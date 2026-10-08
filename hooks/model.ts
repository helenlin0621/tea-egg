import type { Egg, EggRecord, Save } from '../types'
import { T } from './text'

export const STORE_KEY = 'tea-egg/v1'
// Used instead while TEA_EGG_FAKE_DATE is in effect, so fake test dates never touch the real egg
export const FAKE_STORE_KEY = 'tea-egg/v1-fake'

export function newRecord(now: number): EggRecord {
  return {
    startedAt: now,
    activeDays: [],
    maxGapDays: 0,
    sessionCount: 0,
    sessionMinutes: 0,
    testRuns: 0,
    testFails: 0,
    cracked: null,
  }
}

export function newEgg(no: number, now: number): Egg {
  return {
    no,
    name: T().defaultName, // picked in the current language; existing saves keep their name
    progress: 0,
    broth: 100,
    mood: 70,
    flipWantedAt: null,
    activeMinutes: 0,
    record: newRecord(now),
  }
}

export function newSave(now: number): Save {
  return {
    version: 1,
    egg: newEgg(1, now),
    dex: {},
    daily: { date: '', gained: 0 },
    clocks: { lastTickAt: now, brothMs: 0, moodMs: 0, bucketStart: now, bucketActive: false },
    nightToastFor: null,
    harvestedAt: null,
    dateMode: {},
    welcomed: false,
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function isSave(v: unknown): v is Save {
  if (!isObj(v) || v.version !== 1) return false
  const { egg, dex, daily, clocks, dateMode } = v
  if (!isObj(egg) || !isObj(egg.record) || !isObj(dex) || !isObj(daily) || !isObj(clocks) || !isObj(dateMode)) return false
  const r = egg.record
  return (
    isNum(egg.no) && typeof egg.name === 'string' && isNum(egg.progress) && isNum(egg.broth) && isNum(egg.mood) &&
    isNum(egg.activeMinutes) && (egg.flipWantedAt === null || isNum(egg.flipWantedAt)) &&
    isNum(r.startedAt) && Array.isArray(r.activeDays) && isNum(r.maxGapDays) && isNum(r.sessionCount) &&
    isNum(r.sessionMinutes) && isNum(r.testRuns) && isNum(r.testFails) &&
    (r.cracked === null || typeof r.cracked === 'string') &&
    typeof daily.date === 'string' && isNum(daily.gained) &&
    isNum(clocks.lastTickAt) && isNum(clocks.brothMs) && isNum(clocks.moodMs) && isNum(clocks.bucketStart) &&
    typeof clocks.bucketActive === 'boolean' && typeof v.welcomed === 'boolean'
  )
}

function salvageDex(raw: unknown): Record<string, number> {
  if (!isObj(raw) || !isObj(raw.dex)) return {}
  const dex: Record<string, number> = {}
  for (const [id, n] of Object.entries(raw.dex)) if (isNum(n) && n > 0) dex[id] = Math.floor(n)
  return dex
}

export function parseSave(raw: unknown, now: number): Save {
  if (isSave(raw)) return raw
  const dex = salvageDex(raw)
  return { ...newSave(now), dex, welcomed: Object.keys(dex).length > 0 }
}
