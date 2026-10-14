import type { Save } from '../types'
import type { LocalTime } from './clock'
import { isSave } from './model'
import { fill, T } from './text'

// Claude keeps one store file per load identity (tea-egg@<marketplace> installed, tea-egg@inline by --plugin-dir).
// Each identity only writes its own save; the others are read to offer the person a copy, never written.

export type SyncOffer = { save: Save; fingerprint: string }

// A short, stable id of a save's content, so a declined offer is not asked again until that save changes
export function fingerprint(s: unknown): string {
  const text = JSON.stringify(s) ?? ''
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return `${h.toString(16)}-${text.length}`
}

// The other save worth offering: valid, different from ours, and if several, the furthest along
// (higher egg number, then the later tick). null when there is nothing to offer.
export function pickOther(own: unknown, others: readonly unknown[]): Save | null {
  const mine = JSON.stringify(own)
  const candidates = others.filter((s): s is Save => isSave(s) && JSON.stringify(s) !== mine)
  if (candidates.length === 0) return null
  return candidates.reduce((a, b) =>
    b.egg.no > a.egg.no || (b.egg.no === a.egg.no && b.clocks.lastTickAt > a.clocks.lastTickAt) ? b : a,
  )
}

// The offer to show now, or null when there is none or the person already declined this exact save
export function offerFor(own: unknown, others: readonly unknown[], dismissed: unknown): SyncOffer | null {
  const other = pickOther(own, others)
  if (other === null) return null
  const fp = fingerprint(other)
  return fp === dismissed ? null : { save: other, fingerprint: fp }
}

const pad = (n: number) => String(n).padStart(2, '0')

// One line describing a save, e.g. "小蛋 #13、入味 32%、圖鑑 1 種（12 次），最後遊玩 10/14 01:32"
export function describe(s: unknown, at: (ms: number) => LocalTime): string {
  if (!isSave(s)) return T().sync.none
  const counts = Object.values(s.dex)
  const t = at(s.clocks.lastTickAt)
  return fill(T().sync.line, {
    name: s.egg.name,
    no: String(s.egg.no),
    flavor: String(Math.floor(s.egg.progress)),
    kinds: String(counts.length),
    count: String(counts.reduce((a, b) => a + b, 0)),
    when: `${pad(t.month)}/${pad(t.day)} ${pad(t.hour)}:${pad(t.minute)}`,
  })
}

// The two saves side by side, as /egg sync and the pane show them
export function compareLines(own: unknown, other: Save, at: (ms: number) => LocalTime): string[] {
  return [
    T().sync.title,
    `${T().sync.current}${describe(own, at)}`,
    `${T().sync.other}${describe(other, at)}`,
    T().sync.question,
  ]
}
