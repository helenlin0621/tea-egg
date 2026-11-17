import { test, expect } from 'claude-code/testing'
import { newSave } from '../hooks/model'
import { mutate, type StoreIo } from '../hooks/store'
import type { Save } from '../types'

const NOW = Date.UTC(2026, 9, 7, 2)

// A store held in memory; `beforeRead` lets a test play another session writing in between our reads
function memory(initial: unknown, beforeRead?: (reads: number, set: (v: unknown) => void) => void) {
  let stored = initial
  let reads = 0
  const writes: Save[] = []
  const mirrored: Save[] = []
  const io: StoreIo = {
    now: async () => NOW,
    read: async () => {
      reads++
      beforeRead?.(reads, v => (stored = v))
      return structuredClone(stored)
    },
    write: async save => {
      writes.push(save)
      stored = structuredClone(save)
    },
    mirror: async save => {
      mirrored.push(save)
    },
    toast: () => undefined,
  }
  return { io, writes, mirrored }
}

test('Store: a result equal to what is stored is not written back, only mirrored', async () => {
  const save = newSave(NOW)
  const m = memory(save)
  await mutate(m.io, s => ({ save: s, effects: [] }))
  expect(m.writes.length).toBe(0)
  expect(m.mirrored.length).toBe(1)
})

test('Store: a changed result is written', async () => {
  const m = memory(newSave(NOW))
  await mutate(m.io, s => ({ save: { ...s, welcomed: true }, effects: [] }))
  expect(m.writes.length).toBe(1)
  expect(m.writes[0]!.welcomed).toBe(true)
})

test('Store: another session writing between our read and our write is not overwritten', async () => {
  const theirs = { ...newSave(NOW), dex: { e1: 1 } }
  // The second read (the check right before writing) finds their save
  const m = memory(newSave(NOW), (reads, set) => {
    if (reads === 2) set(theirs)
  })
  let runs = 0
  await mutate(m.io, s => {
    runs++
    return { save: { ...s, welcomed: true }, effects: [] }
  })
  expect(runs).toBe(2)
  expect(m.writes.length).toBe(1)
  expect(m.writes[0]!.dex).toEqual({ e1: 1 })
  expect(m.writes[0]!.welcomed).toBe(true)
})
