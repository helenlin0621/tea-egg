import { test, expect } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { caution, crack, dexCaption, dexHeader, dexText, outcome, predictHint, settle } from '../hooks/rules'
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

// Days for the several-sessions rule: n days in all, the first m of them with several sessions
function days(n: number, m: number) {
  const all = Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
  return { activeDays: all, multiDays: all.slice(0, m) }
}

test('Harvest rules: one case for each of the nine outcomes, in the right order', async () => {
  expect(outcome(egg({ cracked: 'rm -rf', maxGapDays: 9 }), NOW, lucky)).toBe(ruleEgg(0))
  expect(outcome(egg({ maxGapDays: 9 }), NOW, lucky)).toBe(ruleEgg(1))
  expect(outcome(egg({ maxGapDays: 3, testRuns: 9, testFails: 9 }), NOW, noLuck)).toBe(ruleEgg(2))
  expect(outcome(egg({ testRuns: 10, testFails: 4, dryMinutes: 999 }), NOW, noLuck)).toBe(ruleEgg(3))
  expect(outcome(egg({ dryMinutes: 999, sessionMinutes: 99999 }), NOW, noLuck)).toBe(ruleEgg(4))
  // Also long sessions: the several-sessions rule comes first
  expect(outcome(egg({ ...days(7, 5), sessionMinutes: 1300 }), NOW, noLuck)).toBe(ruleEgg(5))
  expect(outcome(egg({ sessionMinutes: 1300 }), NOW, noLuck)).toBe(ruleEgg(6))
  expect(outcome(egg({ sessionMinutes: 150 }), NOW, noLuck)).toBe(ruleEgg(7))
  expect(outcome(egg({}), NOW, noLuck)).toBe(ruleEgg(8))
})

test('Several sessions: needs enough days, and enough of the active days', async () => {
  const rule = decodeSpoilers().rules[5]!
  if (rule.when !== 'multiDaysAtLeast') throw new Error('rule 5 is the several-sessions rule')
  const enough = rule.days
  const most = Math.floor(enough / rule.ratio) // the most active days that still meet the share
  expect(outcome(egg(days(most, enough)), NOW, noLuck)).toBe(ruleEgg(5))
  expect(outcome(egg(days(most, enough - 1)), NOW, noLuck)).toBe(ruleEgg(8)) // too few days
  expect(outcome(egg(days(most + 1, enough)), NOW, noLuck)).toBe(ruleEgg(8)) // under the share of active days
  expect(outcome(egg({ ...days(most, enough), multiDays: undefined }), NOW, noLuck)).toBe(ruleEgg(8)) // older saves
})

test('The lucky roll: below the chance wins, at or above it does not', async () => {
  const rule = decodeSpoilers().rules[1]!
  if (rule.when !== 'chance') throw new Error('rule 1 is the lucky roll')
  expect(outcome(egg({}), NOW, () => rule.p - 0.001)).toBe(ruleEgg(1))
  expect(outcome(egg({}), NOW, () => rule.p)).toBe(ruleEgg(8))
})

test('Edge: a fail rate exactly at the line, or too few test runs, does not count', async () => {
  const rule = decodeSpoilers().rules[3]!
  if (rule.when !== 'failRateAbove') throw new Error('rule 3 is the fail-rate rule')
  const runs = rule.minRuns
  expect(outcome(egg({ testRuns: runs - 1, testFails: runs - 1 }), NOW, noLuck)).toBe(ruleEgg(8))
  expect(outcome(egg({ testRuns: runs, testFails: Math.round(runs * rule.rate) }), NOW, noLuck)).toBe(ruleEgg(8))
  expect(outcome(egg({ testRuns: runs, testFails: Math.round(runs * rule.rate) + 1 }), NOW, noLuck)).toBe(ruleEgg(3))
})

test('Dry pot: enough minutes in use with no broth', async () => {
  const rule = decodeSpoilers().rules[4]!
  if (rule.when !== 'dryAtLeast') throw new Error('rule 4 is the dry-pot rule')
  expect(outcome(egg({ dryMinutes: rule.minutes }), NOW, noLuck)).toBe(ruleEgg(4))
  expect(outcome(egg({ dryMinutes: rule.minutes - 1 }), NOW, noLuck)).toBe(ruleEgg(8))
  expect(outcome(egg({ startedAt: NOW - 60 * DAY }), NOW, noLuck)).toBe(ruleEgg(8)) // age alone no longer counts
})

test('Caution-level commands crack the egg once enough of them pile up', async () => {
  const rule = decodeSpoilers().rules[0]!
  if (rule.when !== 'cracked') throw new Error('rule 0 is the cracked rule')
  let s = newSave(NOW)
  for (let i = 1; i < rule.cautions; i++) {
    s = caution(s, 'git reset --hard', NOW, noLuck).save
    expect(s.egg.no).toBe(1)
    expect(s.egg.record.cautions).toBe(i)
  }
  const r = caution(s, 'git reset --hard', NOW, noLuck)
  expect(r.save.egg.no).toBe(2)
  expect(r.save.dex[ruleEgg(0)]).toBe(1)
  expect(r.effects[0]!.text.includes('git reset --hard')).toBe(true)
  expect(r.save.egg.record.cautions ?? 0).toBe(0) // the new egg starts over
})

test('No session records is not judged as short sessions', async () => {
  expect(outcome(egg({ sessionCount: 0, sessionMinutes: 0 }), NOW, noLuck)).toBe(ruleEgg(8))
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
  const id = ruleEgg(8)
  expect(r.save.dex[id]).toBe(1)
  expect(r.save.egg.no).toBe(2)
  expect(r.save.egg.progress).toBe(0)
  expect(r.save.egg.record.sessionCount).toBe(0) // the session counts toward the new egg on its next prompt
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

test('Dex text: every slot counted, missing ones show ???, the prize slot gives no hint', async () => {
  const s = newSave(NOW)
  s.dex = { [ruleEgg(8)]: 3 }
  const text = dexText(s, '蛋圖鑑')
  expect(text.startsWith(` 蛋圖鑑 1/${decodeSpoilers().dexSlots.length}`)).toBe(true)
  expect(text.includes('×3')).toBe(true)
  expect(text.includes('❓ ???')).toBe(true)
  expect(text.split('???').length - 1).toBe(decodeSpoilers().dexSlots.length - 1)
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

test('Dex pane: header is only the count; captions show name and count once collected, ??? before', async () => {
  const s = newSave(NOW)
  const id = ruleEgg(8)
  s.dex = { [id]: 3 }
  expect(dexHeader(s, '蛋圖鑑')).toBe(` 蛋圖鑑 1/${decodeSpoilers().dexSlots.length}`)
  const sp = decodeSpoilers()
  expect(dexCaption(s, id)).toEqual({ name: sp.eggs[id]!.name, count: '×3' })
  const missing = sp.dexSlots.find(x => x !== id)!
  expect(dexCaption(s, missing)).toEqual({ name: '???', count: ' ' })
})
