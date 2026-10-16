import type { Save } from '../types'
import type { LocalTime } from './clock'
import { FIRST_ART, isSpecialDay, specialBand } from './datemode'
import { dateArt, dateLook, timedBand } from './dates'
import { compose, rasterCells, svgSource, SIZE, type Layer } from './pixels'
import { decodeSpoilers } from './spoilers'
import { ICON_OWN_PALETTES, ICON_PALETTE, LAYER_PALETTE_OF, LAYER_PALETTES, PALETTE, SPRITES } from './sprites'
import { T } from './text'
import { FACE_TEXT, bar, faceOf, hintOf, stageOf, strWidth, type Face } from './view'

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

// The egg is stacked from layers: the pot + egg for the stage (the dry-pot version once the broth runs out),
// then the steam, then the face. The same face sheet fits every base, so a face never changes the egg's color.
// No steam over a dry pot, or with the flip face (its ↻ sits where the steam rises)
function baseKey(s: Save): string {
  return `base${stageOf(s.egg.progress)}${s.egg.broth <= 0 ? '_dry' : ''}`
}

function faceKey(face: Face): string {
  return `face_${face === 'dry' ? 'cry' : face}`
}

function stackKeys(base: string, face: string, steam = true): string[] {
  const withSteam = steam && !base.endsWith('_dry') && face !== 'face_flip'
  return [base, ...(withSteam ? ['steam'] : []), face]
}

// Special-date layers are in the encoded spoilers; a missing layer is skipped
function layersOf(keys: readonly string[]): Layer[] {
  const hidden = decodeSpoilers().sprites
  return keys.flatMap(k => {
    const pixels = SPRITES[k] ?? hidden[k]
    return pixels ? [{ pixels }] : []
  })
}

// Layers in a group of their own (a costume and its faces) use that group's palette
const paletteOfLayers = (keys: readonly string[]): readonly number[] => {
  const group = keys.map(k => LAYER_PALETTE_OF[k]).find(g => g !== undefined)
  return (group !== undefined ? LAYER_PALETTES[group] : undefined) ?? PALETTE
}

// The keys to stack now, special dates included (dates.ts); null when a special date shows a dex icon instead
function eggKeys(s: Save, t: LocalTime, now: number): string[] | null {
  const special = dateArt(s, t, now)
  if (special?.prize !== undefined) return null
  const face = special?.face ?? faceKey(faceOf(s, t, now))
  return stackKeys(special?.base ?? baseKey(s), face, special?.steam ?? true)
}

export function eggLayers(s: Save, t: LocalTime, now: number): Layer[] {
  const keys = eggKeys(s, t, now)
  return keys ? layersOf(keys) : []
}

function artOf(pixels: string, surface: string, palette: readonly number[] = PALETTE): Art {
  return surface === 'terminal'
    ? { kind: 'raster', cells: rasterCells(pixels, palette) }
    : { kind: 'svg', source: svgSource(pixels, palette, SVG_SCALE, SVG_BACKGROUND) }
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
  const tooNarrow = surface === 'terminal' && columns < SIZE
  // The first special date: the egg is paused all day, and a stand-in takes its place
  if (isSpecialDay(t) && !tooNarrow) {
    const stand = dexArt(FIRST_ART, true, surface)
    if (stand) return stand
  }
  const prize = dateArt(s, t, now)?.prize
  if (prize !== undefined && !tooNarrow) {
    const icon = dexArt(prize, true, surface)
    if (icon) return icon
  }
  const keys = eggKeys(s, t, now) ?? []
  const layers = layersOf(keys)
  if (layers.length === 0 || tooNarrow) {
    const stage = stageOf(s.egg.progress)
    // Only a 4-column face goes inside the frame (parentheses removed) to keep alignment
    const face = fitWidth(FACE_TEXT[faceOf(s, t, now)].replace(/[()]/g, ''), FACE_COLS)
    return { kind: 'ascii', lines: [...ASCII_EGG[stage]!.map(l => l.replace('FACE', face)), `   ${T().stageNames[stage]}`] }
  }
  return artOf(compose(layers), surface, paletteOfLayers(keys))
}

// Dev preview: every picture the game can actually show, as "<base>+<face>", without reading or changing the save.
// Dry broth outranks every face except sleep and done, and done only follows a harvest (a fresh raw egg)
const PLAY_FACES = ['face_happy', 'face_normal', 'face_bored', 'face_sleep', 'face_flip'] as const
export const PREVIEW_KEYS: readonly string[] = [
  ...[0, 1, 2, 3].flatMap(n => [...PLAY_FACES, ...(n === 0 ? ['face_done'] : [])].map(f => `base${n}+${f}`)),
  ...[0, 1, 2, 3].flatMap(n => ['face_cry', 'face_sleep'].map(f => `base${n}_dry+${f}`)),
]

// "Stage label + face label", read in the current language when accessed
export const PREVIEW_LABELS: Readonly<Record<string, string>> = Object.defineProperties(
  {},
  Object.fromEntries(
    PREVIEW_KEYS.map(key => {
      const [base, face] = key.split('+') as [string, string]
      return [key, { enumerable: true, get: () => `${T().previewLabels[base]} + ${T().previewLabels[face]}` }]
    }),
  ),
)

// Pick the preview from the command argument: empty/next = next, prev = previous, number = nth (1-based), or a sprite name; off = stop
const NEXT_WORDS = ['', 'next', '下一張']
const PREV_WORDS = ['prev', '上一張']

export function nextPreview(current: string | null, arg: string): string | null | undefined {
  const a = arg.trim().toLowerCase()
  if (a === 'off') return null
  const step = NEXT_WORDS.includes(a) ? 1 : PREV_WORDS.includes(a) ? -1 : 0
  if (step !== 0) {
    const n = PREVIEW_KEYS.length
    const i = current === null ? (step > 0 ? -1 : 0) : PREVIEW_KEYS.indexOf(current)
    return PREVIEW_KEYS[(i + step + n) % n]
  }
  const n = Number(a)
  if (Number.isInteger(n) && n >= 1 && n <= PREVIEW_KEYS.length) return PREVIEW_KEYS[n - 1]
  return PREVIEW_KEYS.includes(a) ? a : undefined
}

export function previewArt(key: string, surface: string, columns: number): Art | null {
  if (surface === 'terminal' && columns < SIZE) return null
  const [base, face] = key.split('+')
  const layers = base && face ? layersOf(stackKeys(base, face)) : []
  return layers.length ? artOf(compose(layers), surface) : null
}

// Dex sprites (art sets C/D/E and later) use their own ICON_PALETTE (or their entry in ICON_OWN_PALETTES); return null when one is missing and the dex shows text only.
// Always the pixel SVG on desktop: 9 HD icons made the pane too big and desktop drew nothing at all
export function dexArt(id: string, owned: boolean, surface: string): Art | null {
  // An egg whose picture isn't drawn yet keeps the locked picture; its caption still shows the name once owned
  const pixels = owned ? decodeSpoilers().sprites[id] ?? SPRITES.locked : SPRITES.locked
  if (!pixels) return null
  const own = owned && pixels !== SPRITES.locked ? ICON_OWN_PALETTES[id] : undefined
  return artOf(pixels, surface, own ?? ICON_PALETTE)
}

export function panelLines(s: Save, t: LocalTime, now: number): string[] {
  // The first special date: the human's progress, broth and mood in place of the paused egg's
  if (isSpecialDay(t)) {
    const b = specialBand(s, t)
    return [
      `${b.title}  ${b.face}`,
      `${b.who} ${bar(b.human, 10)} ${Math.round(b.human)}%`,
      `${T().broth} ${bar(b.broth, 10)} ${Math.round(b.broth)}`,
      `${T().mood} ${bar(b.mood, 10)} ${Math.round(b.mood)}`,
      b.hint,
    ]
  }
  // A timed special date: the egg is paused; show the ask's countdown and the count instead of its stats.
  // The countdown line keeps its emoji right of the digits: it changes every second (see bandSegments)
  const timed = timedBand(s, t, now)
  if (timed) {
    return [
      `${s.egg.name} #${s.egg.no}  ${timed.look.face}`,
      ...(timed.timer !== null ? [`${timed.timer.digits} ${timed.timer.icon}`] : []),
      ...(timed.count !== null ? [timed.count + (timed.mark !== null ? ` ${timed.mark}` : '')] : []),
      timed.look.text,
    ]
  }
  // Another special date's face and line, as on the band
  const look = dateLook(s, t)
  const hint = look ? look.text : hintOf(s, now)
  return [
    `${s.egg.name} #${s.egg.no}  ${look?.face ?? FACE_TEXT[faceOf(s, t, now)]}`,
    `${T().flavor} ${bar(s.egg.progress, 10)} ${Math.floor(s.egg.progress)}%`,
    `${T().broth} ${bar(s.egg.broth, 10)} ${Math.round(s.egg.broth)}`,
    `${T().mood} ${bar(s.egg.mood, 10)} ${Math.round(s.egg.mood)}`,
    ...(hint ? [hint] : []),
  ]
}
