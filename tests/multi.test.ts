import { test, expect } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { newSave } from '../hooks/model'
import { newUse, usePrompt, useTurn, type SessionUse } from '../hooks/usage'
import type { Save } from '../types'
import { at } from './helpers'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 7, 2)
const day = at('2026-10-07')
const rule = () => {
  const r = decodeSpoilers().rules.find(x => x.when === 'multiDaysAtLeast')!
  if (r.when !== 'multiDaysAtLeast') throw new Error('no several-session rule')
  return r
}

// Sessions A, B, C sharing one save: prompts and turn ends at the given minutes
function play(steps: [who: string, kind: 'p' | 't', minute: number][], save: Save = newSave(T0), t = day) {
  const uses: Record<string, SessionUse> = {}
  for (const [who, kind, minute] of steps) {
    const r = (kind === 'p' ? usePrompt : useTurn)(save, uses[who] ?? newUse(), T0 + minute * MIN, t, who)
    save = r.save
    uses[who] = r.use
  }
  return save
}
const minutesOf = (s: Save) => s.egg.record.multiMinutes?.[day.date] ?? 0

test('Several sessions: only the time both are in use counts, once', async () => {
  // A in use 0–40, B in use 20–60: they overlap for 20 minutes
  const s = play([['A', 'p', 0], ['B', 'p', 20], ['A', 't', 40], ['B', 't', 60]])
  expect(minutesOf(s)).toBe(20)
  // A third session over the same stretch adds nothing new
  const three = play([['A', 'p', 0], ['B', 'p', 0], ['C', 'p', 0], ['A', 't', 30], ['B', 't', 30], ['C', 't', 30]])
  expect(minutesOf(three)).toBe(30)
})

test('Several sessions: one session alone, or two one after the other, is not several', async () => {
  expect(minutesOf(play([['A', 'p', 0], ['A', 't', 30], ['A', 'p', 31], ['A', 't', 60]]))).toBe(0)
  expect(minutesOf(play([['A', 'p', 0], ['A', 't', 30], ['B', 'p', 31], ['B', 't', 60]]))).toBe(0)
})

test('Several sessions: a day counts once its overlap reaches the threshold', async () => {
  const n = rule().dayMinutes
  const under = play([['A', 'p', 0], ['B', 'p', 0], ['A', 't', n - 1], ['B', 't', n - 1]])
  expect(under.egg.record.multiDays ?? []).toEqual([])
  const enough = play([['A', 'p', 0], ['B', 'p', 0], ['A', 't', n], ['B', 't', n]])
  expect(enough.egg.record.multiDays).toEqual([day.date])
  // Adding more that day doesn't add the day twice
  const more = play([['A', 'p', n + 1], ['B', 'p', n + 1], ['A', 't', n + 20], ['B', 't', n + 20]], enough)
  expect(more.egg.record.multiDays).toEqual([day.date])
})

test('Several sessions: not counted in special-date mode', async () => {
  const dm = decodeSpoilers().dateMode
  const pad = (n: number) => String(n).padStart(2, '0')
  const special = at(`2027-${pad(dm.month)}-${pad(dm.day)}`)
  const s = play([['A', 'p', 0], ['B', 'p', 0], ['A', 't', 90], ['B', 't', 90]], newSave(T0), special)
  expect(s.egg.record.multiMinutes ?? {}).toEqual({})
})
