import { test, expect } from 'claude-code/testing'
import { ASCII_EGG, dexArt, eggArt, eggLayers, panelLines } from '../hooks/panel'
import { strWidth } from '../hooks/view'
import { newSave } from '../hooks/model'
import { SPRITES } from '../hooks/sprites'
import { SPRITES_HD } from '../hooks/sprites-hd'
import { decodeSpoilers } from '../hooks/spoilers'
import { at, ms } from './helpers'

const NOW = ms('2026-10-07', 14)

test('Terminal uses Raster when wide enough and ASCII when too narrow', async () => {
  const s = newSave(NOW)
  expect(eggArt(s, at('2026-10-07', 14), NOW, 'terminal', 50).kind).toBe('raster')
  expect(eggArt(s, at('2026-10-07', 14), NOW, 'terminal', 40).kind).toBe('ascii')
})

test('Desktop uses SVG', async () => {
  expect(eggArt(newSave(NOW), at('2026-10-07', 14), NOW, 'desktop', 40).kind).toBe('svg')
})

test('Happy uses the stage sprite; other faces use face sprites', async () => {
  const s = newSave(NOW)
  const happy = eggLayers(s, at('2026-10-07', 14), NOW)
  expect(happy.length).toBe(1)
  expect(happy[0]!.pixels).toBe(SPRITES.stage0)
  s.egg.broth = 0
  const dry = eggLayers(s, at('2026-10-07', 14), NOW)
  expect(dry[0]!.pixels).toBe(SPRITES.face_dry)
})

test('Dex art is null when the sprite is missing', async () => {
  expect(dexArt('nope-id', true, 'terminal')).toBeNull()
})

test('Panel text includes the name, stat bars and hint', async () => {
  const s = newSave(NOW)
  s.egg.broth = 20
  const lines = panelLines(s, at('2026-10-07', 14), NOW).join('\n')
  expect(lines.includes('小蛋 #1')).toBe(true)
  expect(lines.includes('入味')).toBe(true)
  expect(lines.includes('滷汁')).toBe(true)
  expect(lines.includes('心情')).toBe(true)
  expect(lines.includes('滷汁快乾了')).toBe(true)
})

test('ASCII fallback: every face fits the frame with equal-width rows', async () => {
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

test('ASCII egg: equal-width rows at every stage, with backslash edges kept', async () => {
  for (const stage of ASCII_EGG) {
    expect(new Set(stage.map(strWidth)).size).toBe(1)
  }
  expect(ASCII_EGG[0]![1]!.includes('\\')).toBe(true)
  expect(ASCII_EGG[0]![3]!.includes('\\')).toBe(true)
})

test('Desktop uses <image> when a high-res sprite exists, and every SVG stays under 131072 chars', async () => {
  const art = eggArt(newSave(NOW), at('2026-10-07', 14), NOW, 'desktop', 40)
  expect(art.kind).toBe('svg')
  if (art.kind === 'svg') expect(art.source.includes('<image')).toBe(true)
  expect(eggArt(newSave(NOW), at('2026-10-07', 14), NOW, 'terminal', 50).kind).toBe('raster')
  const ids = [...Object.keys(SPRITES_HD), ...Object.keys(decodeSpoilers().spritesHd ?? {})]
  expect(ids.length).toBeGreaterThan(0)
  for (const id of Object.keys(SPRITES_HD)) {
    const a = dexArt(id, false, 'desktop')
    if (id === 'locked') expect(a?.kind === 'svg' && a.source.length < 131072).toBe(true)
  }
  for (const id of Object.keys(decodeSpoilers().spritesHd ?? {})) {
    const a = dexArt(id, true, 'desktop')
    expect(a?.kind === 'svg' && a.source.includes('<image') && a.source.length < 131072).toBe(true)
  }
  // Public sprites: SVG length with the HD string embedded twice
  for (const b64 of Object.values(SPRITES_HD)) expect(b64.length * 2 + 600).toBeLessThan(131072)
})
