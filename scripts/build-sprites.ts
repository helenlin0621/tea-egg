// Turn the PNG sprite sheets in art-source/ into 48×48 pixel data that all share one palette of ≤32 colors.
//
// Output: hooks/sprites.ts (non-spoiler), art-build/spoiler_sprites.json (spoilers, encoded later by encode-spoilers.ts),
//         art-build/preview.png (each sprite 4x on dark gray in one row, for manual review),
//         art-build/terminal/<name>.png (terminal sprites at native 48×48 on magenta, as a base for manual touch-ups)
// Hand-edited terminal sprites: when art-source/terminal/<name>.png (48×48, magenta 255,0,255 = transparent) exists, it's used as is instead of being computed from the sheet
// Usage: npm run sprites [-- --source DIR]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngjs from 'pngjs'

const { PNG } = pngjs
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 48
const COLORS = 32
const SEP_RATIO = 0.97
const ROW_GAP = 0.04 // merge row separator gaps smaller than 4% of the image height
const COL_GAP = 0.02 // merge column separator gaps smaller than 2% of the image width
const DIGITS = '0123456789abcdefghijklmnopqrstuv'
const PREVIEW_SCALE = 4

type Img = { width: number; height: number; data: Uint8Array } // RGBA
type Rgba = [number, number, number, number]
type Rgb = [number, number, number]
// potAnchor: every cell in this sheet has the same pot; the HD version normalizes size by pot width
type Sheet = { file: string; cells: string[]; spoiler?: boolean; potAnchor?: boolean }
// hdOverride: use this 144×144 transparent PNG directly as a sprite's high-res image (e.g. a hand-fixed one)
type Manifest = { faceBox?: [number, number, number, number] | null; sheets: Sheet[]; hdOverride?: Record<string, string> }

function pixel(img: Img, x: number, y: number): Rgba {
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
}

// AI-generated images have anti-aliased fringes against the magenta background, so the test is relaxed
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

// Runs of false (non-separator) → [start, end); separators in between shorter than minGap are merged
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

// ---- Sampling aligned to the source grid ----
// In AI-generated "pixel art" each pixel is a block of roughly 8–24 real pixels (sizes not perfectly uniform).
// Plain nearest-neighbor down to 48×48 makes some pixels take 1 cell and others 2, which looks jagged.
// Approach: per axis, find block size b and offset o from a histogram of color jumps, then sample each block's center.
const EDGE_DIFF = 60 // adjacent pixels with |dr|+|dg|+|db| above this count as one color jump
const B_MIN = 8, B_MAX = 24, B_STEP = 0.25, O_STEP = 0.1
const SMALL_BLOCK_PENALTY = 0.02 // slight penalty for small blocks (so the grid doesn't get so fine that it covers everything)
// Grid score = jump mass of the best grid ÷ average mass of all candidate grids (lift). Real images score about 2.5–3.1.
// Below this (close to 1: any cut is about as good = no grid at all) fall back to the old crop + scale.
// Note: make-test-sheet's synthetic egg outlines are stair-stepped and also fit a fake grid of about 2.7, so they still take the grid path (harmless, just meaningless); this threshold only stops truly structureless images.
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

// fixedB: only search the grid offset, with a fixed block size (for a cell misdetected within a sheet)
function fitAxis(e: number[], fixedB?: number): { b: number; o: number; score: number } {
  let sum = 0, cnt = 0
  const n = e.length
  const tot = e.reduce((s, v) => s + v, 0) || 1
  let best = { b: B_MIN, o: 0, score: 0 }
  let bestAdj = -Infinity
  for (let b = fixedB ?? B_MIN; b <= (fixedB ?? B_MAX); b += B_STEP) {
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
      if (score > bestAdj) { bestAdj = score; best = { b, o, score: raw } } // pick the best by penalized score; report the unpenalized ratio
    }
  }
  // Report "best grid score ÷ average score of all candidates": far above 1 with a real grid, close to 1 without one (any cut is about as good)
  return { ...best, score: best.score / (sum / cnt) }
}

// Crop to the non-magenta area (returns the bbox); null if it's all magenta
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

// Sample a "native" pixel image on the grid (block = 1 pixel), magenta → transparent, cropped to the opaque area
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
  // Remove magenta fringes: opaque pixels that are purplish (r and b clearly above g, and b > 70) and touch transparency (up/down/left/right) become transparent.
  // Blue zZ (low r) and pink blush (b not clearly above g) are unaffected.
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

// Old approach (fallback without a grid): crop to non-magenta → pad to a square → nearest-neighbor down to SIZE×SIZE
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

function toSize(cell: Img, force?: { bx: number; by: number }): SpriteInfo {
  const fx = fitAxis(edgeHistogram(cell, 0), force?.bx), fy = fitAxis(edgeHistogram(cell, 1), force?.by)
  const native = fx.score >= GRID_MIN_SCORE && fy.score >= GRID_MIN_SCORE ? sampleNative(cell, fx.b, fx.o, fy.b, fy.o) : null
  if (!native) return { img: cropAndResize(cell), mode: 'fallback', bx: fx.b, by: fy.b, scoreX: fx.score, scoreY: fy.score }
  // Shrink (nearest-neighbor) only when larger than SIZE; otherwise no scaling. Center horizontally, align to the bottom (so the pots line up across sprites)
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

// median cut: repeatedly split the box with the widest single-channel range until there are count boxes or none can be split
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

const RARE_DIST = 60 // pixels further than this from the nearest palette color (sum of RGB abs diffs) count as "swallowed rare colors"
const RARE_MAX_ITER = 16

// median cut merges rare but eye-catching colors (blue zZ, green leaves) into dominant ones. This adds them back:
// while some pixel is too far from the palette, merge the two closest palette colors (pixel-count weighted average) and add that pixel's color.
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
    // Find the pixel color furthest from the palette (furthest first, before any pixel-count tie-break)
    let worst: Rgb | null = null, worstD = RARE_DIST
    for (const { c } of distinct) {
      let d = Infinity
      for (const p of palette) d = Math.min(d, dist(p, c))
      if (d > worstD) { worstD = d; worst = c }
    }
    if (!worst) return
    // How many pixels each palette color currently stands for
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

// All sprites share one palette of ≤COLORS colors; keep only colors actually used
// paletteFrom: only these images feed the median cut (hand-edited sprites are left out so editing one doesn't shift the others' colors);
// new colors in hand-edited sprites that are too far from the palette are still added by protectRare
function quantize(images: Map<string, Img>, paletteFrom: Map<string, Img> = images): { palette: number[]; grids: Map<string, string> } {
  const pixels = (imgs: Iterable<Img>) => {
    const out: Rgb[] = []
    for (const img of imgs) {
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3]! > 0) out.push([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!])
      }
    }
    return out
  }
  const base = pixels(paletteFrom.values())
  const raw = medianCut(base, COLORS)
  protectRare(raw, base)
  // Second pass looks only at hand-edited sprites: nothing changes when they reuse existing colors; only new colors get added
  protectRare(raw, pixels([...images].filter(([n, img]) => paletteFrom.get(n) !== img).map(([, img]) => img)))
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
    '// Generated by scripts/build-sprites.ts. Do not edit by hand.',
    `// Pixel strings: ${SIZE}×${SIZE} row by row, '.' transparent, 0–9 and a–v are PALETTE indices (base-32).`,
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

// Public sprites scaled PREVIEW_SCALE times on dark gray, in one row
// Each terminal sprite is saved as a 48×48 PNG with magenta for transparency (Paint doesn't support transparency)
function writeTerminalPngs(dir: string, palette: number[], sprites: Map<string, string>): void {
  mkdirSync(dir, { recursive: true })
  for (const [name, px] of sprites) {
    const png = new PNG({ width: SIZE, height: SIZE })
    for (let i = 0; i < SIZE * SIZE; i++) {
      const c = px[i]!
      const rgb = c === '.' ? 0xff00ff : palette[parseInt(c, 32)]!
      png.data.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i * 4)
    }
    writeFileSync(join(dir, `${name}.png`), PNG.sync.write(png))
  }
}

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


// ---- High-res (HD) version: soft-key the source → crop → area-average downscale → 144×144 canvas ----
const HD_CANVAS = 144
const HD_FIT = 136
const HD_BOTTOM = 4
const KEY_FULL = 150 // m = min(r,b) − g above this: fully transparent
const KEY_SOFT = 60 // in between: semi-transparent with the magenta spill removed

function softKey(cell: Img): Img {
  const out = blank(cell.width, cell.height, [0, 0, 0, 0])
  for (let i = 0; i < cell.data.length; i += 4) {
    let r = cell.data[i]!, g = cell.data[i + 1]!, b = cell.data[i + 2]!
    let a = cell.data[i + 3]!
    const m = Math.min(r, b) - g
    if (m > KEY_FULL) a = 0
    else if (m > KEY_SOFT) {
      a = Math.round((a * (KEY_FULL - m)) / (KEY_FULL - KEY_SOFT))
      r = Math.max(0, r - (m - KEY_SOFT)); b = Math.max(0, b - (m - KEY_SOFT))
    }
    out.data.set([r, g, b, a], i)
  }
  return out
}

// Area average (box filter) in premultiplied-alpha space; degrades to nearest-neighbor when upscaling
function boxScale(src: Img, w: number, h: number): Img {
  const out = blank(w, h, [0, 0, 0, 0])
  const sx = src.width / w, sy = src.height / h
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx
      let r = 0, g = 0, b = 0, a = 0, wsum = 0
      for (let j = Math.floor(y0); j < Math.min(src.height, Math.ceil(y1)); j++) {
        const wy = Math.min(j + 1, y1) - Math.max(j, y0)
        for (let i = Math.floor(x0); i < Math.min(src.width, Math.ceil(x1)); i++) {
          const wt = wy * (Math.min(i + 1, x1) - Math.max(i, x0))
          const k = (j * src.width + i) * 4
          const al = src.data[k + 3]! / 255
          r += src.data[k]! * al * wt; g += src.data[k + 1]! * al * wt; b += src.data[k + 2]! * al * wt
          a += al * wt; wsum += wt
        }
      }
      if (wsum === 0 || a === 0) continue
      out.data.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / wsum) * 255)], (y * w + x) * 4)
    }
  }
  return out
}

// Key out the background and crop to the content
function hdBody(cell: Img): Img | null {
  const keyed = softKey(cell)
  const box = bboxAlpha(keyed)
  return box ? crop(keyed, ...box) : null
}

// Pot width: the widest row of opaque pixels within the bottom 35% of the content
const POT_ZONE = 0.35
function potWidth(body: Img): number {
  let widest = 0
  for (let y = Math.floor(body.height * (1 - POT_ZONE)); y < body.height; y++) {
    let lo = -1, hi = -1
    for (let x = 0; x < body.width; x++) {
      if (body.data[(y * body.width + x) * 4 + 3]! > 128) { if (lo < 0) lo = x; hi = x }
    }
    if (lo >= 0) widest = Math.max(widest, hi - lo + 1)
  }
  return widest || body.width
}

// Sprites in one group (sheets marked potAnchor in the manifest) share a "pot width": each is scaled to the same pot width,
// using the largest pot width at which every sprite fits HD_FIT, so sprites with zZ or sparkles aren't shrunk more
function anchoredScales(bodies: Map<string, Img>): Map<string, number> {
  let target = Infinity
  const pots = new Map<string, number>()
  for (const [name, b] of bodies) {
    const p = potWidth(b)
    pots.set(name, p)
    target = Math.min(target, (HD_FIT * p) / b.width, (HD_FIT * p) / b.height)
  }
  return new Map([...pots].map(([name, p]) => [name, target / p] as const))
}

// Mode downscale: each output pixel takes the most frequent color in its source area (no averaging, so edges stay crisp); transparent if less than half is opaque
function modeScale(src: Img, w: number, h: number): Img {
  const out = blank(w, h, [0, 0, 0, 0])
  const sx = src.width / w, sy = src.height / h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const counts = new Map<number, { n: number; c: Rgb }>()
      let total = 0, opaque = 0
      for (let j = Math.floor(y * sy); j < Math.max(Math.floor((y + 1) * sy), Math.floor(y * sy) + 1); j++) {
        for (let i = Math.floor(x * sx); i < Math.max(Math.floor((x + 1) * sx), Math.floor(x * sx) + 1); i++) {
          total++
          const p = pixel(src, Math.min(i, src.width - 1), Math.min(j, src.height - 1))
          if (p[3] <= 128) continue
          opaque++
          const k = ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3)
          const e = counts.get(k)
          if (e) e.n++; else counts.set(k, { n: 1, c: [p[0], p[1], p[2]] })
        }
      }
      if (opaque * 2 < total) continue
      let best: Rgb = [0, 0, 0], bn = 0
      for (const { n, c } of counts.values()) if (n > bn) { bn = n; best = c }
      out.data.set([...best, 255], (y * w + x) * 4)
    }
  }
  return out
}

// Cells that don't match the grid (e.g. pasted by hand with different block proportions): mode-downscale the keyed source so the pot width matches the other cells in the sheet
function toSizeByPot(body: Img, potTarget: number): Img {
  const r = potTarget / potWidth(body)
  const w = Math.min(SIZE, Math.max(1, Math.round(body.width * r))), h = Math.min(SIZE, Math.max(1, Math.round(body.height * r)))
  const sprite = modeScale(body, w, h)
  const out = blank(SIZE, SIZE, [0, 0, 0, 0])
  const ox = Math.floor((SIZE - w) / 2), oy = SIZE - h
  for (let y = 0; y < h; y++) out.data.set(sprite.data.subarray(y * w * 4, (y + 1) * w * 4), ((y + oy) * SIZE + ox) * 4)
  return out
}

function toHd(body: Img, scale?: number): Img {
  const r = scale ?? Math.min(HD_FIT / body.width, HD_FIT / body.height)
  const w = Math.max(1, Math.round(body.width * r)), h = Math.max(1, Math.round(body.height * r))
  const sprite = boxScale(body, Math.min(w, HD_FIT), Math.min(h, HD_FIT))
  const out = blank(HD_CANVAS, HD_CANVAS, [0, 0, 0, 0])
  const ox = Math.floor((HD_CANVAS - sprite.width) / 2), oy = HD_CANVAS - HD_BOTTOM - sprite.height
  for (let y = 0; y < sprite.height; y++) {
    out.data.set(sprite.data.subarray(y * sprite.width * 4, (y + 1) * sprite.width * 4), ((y + oy) * HD_CANVAS + ox) * 4)
  }
  return out
}

function pngBase64(img: Img): string {
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data)
  return PNG.sync.write(png).toString('base64')
}

function writeHdTs(path: string, sprites: Map<string, string>): void {
  const lines = [
    '// Generated by scripts/build-sprites.ts. Do not edit by hand.',
    '// High-res sprites for the desktop pane: base64 of 144×144 transparent PNGs.',
    '',
    'export const SPRITES_HD: Readonly<Record<string, string>> = {',
  ]
  for (const [name, b64] of sprites) lines.push(`  ${name}: '${b64}',`)
  lines.push('}')
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
}

// All HD sprites (spoilers included) on dark brown cards in one row, for manual review
function writeHdPreview(path: string, images: Map<string, Img>): void {
  const pad = 8
  const n = Math.max(images.size, 1)
  const png = new PNG({ width: pad + n * (HD_CANVAS + pad), height: HD_CANVAS + pad * 2 })
  for (let i = 0; i < png.data.length; i += 4) png.data.set([0x3b, 0x2f, 0x2a, 255], i)
  let k = 0
  for (const img of images.values()) {
    const ox = pad + k * (HD_CANVAS + pad)
    for (let y = 0; y < HD_CANVAS; y++) {
      for (let x = 0; x < HD_CANVAS; x++) {
        const s = (y * HD_CANVAS + x) * 4
        const al = img.data[s + 3]! / 255
        const d = ((pad + y) * png.width + ox + x) * 4
        for (let c = 0; c < 3; c++) png.data[d + c] = Math.round(img.data[s + c]! * al + png.data[d + c]! * (1 - al))
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
  const hd = new Map<string, Img>()
  const anchored = new Map<string, Img>()
  for (const sheet of manifest.sheets) {
    const png = PNG.sync.read(readFileSync(join(src, sheet.file)))
    const cells = splitSheet({ width: png.width, height: png.height, data: png.data })
    if (cells.length !== sheet.cells.length) {
      console.error(`${sheet.file}: cut into ${cells.length} cells, but the manifest lists ${sheet.cells.length}`)
      return 1
    }
    // If the block size differs too much from most cells in the sheet (e.g. a cell pasted by hand at another scale), use the majority size so that sprite doesn't come out bigger or smaller
    const infos = cells.map(c => toSize(c))
    const grid = infos.filter(f => f.mode === 'grid')
    const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]!
    const ref = grid.length ? { bx: median(grid.map(f => f.bx)), by: median(grid.map(f => f.by)) } : null
    const potTarget = sheet.potAnchor && grid.length ? median(grid.map(f => potWidth(f.img))) : null
    sheet.cells.forEach((name, i) => {
      let info = infos[i]!
      if (ref && (Math.abs(info.bx / ref.bx - 1) > 0.1 || Math.abs(info.by / ref.by - 1) > 0.1)) {
        console.log(`  ${name}: block ${info.bx.toFixed(2)}×${info.by.toFixed(2)} differs from most cells; using ${ref.bx.toFixed(2)}×${ref.by.toFixed(2)}`)
        info = toSize(cells[i]!, ref)
      }
      const body = hdBody(cells[i]!)
      if (info.mode === 'fallback' && potTarget && body) {
        console.log(`  ${name}: no grid match; using a mode downscale of the source, pot width aligned to ${potTarget}`)
        info = { ...info, img: toSizeByPot(body, potTarget) }
      }
      images.set(name, info.img)
      if (body && sheet.potAnchor) anchored.set(name, body)
      else if (body) hd.set(name, toHd(body))
      console.log(`  ${name}: ${info.mode} block ${info.bx.toFixed(2)}×${info.by.toFixed(2)}, grid score ${info.scoreX.toFixed(2)}/${info.scoreY.toFixed(2)}`)
      if (sheet.spoiler) spoilerNames.add(name)
    })
  }
  for (const [name, scale] of anchoredScales(anchored)) hd.set(name, toHd(anchored.get(name)!, scale))
  for (const [name, file] of Object.entries(manifest.hdOverride ?? {})) {
    const png = PNG.sync.read(readFileSync(join(src, file)))
    if (png.width !== HD_CANVAS || png.height !== HD_CANVAS) {
      console.error(`${file}: the high-res override must be ${HD_CANVAS}×${HD_CANVAS}`)
      return 1
    }
    hd.set(name, { width: png.width, height: png.height, data: png.data })
    console.log(`  ${name}: high-res sprite from ${file}`)
  }
  const auto = new Map(images)
  for (const name of auto.keys()) {
    const file = join(src, 'terminal', `${name}.png`)
    if (!existsSync(file)) continue
    const png = PNG.sync.read(readFileSync(file))
    if (png.width !== SIZE || png.height !== SIZE) {
      console.error(`terminal/${name}.png: a hand-edited terminal sprite must be ${SIZE}×${SIZE}`)
      return 1
    }
    const img: Img = { width: SIZE, height: SIZE, data: new Uint8Array(png.data) }
    for (let i = 0; i < img.data.length; i += 4) {
      if (isMagenta([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!])) img.data.set([0, 0, 0, 0], i)
      else img.data[i + 3] = 255
    }
    images.set(name, img)
    console.log(`  ${name}: terminal sprite from terminal/${name}.png`)
  }
  const { palette, grids } = quantize(images, auto)
  const pub = new Map([...grids].filter(([n]) => !spoilerNames.has(n)))
  const secret = Object.fromEntries([...grids].filter(([n]) => spoilerNames.has(n)))
  writeTs(join(ROOT, 'hooks', 'sprites.ts'), palette, pub, manifest.faceBox ?? null)
  mkdirSync(join(ROOT, 'art-build'), { recursive: true })
  writeFileSync(join(ROOT, 'art-build', 'spoiler_sprites.json'), JSON.stringify(secret), 'utf8')
  writePreview(join(ROOT, 'art-build', 'preview.png'), palette, pub)
  writeTerminalPngs(join(ROOT, 'art-build', 'terminal'), palette, grids)
  const hdB64 = new Map([...hd].map(([n, img]) => [n, pngBase64(img)] as const))
  writeHdTs(join(ROOT, 'hooks', 'sprites-hd.ts'), new Map([...hdB64].filter(([n]) => !spoilerNames.has(n))))
  writeFileSync(join(ROOT, 'art-build', 'spoiler_sprites_hd.json'), JSON.stringify(Object.fromEntries([...hdB64].filter(([n]) => spoilerNames.has(n)))), 'utf8')
  writeHdPreview(join(ROOT, 'art-build', 'preview-hd.png'), hd)
  console.log(`Palette ${palette.length} colors; ${pub.size} public (${hd.size} HD), ${Object.keys(secret).length} encoded`)
  return 0
}

process.exit(main(process.argv.slice(2)))
