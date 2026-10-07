import { test, expect } from 'claude-code/testing'
import { newSave, parseSave } from '../hooks/model'

test('沒有存檔時建立新存檔', async () => {
  const s = parseSave(undefined, 1000)
  expect(s.version).toBe(1)
  expect(s.egg.no).toBe(1)
  expect(s.egg.name).toBe('小蛋')
  expect(s.egg.broth).toBe(100)
  expect(s.egg.record.startedAt).toBe(1000)
  expect(s.welcomed).toBe(false)
})

test('正常存檔原樣讀回', async () => {
  const s = newSave(5)
  s.egg.progress = 42
  expect(parseSave(JSON.parse(JSON.stringify(s)), 9).egg.progress).toBe(42)
})

test('格式壞掉時重建但保留圖鑑', async () => {
  const s = parseSave({ version: 1, egg: 'oops', dex: { e8: 3, e6: 1, bad: -2, worse: 'x' } }, 7)
  expect(s.egg.progress).toBe(0)
  expect(s.dex).toEqual({ e8: 3, e6: 1 })
  expect(s.welcomed).toBe(true)
})

test('完全不是物件時給全新存檔', async () => {
  const s = parseSave('garbage', 7)
  expect(s.dex).toEqual({})
  expect(s.welcomed).toBe(false)
})
