export const SIZE = 48
export const RASTER_ROWS = SIZE / 2

const UPPER = 0x2580
const LOWER = 0x2584
const SPACE = 0x20
const DEFAULT = 0x01000000

export type Layer = { pixels: string; box?: readonly [number, number, number, number] }

// 依序疊圖：後面的圖層在 box 範圍內覆蓋不透明像素（成長提示的疊加圖層也用這個）
export function compose(layers: readonly Layer[]): string {
  const out = (layers[0]?.pixels ?? '.'.repeat(SIZE * SIZE)).split('')
  for (const layer of layers.slice(1)) {
    const [x0, y0, x1, y1] = layer.box ?? [0, 0, SIZE, SIZE]
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = layer.pixels[y * SIZE + x]
        if (c !== undefined && c !== '.') out[y * SIZE + x] = c
      }
    }
  }
  return out.join('')
}

// 像素字元：'.' 透明；0–9、a–v 為調色盤索引（base-32）
function color(c: string | undefined, palette: readonly number[]): number | null {
  if (c === undefined || c === '.') return null
  return palette[parseInt(c, 32)] ?? null
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

// 一格 = 上下兩個像素。上有色用 ▀（前景=上、背景=下）；只有下有色用 ▄；都透明用空白
export function rasterCells(pixels: string, palette: readonly number[]): string {
  const view = new DataView(new ArrayBuffer(SIZE * RASTER_ROWS * 12))
  let o = 0
  const put = (n: number) => { view.setUint32(o, n, true); o += 4 }
  for (let row = 0; row < RASTER_ROWS; row++) {
    for (let x = 0; x < SIZE; x++) {
      const top = color(pixels[row * 2 * SIZE + x], palette)
      const bottom = color(pixels[(row * 2 + 1) * SIZE + x], palette)
      if (top !== null) { put(UPPER); put(top); put(bottom ?? DEFAULT) }
      else if (bottom !== null) { put(LOWER); put(bottom); put(DEFAULT) }
      else { put(SPACE); put(DEFAULT); put(DEFAULT) }
    }
  }
  return toBase64(new Uint8Array(view.buffer))
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

export function svgSource(pixels: string, palette: readonly number[], scale: number): string {
  const rects: string[] = []
  for (let y = 0; y < SIZE; y++) {
    let x = 0
    while (x < SIZE) {
      const c = pixels[y * SIZE + x]
      const fill = color(c, palette)
      let run = 1
      while (x + run < SIZE && pixels[y * SIZE + x + run] === c) run++
      if (fill !== null) rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${hex(fill)}"/>`)
      x += run
    }
  }
  const px = SIZE * scale
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${px}" height="${px}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}
