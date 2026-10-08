import type { ClockConfig, LocalTime } from '../hooks/clock'

export const TAIPEI: ClockConfig = { offsetMinutes: () => 480, fake: null, loadedAt: 0 }

export function at(date: string, hour = 10, minute = 0): LocalTime {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return { date, year: y, month: m, day: d, hour, minute }
}

// Epoch ms for local date hour:minute (UTC+8)
export function ms(date: string, hour = 10, minute = 0): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d, hour - 8, minute)
}
