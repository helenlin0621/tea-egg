// The special dates after the first (datemode.ts). What each kind does is here; which day, what it gives and every
// line are spoiler data (decodeSpoilers().dates).
//  - timed: the egg is paused; the day's first prompt starts a countdown; pressing the button in time gives one prize,
//    running out gives the other
//  - grant: the day's first prompt hands over a prize; the egg goes on as usual
//  - reply: for someone who got `needs` that year; press the button on the day for the prize. Miss it and the egg is
//    cross on the first day opened after (faces and lines only; the egg goes on as usual)
// Days missed are made up on the first open after (timed and grant), for saves made before that day.
import type { DateKey, GrantEntry, ReplyEntry, Save, TimedEntry } from '../types'
import type { LocalTime } from './clock'
import type { Effect, Step } from './engine'
import type { BandLook, DateSpec, GrantDate, ReplyDate, TimedDate } from './spoiler-types'
import { decodeSpoilers } from './spoilers'
import { T, pick } from './text'

const pad = (n: number) => String(n).padStart(2, '0')
const dayOf = (year: number, d: { month: number; day: number }): DateKey => `${year}-${pad(d.month)}-${pad(d.day)}`
const keyOf = (id: string, year: number) => `${id}:${year}`
const isOn = (d: DateSpec, t: LocalTime) => d.month === t.month && d.day === t.day
const toast = (text: string): Effect => ({ kind: 'toast', text })
const begin = (prev: Save): Step => ({ save: structuredClone(prev), effects: [] })

function all<K extends DateSpec['kind']>(kind: K): [string, Extract<DateSpec, { kind: K }>][] {
  return Object.entries(decodeSpoilers().dates).filter((e): e is [string, Extract<DateSpec, { kind: K }>] => e[1].kind === kind)
}

// The date's most recent day strictly before today
function lastBefore(d: DateSpec, t: LocalTime): { year: number; date: DateKey } {
  const thisYear = dayOf(t.year, d)
  return thisYear < t.date ? { year: t.year, date: thisYear } : { year: t.year - 1, date: dayOf(t.year - 1, d) }
}

// Add a prize to the dex; the text gets the "new in the dex" mark the first time
function award(s: Save, id: string, text: string): string {
  const isNew = (s.dex[id] ?? 0) === 0
  s.dex[id] = (s.dex[id] ?? 0) + 1
  return isNew ? text + T().newDex : text
}

const surfaced = (lines: { desktop: string; terminal: string }, terminal: boolean) => (terminal ? lines.terminal : lines.desktop)

// ---- timed ----

type Timed = { id: string; spec: TimedDate; key: string; entry: TimedEntry | undefined }

// The countdown under way, whatever the date (one started just before midnight runs on into the next day)
function running(s: Save): Timed | null {
  for (const [id, spec] of all('timed')) {
    for (const [key, entry] of Object.entries(s.dateMode)) {
      if (key.startsWith(`${id}:`) && (entry as TimedEntry).phase === 'run') return { id, spec, key, entry: entry as TimedEntry }
    }
  }
  return null
}

// The timed date to show now: a countdown under way, or today's
export function timedNow(s: Save, t: LocalTime): Timed | null {
  const run = running(s)
  if (run) return run
  for (const [id, spec] of all('timed')) {
    if (!isOn(spec, t)) continue
    const key = keyOf(id, t.year)
    return { id, spec, key, entry: s.dateMode[key] as TimedEntry | undefined }
  }
  return null
}

export function remainingMs(spec: TimedDate, entry: TimedEntry, now: number): number {
  return Math.max(0, spec.seconds * 1000 - (now - (entry.startedAt ?? now)))
}

// Settle a countdown that ran out, or warn once it is nearly over. Runs on every event (and on the countdown's timers)
function checkTimed(step: Step, now: number): void {
  const run = running(step.save)
  if (!run || !run.entry) return
  const { spec, entry } = run
  const left = remainingMs(spec, entry, now)
  if (left <= 0) {
    entry.phase = 'lost'
    step.effects.push(toast(award(step.save, spec.prizes.lost, spec.lines.lost)))
  } else if (left <= spec.warnSeconds * 1000 && !entry.warned) {
    entry.warned = true
    step.effects.push(toast(surfaced(spec.lines.warn, entry.terminal === true)))
  }
}

export function timedTick(prev: Save, now: number): Step {
  const step = begin(prev)
  checkTimed(step, now)
  return step
}

// Opened on the day: remember it (an idle day is made up like a missed one if no prompt ever comes)
export function timedSeen(prev: Save, t: LocalTime): Step {
  const step = begin(prev)
  const day = timedNow(step.save, t)
  if (day && !day.entry && isOn(day.spec, t)) step.save.dateMode[day.key] = { phase: 'idle' }
  return step
}

// The danger line instead of cracking the paused egg, at most once per dangerGapMs
export function timedDanger(prev: Save, now: number, t: LocalTime): Step {
  const step = begin(prev)
  const day = timedNow(step.save, t)
  if (!day) return step
  const entry = (step.save.dateMode[day.key] ??= { phase: 'idle' }) as TimedEntry
  if (entry.lastDanger !== undefined && now - entry.lastDanger < day.spec.dangerGapMs) return step
  entry.lastDanger = now
  step.effects.push(toast(day.spec.lines.danger))
  return step
}

// The button (or /egg refill): in time it wins; otherwise a line for each case. null when no timed date is showing
export function timedPress(prev: Save, now: number, t: LocalTime): Step | null {
  const step = begin(prev)
  checkTimed(step, now)
  const day = timedNow(step.save, t)
  if (!day) return null
  const { spec, entry } = day
  if (entry?.phase === 'run') {
    entry.phase = 'won'
    step.reply = award(step.save, spec.prizes.won, spec.lines.won)
  } else if (entry?.phase === 'won') step.reply = spec.replies.afterWon
  else if (entry?.phase === 'lost') step.reply = spec.replies.afterLost
  else step.reply = spec.replies.early
  return step
}

export function timedFlipReply(s: Save, t: LocalTime): string | null {
  return timedNow(s, t)?.spec.replies.flip ?? null
}

// ---- the day's first prompt ----

// Starts today's countdown, hands over today's grant, opens today's reply. terminal: a terminal is attached
export function datesPrompt(prev: Save, now: number, t: LocalTime, terminal: boolean): Step {
  const step = begin(prev)
  const s = step.save
  for (const [id, spec] of all('timed')) {
    const key = keyOf(id, t.year)
    const entry = s.dateMode[key] as TimedEntry | undefined
    if (!isOn(spec, t) || (entry && entry.phase !== 'idle')) continue
    s.dateMode[key] = { phase: 'run', startedAt: now, terminal, from: 'live' }
    step.effects.push(toast(surfaced(spec.lines.start, terminal)))
  }
  for (const [id, spec] of all('grant')) {
    const key = keyOf(id, t.year)
    if (!isOn(spec, t) || s.dateMode[key]) continue
    s.dateMode[key] = { got: true, date: t.date, from: 'live' }
    step.effects.push(toast(award(s, spec.prize, spec.lines.got)))
  }
  for (const [id, spec] of all('reply')) {
    const key = keyOf(id, t.year)
    if (!isOn(spec, t) || s.dateMode[key] || !eligible(s, spec, t.year)) continue
    s.dateMode[key] = { phase: 'open' }
    step.effects.push(toast(surfaced(spec.lines.open, terminal)))
  }
  return step
}

// ---- catching up: on opening, on every turn and tick ----

// Settle what happened while away: a countdown that ran out, days missed (made up oldest first), the end of a
// timed day, and a reply day that was missed or a cross day that is over
export function datesCatchUp(prev: Save, now: number, t: LocalTime): Step {
  const step = begin(prev)
  const s = step.save
  checkTimed(step, now)
  const since = s.installedOn
  const missed: { date: DateKey; run: () => void }[] = []
  for (const [id, spec] of [...all('timed'), ...all('grant')] as [string, TimedDate | GrantDate][]) {
    const last = lastBefore(spec, t)
    // Only for saves made before that day: someone who installed later never had the chance
    if (since === undefined || since >= last.date) continue
    const key = keyOf(id, last.year)
    const entry = s.dateMode[key]
    if (spec.kind === 'timed' && (!entry || (entry as TimedEntry).phase === 'idle')) {
      missed.push({
        date: last.date,
        run: () => {
          s.dateMode[key] = { phase: 'lost', from: 'missed', closed: true }
          step.effects.push(toast(award(s, spec.prizes.lost, spec.lines.makeup)))
        },
      })
    }
    if (spec.kind === 'grant' && !entry) {
      missed.push({
        date: last.date,
        run: () => {
          s.dateMode[key] = { got: true, date: t.date, from: 'missed' }
          step.effects.push(toast(award(s, spec.prize, spec.lines.makeup)))
        },
      })
    }
  }
  for (const m of missed.sort((a, b) => a.date.localeCompare(b.date))) m.run()
  // The first open after a timed day that was played: back to the usual egg
  for (const [id, spec] of all('timed')) {
    const entry = s.dateMode[keyOf(id, lastBefore(spec, t).year)] as TimedEntry | undefined
    if (entry && entry.from === 'live' && (entry.phase === 'won' || entry.phase === 'lost') && !entry.closed) {
      entry.closed = true
      step.effects.push(toast(spec.lines.over))
    }
  }
  for (const [id, spec] of all('reply')) replyCatchUp(step, id, spec, t)
  return step
}

// ---- reply ----

// Got `needs` that year, on or before this date's day (made up later doesn't count: there was no chance to answer)
function eligible(s: Save, spec: ReplyDate, year: number): boolean {
  const got = s.dateMode[keyOf(spec.needs, year)] as GrantEntry | undefined
  return got?.got === true && got.date <= dayOf(year, spec)
}

function replyCatchUp(step: Step, id: string, spec: ReplyDate, t: LocalTime): void {
  const s = step.save
  const last = lastBefore(spec, t)
  // A cross day that is over (the year before too, for someone back after a long time)
  for (const year of [last.year - 1, last.year]) {
    const entry = s.dateMode[keyOf(id, year)] as ReplyEntry | undefined
    if (entry?.phase === 'late' && entry.lateDate !== undefined && entry.lateDate < t.date) {
      entry.phase = 'over'
      step.effects.push(toast(spec.lines.over))
    }
  }
  // The day went by unanswered (or unopened): cross today, the first day opened after it
  const key = keyOf(id, last.year)
  const entry = s.dateMode[key] as ReplyEntry | undefined
  if ((!entry || entry.phase === 'open') && eligible(s, spec, last.year)) {
    s.dateMode[key] = { phase: 'late', lateDate: t.date }
    step.effects.push(toast(spec.lines.late))
  }
}

type Reply = { id: string; spec: ReplyDate; key: string; entry: ReplyEntry }

// Today's reply entry: on the day itself, or the day the egg is cross
export function replyNow(s: Save, t: LocalTime): Reply | null {
  for (const [id, spec] of all('reply')) {
    if (isOn(spec, t)) {
      const key = keyOf(id, t.year)
      const entry = s.dateMode[key] as ReplyEntry | undefined
      if (entry) return { id, spec, key, entry }
    }
    for (const [key, entry] of Object.entries(s.dateMode)) {
      const r = entry as ReplyEntry
      if (key.startsWith(`${id}:`) && (r.phase === 'late' || r.phase === 'eased') && r.lateDate === t.date) {
        return { id, spec, key, entry: r }
      }
    }
  }
  return null
}

export const isCross = (s: Save, t: LocalTime) => replyNow(s, t)?.entry.phase === 'late'

// /egg <command> or the button: answered on the day gives the prize; while cross it eases. null: nothing to answer
export function replyPress(prev: Save, t: LocalTime): Step | null {
  const step = begin(prev)
  const r = replyNow(step.save, t)
  if (!r) return null
  if (r.entry.phase === 'open') {
    r.entry.phase = 'done'
    step.reply = award(step.save, r.spec.prize, r.spec.lines.done)
  } else if (r.entry.phase === 'late') {
    r.entry.phase = 'eased'
    step.reply = r.spec.lines.eased
  } else return null
  return step
}

export function replyCommand(): string[] {
  return all('reply').map(([, spec]) => spec.command)
}

// While cross: one of its lines when a turn finishes, at most once per lineGapMs
export function crossLine(prev: Save, now: number, t: LocalTime, rng: () => number): Step {
  const step = begin(prev)
  const r = replyNow(step.save, t)
  if (r?.entry.phase !== 'late') return step
  if (r.entry.lastLine !== undefined && now - r.entry.lastLine < r.spec.lineGapMs) return step
  r.entry.lastLine = now
  step.effects.push(toast(pick(r.spec.lines.lateLines, rng)))
  return step
}

// While cross, refill and flip still work; only the reply changes
export function crossReply(s: Save, t: LocalTime, what: 'refill' | 'flip'): string | null {
  const r = replyNow(s, t)
  if (r?.entry.phase !== 'late') return null
  return what === 'refill' ? r.spec.lines.lateRefill : r.spec.lines.lateFlip
}

// The egg cracked while cross: the new egg holds no grudge
export function endCross(prev: Save, t: LocalTime): Step {
  const step = begin(prev)
  const r = replyNow(step.save, t)
  if (r?.entry.phase === 'late') r.entry.phase = 'over'
  return step
}

// ---- what the band and the pane show ----

// The timed date's band, instead of the egg's: counting down, or how it ended (until the day is over).
// The timer's icon and its digits are separate: what redraws every second stays emoji-free (view.ts)
export type TimedBand = { look: BandLook; timer: { icon: string; digits: string } | null; warn: boolean }

export function timedBand(s: Save, t: LocalTime, now: number): TimedBand | null {
  const day = timedNow(s, t)
  if (!day?.entry) return null
  const { spec, entry } = day
  const b = spec.band
  if (entry.phase === 'run') {
    const left = remainingMs(spec, entry, now)
    const warn = left <= spec.warnSeconds * 1000
    const secs = Math.ceil(left / 1000)
    return {
      look: { icon: b.icon, face: warn ? b.warnFace : b.face, text: warn ? b.warnAsk : b.ask },
      timer: { icon: b.timer, digits: `${Math.floor(secs / 60)}:${pad(secs % 60)}` },
      warn,
    }
  }
  if ((entry.phase === 'won' || entry.phase === 'lost') && isOn(spec, t)) return { look: b[entry.phase], timer: null, warn: false }
  return null
}

// The egg's band with the day's icon, face and hint: a grant got today, or the reply day / cross day
export function dateLook(s: Save, t: LocalTime): BandLook | null {
  const r = replyNow(s, t)
  if (r && r.entry.phase !== 'over') return r.spec.band[r.entry.phase]
  for (const [id, spec] of all('grant')) {
    const got = s.dateMode[keyOf(id, t.year)] as GrantEntry | undefined
    if (isOn(spec, t) && got?.from === 'live') return spec.band
  }
  return null
}

// The button on the band and the pane, and what it runs (as /egg <args>)
export type DateAction = { label: string; paneLabel: string; hotkey: string; args: string; done?: boolean }

export function dateAction(s: Save, t: LocalTime): DateAction | null {
  const day = timedNow(s, t)
  if (day?.entry?.phase === 'run') return { label: day.spec.button, paneLabel: day.spec.paneButton, hotkey: day.spec.hotkey, args: 'refill' }
  const r = replyNow(s, t)
  if (r && (r.entry.phase === 'open' || r.entry.phase === 'late')) {
    return { label: r.spec.button, paneLabel: r.spec.paneButton, hotkey: r.spec.hotkey, args: r.spec.command }
  }
  if (r?.entry.phase === 'done') return { label: r.spec.doneButton, paneLabel: r.spec.doneButton, hotkey: '', args: '', done: true }
  return null
}

// The pane's Refill button on a timed day (any phase): it presses the day's button instead
export function paneRefillLabel(s: Save, t: LocalTime): string | null {
  return timedNow(s, t)?.spec.paneButton ?? null
}

// Egg layers that replace the usual picture: the costume while counting down, the cross face, the done face.
// prize: show that dex icon instead (how a timed day ended)
export type DateArt = { base?: string; face?: string; steam?: boolean; palette?: string; prize?: string }

export function dateArt(s: Save, t: LocalTime, now: number): DateArt | null {
  const day = timedNow(s, t)
  if (day?.entry?.phase === 'run') {
    const warn = remainingMs(day.spec, day.entry, now) <= day.spec.warnSeconds * 1000
    return { base: day.spec.art.base, face: warn ? day.spec.art.warnFace : day.spec.art.face, steam: false }
  }
  if (day?.entry && (day.entry.phase === 'won' || day.entry.phase === 'lost') && isOn(day.spec, t)) {
    return { prize: day.spec.prizes[day.entry.phase] }
  }
  const r = replyNow(s, t)
  if (r?.entry.phase === 'late') return { face: r.spec.art.late, steam: false }
  if (r?.entry.phase === 'done') return { face: 'face_done' }
  return null
}

