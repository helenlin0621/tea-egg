import { test, expect } from 'claude-code/testing'
import { nextPreview, PREVIEW_KEYS, PREVIEW_LABELS, previewArt } from '../hooks/panel'
import { SPRITES } from '../hooks/sprites'

test('Preview command: empty goes to the next one and wraps from the last to the first', async () => {
  expect(nextPreview(null, '')).toBe('stage0')
  expect(nextPreview('stage0', '')).toBe('stage1')
  expect(nextPreview(PREVIEW_KEYS[PREVIEW_KEYS.length - 1]!, '')).toBe('stage0')
})

test('Preview command: numbers, names, off and bad input', async () => {
  expect(nextPreview(null, ' 3')).toBe('stage2')
  expect(nextPreview(null, 'face_sleep')).toBe('face_sleep')
  expect(nextPreview('stage1', 'off')).toBe(null)
  expect(nextPreview(null, '0')).toBe(undefined)
  expect(nextPreview(null, '99')).toBe(undefined)
  expect(nextPreview(null, 'banana')).toBe(undefined)
})

test('Every preview sprite has a label and renders', async () => {
  for (const key of PREVIEW_KEYS) {
    expect(SPRITES[key]).toBeDefined()
    expect(PREVIEW_LABELS[key]).toBeDefined()
    expect(previewArt(key, 'desktop', 60)?.kind).toBe('svg')
    expect(previewArt(key, 'terminal', 60)?.kind).toBe('raster')
  }
  expect(previewArt('stage0', 'terminal', 40)).toBe(null)
})
