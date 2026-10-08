import { test, expect } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'

test('劇透資料能解碼且結構完整', async () => {
  const s = decodeSpoilers()
  expect(s.rules.length).toBe(8)
  expect(s.rules[0]!.when).toBe('cracked')
  expect(s.rules[s.rules.length - 1]!.when).toBe('always')
  expect(s.dexSlots.length).toBe(9)
  expect(s.dexSlots).toContain(s.dateMode.prize)
  expect(new Set(s.dexSlots).size).toBe(s.dexSlots.length)
  for (const id of s.dexSlots) expect(s.eggs[id]).toBeDefined()
})

test('解碼結果有快取', async () => {
  expect(decodeSpoilers()).toBe(decodeSpoilers())
})
