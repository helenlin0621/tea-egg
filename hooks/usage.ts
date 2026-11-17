import type { Save } from '../types'
import type { LocalTime } from './clock'
import { dryLine, humanBroth, isPausedDay, isSpecialDay } from './datemode'
import { RULES, uncovered, useBroth, type Effect } from './engine'
import { noteUse } from './multi'

// Session length = time actually in use, not time the program stays open.
// A segment runs from a prompt to the last turn that finished after it; a prompt 30+ minutes after the last turn
// starts a new segment and the break in between doesn't count. Each session keeps its own record in the store
// under its session id (a --resume keeps the id, so a resumed session carries on), and every finished turn adds
// the new minutes to whichever egg is in the pot at that moment, so a harvest splits a session between two eggs.

const MIN = 60_000
export const SEGMENT_GAP_MS = 30 * MIN
// Records of sessions not used for this long are dropped from the store
export const USE_KEEP_MS = 30 * 24 * 60 * MIN

export type SessionUse = {
  minutes: number // total minutes in use, across days and eggs
  segmentStart: number | null
  lastTurnEnd: number | null
  lastPromptAt: number | null
  countedFor: number | null // the egg number this session already counted toward
}

export function newUse(): SessionUse {
  return { minutes: 0, segmentStart: null, lastTurnEnd: null, lastPromptAt: null, countedFor: null }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null)

export function parseUse(raw: unknown): SessionUse {
  if (typeof raw !== 'object' || raw === null) return newUse()
  const r = raw as Record<string, unknown>
  return {
    minutes: isNum(r.minutes) ? r.minutes : 0,
    segmentStart: numOrNull(r.segmentStart),
    lastTurnEnd: numOrNull(r.lastTurnEnd),
    lastPromptAt: numOrNull(r.lastPromptAt),
    countedFor: numOrNull(r.countedFor),
  }
}

export function useStale(use: SessionUse, now: number): boolean {
  const last = Math.max(use.lastTurnEnd ?? 0, use.segmentStart ?? 0)
  return now - last > USE_KEEP_MS
}

// When this segment was last active: its last finished turn, or its start if no turn has finished in it yet
function lastActive(use: SessionUse): number | null {
  if (use.segmentStart === null) return null
  return use.lastTurnEnd !== null && use.lastTurnEnd >= use.segmentStart ? use.lastTurnEnd : use.segmentStart
}

export type UseStep = { save: Save; use: SessionUse; effects: Effect[] }

// Stretches spent waiting for the person (a permission prompt, a question to answer) are not use
export type Wait = [from: number, to: number]

// [from, to] with the waits taken out, as the pieces that remain
export function withoutWaits(from: number, to: number, waits: readonly Wait[]): Wait[] {
  let pieces: Wait[] = [[from, to]]
  for (const [a, b] of waits) {
    pieces = pieces.flatMap(([x, y]): Wait[] => {
      if (b <= x || a >= y) return [[x, y]]
      const out: Wait[] = []
      if (a > x) out.push([x, a])
      if (b < y) out.push([b, y])
      return out
    })
  }
  return pieces
}

// [from, to] cut at each local midnight, each piece with its own day: a stretch that crosses midnight belongs to both
// days (the egg may be paused on one of them, and the several-session minutes are counted per day). No `at`: one piece
export function splitByDay(from: number, to: number, t: LocalTime, at?: (ms: number) => LocalTime): [from: number, to: number, t: LocalTime][] {
  if (!at) return [[from, to, t]]
  const out: [number, number, LocalTime][] = []
  let a = from
  for (;;) {
    const ta = at(a)
    const midnight = a - (a % MIN) + ((24 - ta.hour) * 60 - ta.minute) * MIN
    if (midnight >= to) {
      out.push([a, to, ta])
      return out
    }
    out.push([a, midnight, ta])
    a = midnight
  }
}

// prompt.submit: start a new segment after a long break, and count this session toward the egg in the pot once
export function usePrompt(prev: Save, prevUse: SessionUse, now: number, t: LocalTime, _tag = ''): UseStep {
  // The first special date keeps the segments going for the human's broth (useTurn); the egg's records stay as they are
  const human = isSpecialDay(t)
  if (isPausedDay(t) && !human) return { save: prev, use: prevUse, effects: [] }
  const save = structuredClone(prev)
  const use = { ...prevUse }
  const last = lastActive(use)
  if (last === null || now - last >= SEGMENT_GAP_MS) use.segmentStart = now
  use.lastPromptAt = now
  if (!human && use.countedFor !== save.egg.no) {
    save.egg.record.sessionCount += 1
    use.countedFor = save.egg.no
  }
  return { save, use, effects: [] }
}

// turn.complete: add the minutes since the segment was last active to the egg in the pot, use up broth for them,
// and note them for this session (tag) so overlaps with other sessions can be found (multi.ts). Time spent waiting
// for the person during the turn (waits) is left out of all three. On the first special date the time uses up the
// human's broth instead (terminal: the dry toast mentions the fallback command), and the egg's records stay as they are
export function useTurn(
  prev: Save,
  prevUse: SessionUse,
  now: number,
  t: LocalTime,
  tag = '',
  waits: readonly Wait[] = [],
  terminal = false,
  at?: (ms: number) => LocalTime,
): UseStep {
  const last = lastActive(prevUse)
  // The egg is paused all day and nothing from an earlier day is waiting to be counted. Otherwise a turn that began
  // before midnight still has its first part to count and lastTurnEnd must move, or the next turn counts it all again
  const startedToday = last === null || !at || at(last).date === t.date
  if (isPausedDay(t) && !isSpecialDay(t) && startedToday) return { save: prev, use: prevUse, effects: [] }
  const save = structuredClone(prev)
  const use = { ...prevUse }
  const effects: Effect[] = []
  const prompted = use.lastPromptAt !== null && (use.lastTurnEnd === null || use.lastPromptAt > use.lastTurnEnd)
  // A turn with no prompt before it opens a segment here and adds nothing yet, unless it follows the last turn
  // closely. A turn that a prompt started always counts in full, however long it ran
  if (last === null || (!prompted && now - last >= SEGMENT_GAP_MS)) {
    use.segmentStart = now
  } else {
    for (const [a, b, day] of withoutWaits(last, now, waits).flatMap(([x, y]) => splitByDay(x, y, t, at))) {
      const human = isSpecialDay(day)
      if (isPausedDay(day) && !human) continue
      if (human) {
        const r = uncovered(save.clocks.usedSpans ?? [], a, b)
        save.clocks.usedSpans = r.spans
        if (humanBroth(save, day, r.ms, RULES.brothStepMs, RULES.brothStep)) effects.push({ kind: 'toast', text: dryLine(terminal) })
        continue
      }
      const minutes = (b - a) / MIN
      save.egg.record.sessionMinutes += minutes
      use.minutes += minutes
      useBroth(save, a, b, effects)
      noteUse(save, tag, a, b, day)
    }
  }
  use.lastTurnEnd = now
  return { save, use, effects }
}
