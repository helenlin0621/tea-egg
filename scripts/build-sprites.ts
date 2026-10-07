// 把 art-source/ 的 PNG 拼圖轉成 48×48、全套共用 ≤32 色的像素資料。
//
// 輸出：hooks/sprites.ts（非劇透）、art-build/spoiler_sprites.json（劇透，之後由 encode-spoilers.ts 編碼）、
//       art-build/preview.png（每張放大 4 倍、深灰底排成一列，人工確認用）
// 用法：npm run sprites [-- --source 資料夾]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngjs from 'pngjs'

const { PNG } = pngjs
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 48
const COLORS = 32
const SEP_RATIO = 0.97
const ROW_GAP = 0.04 // 小於圖高 4% 的列分隔間隙要合併
const COL_GAP = 0.02 // 小於圖寬 2% 的欄分隔間隙要合併
const DIGITS = '0123456789abcdefghijklmnopqrstuv'
const PREVIEW_SCALE = 4

type Img = { width: number; height: number; data: Uint8Array } // RGBA
type Rgba = [number, number, number, number]
type Rgb = [number, number, number]
type Sheet = { file: string; cells: string[]; spoiler?: boolean }
type Manifest = { faceBox?: [number, number, number, number] | null; sheets: Sheet[] }

function pixel(img: Img, x: number, y: number): Rgba {
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
}

// AI 生成的圖在洋紅底的邊緣有抗鋸齒雜邊，所以條件放寬
function isMagenta([r, g, b, a]: Rgba): boolean {
  return a < 128 || (r > 150 && b > 150 && g < 120)
}

function blank(width: number, height: number, fill: Rgba): Img {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(fill, i)
  return { width, height, data }
}

function crop(img: Img, x0: number, y0: number, x1: number, y1: number): Img {
  const out = blank(x1 - x0, y1 - y0, [0, 0, 0, 0])
  for (let y = y0; y < y1; y++) {
    out.data.set(img.data.subarray((y * img.width + x0) * 4, (y * img.width + x1) * 4), (y - y0) * out.width * 4)
  }
  return out
}

// 連續為 false（非分隔）的區段 → [start, end)；中間夾的分隔若短於 minGap 就併起來
function runs(isSep: boolean[], minGap: number): [number, number][] {
  const raw: [number, number][] = []
  let start = -1
  isSep.forEach((sep, i) => {
    if (!sep && start < 0) start = i
    if (sep && start >= 0) { raw.push([start, i]); start = -1 }
  })
  if (start >= 0) raw.push([start, isSep.length])
  const out: [number, number][] = []
  for (const run of raw) {
    const last = out[out.length - 1]
    if (last && run[0] - last[1] < minGap) last[1] = run[1]
    else out.push([run[0], run[1]])
  }
  return out
}

function splitSheet(img: Img): Img[] {
  const rowSep = Array.from({ length: img.height }, (_, y) => {
    let n = 0
    for (let x = 0; x < img.width; x++) if (isMagenta(pixel(img, x, y))) n++
    return n >= img.width * SEP_RATIO
  })
  const cells: Img[] = []
  for (const [y0, y1] of runs(rowSep, img.height * ROW_GAP)) {
    const colSep = Array.from({ length: img.width }, (_, x) => {
      let n = 0
      for (let y = y0; y < y1; y++) if (isMagenta(pixel(img, x, y))) n++
      return n >= (y1 - y0) * SEP_RATIO
    })
    for (const [x0, x1] of runs(colSep, img.width * COL_GAP)) cells.push(crop(img, x0, y0, x1, y1))
  }
  return cells
}

// ---- 對齊原圖格線取樣 ----
// AI 生成的「像素圖」每個畫素是約 8–24 個真實像素的色塊（大小不完全一致）。
// 直接最近鄰縮成 48×48 會讓部分畫素佔 1 格、部分佔 2 格而鋸齒。
// 做法：每個軸各自用「顏色跳變直方圖」找出色塊大小 b 與起點 o，再在每個色塊中心取樣。
const EDGE_DIFF = 60 // 相鄰像素 |dr|+|dg|+|db| 超過此值算一次顏色跳變
const B_MIN = 8, B_MAX = 24, B_STEP = 0.25, O_STEP = 0.1
const SMALL_BLOCK_PENALTY = 0.02 // 對小色塊的輕微扣分（避免格線細到什麼都蓋到）
// 格線分數 = 最佳格線的跳變質量 ÷ 所有候選格線的平均質量（lift）。真實圖約 2.5–3.1。
// 低於此值（接近 1：隨便切都差不多＝完全沒格線）才退回舊的裁切＋縮放。
// 注意：make-test-sheet 的合成蛋輪廓是階梯狀，也會擬合出約 2.7 的假格線，所以仍走 grid 路徑（不會崩，只是沒意義）；此門檻只擋真正無結構的圖。
const GRID_MIN_SCORE = 1.5

function edgeHistogram(cell: Img, axis: 0 | 1): number[] {
  const n = axis === 0 ? cell.width : cell.height
  const m = axis === 0 ? cell.height : cell.width
  const e = new Array<number>(n).fill(0)
  for (let j = 0; j < m; j++) {
    for (let i = 1; i < n; i++) {
      const a = axis === 0 ? pixel(cell, i, j) : pixel(cell, j, i)
      const b = axis === 0 ? pixel(cell, i - 1, j) : pixel(cell, j, i - 1)
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > EDGE_DIFF) e[i]!++
    }
  }
  return e
}

function fitAxis(e: number[]): { b: number; o: number; score: number } {
  let sum = 0, cnt = 0
  const n = e.length
  const tot = e.reduce((s, v) => s + v, 0) || 1
  let best = { b: B_MIN, o: 0, score: 0 }
  let bestAdj = -Infinity
  for (let b = B_MIN; b <= B_MAX; b += B_STEP) {
    for (let o10 = 0; o10 < Math.round(b / O_STEP); o10++) {
      const o = o10 * O_STEP
      let s = 0
      for (let k = o; k < n; k += b) {
        const i = Math.round(k)
        for (let d = -1; d <= 1; d++) if (i + d >= 0 && i + d < n) s += e[i + d]! * (d === 0 ? 1 : 0.5)
      }
      const raw = s / tot
      sum += raw; cnt++
      const score = raw - (SMALL_BLOCK_PENALTY * (n / b)) / 10
      if (score > bestAdj) { bestAdj = score; best = { b, o, score: raw } } // 以含扣分的分數選最佳；回報未扣分的比例
    }
  }
  // 回報「最佳格線分數 ÷ 所有候選格線的平均分數」：真有格線時遠大於 1，沒格線（隨便切都差不多）時接近 1
  return { ...best, score: best.score / (sum / cnt) }
}

// 裁到非洋紅範圍（回傳 bbox）；全洋紅則回傳 null
function bbox(img: Img): [number, number, number, number] | null {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (isMagenta(pixel(img, x, y))) continue
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
  }
  return maxX < 0 ? null : [minX, minY, maxX + 1, maxY + 1]
}

// 依格線取樣成「原生」像素圖（色塊 = 1 畫素），洋紅變透明，裁到非透明範圍
function sampleNative(cell: Img, bx: number, ox: number, by: number, oy: number): Img | null {
  const nx = Math.floor((cell.width - ox) / bx), ny = Math.floor((cell.height - oy) / by)
  const out = blank(nx, ny, [0, 0, 0, 0])
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = Math.floor(ox + (i + 0.5) * bx), y = Math.floor(oy + (j + 0.5) * by)
      if (x >= cell.width || y >= cell.height) continue
      const p = pixel(cell, x, y)
      if (!isMagenta(p)) out.data.set([p[0], p[1], p[2], 255], (j * nx + i) * 4)
    }
  }
  // 去除邊緣的洋紅殘影：偏紫（r、b 都明顯高於 g，且 b > 70）且貼著透明（上下左右）的不透明畫素改成透明。
  // 藍色 zZ（r 低）與粉紅腮紅（b 沒有明顯高於 g）不受影響。
  const isClear = (x: number, y: number) => x < 0 || y < 0 || x >= nx || y >= ny || out.data[(y * nx + x) * 4 + 3]! === 0
  const fringe: number[] = []
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = (y * nx + x) * 4
      if (out.data[i + 3]! === 0) continue
      const r = out.data[i]!, g = out.data[i + 1]!, b = out.data[i + 2]!
      if (r > g + 40 && b > g + 40 && b > 70 && (isClear(x - 1, y) || isClear(x + 1, y) || isClear(x, y - 1) || isClear(x, y + 1))) fringe.push(i)
    }
  }
  for (const i of fringe) out.data.set([0, 0, 0, 0], i)
  const box = bboxAlpha(out)
  return box ? crop(out, ...box) : null
}

function bboxAlpha(img: Img): [number, number, number, number] | null {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]! === 0) continue
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
  }
  return maxX < 0 ? null : [minX, minY, maxX + 1, maxY + 1]
}

// 舊做法（沒有格線時的退路）：裁到非洋紅範圍 → 補成正方形 → 最近鄰縮成 SIZE×SIZE
function cropAndResize(cell: Img): Img {
  const box = bbox(cell)
  const body = box ? crop(cell, ...box) : cell
  const side = Math.max(body.width, body.height)
  const square = blank(side, side, [255, 0, 255, 255])
  const ox = Math.floor((side - body.width) / 2)
  const oy = Math.floor((side - body.height) / 2)
  for (let y = 0; y < body.height; y++) {
    square.data.set(body.data.subarray(y * body.width * 4, (y + 1) * body.width * 4), ((y + oy) * side + ox) * 4)
  }
  const out = blank(SIZE, SIZE, [0, 0, 0, 0])
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const p = pixel(square, Math.floor(((x + 0.5) * side) / SIZE), Math.floor(((y + 0.5) * side) / SIZE))
      if (!isMagenta(p)) out.data.set([p[0], p[1], p[2], 255], (y * SIZE + x) * 4)
    }
  }
  return out
}

type SpriteInfo = { img: Img; mode: 'grid' | 'fallback'; bx: number; by: number; scoreX: number; scoreY: number }

function toSize(cell: Img): SpriteInfo {
  const fx = fitAxis(edgeHistogram(cell, 0)), fy = fitAxis(edgeHistogram(cell, 1))
  const native = fx.score >= GRID_MIN_SCORE && fy.score >= GRID_MIN_SCORE ? sampleNative(cell, fx.b, fx.o, fy.b, fy.o) : null
  if (!native) return { img: cropAndResize(cell), mode: 'fallback', bx: fx.b, by: fy.b, scoreX: fx.score, scoreY: fy.score }
  // 超過 SIZE 才最近鄰縮小到放得下；否則不縮放。水平置中、底部對齊（讓花盆在各張間對齊）
  let sprite = native
  const longest = Math.max(native.width, native.height)
  if (longest > SIZE) {
    const r = SIZE / longest
    const w = Math.max(1, Math.floor(native.width * r)), h = Math.max(1, Math.floor(native.height * r))
    const scaled = blank(w, h, [0, 0, 0, 0])
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = pixel(native, Math.min(native.width - 1, Math.floor((x + 0.5) / r)), Math.min(native.height - 1, Math.floor((y + 0.5) / r)))
        scaled.data.set(p, (y * w + x) * 4)
      }
    }
    sprite = scaled
  }
  const out = blank(SIZE, SIZE, [0, 0, 0, 0])
  const ox = Math.floor((SIZE - sprite.width) / 2), oy = SIZE - sprite.height
  for (let y = 0; y < sprite.height; y++) {
    out.data.set(sprite.data.subarray(y * sprite.width * 4, (y + 1) * sprite.width * 4), ((y + oy) * SIZE + ox) * 4)
  }
  return { img: out, mode: 'grid', bx: fx.b, by: fy.b, scoreX: fx.score, scoreY: fy.score }
}

// median cut：每次切開「單一色版範圍最大」的盒子，直到 count 個或無法再切
function medianCut(colors: Rgb[], count: number): Rgb[] {
  if (colors.length === 0) return []
  const boxes: Rgb[][] = [colors]
  while (boxes.length < count) {
    let best = -1, bestRange = 0, bestCh = 0
    boxes.forEach((box, i) => {
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0
        for (const c of box) { lo = Math.min(lo, c[ch]!); hi = Math.max(hi, c[ch]!) }
        if (hi - lo > bestRange) { bestRange = hi - lo; best = i; bestCh = ch }
      }
    })
    if (best < 0) break
    const sorted = [...boxes[best]!].sort((a, b) => a[bestCh]! - b[bestCh]!)
    const mid = sorted.length >> 1
    boxes.splice(best, 1, sorted.slice(0, mid), sorted.slice(mid))
  }
  return boxes.map(box => {
    const sum = box.reduce((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0])
    return sum.map(v => Math.round(v / box.length)) as Rgb
  })
}

function nearest(palette: Rgb[], c: Rgb): number {
  let best = 0, bestD = Infinity
  palette.forEach((p, i) => {
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

const RARE_DIST = 60 // 與最近調色盤色相差（RGB 絕對差總和）超過此值的像素算「被吃掉的稀有色」
const RARE_MAX_ITER = 16

// median cut 會把稀有但顯眼的色（如藍色 zZ、綠葉）併進大宗色。這裡把這些色補回：
// 只要還有像素離調色盤太遠，就把最接近的兩個調色盤色（依像素數加權平均）合併，並把該像素色加進調色盤。
function protectRare(palette: Rgb[], opaque: Rgb[]): void {
  const dist = (a: Rgb, b: Rgb) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
  const counts = new Map<string, { c: Rgb; n: number }>()
  for (const c of opaque) {
    const k = c.join(",")
    const e = counts.get(k)
    if (e) e.n++; else counts.set(k, { c, n: 1 })
  }
  const distinct = [...counts.values()]
  for (let iter = 0; iter < RARE_MAX_ITER; iter++) {
    // 找離調色盤最遠的像素色（以像素數加權決勝之外，先取最遠者）
    let worst: Rgb | null = null, worstD = RARE_DIST
    for (const { c } of distinct) {
      let d = Infinity
      for (const p of palette) d = Math.min(d, dist(p, c))
      if (d > worstD) { worstD = d; worst = c }
    }
    if (!worst) return
    // 每個調色盤色目前代表多少像素
    const weight = palette.map(() => 0)
    for (const { c, n } of distinct) weight[nearest(palette, c)]! += n
    let bi = 0, bj = 1, bd = Infinity
    for (let i = 0; i < palette.length; i++) {
      for (let j = i + 1; j < palette.length; j++) {
        const d = dist(palette[i]!, palette[j]!)
        if (d < bd) { bd = d; bi = i; bj = j }
      }
    }
    const wi = weight[bi]! || 1, wj = weight[bj]! || 1
    const merged = [0, 1, 2].map(ch => Math.round((palette[bi]![ch]! * wi + palette[bj]![ch]! * wj) / (wi + wj))) as Rgb
    palette[bi] = merged
    palette[bj] = worst
  }
}

// 全部圖共用一組 ≤COLORS 色調色盤；只保留實際用到的顏色
function quantize(images: Map<string, Img>): { palette: number[]; grids: Map<string, string> } {
  const opaque: Rgb[] = []
  for (const img of images.values()) {
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3]! > 0) opaque.push([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!])
    }
  }
  const raw = medianCut(opaque, COLORS)
  protectRare(raw, opaque)
  const index = new Map<string, number[]>()
  const used = new Set<number>()
  for (const [name, img] of images) {
    const idx: number[] = []
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3]! === 0) { idx.push(-1); continue }
      const k = nearest(raw, [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!])
      used.add(k)
      idx.push(k)
    }
    index.set(name, idx)
  }
  const kept = [...used].sort((a, b) => a - b)
  const remap = new Map(kept.map((old, i) => [old, i]))
  const palette = kept.map(k => (raw[k]![0] << 16) | (raw[k]![1] << 8) | raw[k]![2])
  const grids = new Map<string, string>()
  for (const [name, idx] of index) grids.set(name, idx.map(k => (k < 0 ? '.' : DIGITS[remap.get(k)!]!)).join(''))
  return { palette, grids }
}

function writeTs(path: string, palette: number[], sprites: Map<string, string>, faceBox: Manifest['faceBox']): void {
  const lines = [
    '// 本檔由 scripts/build-sprites.ts 產生，請勿手動修改。',
    `// 像素字串：${SIZE}×${SIZE} 逐列，'.' 透明，0–9、a–v 為 PALETTE 索引（base-32）。`,
    '',
    `export const PALETTE: readonly number[] = [${palette.map(c => '0x' + c.toString(16).padStart(6, '0')).join(', ')}]`,
    '',
    `export const FACE_BOX: readonly [number, number, number, number] | null = ${faceBox ? JSON.stringify(faceBox) : 'null'}`,
    '',
    'export const SPRITES: Readonly<Record<string, string>> = {',
  ]
  for (const [name, px] of sprites) {
    lines.push(`  ${name}:`)
    for (let i = 0; i < px.length; i += 96) lines.push(`    '${px.slice(i, i + 96)}'${i + 96 < px.length ? ' +' : ','}`)
  }
  lines.push('}')
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
}

// 公開圖放大 PREVIEW_SCALE 倍、深灰底、排成一列
function writePreview(path: string, palette: number[], sprites: Map<string, string>): void {
  const pad = 8
  const cell = SIZE * PREVIEW_SCALE
  const n = Math.max(sprites.size, 1)
  const png = new PNG({ width: pad + n * (cell + pad), height: cell + pad * 2 })
  for (let i = 0; i < png.data.length; i += 4) png.data.set([40, 40, 40, 255], i)
  let k = 0
  for (const px of sprites.values()) {
    const ox = pad + k * (cell + pad)
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const c = px[y * SIZE + x]!
        if (c === '.') continue
        const rgb = palette[parseInt(c, 32)]!
        for (let dy = 0; dy < PREVIEW_SCALE; dy++) {
          for (let dx = 0; dx < PREVIEW_SCALE; dx++) {
            const i = ((pad + y * PREVIEW_SCALE + dy) * png.width + ox + x * PREVIEW_SCALE + dx) * 4
            png.data.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i)
          }
        }
      }
    }
    k++
  }
  writeFileSync(path, PNG.sync.write(png))
}

function main(argv: string[]): number {
  const at = argv.indexOf('--source')
  const src = resolve(ROOT, at >= 0 && argv[at + 1] ? argv[at + 1]! : 'art-source')
  const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8')) as Manifest
  const images = new Map<string, Img>()
  const spoilerNames = new Set<string>()
  for (const sheet of manifest.sheets) {
    const png = PNG.sync.read(readFileSync(join(src, sheet.file)))
    const cells = splitSheet({ width: png.width, height: png.height, data: png.data })
    if (cells.length !== sheet.cells.length) {
      console.error(`${sheet.file}: 切出 ${cells.length} 格，但 manifest 列了 ${sheet.cells.length} 格`)
      return 1
    }
    sheet.cells.forEach((name, i) => {
      const info = toSize(cells[i]!)
      images.set(name, info.img)
      console.log(`  ${name}: ${info.mode} 色塊 ${info.bx.toFixed(2)}×${info.by.toFixed(2)}，格線分數 ${info.scoreX.toFixed(2)}/${info.scoreY.toFixed(2)}`)
      if (sheet.spoiler) spoilerNames.add(name)
    })
  }
  const { palette, grids } = quantize(images)
  const pub = new Map([...grids].filter(([n]) => !spoilerNames.has(n)))
  const secret = Object.fromEntries([...grids].filter(([n]) => spoilerNames.has(n)))
  writeTs(join(ROOT, 'hooks', 'sprites.ts'), palette, pub, manifest.faceBox ?? null)
  mkdirSync(join(ROOT, 'art-build'), { recursive: true })
  writeFileSync(join(ROOT, 'art-build', 'spoiler_sprites.json'), JSON.stringify(secret), 'utf8')
  writePreview(join(ROOT, 'art-build', 'preview.png'), palette, pub)
  console.log(`調色盤 ${palette.length} 色；公開 ${pub.size} 張、編碼 ${Object.keys(secret).length} 張`)
  return 0
}

process.exit(main(process.argv.slice(2)))
