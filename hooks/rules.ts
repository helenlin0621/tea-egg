import type { Egg, Save } from '../types'
import { newEgg } from './model'
import type { Effect, Step } from './engine'
import { decodeSpoilers } from './spoilers'
import type { Rule, Spoilers } from './spoiler-types'
import { T, fill } from './text'

const DAY = 86_400_000
const HINT_FROM = 50

export type Stats = {
  cracked: boolean
  maxGapDays: number
  testRuns: number
  failRate: number
  ageDays: number
  sessionCount: number
  avgSessionMinutes: number
}

export function statsOf(egg: Egg, now: number): Stats {
  const r = egg.record
  return {
    cracked: r.cracked !== null,
    maxGapDays: r.maxGapDays,
    testRuns: r.testRuns,
    failRate: r.testRuns > 0 ? r.testFails / r.testRuns : 0,
    ageDays: (now - r.startedAt) / DAY,
    sessionCount: r.sessionCount,
    avgSessionMinutes: r.sessionCount > 0 ? r.sessionMinutes / r.sessionCount : 0,
  }
}

// Rule kinds and how they're evaluated are public; thresholds and which egg each yields are in SPOILERS
export function matches(rule: Rule, st: Stats, roll: number): boolean {
  switch (rule.when) {
    case 'cracked': return st.cracked
    case 'chance': return roll < rule.p
    case 'gapAtLeast': return st.maxGapDays >= rule.days
    case 'failRateAbove': return st.testRuns >= rule.minRuns && st.failRate > rule.rate
    case 'ageAtLeast': return st.ageDays >= rule.days
    case 'avgSessionAbove': return st.sessionCount > 0 && st.avgSessionMinutes > rule.minutes
    case 'avgSessionBelow': return st.sessionCount > 0 && st.avgSessionMinutes < rule.minutes
    case 'always': return true
  }
}

export function outcome(egg: Egg, now: number, rng: () => number): string {
  const st = statsOf(egg, now)
  const roll = rng()
  const rules = decodeSpoilers().rules
  return (rules.find(rule => matches(rule, st, roll)) ?? rules[rules.length - 1]!).egg
}

export function predictHint(egg: Egg, now: number): string | null {
  if (egg.progress < HINT_FROM) return null
  const st = statsOf(egg, now)
  const { rules, hints } = decodeSpoilers()
  const guess = rules.find(rule => rule.when !== 'cracked' && rule.when !== 'chance' && matches(rule, st, 1))
  return guess ? hints[guess.egg] ?? null : null
}

function harvest(s: Save, now: number, rng: () => number): Effect {
  const { eggs, crackToast } = decodeSpoilers()
  const id = outcome(s.egg, now, rng)
  const info = eggs[id] ?? { name: id, icon: '🥚' }
  const isNew = (s.dex[id] ?? 0) === 0
  s.dex[id] = (s.dex[id] ?? 0) + 1
  const keyword = s.egg.record.cracked
  const text = keyword !== null
    ? fill(crackToast, { kw: keyword, name: info.name, icon: info.icon })
    : fill(T().harvest, { name: info.name })
  const next = newEgg(s.egg.no + 1, now)
  next.record.sessionCount = 1 // the current session counts toward the new egg too
  s.egg = next
  s.daily.gained = 0 // the daily cap is per egg: a new egg gets a fresh cap even if the last one used today's up
  s.harvestedAt = now
  return { kind: 'toast', text: isNew ? text + T().newDex : text }
}

export function settle(step: Step, now: number, rng: () => number): Step {
  const s = step.save
  if (s.egg.record.cracked === null && s.egg.progress < 100) return step
  const save = structuredClone(s)
  const effect = harvest(save, now, rng)
  return { ...step, save, effects: [...step.effects, effect] }
}

export function crack(prev: Save, keyword: string, now: number, rng: () => number): Step {
  const save = structuredClone(prev)
  save.egg.record.cracked = keyword
  return settle({ save, effects: [] }, now, rng)
}

// The special-date-mode prize egg hides even its icon until collected. Decided by "is it the prize", not by slot position,
// so egg kinds added later (regular or special) can sit in any slot without being mistaken for it
export function isPrizeEgg(id: string, sp: Spoilers = decodeSpoilers()): boolean {
  return id === sp.dateMode.prize
}

export function dexText(save: Save, title: string, sp: Spoilers = decodeSpoilers()): string {
  const { eggs, dexSlots } = sp
  const owned = dexSlots.filter(id => (save.dex[id] ?? 0) > 0)
  const missing = dexSlots.filter(id => (save.dex[id] ?? 0) === 0)
  const ownedText = owned.map(id => `${eggs[id]!.icon} ${eggs[id]!.name} ×${save.dex[id]}`)
  const missingText = missing.map(id => (isPrizeEgg(id, sp) ? '❓ ???' : `${eggs[id]!.icon} ???`))
  return [` ${title} ${owned.length}/${dexSlots.length}`, ` ${ownedText.join('   ')}`, ` ${missingText.join('   ')}`]
    .filter(line => line.trim() !== '')
    .join('\n')
}
