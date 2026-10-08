// Shape of the spoiler data. The actual content is in spoilers.ts (base64-encoded).
import type { Lang } from './i18n'

export type Rule =
  | { egg: string; when: 'cracked' }
  | { egg: string; when: 'chance'; p: number }
  | { egg: string; when: 'gapAtLeast'; days: number }
  | { egg: string; when: 'failRateAbove'; minRuns: number; rate: number }
  | { egg: string; when: 'ageAtLeast'; days: number }
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

export type Spoilers = {
  eggs: Record<string, EggInfo>
  rules: Rule[]
  hints: Record<string, string>
  crackToast: string // {kw} {name} {icon}
  dexSlots: string[] // Order of the dex slots; must include dateMode.prize, at any position
  dateMode: DateMode
  sprites: Record<string, string>
  spritesHd?: Record<string, string> // High-res PNGs for desktop (base64)
  // Translations: the top-level text is zh-TW; each language overrides only its text fields.
  // decodeSpoilers(lang) merges them in and leaves this field out of the result.
  i18n?: Partial<Record<Lang, SpoilerText>>
}

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

// The translatable part of the spoilers: names, hints and special-date-mode lines (arrays replace whole)
export type SpoilerText = DeepPartial<Pick<Spoilers, 'eggs' | 'hints' | 'crackToast' | 'dateMode'>>
