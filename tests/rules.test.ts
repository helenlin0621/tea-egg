import { test, expect } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { crack, dexText, outcome, predictHint, settle } from '../hooks/rules'
import { newSave, newEgg } from '../hooks/model'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 7)
const noLuck = () => 0.99
const lucky = () => 0

// 每個案例只描述成長紀錄；預期的蛋用規則順序（index）表示，不寫明文名稱
function egg(patch: Partial<ReturnType<typeof newEgg>['record']>) {
  const e = newEgg(1, NOW - 7 * DAY)
  e.record = { ...e.record, sessionCount: 10, sessionMinutes: 600, ...patch }
  return e
}
const ruleEgg = (i: number) => decodeSpoilers().rules[i]!.egg

test('出鍋規則：八種結果各一例且順序正確', async () => {
  expect(outcome(egg({ cracked: 'rm -rf', maxGapDays: 9 }), NOW, lucky)).toBe(ruleEgg(0))
  expect(outcome(egg({ maxGapDays: 9 }), NOW, lucky)).toBe(ruleEgg(1))
  expect(outcome(egg({ maxGapDays: 3, testRuns: 9, testFails: 9 }), NOW, noLuck)).toBe(ruleEgg(2))
  expect(outcome(egg({ testRuns: 5, testFails: 3, startedAt: NOW - 30 * DAY }), NOW, noLuck)).toBe(ruleEgg(3))
  expect(outcome(egg({ startedAt: NOW - 21 * DAY, sessionMinutes: 99999 }), NOW, noLuck)).toBe(ruleEgg(4))
  expect(outcome(egg({ sessionMinutes: 1300 }), NOW, noLuck)).toBe(ruleEgg(5))
  expect(outcome(egg({ sessionMinutes: 150 }), NOW, noLuck)).toBe(ruleEgg(6))
  expect(outcome(egg({}), NOW, noLuck)).toBe(ruleEgg(7))
})

test('邊界：失敗率剛好 50% 或測試不足 5 次不算', async () => {
  expect(outcome(egg({ testRuns: 4, testFails: 4 }), NOW, noLuck)).toBe(ruleEgg(7))
  expect(outcome(egg({ testRuns: 6, testFails: 3 }), NOW, noLuck)).toBe(ruleEgg(7))
})

test('沒有任何 session 紀錄時不會被判成短 session', async () => {
  expect(outcome(egg({ sessionCount: 0, sessionMinutes: 0 }), NOW, noLuck)).toBe(ruleEgg(7))
})

test('入味 50% 前沒有提示，之後依推測給提示（跳過前兩條）', async () => {
  const e = egg({ maxGapDays: 5 })
  e.progress = 49
  expect(predictHint(e, NOW)).toBe(null)
  e.progress = 50
  expect(predictHint(e, NOW)).toBe(decodeSpoilers().hints[ruleEgg(2)]!)
})

test('入味到 100 出鍋：寫入圖鑑、首次有新圖鑑字樣、領下一顆', async () => {
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
  // 第二顆蛋：給它正常長度的 session，避免落到「平均 session 太短」那條規則
  const second = { ...r.save.egg, progress: 100, record: { ...r.save.egg.record, sessionMinutes: 60 } }
  const again = settle({ save: { ...r.save, egg: second }, effects: [] }, NOW, noLuck)
  expect(again.save.dex[id]).toBe(2)
  expect(again.effects[0]!.text.includes('新圖鑑')).toBe(false)
})

test('危險指令立即破蛋，訊息顯示關鍵字', async () => {
  const r = crack(newSave(NOW), 'git reset --hard', NOW, noLuck)
  expect(r.save.dex[ruleEgg(0)]).toBe(1)
  expect(r.effects[0]!.text.includes('git reset --hard')).toBe(true)
  expect(r.save.egg.no).toBe(2)
})

test('圖鑑文字：共 9 格，未獲得顯示 ???，第 9 格無提示', async () => {
  const s = newSave(NOW)
  s.dex = { [ruleEgg(7)]: 3 }
  const text = dexText(s, '蛋圖鑑')
  expect(text.startsWith(' 蛋圖鑑 1/9')).toBe(true)
  expect(text.includes('×3')).toBe(true)
  expect(text.includes('❓ ???')).toBe(true)
  expect(text.split('???').length - 1).toBe(8)
})
