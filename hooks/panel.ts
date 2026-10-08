import type { Save } from '../types'
import type { LocalTime } from './clock'
import { compose, rasterCells, svgSource, SIZE, type Layer } from './pixels'
import { decodeSpoilers } from './spoilers'
import { FACE_BOX, ICON_PALETTE, PALETTE, SPRITES } from './sprites'
import { SPRITES_HD } from './sprites-hd'
import { T } from './text'
import { FACE_TEXT, bar, faceOf, hintOf, stageOf, strWidth } from './view'

// The bigger the pixel art, the coarser it looks; 3x (144px) looks the most refined
const SVG_SCALE = 3
export const SVG_PX = SIZE * SVG_SCALE
// Dark brown backing card: without it the white steam is invisible on light themes
const SVG_BACKGROUND = '#3b2f2a'

export const ASCII_EGG: readonly string[][] = [
  ['  .-""-.  ', ' /      \\ ', '|  FACE  |', ' \\      / ', "  '-..-'  "],
  ['  .-""-.  ', ' / ╱    \\ ', '|  FACE  |', ' \\    ╲ / ', "  '-..-'  "],
  ['  .-""-.  ', ' /▓╱▓▓▓▓\\ ', '|▓ FACE ▓|', ' \\▓▓▓╲▓▓/ ', "  '-..-'  "],
  ['  .-""-.  ', ' /█╱████\\ ', '|█ FACE █|', ' \\███╲██/ ', "  '-..-'  "],
]

export type Art = { kind: 'raster'; cells: string } | { kind: 'svg'; source: string } | { kind: 'ascii'; lines: string[] }

// The stage sprites already have a smiling face: happy/normal use the stage sprite, other faces use the full face_<face> sprite.
// No face overlay (FACE_BOX is null); still returns a layer array so growth-hint layers can be appended later
function eggSpriteKey(s: Save, t: LocalTime, now: number): string {
  const face = faceOf(s, t, now)
  return face === 'happy' || face === 'normal' ? `stage${stageOf(s.egg.progress)}` : `face_${face}`
}

export function eggLayers(s: Save, t: LocalTime, now: number): Layer[] {
  const key = eggSpriteKey(s, t, now)
  const base = SPRITES[key]
  const layers: Layer[] = []
  // The FACE_BOX branch is unused for now; kept for future overlay layers
  if (base) layers.push(FACE_BOX && key.startsWith('face_') ? { pixels: base, box: FACE_BOX } : { pixels: base })
  return layers
}

function artOf(pixels: string, surface: string, palette: readonly number[] = PALETTE): Art {
  return surface === 'terminal'
    ? { kind: 'raster', cells: rasterCells(pixels, palette) }
    : { kind: 'svg', source: svgSource(pixels, palette, SVG_SCALE, SVG_BACKGROUND) }
}

// Desktop: embed the original high-res PNG in an SVG when available (dark brown card + <image>), else fall back to the pixel SVG
function hdArt(b64: string | undefined): Art | null {
  if (!b64) return null
  const href = `data:image/png;base64,${b64}`
  const px = SVG_PX
  return {
    kind: 'svg',
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}">` +
      `<rect width="${px}" height="${px}" rx="9" fill="${SVG_BACKGROUND}"/>` +
      `<image width="${px}" height="${px}" href="${href}" xlink:href="${href}"/></svg>`,
  }
}

const FACE_COLS = 4

// Truncate by display width, then pad with spaces (full-width chars take 2 columns, combining marks 0)
function fitWidth(text: string, cols: number): string {
  let out = ''
  for (const ch of text) {
    if (strWidth(out + ch) > cols) break
    out += ch
  }
  return out + ' '.repeat(cols - strWidth(out))
}

export function eggArt(s: Save, t: LocalTime, now: number, surface: string, columns: number): Art {
  const layers = eggLayers(s, t, now)
  const tooNarrow = surface === 'terminal' && columns < SIZE
  if (layers.length === 0 || tooNarrow) {
    const stage = stageOf(s.egg.progress)
    // Only a 4-column face goes inside the frame (parentheses removed) to keep alignment
    const face = fitWidth(FACE_TEXT[faceOf(s, t, now)].replace(/[()]/g, ''), FACE_COLS)
    return { kind: 'ascii', lines: [...ASCII_EGG[stage]!.map(l => l.replace('FACE', face)), `   ${T().stageNames[stage]}`] }
  }
  if (surface !== 'terminal') {
    const hd = hdArt(SPRITES_HD[eggSpriteKey(s, t, now)])
    if (hd) return hd
  }
  return artOf(compose(layers), surface)
}

// Dev preview: step through each public sprite without reading or changing the save
export const PREVIEW_KEYS = [
  'stage0', 'stage1', 'stage2', 'stage3',
  'face_happy', 'face_normal', 'face_bored', 'face_dry', 'face_sleep', 'face_flip', 'face_done',
] as const

// Each label is read in the current language when accessed
export const PREVIEW_LABELS: Readonly<Record<string, string>> = Object.defineProperties(
  {},
  Object.fromEntries(PREVIEW_KEYS.map(key => [key, { enumerable: true, get: () => T().previewLabels[key] }])),
)

// Pick the preview from the command argument: empty = next, number = nth (1-based), or a sprite name; off = stop
export function nextPreview(current: string | null, arg: string): string | null | undefined {
  const a = arg.trim()
  if (a === 'off') return null
  if (a === '') {
    const i = current === null ? -1 : PREVIEW_KEYS.indexOf(current as (typeof PREVIEW_KEYS)[number])
    return PREVIEW_KEYS[(i + 1) % PREVIEW_KEYS.length]
  }
  const n = Number(a)
  if (Number.isInteger(n) && n >= 1 && n <= PREVIEW_KEYS.length) return PREVIEW_KEYS[n - 1]
  return (PREVIEW_KEYS as readonly string[]).includes(a) ? a : undefined
}

export function previewArt(key: string, surface: string, columns: number): Art | null {
  if (surface !== 'terminal') {
    const hd = hdArt(SPRITES_HD[key])
    if (hd) return hd
  } else if (columns < SIZE) {
    return null
  }
  const pixels = SPRITES[key]
  return pixels ? artOf(pixels, surface) : null
}

// Dex sprites (art sets C/D/E) use their own ICON_PALETTE; return null when one is missing and the dex shows text only.
// Always the pixel SVG on desktop: 9 HD icons made the pane too big and desktop drew nothing at all
export function dexArt(id: string, owned: boolean, surface: string): Art | null {
  const pixels = owned ? decodeSpoilers().sprites[id] : SPRITES.locked
  if (!pixels) return null
  return artOf(pixels, surface, ICON_PALETTE)
}

export function panelLines(s: Save, t: LocalTime, now: number): string[] {
  const hint = hintOf(s, now)
  return [
    `${s.egg.name} #${s.egg.no}  ${FACE_TEXT[faceOf(s, t, now)]}`,
    `${T().flavor} ${bar(s.egg.progress, 10)} ${Math.floor(s.egg.progress)}%`,
    `${T().broth} ${bar(s.egg.broth, 10)} ${Math.round(s.egg.broth)}`,
    `${T().mood} ${bar(s.egg.mood, 10)} ${Math.round(s.egg.mood)}`,
    ...(hint ? [hint] : []),
  ]
}
