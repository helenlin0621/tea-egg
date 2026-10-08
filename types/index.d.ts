export type DateKey = string // 'YYYY-MM-DD' (local date)

export type EggRecord = {
  startedAt: number
  activeDays: DateKey[]
  maxGapDays: number
  sessionCount: number
  sessionMinutes: number
  testRuns: number
  testFails: number
  cracked: string | null // keyword of the dangerous command that triggered it
}

export type Egg = {
  no: number
  name: string
  progress: number
  broth: number
  mood: number
  flipWantedAt: number | null
  activeMinutes: number // active minutes accumulated since the last flip
  record: EggRecord
}

export type Clocks = {
  lastTickAt: number
  brothMs: number
  moodMs: number
  bucketStart: number
  bucketActive: boolean
}

export type DateModeYear = {
  seen: boolean
  revealed: boolean
  human: number
  lastToast: Record<string, number>
}

export type Save = {
  version: 1
  egg: Egg
  dex: Record<string, number>
  daily: { date: DateKey; gained: number }
  clocks: Clocks
  nightToastFor: DateKey | null
  harvestedAt: number | null
  dateMode: Record<string, DateModeYear>
  welcomed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'tea-egg': { save: Save | null; showDex: boolean; sessionCounted: boolean; preview: string | null }
  }
}
