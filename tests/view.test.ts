import { test, expect } from 'claude-code/testing'
import { bandSegments, bar, faceOf, fitSegments, STAGE_COLOR, stageOf, strWidth, truncate } from '../hooks/view'
import { newSave } from '../hooks/model'
import { at, ms } from './helpers'

const NOW = ms('2026-10-07', 14)
const text = (segs: { text: string }[]) => segs.map(s => s.text).join('')

test('Width: CJK and full-width take 2 columns, combining marks 0', async () => {
  expect(strWidth('abc')).toBe(3)
  expect(strWidth('入味')).toBe(4)
  expect(strWidth('｜')).toBe(2)
  expect(strWidth('(•̀ᴗ•́)')).toBe(5)
})

test('Truncation by display width', async () => {
  expect(truncate('茶葉蛋養成', 7)).toBe('茶葉蛋…')
  expect(strWidth(truncate('茶葉蛋養成', 7)) <= 7).toBe(true)
  expect(truncate('abc', 5)).toBe('abc')
})

test('Progress bar', async () => {
  expect(bar(62, 10)).toBe('██████░░░░')
  expect(bar(0, 5)).toBe('░░░░░')
  expect(bar(100, 5)).toBe('█████')
})

test('Flavor stages', async () => {
  expect([0, 19, 20, 39, 40, 69, 70, 99].map(stageOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
})

test('Face priority: just harvested > late night > broth dry > wants a flip > mood', async () => {
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

test('Band content', async () => {
  const s = newSave(NOW)
  s.egg.progress = 62
  s.egg.broth = 60
  s.egg.no = 3
  const line = text(bandSegments(s, at('2026-10-07', 14), NOW))
  expect(line.includes('小蛋 #3')).toBe(true)
  expect(line.includes('入味 ██████░░░░ 62%')).toBe(true)
  expect(line.includes('滷汁 ███░░')).toBe(true)
})

test('Hint shown when broth is below 30', async () => {
  const s = newSave(NOW)
  s.egg.broth = 20
  expect(text(bandSegments(s, at('2026-10-07', 14), NOW)).includes('滷汁快乾了')).toBe(true)
})

test('When too narrow, whole segments drop from the right and the result fits', async () => {
  const s = newSave(NOW)
  s.egg.progress = 62
  for (const cols of [10, 20, 40, 80]) {
    const fitted = fitSegments(bandSegments(s, at('2026-10-07', 14), NOW), cols)
    expect(strWidth(text(fitted)) <= cols).toBe(true)
  }
})

// The face sat in near-white and vanished on light themes: every fixed color must hold 2.5:1 against both a white and a near-black background
test('Band face colors stay readable on light and dark themes', async () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
  }
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  for (const color of STAGE_COLOR) {
    if (color === undefined) continue
    expect(contrast(lum(color), 1)).toBeGreaterThan(2.5)
    expect(contrast(lum(color), lum('#1e1e1e'))).toBeGreaterThan(2.5)
  }
})
