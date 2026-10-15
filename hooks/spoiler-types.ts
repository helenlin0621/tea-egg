// Shape of the spoiler data. The actual content is in spoilers.ts (base64-encoded).
import type { Lang } from './i18n'

export type Rule =
  | { egg: string; when: 'cracked'; cautions: number } // cautions: risky commands per egg that also crack it
  | { egg: string; when: 'chance'; p: number }
  | { egg: string; when: 'gapAtLeast'; days: number }
  | { egg: string; when: 'failRateAbove'; minRuns: number; rate: number }
  | { egg: string; when: 'ageAtLeast'; days: number }
  | { egg: string; when: 'dryAtLeast'; minutes: number }
  // dayMinutes: minutes of 2+ sessions in use at once that make a day count
  | { egg: string; when: 'multiDaysAtLeast'; days: number; ratio: number; dayMinutes: number }
  | { egg: string; when: 'avgSessionAbove'; minutes: number }
  | { egg: string; when: 'avgSessionBelow'; minutes: number }
  | { egg: string; when: 'always' }

export type EggInfo = { name: string; icon: string }

export type DateMode = {
  month: number
  day: number
  revealHour: number
  humanStep: number
  prize: string
  throttleMs: number
  band: { icon: string; face: string; title: string; bar: string; hints: string[] }
  dexTitle: string
  replies: { refill: string; flip: string }
  lines: {
    turn: string[]
    testFail: string[]
    testPass: string[]
    danger: string[]
    reveal: string
    makeup: string
  }
}

// The other special dates (dates.ts). Their kind says how they play; which day and what they give is spoiler data.
// A toast that tells terminal users the fallback command comes in two versions
export type BySurface = { desktop: string; terminal: string }
export type BandLook = { icon: string; face: string; text: string }

// A countdown on the day: the egg is paused and dressed up; press the button in time for one prize, or get the other
export type TimedDate = {
  kind: 'timed'
  month: number
  day: number
  seconds: number
  warnSeconds: number
  dangerGapMs: number
  prizes: { won: string; lost: string }
  hotkey: string
  button: string // on the band
  paneButton: string // replaces Refill on the pane that day
  art: { base: string; face: string; warnFace: string } // egg layers stacked while counting down
  band: { icon: string; face: string; warnFace: string; timer: string; ask: string; warnAsk: string; won: BandLook; lost: BandLook }
  replies: { early: string; afterWon: string; afterLost: string; flip: string }
  lines: { start: BySurface; warn: BySurface; won: string; lost: string; danger: string; over: string; makeup: string }
}

// One egg handed over on the day's first prompt; the egg goes on as usual
export type GrantDate = {
  kind: 'grant'
  month: number
  day: number
  prize: string
  band: BandLook
  lines: { got: string; makeup: string }
}

// For someone who got `needs` that year: press the button on the day for the prize; miss it and the egg is cross for a day
export type ReplyDate = {
  kind: 'reply'
  month: number
  day: number
  needs: string
  prize: string
  command: string // /egg <command>, the button's hidden fallback
  hotkey: string
  button: string
  paneButton: string
  doneButton: string
  lineGapMs: number
  art: { late: string } // face layer while cross
  band: { open: BandLook; done: BandLook; late: BandLook; eased: BandLook }
  lines: {
    open: BySurface
    done: string
    late: string
    lateLines: string[]
    lateRefill: string
    lateFlip: string
    eased: string
    over: string
  }
}

export type DateSpec = TimedDate | GrantDate | ReplyDate

export type Spoilers = {
  eggs: Record<string, EggInfo>
  rules: Rule[]
  hints: Record<string, string>
  crackToast: string // {kw} {name} {icon}
  dexSlots: string[] // Order of the dex slots; must include every prize, at any position
  dateMode: DateMode // the first special date (id d1)
  dates: Record<string, DateSpec> // the others, by id (d2, d3, …)
  sprites: Record<string, string>
  spritesHd?: Record<string, string> // High-res PNGs for desktop (base64)
  // Translations: the top-level text is zh-TW; each language overrides only its text fields.
  // decodeSpoilers(lang) merges them in and leaves this field out of the result.
  i18n?: Partial<Record<Lang, SpoilerText>>
}

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

// The translatable part of the spoilers: names, hints and special-date-mode lines (arrays replace whole)
export type SpoilerText = DeepPartial<Pick<Spoilers, 'eggs' | 'hints' | 'crackToast' | 'dateMode' | 'dates'>>
