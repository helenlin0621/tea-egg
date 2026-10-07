import type { Save } from '../types'
import { daysBetween, type LocalTime } from './clock'
import { TEXT, pick } from './text'

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

export function addActiveDay(s: Save, t: LocalTime): void {
  const days = s.egg.record.activeDays
  if (days.includes(t.date)) return
  const last = days[days.length - 1]
  if (last !== undefined) s.egg.record.maxGapDays = Math.max(s.egg.record.maxGapDays, daysBetween(last, t.date))
  days.push(t.date)
}

export function tick(prev: Save, now: number, t: LocalTime): Step {
  const step = begin(prev)
  const s = step.save
  const elapsed = Math.max(0, Math.min(now - s.clocks.lastTickAt, RULES.maxTickGapMs))
  s.clocks.lastTickAt = Math.max(s.clocks.lastTickAt, now)
  if (elapsed === 0) return step

  s.egg.record.sessionMinutes += elapsed / MIN

  s.clocks.brothMs += elapsed
  while (s.clocks.brothMs >= RULES.brothStepMs) {
    s.clocks.brothMs -= RULES.brothStepMs
    const before = s.egg.broth
    s.egg.broth = clamp(before - RULES.brothStep)
    if (before > 0 && s.egg.broth === 0) step.effects.push(toast(TEXT.brothEmpty))
  }

  s.clocks.moodMs += elapsed
  while (s.clocks.moodMs >= RULES.moodStepMs) {
    s.clocks.moodMs -= RULES.moodStepMs
    s.egg.mood = clamp(s.egg.mood - RULES.moodStep)
  }

  if (now - s.clocks.bucketStart >= RULES.bucketMs) {
    // 區間太久以前（session 中斷過）就不算
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
    step.effects.push(toast(TEXT.flipWanted))
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
    step.effects.push(toast(pick(TEXT.night, rng)))
  }
  return step
}

export function refill(prev: Save): Step {
  const step = begin(prev)
  step.save.egg.broth = 100
  step.save.egg.mood = Math.max(clamp(step.save.egg.mood + 20), 70)
  step.reply = TEXT.refillReply
  return step
}

export function flip(prev: Save, now: number, t: LocalTime): Step {
  const step = begin(prev)
  const egg = step.save.egg
  if (egg.flipWantedAt === null || now - egg.flipWantedAt > RULES.flipWindowMs) {
    step.reply = TEXT.flipNotNeeded
    return step
  }
  gain(step.save, RULES.flipBonus, t, false)
  egg.mood = clamp(egg.mood + 15)
  egg.flipWantedAt = null
  egg.activeMinutes = 0
  step.reply = TEXT.flipReply
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
