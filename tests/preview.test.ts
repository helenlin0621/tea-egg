import { test, expect } from 'claude-code/testing'
import { nextPreview, PREVIEW_KEYS, PREVIEW_LABELS, previewArt } from '../hooks/panel'
import { SPRITES } from '../hooks/sprites'

test('預覽指令：空白輪到下一張、最後一張再回到第一張', async () => {
  expect(nextPreview(null, '')).toBe('stage0')
  expect(nextPreview('stage0', '')).toBe('stage1')
  expect(nextPreview(PREVIEW_KEYS[PREVIEW_KEYS.length - 1]!, '')).toBe('stage0')
})

test('預覽指令：數字、圖名、off 與錯誤輸入', async () => {
  expect(nextPreview(null, ' 3')).toBe('stage2')
  expect(nextPreview(null, 'face_sleep')).toBe('face_sleep')
  expect(nextPreview('stage1', 'off')).toBe(null)
  expect(nextPreview(null, '0')).toBe(undefined)
  expect(nextPreview(null, '99')).toBe(undefined)
  expect(nextPreview(null, 'banana')).toBe(undefined)
})

test('每張預覽圖都有說明、也都畫得出來', async () => {
  for (const key of PREVIEW_KEYS) {
    expect(SPRITES[key]).toBeDefined()
    expect(PREVIEW_LABELS[key]).toBeDefined()
    expect(previewArt(key, 'desktop', 60)?.kind).toBe('svg')
    expect(previewArt(key, 'terminal', 60)?.kind).toBe('raster')
  }
  expect(previewArt('stage0', 'terminal', 40)).toBe(null)
})
