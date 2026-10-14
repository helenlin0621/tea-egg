import type { Save } from '../types'
import { daysBetween, type LocalTime } from './clock'
import { isSpecialDay } from './datemode'
import { T, pick } from './text'

export type Effect = { kind: 'toast'; text: string }
export type Step = { save: Save; effects: Effect[]; reply?: string }

const MIN = 60_000

export const RULES = {
  dailyCap: 15,
  brothStepMs: 15 * MIN,
  brothStep: 4,
  moodStepMs: 60 * MIN,
  moodStep: 5,
  bucketMs: 10 * MIN,
  flipAfterMin: 90,
  flipWindowMs: 30 * MIN,
  flipBonus: 2,
  maxTickGapMs: 3 * MIN,
  lowBroth: 30,
  nightEndHour: 5,
} as const

const clamp = (n: number) => Math.max(0, Math.min(100, n))
const toast = (text: string): Effect => ({ kind: 'toast', text })
const begin = (prev: Save): Step => ({ save: structuredClone(prev), effects: [] })

export function gain(s: Save, n: number, t: LocalTime, capped: boolean): number {
  if (s.egg.broth <= 0 || n <= 0) return 0
  if (capped) {
    if (s.daily.date !== t.date) s.daily = { date: t.date, gained: 0 }
    n = Math.min(n, RULES.dailyCap - s.daily.gained)
    if (n <= 0) return 0
    s.daily.gained += n
  }
  const before = s.egg.progress
  s.egg.progress = Math.min(100, before + n)
  return s.egg.progress - before
}

// Spans of use are kept for a day: long enough for any session's turn to overlap them
export const SPAN_KEEP_MS = 24 * 60 * MIN

// The part of [from, to] not yet covered by the (merged) spans, and the spans with [from, to] merged in
export function uncovered(spans: [number, number][], from: number, to: number): { ms: number; spans: [number, number][] } {
  let covered = 0
  for (const [a, b] of spans) covered += Math.max(0, Math.min(b, to) - Math.max(a, from))
  const merged: [number, number][] = []
  for (const [a, b] of [...spans, [from, to] as [number, number]].sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  return { ms: Math.max(0, to - from - covered), spans: merged.filter(([, b]) => b >= to - SPAN_KEEP_MS) }
}

// Broth goes down only for time in use ([from, to], one segment of a session). Several sessions in use at once
// share the save's charged spans, so the same stretch of time is charged once
export function useBroth(s: Save, from: number, to: number, effects: Effect[]): void {
  if (to <= from) return
  const r = uncovered(s.clocks.usedSpans ?? [], from, to)
  s.clocks.usedSpans = r.spans
  let ms = r.ms
  while (ms > 0) {
    if (s.egg.broth <= 0) {
      // A dry pot: the rest of this stretch is time in use with no broth (whatever the day's flavor)
      s.egg.record.dryMinutes = (s.egg.record.dryMinutes ?? 0) + ms / MIN
      return
    }
    const part = Math.min(ms, RULES.brothStepMs - s.clocks.brothMs)
    s.clocks.brothMs += part
    ms -= part
    if (s.clocks.brothMs >= RULES.brothStepMs) {
      s.clocks.brothMs = 0
      s.egg.broth = clamp(s.egg.broth - RULES.brothStep)
      if (s.egg.broth === 0) effects.push(toast(T().brothEmpty))
    }
  }
}

// Special-date-mode days pause the egg: they are neither active days nor days not opened
function pausedDaysBetween(a: string, b: string): number {
  const start = Date.parse(`${a}T00:00:00Z`)
  const span = Math.min(daysBetween(a, b), 400)
  let n = 0
  for (let i = 1; i < span; i++) {
    const d = new Date(start + i * 24 * 60 * MIN)
    const month = d.getUTCMonth() + 1
    const day = d.getUTCDate()
    const date = d.toISOString().slice(0, 10)
    if (isSpecialDay({ date, year: d.getUTCFullYear(), month, day, hour: 12, minute: 0 })) n++
  }
  return n
}

export function addActiveDay(s: Save, t: LocalTime): void {
  const days = s.egg.record.activeDays
  if (days.includes(t.date)) return
  const last = days[days.length - 1]
  // Gap = days not opened between two active days (consecutive days = 0); special-date days in between don't count
  if (last !== undefined) {
    const gap = daysBetween(last, t.date) - 1 - pausedDaysBetween(last, t.date)
    s.egg.record.maxGapDays = Math.max(s.egg.record.maxGapDays, gap)
  }
  days.push(t.date)
}

export function tick(prev: Save, now: number, t: LocalTime): Step {
  const step = begin(prev)
  const s = step.save
  const elapsed = Math.max(0, Math.min(now - s.clocks.lastTickAt, RULES.maxTickGapMs))
  s.clocks.lastTickAt = Math.max(s.clocks.lastTickAt, now)
  if (elapsed === 0) return step

  // Session length and broth both follow actual use (usage.ts, useBroth), not the time the program stays open

  s.clocks.moodMs += elapsed
  while (s.clocks.moodMs >= RULES.moodStepMs) {
    s.clocks.moodMs -= RULES.moodStepMs
    s.egg.mood = clamp(s.egg.mood - RULES.moodStep)
  }

  if (now - s.clocks.bucketStart >= RULES.bucketMs) {
    // Skip a bucket that started too long ago (the session was interrupted)
    const fresh = now - s.clocks.bucketStart < RULES.bucketMs + RULES.maxTickGapMs
    if (s.clocks.bucketActive && fresh) {
      gain(s, 1, t, true)
      s.egg.activeMinutes += RULES.bucketMs / MIN
    }
    s.clocks.bucketStart = now
    s.clocks.bucketActive = false
  }

  if (s.egg.flipWantedAt !== null && now - s.egg.flipWantedAt > RULES.flipWindowMs) {
    s.egg.flipWantedAt = null
    s.egg.activeMinutes = 0
  } else if (s.egg.flipWantedAt === null && s.egg.activeMinutes >= RULES.flipAfterMin) {
    s.egg.flipWantedAt = now
    step.effects.push(toast(T().flipWanted))
  }
  return step
}

export function turnDone(prev: Save, now: number, t: LocalTime, rng: () => number): Step {
  const step = begin(prev)
  const s = step.save
  addActiveDay(s, t)
  s.clocks.bucketActive = true
  gain(s, 1, t, true)
  if (t.hour < RULES.nightEndHour && s.nightToastFor !== t.date) {
    s.nightToastFor = t.date
    step.effects.push(toast(pick(T().night, rng)))
  }
  return step
}

export function refill(prev: Save): Step {
  const step = begin(prev)
  step.save.egg.broth = 100
  step.save.egg.mood = Math.max(clamp(step.save.egg.mood + 20), 70)
  step.reply = T().refillReply
  return step
}

export function flip(prev: Save, now: number, t: LocalTime): Step {
  const step = begin(prev)
  const egg = step.save.egg
  if (egg.flipWantedAt === null || now - egg.flipWantedAt > RULES.flipWindowMs) {
    step.reply = T().flipNotNeeded
    return step
  }
  const gained = gain(step.save, RULES.flipBonus, t, false)
  egg.mood = clamp(egg.mood + 15)
  egg.flipWantedAt = null
  egg.activeMinutes = 0
  step.reply = gained > 0 ? T().flipReply : T().flipNoGain
  return step
}

export function testObserved(prev: Save, passed: boolean): Step {
  const step = begin(prev)
  const r = step.save.egg.record
  r.testRuns += 1
  if (passed) step.save.egg.mood = clamp(step.save.egg.mood + 5)
  else r.testFails += 1
  return step
}

export function toolFailed(prev: Save): Step {
  const step = begin(prev)
  step.save.egg.mood = clamp(step.save.egg.mood - 3)
  return step
}

export function pauseClocks(prev: Save, now: number): Step {
  const step = begin(prev)
  const c = step.save.clocks
  c.lastTickAt = Math.max(c.lastTickAt, now)
  c.bucketStart = now
  c.bucketActive = false
  return step
}
