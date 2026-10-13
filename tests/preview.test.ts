import { test, expect } from 'claude-code/testing'
import { nextPreview, PREVIEW_KEYS, PREVIEW_LABELS, previewArt } from '../hooks/panel'
import { SPRITES } from '../hooks/sprites'

test('Preview command: empty goes to the next one and wraps from the last to the first', async () => {
  expect(nextPreview(null, '')).toBe('base0+face_happy')
  expect(nextPreview('base0+face_happy', '')).toBe('base0+face_normal')
  expect(nextPreview(PREVIEW_KEYS[PREVIEW_KEYS.length - 1]!, '')).toBe('base0+face_happy')
})

test('Preview command: next/prev words step both ways and wrap', async () => {
  expect(nextPreview('base0+face_happy', 'next')).toBe('base0+face_normal')
  expect(nextPreview('base0+face_happy', '下一張')).toBe('base0+face_normal')
  expect(nextPreview('base0+face_normal', 'prev')).toBe('base0+face_happy')
  expect(nextPreview('base0+face_normal', '上一張')).toBe('base0+face_happy')
  expect(nextPreview('base0+face_happy', 'prev')).toBe(PREVIEW_KEYS[PREVIEW_KEYS.length - 1])
  expect(nextPreview(null, 'prev')).toBe(PREVIEW_KEYS[PREVIEW_KEYS.length - 1])
})

test('Preview command: numbers, names, off and bad input', async () => {
  expect(nextPreview(null, ' 3')).toBe('base0+face_bored')
  expect(nextPreview(null, 'base2_dry+face_cry')).toBe('base2_dry+face_cry')
  expect(nextPreview(null, 'face_sleep')).toBe(undefined)
  expect(nextPreview('base0+face_normal', 'off')).toBe(null)
  expect(nextPreview(null, '0')).toBe(undefined)
  expect(nextPreview(null, '99')).toBe(undefined)
  expect(nextPreview(null, 'banana')).toBe(undefined)
})

test('Preview covers every picture the game can show: 4 stages × 5 faces, done, and 4 dry pots × 2', async () => {
  expect(PREVIEW_KEYS.length).toBe(29)
  expect(new Set(PREVIEW_KEYS).size).toBe(29)
  expect(PREVIEW_KEYS.filter(k => k.endsWith('+face_done'))).toEqual(['base0+face_done'])
  expect(PREVIEW_KEYS.filter(k => k.includes('_dry')).every(k => /\+face_(cry|sleep)$/.test(k))).toBe(true)
})

test('Every preview has a "stage + face" label and renders', async () => {
  for (const key of PREVIEW_KEYS) {
    const [base, face] = key.split('+')
    expect(SPRITES[base!]).toBeDefined()
    expect(SPRITES[face!]).toBeDefined()
    expect(PREVIEW_LABELS[key]!.includes('undefined')).toBe(false)
    expect(previewArt(key, 'desktop', 60)?.kind).toBe('svg')
    expect(previewArt(key, 'terminal', 60)?.kind).toBe('raster')
  }
  expect(PREVIEW_LABELS['base0+face_happy']).toBe('入味 0–19%（生蛋） + 表情：開心')
  expect(previewArt('base0+face_happy', 'terminal', 40)).toBe(null)
})
