import { test, expect } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { crack, dexText, outcome, predictHint, settle } from '../hooks/rules'
import { newSave, newEgg } from '../hooks/model'
import { RULES, turnDone } from '../hooks/engine'
import { at } from './helpers'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 7)
const noLuck = () => 0.99
const lucky = () => 0

// Each case only describes the growth record; the expected egg is given by rule index, never by its plaintext name
function egg(patch: Partial<ReturnType<typeof newEgg>['record']>) {
  const e = newEgg(1, NOW - 7 * DAY)
  e.record = { ...e.record, sessionCount: 10, sessionMinutes: 600, ...patch }
  return e
}
const ruleEgg = (i: number) => decodeSpoilers().rules[i]!.egg

test('Harvest rules: one case for each of the eight outcomes, in the right order', async () => {
  expect(outcome(egg({ cracked: 'rm -rf', maxGapDays: 9 }), NOW, lucky)).toBe(ruleEgg(0))
  expect(outcome(egg({ maxGapDays: 9 }), NOW, lucky)).toBe(ruleEgg(1))
  expect(outcome(egg({ maxGapDays: 3, testRuns: 9, testFails: 9 }), NOW, noLuck)).toBe(ruleEgg(2))
  expect(outcome(egg({ testRuns: 5, testFails: 3, startedAt: NOW - 30 * DAY }), NOW, noLuck)).toBe(ruleEgg(3))
  expect(outcome(egg({ startedAt: NOW - 21 * DAY, sessionMinutes: 99999 }), NOW, noLuck)).toBe(ruleEgg(4))
  expect(outcome(egg({ sessionMinutes: 1300 }), NOW, noLuck)).toBe(ruleEgg(5))
  expect(outcome(egg({ sessionMinutes: 150 }), NOW, noLuck)).toBe(ruleEgg(6))
  expect(outcome(egg({}), NOW, noLuck)).toBe(ruleEgg(7))
})

test('Edge: exactly 50% fail rate or fewer than 5 test runs does not count', async () => {
  expect(outcome(egg({ testRuns: 4, testFails: 4 }), NOW, noLuck)).toBe(ruleEgg(7))
  expect(outcome(egg({ testRuns: 6, testFails: 3 }), NOW, noLuck)).toBe(ruleEgg(7))
})

test('No session records is not judged as short sessions', async () => {
  expect(outcome(egg({ sessionCount: 0, sessionMinutes: 0 }), NOW, noLuck)).toBe(ruleEgg(7))
})

test('No hint before 50% flavor; afterwards a hint from the predicted outcome (skipping the first two rules)', async () => {
  const e = egg({ maxGapDays: 5 })
  e.progress = 49
  expect(predictHint(e, NOW)).toBe(null)
  e.progress = 50
  expect(predictHint(e, NOW)).toBe(decodeSpoilers().hints[ruleEgg(2)]!)
})

test('Harvest at 100: added to the dex, new-entry note the first time, next egg handed out', async () => {
  const s = newSave(NOW)
  s.egg.progress = 100
  const r = settle({ save: s, effects: [] }, NOW, noLuck)
  const id = ruleEgg(7)
  expect(r.save.dex[id]).toBe(1)
  expect(r.save.egg.no).toBe(2)
  expect(r.save.egg.progress).toBe(0)
  expect(r.save.egg.record.sessionCount).toBe(1)
  expect(r.save.harvestedAt).toBe(NOW)
  expect(r.effects[0]!.text.includes(decodeSpoilers().eggs[id]!.name)).toBe(true)
  expect(r.effects[0]!.text.includes('新圖鑑')).toBe(true)
  // Second egg: give it normal-length sessions so it doesn't hit the "average session too short" rule
  const second = { ...r.save.egg, progress: 100, record: { ...r.save.egg.record, sessionMinutes: 60 } }
  const again = settle({ save: { ...r.save, egg: second }, effects: [] }, NOW, noLuck)
  expect(again.save.dex[id]).toBe(2)
  expect(again.effects[0]!.text.includes('新圖鑑')).toBe(false)
})

test('A dangerous command cracks the egg immediately and the message shows the keyword', async () => {
  const r = crack(newSave(NOW), 'git reset --hard', NOW, noLuck)
  expect(r.save.dex[ruleEgg(0)]).toBe(1)
  expect(r.effects[0]!.text.includes('git reset --hard')).toBe(true)
  expect(r.save.egg.no).toBe(2)
})

test('Dex text: 9 slots, missing ones show ???, slot 9 gives no hint', async () => {
  const s = newSave(NOW)
  s.dex = { [ruleEgg(7)]: 3 }
  const text = dexText(s, '蛋圖鑑')
  expect(text.startsWith(' 蛋圖鑑 1/9')).toBe(true)
  expect(text.includes('×3')).toBe(true)
  expect(text.includes('❓ ???')).toBe(true)
  expect(text.split('???').length - 1).toBe(8)
})

test('Dex: the prize egg hides its icon until collected, whatever its slot', async () => {
  const sp = structuredClone(decodeSpoilers())
  const prize = sp.dateMode.prize
  const others = sp.dexSlots.filter(id => id !== prize)
  // Move the prize egg to the front and append a new regular egg at the end
  sp.eggs.newcomer = { name: '新蛋', icon: '🆕' }
  sp.dexSlots = [prize, ...others, 'newcomer']
  const text = dexText(newSave(NOW), '蛋圖鑑', sp)
  expect(text).toContain(`0/${sp.dexSlots.length}`)
  expect(text).toContain('🆕 ???')
  expect(text).not.toContain(`${sp.eggs[prize]!.icon} ???`)
  expect(text.split('❓ ???').length - 1).toBe(1)
})

test('A new egg starts with a fresh daily flavor cap, even after the previous egg used it up today', async () => {
  const s = newSave(NOW)
  s.daily = { date: at('2026-10-07').date, gained: RULES.dailyCap }
  const r = crack(s, 'rm -rf', NOW, noLuck)
  expect(r.save.egg.no).toBe(2)
  const next = turnDone(r.save, NOW, at('2026-10-07'), noLuck)
  expect(next.save.egg.progress).toBe(1)
})
