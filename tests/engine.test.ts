import { test, expect } from 'claude-code/testing'
import { RULES, flip, refill, testObserved, tick, toolFailed, turnDone, pauseClocks } from '../hooks/engine'
import { newSave } from '../hooks/model'
import { outcome } from '../hooks/rules'
import { decodeSpoilers } from '../hooks/spoilers'
import { at, ms } from './helpers'

const MIN = 60_000
const never = () => 0.99

test('Each completed turn adds +1 flavor', async () => {
  const s = newSave(ms('2026-10-07'))
  const r = turnDone(s, ms('2026-10-07'), at('2026-10-07'), never)
  expect(r.save.egg.progress).toBe(1)
  expect(s.egg.progress).toBe(0) // the input save is not modified
})

test('Daily flavor cap is 15 and resets the next day', async () => {
  let s = newSave(ms('2026-10-07'))
  for (let i = 0; i < 30; i++) s = turnDone(s, ms('2026-10-07'), at('2026-10-07'), never).save
  expect(s.egg.progress).toBe(15)
  s = turnDone(s, ms('2026-10-08'), at('2026-10-08'), never).save
  expect(s.egg.progress).toBe(16)
})

test('Broth drops 4 every 15 minutes, counting only time the session is open', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  for (let m = 1; m <= 15; m++) s = tick(s, t0 + m * MIN, at('2026-10-07')).save
  expect(s.egg.broth).toBe(96)
  // Closed for 5 hours, then reopened: at most 3 minutes count per tick
  s = tick(s, t0 + 15 * MIN + 5 * 60 * MIN, at('2026-10-07', 15)).save
  expect(s.egg.broth).toBe(96)
})

test('Two sessions ticking at the same time do not double-deduct', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  for (let m = 1; m <= 15; m++) {
    s = tick(s, t0 + m * MIN, at('2026-10-07')).save
    s = tick(s, t0 + m * MIN, at('2026-10-07')).save
  }
  expect(s.egg.broth).toBe(96)
})

test('Toasts once when broth hits zero, then flavor stops; refill restores it', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.broth = 4
  let x = s
  const toasts: string[] = []
  for (let m = 1; m <= 15; m++) {
    const st = tick(x, t0 + m * MIN, at('2026-10-07'))
    x = st.save
    toasts.push(...st.effects.map(f => f.text))
  }
  expect(x.egg.broth).toBe(0)
  expect(toasts.filter(text => text.includes('滷汁乾了')).length).toBe(1)
  const stuck = turnDone(x, t0 + 16 * MIN, at('2026-10-07'), never).save
  expect(stuck.egg.progress).toBe(0)
  const refilled = refill(stuck).save
  expect(refilled.egg.broth).toBe(100)
  expect(refilled.egg.mood >= 70).toBe(true)
  expect(turnDone(refilled, t0 + 17 * MIN, at('2026-10-07'), never).save.egg.progress).toBe(1)
})

test('A 10-minute bucket adds +1 only if there was activity', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s = turnDone(s, t0 + MIN, at('2026-10-07'), never).save // +1 (turn)
  for (let m = 2; m <= 10; m++) s = tick(s, t0 + m * MIN, at('2026-10-07')).save
  expect(s.egg.progress).toBe(2) // +1 (active bucket)
  for (let m = 11; m <= 20; m++) s = tick(s, t0 + m * MIN, at('2026-10-07')).save
  expect(s.egg.progress).toBe(2) // no turn in this bucket
})

test('Mood -5 per hour; tool failure -3; passing tests +5', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  for (let m = 1; m <= 60; m++) s = tick(s, t0 + m * MIN, at('2026-10-07')).save
  expect(s.egg.mood).toBe(65)
  expect(toolFailed(s).save.egg.mood).toBe(62)
  const passed = testObserved(s, true).save
  expect(passed.egg.mood).toBe(70)
  expect(passed.egg.record.testRuns).toBe(1)
  const failed = testObserved(s, false).save
  expect(failed.egg.record.testFails).toBe(1)
})

test('Wants a flip after 90 active minutes; flipping within 30 minutes gives +2, ignoring the daily cap', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.activeMinutes = RULES.flipAfterMin
  const want = tick(s, t0 + MIN, at('2026-10-07'))
  expect(want.save.egg.flipWantedAt).toBe(t0 + MIN)
  expect(want.effects.some(f => f.text.includes('/egg flip'))).toBe(true)
  const capped = { ...want.save, daily: { date: '2026-10-07', gained: 15 } }
  const flipped = flip(capped, t0 + 10 * MIN, at('2026-10-07')).save
  expect(flipped.egg.progress).toBe(2)
  expect(flipped.egg.flipWantedAt).toBe(null)
})

test('No flip within 30 minutes just lapses, without penalty', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.flipWantedAt = t0
  s.egg.mood = 50
  s = tick(s, t0 + 31 * MIN, at('2026-10-07')).save
  expect(s.egg.flipWantedAt).toBe(null)
  const r = flip(s, t0 + 32 * MIN, at('2026-10-07'))
  expect(r.save.egg.progress).toBe(0)
  expect(r.reply).toBe('蛋現在躺得很舒服，還不用翻')
})

test('The first turn completed late at night toasts once', async () => {
  const s = newSave(ms('2026-10-08', 1))
  const a = turnDone(s, ms('2026-10-08', 1), at('2026-10-08', 1), never)
  expect(a.effects.length).toBe(1)
  const b = turnDone(a.save, ms('2026-10-08', 2), at('2026-10-08', 2), never)
  expect(b.effects.length).toBe(0)
})

test('Active days and max gap', async () => {
  let s = newSave(ms('2026-10-01'))
  s = turnDone(s, ms('2026-10-01'), at('2026-10-01'), never).save
  s = turnDone(s, ms('2026-10-04'), at('2026-10-04'), never).save
  s = turnDone(s, ms('2026-10-05'), at('2026-10-05'), never).save
  expect(s.egg.record.activeDays).toEqual(['2026-10-01', '2026-10-04', '2026-10-05'])
  expect(s.egg.record.maxGapDays).toBe(2) // 10-02 and 10-03 not opened
})

test('A gap counts only the days not opened in between: consecutive days are 0', async () => {
  let s = newSave(ms('2026-10-01'))
  s = turnDone(s, ms('2026-10-01'), at('2026-10-01'), never).save
  s = turnDone(s, ms('2026-10-02'), at('2026-10-02'), never).save
  expect(s.egg.record.maxGapDays).toBe(0)
})

test('Skipping a weekend is not a long gap; one more empty day is', async () => {
  const rule = decodeSpoilers().rules.find(r => r.when === 'gapAtLeast')!
  const after = (next: string) => {
    let s = newSave(ms('2026-10-09')) // Friday
    s = turnDone(s, ms('2026-10-09'), at('2026-10-09'), never).save
    s = turnDone(s, ms(next), at(next), never).save
    return s.egg
  }
  const monday = after('2026-10-12')
  expect(monday.record.maxGapDays).toBe(2)
  expect(outcome(monday, ms('2026-10-12'), never)).not.toBe(rule.egg)
  const tuesday = after('2026-10-13')
  expect(tuesday.record.maxGapDays).toBe(3)
  expect(outcome(tuesday, ms('2026-10-13'), never)).toBe(rule.egg)
})

test('Pausing only advances the clocks; the egg is unchanged', async () => {
  const t0 = ms('2026-10-07')
  const s = newSave(t0)
  const p = pauseClocks(s, t0 + 60 * MIN).save
  expect(p.clocks.lastTickAt).toBe(t0 + 60 * MIN)
  expect(p.egg).toEqual(s.egg)
})

test('Refill lifts mood: 30 → 70 (floor), 60 → 80 (+20), 95 → 100 (cap)', async () => {
  const t0 = ms('2026-10-07')

  let s = newSave(t0)
  s.egg.mood = 30
  const r1 = refill(s)
  expect(r1.save.egg.mood).toBe(70)

  s = newSave(t0)
  s.egg.mood = 60
  const r2 = refill(s)
  expect(r2.save.egg.mood).toBe(80)

  s = newSave(t0)
  s.egg.mood = 95
  const r3 = refill(s)
  expect(r3.save.egg.mood).toBe(100)
})

test('Flipping within the window lifts mood +15', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.mood = 40
  s.egg.flipWantedAt = t0
  const r = flip(s, t0 + 10 * MIN, at('2026-10-07'))
  expect(r.save.egg.mood).toBe(55)
})

test('Flipping after the window does not change mood', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.mood = 40
  s.egg.flipWantedAt = t0
  s = tick(s, t0 + 31 * MIN, at('2026-10-07')).save
  const r = flip(s, t0 + 32 * MIN, at('2026-10-07'))
  expect(r.save.egg.mood).toBe(40)
})

test('Flipping with zero broth gives mood but no flavor and replies with flipNoGain', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.broth = 0
  s.egg.flipWantedAt = t0
  s.egg.mood = 40
  const r = flip(s, t0 + 10 * MIN, at('2026-10-07'))
  expect(r.save.egg.progress).toBe(0)
  expect(r.save.egg.mood).toBe(55)
  expect(r.reply).toBe('翻好了！(•̀ᴗ•́)↻')
})
