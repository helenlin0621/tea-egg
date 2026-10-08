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

test('新版多了蛋種：舊存檔原樣讀回，圖鑑紀錄不變', async () => {
  const s = newSave(5)
  s.egg.progress = 42
  s.dex = { e1: 2, e4: 1 }
  const old = JSON.parse(JSON.stringify(s))
  const back = parseSave(old, 9)
  expect(back.egg.progress).toBe(42)
  expect(back.dex).toEqual({ e1: 2, e4: 1 })
})

test('存檔裡有新版才有的蛋種代號也照樣保留', async () => {
  const s = newSave(5)
  s.dex = { e1: 1, future_egg: 3 }
  expect(parseSave(JSON.parse(JSON.stringify(s)), 9).dex).toEqual({ e1: 1, future_egg: 3 })
})
