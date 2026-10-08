import type { DateKey } from '../types'

export type LocalTime = { date: DateKey; year: number; month: number; day: number; hour: number; minute: number }
export type FakeDate = { wallMs: number; keepTimeOfDay: boolean }
export type ClockConfig = { offsetMinutes: (nowMs: number) => number; fake: FakeDate | null; loadedAt: number }

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

// TEA_EGG_FAKE_DATE: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' (for development and testing)
export function parseFakeDate(raw: string | undefined): FakeDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec((raw ?? '').trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  return {
    wallMs: Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0)),
    keepTimeOfDay: h === undefined,
  }
}

// Always use the time zone of the Claude Code runtime itself (user's decision; not configurable)
export function systemOffset(nowMs: number): number {
  return -new Date(nowMs).getTimezoneOffset()
}

// "Wall time" is kept in the UTC fields so the runtime time zone doesn't convert it a second time
export function localTime(nowMs: number, cfg: ClockConfig): LocalTime {
  const realWall = nowMs + cfg.offsetMinutes(nowMs) * 60_000
  let wall = realWall
  if (cfg.fake) {
    wall = cfg.fake.keepTimeOfDay
      ? cfg.fake.wallMs + (((realWall % DAY_MS) + DAY_MS) % DAY_MS)
      : cfg.fake.wallMs + (nowMs - cfg.loadedAt)
  }
  const d = new Date(wall)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  return { date: `${year}-${pad(month)}-${pad(day)}`, year, month, day, hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}
