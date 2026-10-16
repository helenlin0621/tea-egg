import type { DateModeYear, Save } from '../types'
import type { LocalTime } from './clock'
import type { Step } from './engine'
import { decodeSpoilers } from './spoilers'
import { fill, pick } from './text'

const mode = () => decodeSpoilers().dateMode
const begin = (prev: Save): Step => ({ save: structuredClone(prev), effects: [] })

export function isSpecialDay(t: LocalTime): boolean {
  const dm = mode()
  return t.month === dm.month && t.day === dm.day
}

// Days the egg is paused: the first special date and every 'timed' one (dates.ts). On the others the egg goes on as usual
export function isPausedDay(t: Pick<LocalTime, 'month' | 'day'>): boolean {
  const dm = mode()
  if (t.month === dm.month && t.day === dm.day) return true
  return Object.values(decodeSpoilers().dates).some(d => d.kind === 'timed' && d.month === t.month && d.day === t.day)
}

function isAfterSpecialDay(t: LocalTime): boolean {
  const dm = mode()
  return t.month > dm.month || (t.month === dm.month && t.day > dm.day)
}

export const FIRST = 'd1'
// The dex picture the pane shows instead of the paused egg on this day
export const FIRST_ART = 'x0'
const keyOf = (year: number) => `${FIRST}:${year}`

export function yearOf(s: Save, year: number): DateModeYear {
  const key = keyOf(year)
  s.dateMode[key] ??= { seen: false, revealed: false, human: 0, lastToast: {} }
  return s.dateMode[key] as DateModeYear
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
  // The prompt behind this turn finished a human: that toast was this turn's line
  const quiet = y.quietTurn === true
  delete y.quietTurn
  if (!y.revealed && t.hour >= dm.revealHour) {
    reveal(step, y, dm.lines.reveal)
    return step
  }
  if (!quiet) throttled(step, y, now, 'turn', dm.lines.turn, rng)
  return step
}

export function specialEvent(prev: Save, now: number, t: LocalTime, kind: 'testFail' | 'testPass' | 'danger', rng: () => number): Step {
  const step = begin(prev)
  const y = yearOf(step.save, t.year)
  y.seen = true
  if (kind === 'testPass') y.mood = clamp(moodOf(y) + 5)
  throttled(step, y, now, kind, mode().lines[kind], rng)
  return step
}

// The human being marinated: every humanPrompts prompts finish one and the next starts from 0, with its own broth
// and mood that work like the egg's (missing fields in older saves: broth 100, mood 70)
const MIN = 60_000
const clamp = (n: number) => Math.max(0, Math.min(100, n))
export const brothOf = (y: DateModeYear) => y.broth ?? 100
export const moodOf = (y: DateModeYear) => y.mood ?? 70
export const humansDone = (y: DateModeYear) => Math.floor((y.prompts ?? 0) / mode().humanPrompts)
const humanPercent = (y: DateModeYear) => (((y.prompts ?? 0) % mode().humanPrompts) / mode().humanPrompts) * 100

function drawPeek(now: number, rng: () => number): number {
  const [lo, hi] = mode().peekMs
  return now + Math.round((lo + rng() * (hi - lo)) / MIN) * MIN
}

// A prompt sent that day: it marinates the human, and the host may peek in. The day's first prompt only draws the
// first peek, so it doesn't pop up the moment work starts
export function specialPrompt(prev: Save, now: number, t: LocalTime, rng: () => number): Step {
  const step = begin(prev)
  const dm = mode()
  const y = yearOf(step.save, t.year)
  y.seen = true
  y.prompts = (y.prompts ?? 0) + 1
  if (y.prompts % dm.humanPrompts === 0) {
    const n = y.prompts / dm.humanPrompts
    step.effects.push({ kind: 'toast', text: fill(dm.lines.harvest, { n: String(n) }) })
    step.effects.push({ kind: 'toast', text: fill(dm.lines.next, { n: String(n + 1) }) })
    y.broth = 100
    y.mood = 70
    y.brothMs = 0
    y.quietTurn = true
  }
  if (y.peekAt === undefined) {
    y.peekAt = drawPeek(now, rng)
  } else if (now >= y.peekAt) {
    if (rng() < 0.5) {
      y.broth = 100
      y.mood = clamp(moodOf(y) + 20)
      step.effects.push({ kind: 'toast', text: dm.lines.peek.water })
    } else {
      y.mood = clamp(moodOf(y) + 15)
      step.effects.push({ kind: 'toast', text: dm.lines.peek.flip })
    }
    y.peekAt = drawPeek(now, rng)
  }
  return step
}

// /egg refill and /egg flip that day (the pane's buttons run the same) look after the human instead of the egg
export function humanCare(prev: Save, t: LocalTime, kind: 'refill' | 'flip'): Step {
  const step = begin(prev)
  const y = yearOf(step.save, t.year)
  if (kind === 'refill') y.broth = 100
  y.mood = clamp(moodOf(y) + (kind === 'refill' ? 20 : 15))
  step.reply = mode().replies[kind]
  return step
}

export function humanToolFailed(prev: Save, t: LocalTime): Step {
  const step = begin(prev)
  const y = yearOf(step.save, t.year)
  y.mood = clamp(moodOf(y) - 3)
  return step
}

// Natural mood loss for the time since the last tick, like the egg's (the caller then pauses the egg's clocks)
export function humanClock(s: Save, t: LocalTime, elapsed: number, stepMs: number, step: number): void {
  if (elapsed <= 0) return
  const y = yearOf(s, t.year)
  let ms = (y.moodMs ?? 0) + elapsed
  let mood = moodOf(y)
  while (ms >= stepMs) {
    ms -= stepMs
    mood = clamp(mood - step)
  }
  y.moodMs = ms
  y.mood = mood
}

// Broth used up by `ms` of new time in use (already taken out of the shared charged spans by the caller).
// Returns true when it just ran dry
export function humanBroth(s: Save, t: LocalTime, ms: number, stepMs: number, step: number): boolean {
  const y = yearOf(s, t.year)
  let dried = false
  let acc = (y.brothMs ?? 0) + ms
  let broth = brothOf(y)
  while (acc >= stepMs && broth > 0) {
    acc -= stepMs
    broth = clamp(broth - step)
    if (broth === 0) dried = true
  }
  y.brothMs = broth > 0 ? acc : 0
  y.broth = broth
  return dried
}

export const dryLine = (terminal: boolean) => mode().lines.dry[terminal ? 'terminal' : 'desktop']

export function specialMakeup(prev: Save, t: LocalTime): Step {
  const step = begin(prev)
  for (const [key, entry] of Object.entries(step.save.dateMode)) {
    if (!key.startsWith(`${FIRST}:`)) continue
    const y = entry as DateModeYear
    const year = Number(key.slice(FIRST.length + 1))
    const isPast = year < t.year || (year === t.year && isAfterSpecialDay(t))
    if (isPast && y.seen && !y.revealed) reveal(step, y, mode().lines.makeup)
  }
  return step
}

export function specialBand(s: Save, t: LocalTime) {
  const { band } = mode()
  const y: DateModeYear = (s.dateMode[keyOf(t.year)] as DateModeYear | undefined) ?? { seen: false, revealed: false, human: 0, lastToast: {} }
  const human = humanPercent(y)
  const broth = brothOf(y)
  const mood = moodOf(y)
  const hint = broth < LOW_BROTH ? band.lowHint : band.hints[Math.min(band.hints.length - 1, Math.floor((human / 100) * band.hints.length))]!
  const face = broth <= 0 ? band.faces.worried : mood >= 70 ? band.faces.happy : mood < 30 ? band.faces.bored : band.face
  const who = `${fill(band.who, { n: String(humansDone(y) + 1) })} ${band.flavor}`
  return { icon: band.icon, face, title: band.title, who, human, broth, mood, hint }
}

// Same as the egg's low-broth hint (engine.ts RULES.lowBroth; not imported: engine.ts imports this file)
const LOW_BROTH = 30
