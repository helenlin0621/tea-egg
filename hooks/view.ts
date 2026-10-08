import type { Save } from '../types'
import type { LocalTime } from './clock'
import { isSpecialDay, specialBand } from './datemode'
import { RULES } from './engine'
import { predictHint } from './rules'
import { TEXT } from './text'

export type Face = 'happy' | 'normal' | 'bored' | 'dry' | 'sleep' | 'flip' | 'done'

export const FACE_TEXT: Record<Face, string> = {
  happy: '(•ᴗ•)',
  normal: '(•_•)',
  bored: '(-_-)',
  dry: '(；へ；)',
  sleep: '(－ω－) zzZ',
  flip: '(•̀ᴗ•́)↻',
  done: '(✧ᴗ✧)',
}

const DONE_MS = 10 * 60_000

export function faceOf(s: Save, t: LocalTime, now: number): Face {
  if (s.harvestedAt !== null && now - s.harvestedAt < DONE_MS) return 'done'
  if (t.hour < RULES.nightEndHour) return 'sleep'
  if (s.egg.broth <= 0) return 'dry'
  if (s.egg.flipWantedAt !== null) return 'flip'
  if (s.egg.mood >= 70) return 'happy'
  if (s.egg.mood < 30) return 'bored'
  return 'normal'
}

export function stageOf(progress: number): 0 | 1 | 2 | 3 {
  if (progress < 20) return 0
  if (progress < 40) return 1
  if (progress < 70) return 2
  return 3
}

// Matches the pixel art: 40–69% light amber, 70% and up light brown
export const STAGE_COLOR = ['#f2efe6', '#f2efe6', '#f0c9a2', '#c98f5c'] as const
export const STAGE_NAME = ['生蛋', '裂紋', '入味', '滷透'] as const

function charWidth(cp: number): number {
  if ((cp >= 0x0300 && cp <= 0x036f) || cp === 0xfe0f || cp === 0x200d) return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2
  return 1
}

export function strWidth(text: string): number {
  let w = 0
  for (const ch of text) w += charWidth(ch.codePointAt(0)!)
  return w
}

export function truncate(text: string, columns: number): string {
  if (strWidth(text) <= columns) return text
  let out = ''
  for (const ch of text) {
    if (strWidth(out + ch) > columns - 1) break
    out += ch
  }
  return out + '…'
}

export function bar(value: number, cells: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export function hintOf(s: Save, now: number): string | null {
  if (s.egg.broth <= 0) return TEXT.brothEmptyHint
  if (s.egg.broth < RULES.lowBroth) return TEXT.brothLow
  if (s.egg.flipWantedAt !== null) return TEXT.flipHint
  return predictHint(s.egg, now)
}

export type Seg = { text: string; color?: string; dim?: boolean }

const SEP: Seg = { text: ' ｜ ', dim: true }

export function bandSegments(s: Save, t: LocalTime, now: number): Seg[] {
  if (isSpecialDay(t)) {
    const b = specialBand(s, t)
    return [
      { text: ` ${b.icon}${b.face}  ${b.title}` },
      SEP,
      { text: `${b.bar} ${bar(b.human, 10)} ${Math.round(b.human)}%` },
      SEP,
      { text: b.hint, dim: true },
    ]
  }
  const stage = stageOf(s.egg.progress)
  const segs: Seg[] = [
    { text: ` 🥚${stage === 1 ? '⸝' : ''}` },
    { text: FACE_TEXT[faceOf(s, t, now)], color: STAGE_COLOR[stage] },
    { text: `  ${s.egg.name} #${s.egg.no}` },
    SEP,
    { text: `入味 ${bar(s.egg.progress, 10)} ${Math.floor(s.egg.progress)}%` },
    SEP,
    { text: `滷汁 ${bar(s.egg.broth, 5)}` },
  ]
  const hint = hintOf(s, now)
  if (hint !== null) segs.push(SEP, { text: hint, dim: true })
  return segs
}

// Drop whole segments from the right until it fits; the first segment (the egg) always stays, truncated if needed
export function fitSegments(segs: Seg[], columns: number): Seg[] {
  const out = [...segs]
  const width = () => out.reduce((w, seg) => w + strWidth(seg.text), 0)
  while (out.length > 1 && width() > columns) {
    out.pop()
    if (out.length > 1 && out[out.length - 1] === SEP) out.pop()
  }
  if (width() > columns) out[0] = { ...out[0]!, text: truncate(out[0]!.text, columns) }
  return out
}
