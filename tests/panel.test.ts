import { test, expect } from 'claude-code/testing'
import { ASCII_EGG, dexArt, eggArt, eggLayers, panelLines } from '../hooks/panel'
import { strWidth } from '../hooks/view'
import { newSave } from '../hooks/model'
import { SPRITES } from '../hooks/sprites'
import { at, ms } from './helpers'

const NOW = ms('2026-10-07', 14)

test('terminal 夠寬時用 Raster，太窄退回 ASCII', async () => {
  const s = newSave(NOW)
  expect(eggArt(s, at('2026-10-07', 14), NOW, 'terminal', 50).kind).toBe('raster')
  expect(eggArt(s, at('2026-10-07', 14), NOW, 'terminal', 40).kind).toBe('ascii')
})

test('desktop 用 SVG', async () => {
  expect(eggArt(newSave(NOW), at('2026-10-07', 14), NOW, 'desktop', 40).kind).toBe('svg')
})

test('開心用階段圖，其他表情用表情圖', async () => {
  const s = newSave(NOW)
  const happy = eggLayers(s, at('2026-10-07', 14), NOW)
  expect(happy.length).toBe(1)
  expect(happy[0]!.pixels).toBe(SPRITES.stage0)
  s.egg.broth = 0
  const dry = eggLayers(s, at('2026-10-07', 14), NOW)
  expect(dry[0]!.pixels).toBe(SPRITES.face_dry)
})

test('圖鑑圖缺素材時回 null', async () => {
  expect(dexArt('nope-id', true, 'terminal')).toBeNull()
})

test('面板文字包含名字、數值條與提示', async () => {
  const s = newSave(NOW)
  s.egg.broth = 20
  const lines = panelLines(s, at('2026-10-07', 14), NOW).join('\n')
  expect(lines.includes('小蛋 #1')).toBe(true)
  expect(lines.includes('入味')).toBe(true)
  expect(lines.includes('滷汁')).toBe(true)
  expect(lines.includes('心情')).toBe(true)
  expect(lines.includes('滷汁快乾了')).toBe(true)
})

test('ASCII 退路：每種表情放進外框後每列等寬', async () => {
  const t = at('2026-10-07', 14)
  const cases: ((s: ReturnType<typeof newSave>) => [number, ReturnType<typeof at>])[] = [
    s => { s.egg.mood = 90; return [NOW, t] }, // happy
    s => { s.egg.mood = 50; return [NOW, t] }, // normal
    s => { s.egg.mood = 10; return [NOW, t] }, // bored
    s => { s.egg.broth = 0; return [NOW, t] }, // dry
    () => [ms('2026-10-08', 2), at('2026-10-08', 2)], // sleep
    s => { s.egg.flipWantedAt = NOW; return [NOW, t] }, // flip
    s => { s.harvestedAt = NOW; return [NOW, t] }, // done
  ]
  for (const make of cases) {
    for (const progress of [0, 30, 50, 90]) {
      const s = newSave(NOW)
      s.egg.progress = progress
      const [now, lt] = make(s)
      const art = eggArt(s, lt, now, 'terminal', 10)
      if (art.kind !== 'ascii') throw new Error('expected ascii')
      const box = art.lines.slice(0, 5)
      expect(new Set(box.map(strWidth)).size).toBe(1)
    }
  }
})

test('ASCII 蛋：各階段每列等寬，且保留反斜線邊緣', async () => {
  for (const stage of ASCII_EGG) {
    expect(new Set(stage.map(strWidth)).size).toBe(1)
  }
  expect(ASCII_EGG[0]![1]!.includes('\\')).toBe(true)
  expect(ASCII_EGG[0]![3]!.includes('\\')).toBe(true)
})
