import type { Save } from '../types'
import type { LocalTime } from './clock'
import { isSpecialDay } from './datemode'
import { useBroth, type Effect } from './engine'
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

// prompt.submit: start a new segment after a long break, and count this session toward the egg in the pot once
export function usePrompt(prev: Save, prevUse: SessionUse, now: number, t: LocalTime, _tag = ''): UseStep {
  if (isSpecialDay(t)) return { save: prev, use: prevUse, effects: [] }
  const save = structuredClone(prev)
  const use = { ...prevUse }
  const last = lastActive(use)
  if (last === null || now - last >= SEGMENT_GAP_MS) use.segmentStart = now
  use.lastPromptAt = now
  if (use.countedFor !== save.egg.no) {
    save.egg.record.sessionCount += 1
    use.countedFor = save.egg.no
  }
  return { save, use, effects: [] }
}

// turn.complete: add the minutes since the segment was last active to the egg in the pot, use up broth for them,
// and note them for this session (tag) so overlaps with other sessions can be found (multi.ts)
export function useTurn(prev: Save, prevUse: SessionUse, now: number, t: LocalTime, tag = ''): UseStep {
  if (isSpecialDay(t)) return { save: prev, use: prevUse, effects: [] }
  const save = structuredClone(prev)
  const use = { ...prevUse }
  const effects: Effect[] = []
  const last = lastActive(use)
  const prompted = use.lastPromptAt !== null && (use.lastTurnEnd === null || use.lastPromptAt > use.lastTurnEnd)
  // A turn with no prompt before it opens a segment here and adds nothing yet, unless it follows the last turn
  // closely. A turn that a prompt started always counts in full, however long it ran
  if (last === null || (!prompted && now - last >= SEGMENT_GAP_MS)) {
    use.segmentStart = now
  } else {
    const minutes = Math.max(0, now - last) / MIN
    save.egg.record.sessionMinutes += minutes
    use.minutes += minutes
    useBroth(save, last, now, effects)
    noteUse(save, tag, last, now, t)
  }
  use.lastTurnEnd = now
  return { save, use, effects }
}
