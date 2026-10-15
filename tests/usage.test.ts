import { test, expect } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { onTick, onTurn } from '../hooks/flow'
import { newSave } from '../hooks/model'
import { newUse, parseUse, usePrompt, useStale, useTurn, withoutWaits, type SessionUse } from '../hooks/usage'
import type { Save } from '../types'
import { at } from './helpers'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 7, 2)
const day = at('2026-10-07')
const never = () => 0.99

// Run a script of prompts and turn ends (minutes from T0) through one session
function run(steps: [kind: 'p' | 't', minute: number][], save: Save = newSave(T0), use: SessionUse = newUse()) {
  for (const [kind, minute] of steps) {
    const r = (kind === 'p' ? usePrompt : useTurn)(save, use, T0 + minute * MIN, day)
    save = r.save
    use = r.use
  }
  return { save, use }
}

test('Usage: a segment runs from the prompt to the last turn end; idle time after it does not count', async () => {
  const { save, use } = run([['p', 0], ['t', 5], ['p', 10], ['t', 25]])
  expect(save.egg.record.sessionMinutes).toBe(25)
  expect(use.minutes).toBe(25)
  // The program stays open for hours: ticks no longer add session minutes
  const later = onTick(save, T0 + 3 * 60 * MIN, day, never).save
  expect(later.egg.record.sessionMinutes).toBe(25)
})

test('Usage: a prompt 30+ minutes after the last turn starts a new segment; the break is not counted', async () => {
  const { save } = run([['p', 0], ['t', 10], ['p', 40], ['t', 45]])
  expect(save.egg.record.sessionMinutes).toBe(15)
  const short = run([['p', 0], ['t', 10], ['p', 39], ['t', 45]])
  expect(short.save.egg.record.sessionMinutes).toBe(45) // under 30 minutes: still the same segment
})

test('Usage: a single long turn counts in full', async () => {
  const { save } = run([['p', 0], ['t', 50]])
  expect(save.egg.record.sessionMinutes).toBe(50)
})

test('Usage: a turn with no prompt long after the last one adds nothing', async () => {
  const { save } = run([['p', 0], ['t', 10], ['t', 100]])
  expect(save.egg.record.sessionMinutes).toBe(10)
})

test('Usage: a session counts once per egg, only after a prompt', async () => {
  const opened = run([['t', 5]])
  expect(opened.save.egg.record.sessionCount).toBe(0)
  const used = run([['p', 0], ['t', 5], ['p', 6], ['t', 8]])
  expect(used.save.egg.record.sessionCount).toBe(1)
})

test('Usage: the same session across days (or a --resume) keeps adding up', async () => {
  const first = run([['p', 0], ['t', 30]])
  const nextDay = run([['p', 24 * 60], ['t', 24 * 60 + 30]], first.save, parseUse(JSON.parse(JSON.stringify(first.use))))
  expect(nextDay.use.minutes).toBe(60)
  expect(nextDay.save.egg.record.sessionMinutes).toBe(60)
  expect(nextDay.save.egg.record.sessionCount).toBe(1)
})

test('Usage: a harvest splits the session between the old and the new egg', async () => {
  const s = newSave(T0)
  s.egg.progress = 99
  const a = run([['p', 0]], s)
  const r = useTurn(a.save, a.use, T0 + 20 * MIN, day)
  const harvested = onTurn(r.save, T0 + 20 * MIN, day, never)
  expect(harvested.save.egg.no).toBe(2)
  expect(harvested.save.egg.record.sessionMinutes).toBe(0)
  expect(harvested.save.egg.record.sessionCount).toBe(0)
  const b = run([['p', 25], ['t', 35]], harvested.save, r.use)
  expect(b.save.egg.record.sessionMinutes).toBe(15) // from the last turn end (20) to 35
  expect(b.save.egg.record.sessionCount).toBe(1)
  expect(b.use.minutes).toBe(35)
})

test('Usage: special-date mode does not count', async () => {
  const dm = decodeSpoilers().dateMode
  const pad = (n: number) => String(n).padStart(2, '0')
  const special = at(`2027-${pad(dm.month)}-${pad(dm.day)}`)
  const p = usePrompt(newSave(T0), newUse(), T0, special)
  const t = useTurn(p.save, p.use, T0 + 10 * MIN, special)
  expect(t.save.egg.record.sessionCount).toBe(0)
  expect(t.save.egg.record.sessionMinutes).toBe(0)
})

test('Usage records: bad data reads as empty; month-old records are stale', async () => {
  expect(parseUse(null)).toEqual(newUse())
  expect(parseUse({ minutes: 'x', lastTurnEnd: 5 })).toEqual({ ...newUse(), lastTurnEnd: 5 })
  expect(useStale({ ...newUse(), lastTurnEnd: T0 }, T0 + 29 * 24 * 60 * MIN)).toBe(false)
  expect(useStale({ ...newUse(), lastTurnEnd: T0 }, T0 + 31 * 24 * 60 * MIN)).toBe(true)
})

// Two sessions (A and B) sharing one save, each with its own usage record
function both(steps: [who: 'A' | 'B', kind: 'p' | 't', minute: number][], save: Save = newSave(T0)) {
  const uses = { A: newUse(), B: newUse() }
  const toasts: string[] = []
  for (const [who, kind, minute] of steps) {
    const r = (kind === 'p' ? usePrompt : useTurn)(save, uses[who], T0 + minute * MIN, day)
    save = r.save
    uses[who] = r.use
    toasts.push(...r.effects.map(f => f.text))
  }
  return { save, toasts }
}

test('Broth: 4 for every 15 minutes in use; idle time does not count', async () => {
  const { save } = run([['p', 0], ['t', 15], ['p', 120], ['t', 135]])
  expect(save.egg.broth).toBe(92)
})

test('Broth: two sessions in use at the same time are charged once', async () => {
  expect(both([['A', 'p', 0], ['B', 'p', 0], ['A', 't', 15], ['B', 't', 15]]).save.egg.broth).toBe(96)
  // Overlapping only in part: 0–20 in all is 20 minutes, one step of 15
  const partial = both([['A', 'p', 0], ['B', 'p', 5], ['A', 't', 15], ['B', 't', 20]]).save
  expect(partial.egg.broth).toBe(96)
  expect(partial.clocks.brothMs).toBe(5 * MIN)
  // One after the other: both count
  expect(both([['A', 'p', 0], ['A', 't', 15], ['B', 'p', 15], ['B', 't', 30]]).save.egg.broth).toBe(92)
})

test('Broth: toasts once when it runs dry', async () => {
  const s = newSave(T0)
  s.egg.broth = 4
  const r = both([['A', 'p', 0], ['A', 't', 15], ['A', 'p', 16], ['A', 't', 31]], s)
  expect(r.save.egg.broth).toBe(0)
  expect(r.toasts.filter(text => text.includes('滷汁乾了')).length).toBe(1)
})

test('Dry pot: minutes in use with no broth add up, whatever the day\'s flavor', async () => {
  const s = newSave(T0)
  s.egg.broth = 4
  s.daily = { date: day.date, gained: 15 } // flavor already full today: still counts
  // 15 minutes empty the pot, the next 45 are dry; a 3-hour break unused is not counted
  const r = run([['p', 0], ['t', 60], ['p', 240], ['t', 270]], s)
  expect(r.save.egg.broth).toBe(0)
  expect(r.save.egg.record.dryMinutes).toBe(45 + 30)
})

test('Dry pot: nothing counts while there is broth', async () => {
  const r = run([['p', 0], ['t', 60]])
  expect(r.save.egg.record.dryMinutes ?? 0).toBe(0)
})

test('Waiting for the person is not use: minutes, broth and dry time leave it out', async () => {
  // A prompt at 0; a permission prompt waits from 10 to 190; the turn ends at 200
  const p = usePrompt(newSave(T0), newUse(), T0, day)
  const t = useTurn(p.save, p.use, T0 + 200 * MIN, day, 'A', [[T0 + 10 * MIN, T0 + 190 * MIN]])
  expect(t.save.egg.record.sessionMinutes).toBe(20)
  expect(t.use.minutes).toBe(20)
  expect(t.save.egg.broth).toBe(96) // 20 minutes in use: one step of 15
})

test('Waits: cut out of a stretch, clipped to it, and overlapping waits are fine', async () => {
  expect(withoutWaits(0, 100, [])).toEqual([[0, 100]])
  expect(withoutWaits(0, 100, [[10, 20], [50, 60]])).toEqual([[0, 10], [20, 50], [60, 100]])
  expect(withoutWaits(0, 100, [[-50, 30], [90, 500]])).toEqual([[30, 90]])
  expect(withoutWaits(0, 100, [[10, 40], [30, 60]])).toEqual([[0, 10], [60, 100]])
  expect(withoutWaits(0, 100, [[0, 100]])).toEqual([])
})
