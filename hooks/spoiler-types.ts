// 劇透資料的形狀。實際內容在 spoilers.ts（base64 編碼）。
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
  dexSlots: string[] // 9 格的順序，最後一格是 dateMode.prize
  dateMode: DateMode
  sprites: Record<string, string>
}
