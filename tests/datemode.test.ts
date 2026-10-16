import { test, expect } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { FIRST_ART, isSpecialDay, specialBand, specialEvent, specialMakeup, specialSeen, specialTurn } from '../hooks/datemode'
import { dexArt, eggArt, panelLines } from '../hooks/panel'
import { bar } from '../hooks/view'
import { newSave } from '../hooks/model'
import type { LocalTime } from '../hooks/clock'
import type { DateModeYear, Save } from '../types'
import { T as TX, fill } from '../hooks/text'
import { humanCare, specialPrompt } from '../hooks/datemode'
import { onCommand, onObserved, onTick, onTurn } from '../hooks/flow'
import { newUse, usePrompt, useTurn } from '../hooks/usage'

const dm = () => decodeSpoilers().dateMode
const pad = (n: number) => String(n).padStart(2, '0')
function day(offset: number, hour: number): LocalTime {
  const d = new Date(Date.UTC(2027, dm().month - 1, dm().day + offset))
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return { date, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour, minute: 0 }
}
const T = Date.UTC(2027, 0, 1)
const first = () => 0

test('Special-date mode: only active on that day', async () => {
  expect(isSpecialDay(day(0, 10))).toBe(true)
  expect(isSpecialDay(day(1, 10))).toBe(false)
  expect(isSpecialDay(day(-1, 23))).toBe(false)
})

test('Special-date mode: a turn leaves the real egg unchanged', async () => {
  const s = newSave(T)
  const r = specialTurn(s, T, day(0, 10), first)
  expect(r.save.egg).toEqual(s.egg)
  expect((r.save.dateMode['d1:2027'] as DateModeYear).seen).toBe(true)
})

test('Special-date mode: at most one message of each kind per 10 minutes', async () => {
  let s = newSave(T)
  const a = specialTurn(s, T, day(0, 10), first)
  const b = specialTurn(a.save, T + 5 * 60_000, day(0, 10), first)
  const c = specialTurn(b.save, T + 11 * 60_000, day(0, 10), first)
  expect(a.effects.length).toBe(1)
  expect(b.effects.length).toBe(0)
  expect(c.effects.length).toBe(1)
})

test('Special-date mode: dangerous commands only produce a message; the egg does not crack', async () => {
  const r = specialEvent(newSave(T), T, day(0, 10), 'danger', first)
  expect(r.save.egg.record.cracked).toBe(null)
  expect(r.effects[0]!.text).toBe(dm().lines.danger[0]!)
})

test('Special-date mode: the first turn after reveal time unlocks slot 9, only once', async () => {
  const before = specialTurn(newSave(T), T, day(0, dm().revealHour - 1), first)
  expect(before.save.dex[dm().prize]).toBe(undefined)
  const after = specialTurn(before.save, T + 3_600_000, day(0, dm().revealHour), first)
  expect(after.save.dex[dm().prize]).toBe(1)
  expect(after.effects.some(f => f.text === dm().lines.reveal)).toBe(true)
  const again = specialTurn(after.save, T + 7_200_000, day(0, dm().revealHour + 1), first)
  expect(again.save.dex[dm().prize]).toBe(1)
})

test('Special-date mode: opened that day but missed the reveal; granted on the first open the next day', async () => {
  const seen = specialSeen(newSave(T), day(0, 9)).save
  const r = specialMakeup(seen, day(1, 9))
  expect(r.save.dex[dm().prize]).toBe(1)
  expect(r.effects[0]!.text).toBe(dm().lines.makeup)
  expect(specialMakeup(r.save, day(1, 10)).effects.length).toBe(0)
})

test('Special-date mode: opened that day and reopened much later (next year); still granted', async () => {
  const seen = specialSeen(newSave(T), day(0, 9)).save
  const muchLater: LocalTime = { date: '2028-01-15', year: 2028, month: 1, day: 15, hour: 9, minute: 0 }
  const r = specialMakeup(seen, muchLater)
  expect(r.save.dex[dm().prize]).toBe(1)
  expect(r.effects[0]!.text).toBe(dm().lines.makeup)
})

test('Special-date mode: not opened at all that day; nothing granted', async () => {
  const r = specialMakeup(newSave(T), day(1, 9))
  expect(r.save.dex[dm().prize]).toBe(undefined)
})

test('Special-date mode: can be earned again every year', async () => {
  let s = specialTurn(newSave(T), T, day(0, dm().revealHour), first).save
  const nextYear = { ...day(0, dm().revealHour), year: 2028, date: `2028-${pad(dm().month)}-${pad(dm().day)}` }
  s = specialTurn(s, T + 400 * 86_400_000, nextYear, first).save
  expect(s.dex[dm().prize]).toBe(2)
})

test('Special-date mode: the pane shows the stand-in picture and the band\'s title, progress and hint, not the egg\'s stats', async () => {
  const t = day(0, 10)
  const s = specialTurn(newSave(T), T, t, first).save
  for (const surface of ['desktop', 'terminal']) {
    expect(eggArt(s, t, T, surface, 80)).toEqual(dexArt(FIRST_ART, true, surface))
  }
  const b = specialBand(s, t)
  expect(panelLines(s, t, T)).toEqual([
    `${b.title}  ${b.face}`,
    `${b.who} ${bar(b.human, 10)} ${Math.round(b.human)}%`,
    `${TX().broth} ${bar(b.broth, 10)} ${Math.round(b.broth)}`,
    `${TX().mood} ${bar(b.mood, 10)} ${Math.round(b.mood)}`,
    b.hint,
  ])
  // The next day the egg is back
  const next = day(1, 10)
  expect(eggArt(s, next, T, 'desktop', 80)).not.toEqual(dexArt(FIRST_ART, true, 'desktop'))
  expect(panelLines(s, next, T)[1]).toContain(`${Math.floor(s.egg.progress)}%`)
})

// ---- The human in the pot (prompts, peeks, broth and mood)

const MIN = 60_000
const yr = (s: Save) => s.dateMode['d1:2027'] as DateModeYear
function entry(s: Save): DateModeYear {
  s.dateMode['d1:2027'] ??= { seen: false, revealed: false, human: 0, lastToast: {} }
  return s.dateMode['d1:2027'] as DateModeYear
}
function prompts(s: Save, n: number, from = T, rng: () => number = first) {
  const effects: string[] = []
  for (let i = 0; i < n; i++) {
    const r = specialPrompt(s, from + i * 1000, day(0, 10), rng)
    s = r.save
    effects.push(...r.effects.map(e => e.text))
  }
  return { save: s, effects }
}
const harvest = (n: number) => fill(dm().lines.harvest, { n: String(n) })

test('Special-date human: done after the set number of prompts, then the next one starts from 0', async () => {
  const n = dm().humanPrompts
  const almost = prompts(newSave(T), n - 1)
  expect(almost.effects.includes(harvest(1))).toBe(false)
  expect(specialBand(almost.save, day(0, 10)).who).toContain('#1')
  const one = prompts(almost.save, 1, T + n * 1000)
  expect(one.effects[0]).toBe(harvest(1))
  const b = specialBand(one.save, day(0, 10))
  expect(b.who).toContain('#2')
  expect(b.human).toBe(0)
  const two = prompts(one.save, n, T + 2 * n * 1000)
  expect(two.effects.includes(harvest(2))).toBe(true)
  expect(two.save.egg).toEqual(newSave(T).egg)
})

test('Special-date human: the turn of the prompt that finished one skips its usual line', async () => {
  const n = dm().humanPrompts
  const done = prompts(newSave(T), n).save
  const quiet = specialTurn(done, T + n * 1000, day(0, 10), first)
  expect(quiet.effects.length).toBe(0)
  const later = specialTurn(quiet.save, T + 20 * MIN, day(0, 10), first)
  expect(later.effects.length).toBe(1)
})

test('Special-date human: the first prompt draws the peek time; a later prompt past it peeks once and draws again', async () => {
  const [lo, hi] = dm().peekMs
  const firstPrompt = specialPrompt(newSave(T), T, day(0, 10), first)
  expect(firstPrompt.effects.length).toBe(0)
  expect(yr(firstPrompt.save).peekAt).toBe(T + lo)
  const high = specialPrompt(newSave(T), T, day(0, 10), () => 0.999999)
  expect(yr(high.save).peekAt).toBe(T + hi)
  const early = specialPrompt(firstPrompt.save, T + lo - 1000, day(0, 10), first)
  expect(early.effects.length).toBe(0)
  const peek = specialPrompt(early.save, T + lo, day(0, 10), first)
  expect(peek.effects.map(e => e.text)).toEqual([dm().lines.peek.water])
  expect(yr(peek.save).peekAt).toBe(T + lo + lo)
  const again = specialPrompt(peek.save, T + lo + 1000, day(0, 10), first)
  expect(again.effects.length).toBe(0)
})

test('Special-date human: a water peek fills the broth and lifts the mood; a flip peek lifts the mood', async () => {
  const [lo] = dm().peekMs
  const s = specialPrompt(newSave(T), T, day(0, 10), first).save
  yr(s).broth = 10
  yr(s).mood = 40
  const water = specialPrompt(s, T + lo, day(0, 10), first).save
  expect(yr(water).broth).toBe(100)
  expect(yr(water).mood).toBe(60)
  // The coin takes 0.9 (a flip), then the next draw 0
  const seq = [0.9, 0]
  const flipped = specialPrompt(s, T + lo, day(0, 10), () => seq.shift() ?? 0)
  expect(flipped.effects.map(e => e.text)).toEqual([dm().lines.peek.flip])
  expect(yr(flipped.save).broth).toBe(10)
  expect(yr(flipped.save).mood).toBe(55)
})

test("Special-date human: time in use uses up the human's broth, not the egg's; running dry is a reminder only", async () => {
  const t = day(0, 10)
  const p = usePrompt(newSave(T), newUse(), T, t)
  const r = useTurn(p.save, p.use, T + 15 * MIN, t, 'a', [], true)
  expect(yr(r.save).broth).toBe(96)
  expect(r.save.egg.broth).toBe(100)
  expect(r.save.egg.record.sessionMinutes).toBe(0)
  expect(r.save.egg.record.sessionCount).toBe(0)
  // A prompt right after, then one long turn: 25 more steps of 15 minutes run it dry
  const again = usePrompt(r.save, r.use, T + 15 * MIN + 1000, t)
  const dry = useTurn(again.save, again.use, T + 15 * MIN * 26, t, 'a', [], true)
  expect(yr(dry.save).broth).toBe(0)
  expect(dry.effects.map(e => e.text)).toEqual([dm().lines.dry.terminal])
  const more = useTurn(dry.save, dry.use, T + 15 * MIN * 27, t, 'a', [], false)
  expect(more.effects.length).toBe(0)
  // Dry still counts the prompts
  const n = yr(more.save).prompts ?? 0
  expect(yr(specialPrompt(more.save, T + 15 * MIN * 28, t, first).save).prompts).toBe(n + 1)
})

test('Special-date human: refill and flip look after the human; mood follows the hour, tests and failed tools', async () => {
  const t = day(0, 10)
  const s = newSave(T)
  entry(s).broth = 20
  entry(s).mood = 50
  const refilled = onCommand(s, T, t, 'refill', first)
  expect(refilled.reply).toBe(dm().replies.refill)
  expect(yr(refilled.save).broth).toBe(100)
  expect(yr(refilled.save).mood).toBe(70)
  expect(refilled.save.egg).toEqual(s.egg)
  const flipped = onCommand(refilled.save, T, t, 'flip', first)
  expect(flipped.reply).toBe(dm().replies.flip)
  expect(yr(flipped.save).mood).toBe(85)
  // An hour of ticks, a minute apart
  let ticking = flipped.save
  for (let i = 1; i <= 60; i++) ticking = onTick(ticking, T + i * MIN, t, first).save
  expect(yr(ticking).mood).toBe(80)
  const failed = onObserved(ticking, T + 61 * MIN, t, { danger: null, caution: null, test: null, failed: true }, first)
  expect(yr(failed.save).mood).toBe(77)
  const passed = specialEvent(failed.save, T + 62 * MIN, t, 'testPass', first)
  expect(yr(passed.save).mood).toBe(82)
  const turned = onTurn(passed.save, T + 62 * MIN + 30_000, t, first)
  expect(turned.save.egg.mood).toBe(s.egg.mood)
})

test("Special-date human: the face and hint follow the human's broth and mood", async () => {
  const t = day(0, 10)
  const { band } = dm()
  const s = newSave(T)
  const y = entry(s)
  y.mood = 70
  expect(specialBand(s, t).face).toBe(band.faces.happy)
  y.mood = 50
  expect(specialBand(s, t).face).toBe(band.face)
  y.mood = 29
  expect(specialBand(s, t).face).toBe(band.faces.bored)
  y.broth = 0
  expect(specialBand(s, t).face).toBe(band.faces.worried)
  expect(specialBand(s, t).hint).toBe(band.lowHint)
  y.broth = 30
  expect(specialBand(s, t).hint).toBe(band.hints[0]!)
})

test('Special-date human: an older entry without the new fields still reads (broth 100, mood 70, the first one)', async () => {
  const s = newSave(T)
  s.dateMode['d1:2027'] = { seen: true, revealed: false, human: 40, lastToast: {} }
  const b = specialBand(s, day(0, 10))
  expect(b.broth).toBe(100)
  expect(b.mood).toBe(70)
  expect(b.who).toContain('#1')
  expect(b.human).toBe(0)
})

test('Special-date human: the dex counts the ones done this year, only on the day', async () => {
  const done = prompts(newSave(T), dm().humanPrompts * 2).save
  const count = fill(dm().dexCount, { n: '2' })
  expect(onCommand(done, T, day(0, 10), 'dex', first).reply?.endsWith(count)).toBe(true)
  expect(onCommand(done, T, day(1, 10), 'dex', first).reply?.includes(count)).toBe(false)
})

test('Special-date human: looking after the human leaves the egg alone', async () => {
  const s = newSave(T)
  expect(humanCare(s, day(0, 10), 'refill').save.egg).toEqual(s.egg)
  expect(humanCare(s, day(0, 10), 'flip').save.egg).toEqual(s.egg)
})
