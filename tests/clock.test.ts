import { test, expect } from 'claude-code/testing'
import { daysBetween, localTime, parseFakeDate } from '../hooks/clock'
import { TAIPEI, ms } from './helpers'

test('UTC 前一天 16:30 在台北已是隔天 00:30', async () => {
  const t = localTime(Date.UTC(2026, 9, 6, 16, 30), TAIPEI)
  expect(t.date).toBe('2026-10-07')
  expect(t.hour).toBe(0)
  expect(t.minute).toBe(30)
})

test('假日期只給日期時保留真實的時刻', async () => {
  const cfg = { ...TAIPEI, fake: parseFakeDate('2027-03-15') }
  const t = localTime(ms('2026-10-07', 18, 5), cfg)
  expect(t.date).toBe('2027-03-15')
  expect(t.hour).toBe(18)
  expect(t.minute).toBe(5)
})

test('假日期含時間時從該時刻開始隨真實時間前進', async () => {
  const loadedAt = ms('2026-10-07', 9)
  const cfg = { ...TAIPEI, fake: parseFakeDate('2027-03-15T16:50'), loadedAt }
  expect(localTime(loadedAt, cfg).hour).toBe(16)
  const later = localTime(loadedAt + 20 * 60_000, cfg)
  expect(later.hour).toBe(17)
  expect(later.minute).toBe(10)
})

test('格式不對的假日期被忽略', async () => {
  expect(parseFakeDate('tomorrow')).toBe(null)
  expect(parseFakeDate(undefined)).toBe(null)
  expect(parseFakeDate('')).toBe(null)
})

test('日期差', async () => {
  expect(daysBetween('2026-10-01', '2026-10-04')).toBe(3)
  expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
})
