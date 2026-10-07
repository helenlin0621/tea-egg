import { test, expect } from 'claude-code/testing'
import { bandSegments, bar, faceOf, fitSegments, stageOf, strWidth, truncate } from '../hooks/view'
import { newSave } from '../hooks/model'
import { at, ms } from './helpers'

const NOW = ms('2026-10-07', 14)
const text = (segs: { text: string }[]) => segs.map(s => s.text).join('')

test('字寬：中文與全形 2 格、組合字元 0 格', async () => {
  expect(strWidth('abc')).toBe(3)
  expect(strWidth('入味')).toBe(4)
  expect(strWidth('｜')).toBe(2)
  expect(strWidth('(•̀ᴗ•́)')).toBe(5)
})

test('截斷依字寬', async () => {
  expect(truncate('茶葉蛋養成', 7)).toBe('茶葉蛋…')
  expect(strWidth(truncate('茶葉蛋養成', 7)) <= 7).toBe(true)
  expect(truncate('abc', 5)).toBe('abc')
})

test('進度條', async () => {
  expect(bar(62, 10)).toBe('██████░░░░')
  expect(bar(0, 5)).toBe('░░░░░')
  expect(bar(100, 5)).toBe('█████')
})

test('入味階段', async () => {
  expect([0, 19, 20, 39, 40, 69, 70, 99].map(stageOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
})

test('表情優先順序：剛出鍋 > 深夜 > 滷汁乾 > 想翻身 > 心情', async () => {
  const s = newSave(NOW)
  expect(faceOf(s, at('2026-10-07', 14), NOW)).toBe('happy')
  s.egg.mood = 50
  expect(faceOf(s, at('2026-10-07', 14), NOW)).toBe('normal')
  s.egg.mood = 10
  expect(faceOf(s, at('2026-10-07', 14), NOW)).toBe('bored')
  s.egg.flipWantedAt = NOW
  expect(faceOf(s, at('2026-10-07', 14), NOW)).toBe('flip')
  s.egg.broth = 0
  expect(faceOf(s, at('2026-10-07', 14), NOW)).toBe('dry')
  expect(faceOf(s, at('2026-10-07', 2), NOW)).toBe('sleep')
  s.harvestedAt = NOW - 60_000
  expect(faceOf(s, at('2026-10-07', 2), NOW)).toBe('done')
})

test('橫條內容', async () => {
  const s = newSave(NOW)
  s.egg.progress = 62
  s.egg.broth = 60
  s.egg.no = 3
  const line = text(bandSegments(s, at('2026-10-07', 14), NOW))
  expect(line.includes('小蛋 #3')).toBe(true)
  expect(line.includes('入味 ██████░░░░ 62%')).toBe(true)
  expect(line.includes('滷汁 ███░░')).toBe(true)
})

test('滷汁低於 30 時顯示提示', async () => {
  const s = newSave(NOW)
  s.egg.broth = 20
  expect(text(bandSegments(s, at('2026-10-07', 14), NOW)).includes('滷汁快乾了')).toBe(true)
})

test('寬度不夠時從右邊丟掉整段，結果不超過寬度', async () => {
  const s = newSave(NOW)
  s.egg.progress = 62
  for (const cols of [10, 20, 40, 80]) {
    const fitted = fitSegments(bandSegments(s, at('2026-10-07', 14), NOW), cols)
    expect(strWidth(text(fitted)) <= cols).toBe(true)
  }
})
