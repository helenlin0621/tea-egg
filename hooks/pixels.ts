export const SIZE = 48
export const RASTER_ROWS = SIZE / 2

const UPPER = 0x2580
const LOWER = 0x2584
const SPACE = 0x20
const DEFAULT = 0x01000000

export type Layer = { pixels: string; box?: readonly [number, number, number, number] }

// Stack layers in order: later layers overwrite opaque pixels inside their box (growth-hint overlays use this too)
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

// Pixel chars: '.' is transparent; 0–9 and a–v are palette indices (base-32)
function color(c: string | undefined, palette: readonly number[]): number | null {
  if (c === undefined || c === '.') return null
  return palette[parseInt(c, 32)] ?? null
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

// One cell = two stacked pixels. Top colored: ▀ (fg = top, bg = bottom); only bottom colored: ▄; both transparent: space
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

// background: put a rounded backing card under the pixels (so the white steam shows up on light themes)
export function svgSource(pixels: string, palette: readonly number[], scale: number, background?: string): string {
  // One <path> per color, each horizontal run a subpath: about a quarter the size of one <rect> per run
  const runs = new Map<string, string[]>()
  for (let y = 0; y < SIZE; y++) {
    let x = 0
    while (x < SIZE) {
      const c = pixels[y * SIZE + x]
      const fill = color(c, palette)
      let run = 1
      while (x + run < SIZE && pixels[y * SIZE + x + run] === c) run++
      if (fill !== null) {
        const key = hex(fill)
        if (!runs.has(key)) runs.set(key, [])
        runs.get(key)!.push(`M${x} ${y}h${run}v1h-${run}z`)
      }
      x += run
    }
  }
  const back = background ? `<rect width="${SIZE}" height="${SIZE}" rx="3" fill="${background}"/>` : ''
  const paths = [...runs].map(([fill, d]) => `<path fill="${fill}" d="${d.join('')}"/>`).join('')
  const px = SIZE * scale
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${px}" height="${px}" shape-rendering="crispEdges">${back}${paths}</svg>`
}
