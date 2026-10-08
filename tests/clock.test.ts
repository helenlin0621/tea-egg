import { test, expect } from 'claude-code/testing'
import { daysBetween, localTime, parseFakeDate } from '../hooks/clock'
import { TAIPEI, ms } from './helpers'

test('16:30 UTC the day before is already 00:30 the next day in Taipei', async () => {
  const t = localTime(Date.UTC(2026, 9, 6, 16, 30), TAIPEI)
  expect(t.date).toBe('2026-10-07')
  expect(t.hour).toBe(0)
  expect(t.minute).toBe(30)
})

test('A date-only fake date keeps the real time of day', async () => {
  const cfg = { ...TAIPEI, fake: parseFakeDate('2027-03-15') }
  const t = localTime(ms('2026-10-07', 18, 5), cfg)
  expect(t.date).toBe('2027-03-15')
  expect(t.hour).toBe(18)
  expect(t.minute).toBe(5)
})

test('A fake date with a time starts there and advances with real time', async () => {
  const loadedAt = ms('2026-10-07', 9)
  const cfg = { ...TAIPEI, fake: parseFakeDate('2027-03-15T16:50'), loadedAt }
  expect(localTime(loadedAt, cfg).hour).toBe(16)
  const later = localTime(loadedAt + 20 * 60_000, cfg)
  expect(later.hour).toBe(17)
  expect(later.minute).toBe(10)
})

test('Malformed fake dates are ignored', async () => {
  expect(parseFakeDate('tomorrow')).toBe(null)
  expect(parseFakeDate(undefined)).toBe(null)
  expect(parseFakeDate('')).toBe(null)
})

test('Day difference', async () => {
  expect(daysBetween('2026-10-01', '2026-10-04')).toBe(3)
  expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
})
