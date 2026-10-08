import { test, expect } from 'claude-code/testing'
import { compose, rasterCells, svgSource, SIZE } from '../hooks/pixels'

const blank = '.'.repeat(SIZE * SIZE)
const set = (px: string, x: number, y: number, c: string) => {
  const i = y * SIZE + x
  return px.slice(0, i) + c + px.slice(i + 1)
}
const PAL = [0xff0000, 0x00ff00]

function decodeCells(b64: string): number[] {
  const bin = atob(b64)
  const view = new DataView(Uint8Array.from(bin, c => c.charCodeAt(0)).buffer)
  return Array.from({ length: bin.length / 4 }, (_, i) => view.getUint32(i * 4, true))
}

test('Raster: 48 columns × 24 rows; an upper half block maps two stacked pixels', async () => {
  const px = set(set(blank, 0, 0, '0'), 0, 1, '1')
  const words = decodeCells(rasterCells(px, PAL))
  expect(words.length).toBe(48 * 24 * 3)
  expect(words.slice(0, 3)).toEqual([0x2580, 0xff0000, 0x00ff00])
})

test('Raster: lower half block when only the bottom is colored; transparent uses the terminal default color', async () => {
  const words = decodeCells(rasterCells(set(blank, 1, 1, '0'), PAL))
  expect(words.slice(3, 6)).toEqual([0x2584, 0xff0000, 0x01000000])
  expect(words.slice(6, 9)).toEqual([0x20, 0x01000000, 0x01000000])
})

test('Raster: indices 10–31 decode from a–v (base-32)', async () => {
  const pal = Array.from({ length: 32 }, (_, i) => i)
  const words = decodeCells(rasterCells(set(set(blank, 0, 0, 'a'), 0, 1, 'v'), pal))
  expect(words.slice(0, 3)).toEqual([0x2580, 10, 31])
})

test('SVG: one path per color, adjacent same-color pixels merge; transparent pixels are not drawn', async () => {
  const px = set(set(set(set(blank, 0, 0, '0'), 1, 0, '0'), 3, 0, '1'), 0, 1, '0')
  const svg = svgSource(px, PAL, 4)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.split('<path').length - 1).toBe(2)
  expect(svg.includes('M0 0h2v1h-2z')).toBe(true)
  expect(svg.includes('M0 1h1v1h-1z')).toBe(true)
  expect(svg.includes('#ff00ff')).toBe(false)
})

test('Overlay: only inside the given box, and only opaque pixels overwrite', async () => {
  const base = '0'.repeat(SIZE * SIZE)
  const top = set(set(blank, 5, 5, '1'), 20, 20, '1')
  const out = compose([{ pixels: base }, { pixels: top, box: [0, 0, 10, 10] }])
  expect(out[5 * SIZE + 5]).toBe('1')
  expect(out[20 * SIZE + 20]).toBe('0')
  expect(out[0]).toBe('0')
})
