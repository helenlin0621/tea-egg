import type { Save } from '../types'
import type { LocalTime } from './clock'
import { isSpecialDay } from './datemode'
import { SPAN_KEEP_MS, uncovered } from './engine'
import { decodeSpoilers } from './spoilers'

// Several sessions at once. Each session is its own program, so they only learn about each other through the save:
// every finished turn records the stretch of use it closed ([from, to], the same stretch that counts toward session
// length) tagged with a short session tag. Where it overlaps another session's stretch, two or more sessions were in
// use at the same time. Those minutes add up per day, and a day with enough of them is a several-session day.
// What is recorded is only when each session was in use, never what it did or where it ran.

const MIN = 60_000
// Recent stretches kept in the save; older ones can no longer overlap a new turn
const MAX_SPANS = 400

// How many minutes of overlap make a day count (the threshold lives with the harvest rules)
function dayMinutes(): number {
  const rule = decodeSpoilers().rules.find(r => r.when === 'multiDaysAtLeast')
  return rule?.when === 'multiDaysAtLeast' ? rule.dayMinutes : Infinity
}

// Record [from, to] for session tag; count its overlap with other sessions that isn't counted yet (not during
// special-date mode, when the egg is paused)
export function noteUse(s: Save, tag: string, from: number, to: number, t: LocalTime): void {
  if (to <= from) return
  const spans = (s.clocks.spans ?? []).filter(x => x.b >= to - SPAN_KEEP_MS)
  if (!isSpecialDay(t)) {
    let counted = s.clocks.multiSpans ?? []
    let ms = 0
    for (const x of spans) {
      if (x.s === tag) continue
      const a = Math.max(x.a, from)
      const b = Math.min(x.b, to)
      if (b <= a) continue
      const r = uncovered(counted, a, b)
      ms += r.ms
      counted = r.spans
    }
    s.clocks.multiSpans = counted
    if (ms > 0) {
      const r = s.egg.record
      const minutes = { ...(r.multiMinutes ?? {}) }
      minutes[t.date] = (minutes[t.date] ?? 0) + ms / MIN
      r.multiMinutes = minutes
      const days = r.multiDays ?? []
      if (minutes[t.date]! >= dayMinutes() && !days.includes(t.date)) r.multiDays = [...days, t.date]
    }
  }
  spans.push({ s: tag, a: from, b: to })
  s.clocks.spans = spans.slice(-MAX_SPANS)
}
