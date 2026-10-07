import type { DateModeYear, Save } from '../types'
import type { LocalTime } from './clock'
import type { Step } from './engine'
import { decodeSpoilers } from './spoilers'
import { pick } from './text'

const mode = () => decodeSpoilers().dateMode
const begin = (prev: Save): Step => ({ save: structuredClone(prev), effects: [] })

export function isSpecialDay(t: LocalTime): boolean {
  const dm = mode()
  return t.month === dm.month && t.day === dm.day
}

function isAfterSpecialDay(t: LocalTime): boolean {
  const dm = mode()
  return t.month > dm.month || (t.month === dm.month && t.day > dm.day)
}

export function yearOf(s: Save, year: number): DateModeYear {
  const key = String(year)
  s.dateMode[key] ??= { seen: false, revealed: false, human: 0, lastToast: {} }
  return s.dateMode[key]!
}

function reveal(step: Step, y: DateModeYear, text: string): void {
  const prize = mode().prize
  y.revealed = true
  step.save.dex[prize] = (step.save.dex[prize] ?? 0) + 1
  step.effects.push({ kind: 'toast', text })
}

function throttled(step: Step, y: DateModeYear, now: number, kind: string, lines: readonly string[], rng: () => number): void {
  const last = y.lastToast[kind]
  if (last !== undefined && now - last < mode().throttleMs) return
  y.lastToast[kind] = now
  step.effects.push({ kind: 'toast', text: pick(lines, rng) })
}

export function specialSeen(prev: Save, t: LocalTime): Step {
  const step = begin(prev)
  yearOf(step.save, t.year).seen = true
  return step
}

export function specialTurn(prev: Save, now: number, t: LocalTime, rng: () => number): Step {
  const step = begin(prev)
  const dm = mode()
  const y = yearOf(step.save, t.year)
  y.seen = true
  y.human = Math.min(100, y.human + dm.humanStep)
  if (!y.revealed && t.hour >= dm.revealHour) {
    reveal(step, y, dm.lines.reveal)
    return step
  }
  throttled(step, y, now, 'turn', dm.lines.turn, rng)
  return step
}

export function specialEvent(prev: Save, now: number, t: LocalTime, kind: 'testFail' | 'testPass' | 'danger', rng: () => number): Step {
  const step = begin(prev)
  const y = yearOf(step.save, t.year)
  y.seen = true
  throttled(step, y, now, kind, mode().lines[kind], rng)
  return step
}

export function specialMakeup(prev: Save, t: LocalTime): Step {
  const step = begin(prev)
  for (const [key, y] of Object.entries(step.save.dateMode)) {
    const year = Number(key)
    const isPast = year < t.year || (year === t.year && isAfterSpecialDay(t))
    if (isPast && y.seen && !y.revealed) reveal(step, y, mode().lines.makeup)
  }
  return step
}

export function specialBand(s: Save, t: LocalTime) {
  const { band } = mode()
  const human = s.dateMode[String(t.year)]?.human ?? 0
  const hint = band.hints[Math.min(band.hints.length - 1, Math.floor((human / 100) * band.hints.length))]!
  return { icon: band.icon, face: band.face, title: band.title, bar: band.bar, human, hint }
}
