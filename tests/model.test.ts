import { test, expect } from 'claude-code/testing'
import { newSave, parseSave } from '../hooks/model'

test('Creates a new save when there is none', async () => {
  const s = parseSave(undefined, 1000)
  expect(s.version).toBe(1)
  expect(s.egg.no).toBe(1)
  expect(s.egg.name).toBe('小蛋')
  expect(s.egg.broth).toBe(100)
  expect(s.egg.record.startedAt).toBe(1000)
  expect(s.welcomed).toBe(false)
})

test('A valid save is read back unchanged', async () => {
  const s = newSave(5)
  s.egg.progress = 42
  expect(parseSave(JSON.parse(JSON.stringify(s)), 9).egg.progress).toBe(42)
})

test('A broken save is rebuilt but keeps the dex', async () => {
  const s = parseSave({ version: 1, egg: 'oops', dex: { e8: 3, e6: 1, bad: -2, worse: 'x' } }, 7)
  expect(s.egg.progress).toBe(0)
  expect(s.dex).toEqual({ e8: 3, e6: 1 })
  expect(s.welcomed).toBe(true)
})

test('Not an object at all: a brand-new save', async () => {
  const s = parseSave('garbage', 7)
  expect(s.dex).toEqual({})
  expect(s.welcomed).toBe(false)
})

test('New egg kinds in a newer version: old saves read back unchanged with the dex intact', async () => {
  const s = newSave(5)
  s.egg.progress = 42
  s.dex = { e1: 2, e4: 1 }
  const old = JSON.parse(JSON.stringify(s))
  const back = parseSave(old, 9)
  expect(back.egg.progress).toBe(42)
  expect(back.dex).toEqual({ e1: 2, e4: 1 })
})

test('Unknown egg ids from a newer version are kept in the save', async () => {
  const s = newSave(5)
  s.dex = { e1: 1, future_egg: 3 }
  expect(parseSave(JSON.parse(JSON.stringify(s)), 9).dex).toEqual({ e1: 1, future_egg: 3 })
})
