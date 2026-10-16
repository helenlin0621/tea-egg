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
  human: number // no longer used (progress follows prompts now); kept so older saves still read
  lastToast: Record<string, number>
  // Missing in older saves: no prompts yet, broth 100, mood 70, no peek drawn
  prompts?: number // prompts sent that day; every humanPrompts of them marinate one human
  peekAt?: number // the host peeks in on the first prompt at or after this
  broth?: number // the human's, like the egg's (0-100)
  mood?: number
  brothMs?: number
  moodMs?: number
  quietTurn?: boolean // a human was just done: the turn that prompt started skips its usual line
}

// A 'timed' special date (dates.ts), one per year. idle: the day came, no prompt yet; run: an ask counting down from
// startedAt; rest: between asks, the next no earlier than nextAt; won / lost: settled. from: 'missed' when settled for
// someone who never played that day
export type TimedEntry = {
  phase: 'idle' | 'run' | 'rest' | 'won' | 'lost'
  startedAt?: number
  nextAt?: number
  got?: number // asks answered in time
  asks?: number
  terminal?: boolean // a terminal was attached when it started: its toasts mention the fallback command
  warned?: boolean
  from?: 'live' | 'missed'
  closed?: boolean // the "it's over" toast was shown (or not needed)
  lastDanger?: number
}

// A 'grant' special date: the egg was handed over on `date` (local), on the day or made up later
export type GrantEntry = { got: true; date: DateKey; from: 'live' | 'missed' }

// A 'reply' special date. open: the day, not answered yet; done: answered on the day; late: missed, cross for lateDate;
// eased: answered while cross; over: the cross day ended
export type ReplyEntry = { phase: 'open' | 'done' | 'late' | 'eased' | 'over'; lateDate?: DateKey; lastLine?: number }

export type DateEntry = DateModeYear | TimedEntry | GrantEntry | ReplyEntry

export type Save = {
  version: 1
  egg: Egg
  dex: Record<string, number>
  daily: { date: DateKey; gained: number }
  clocks: Clocks
  nightToastFor: DateKey | null
  harvestedAt: number | null
  // Special dates by "<id>:<year>" (d1 is the first special date; older saves keyed it by the year alone, see model.ts)
  dateMode: Record<string, DateEntry>
  welcomed: boolean
  installedOn?: DateKey // local date this save was made; older saves get the day they first ran this version
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
