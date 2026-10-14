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
  multiDays?: DateKey[] // days with enough time of 2+ sessions in use at once; missing in older saves
  multiMinutes?: Record<DateKey, number> // minutes of 2+ sessions in use at once, per day
  dryMinutes?: number // minutes in use while the broth was dry
  cautions?: number // risky (not outright dangerous) commands run during this egg
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
  usedSpans?: [number, number][] // stretches of use already charged for broth, merged and recent; missing in older saves
  spans?: { s: string; a: number; b: number }[] // recent stretches of use per session (s: session tag), to find overlaps
  multiSpans?: [number, number][] // overlaps already counted as several-session time, merged and recent
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
    'tea-egg': {
      save: Save | null
      showDex: boolean
      sessionCounted: boolean
      preview: string | null
      bandHidden: boolean
      // Another load identity's save offered for copying, or null
      syncOffer: { save: Save; fingerprint: string } | null
      // The person pressed Sync and is being asked to confirm the overwrite
      syncConfirming: boolean
    }
  }
}
