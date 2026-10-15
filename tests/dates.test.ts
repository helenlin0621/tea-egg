import { test, expect } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { dateAction, dateArt, dateLook, timedBand, timedNow } from '../hooks/dates'
import { onCommand, onObserved, onPrompt, onSessionOpen, onTick, onTurn } from '../hooks/flow'
import { newSave, parseSave } from '../hooks/model'
import { fitSegments, bandSegments, strWidth } from '../hooks/view'
import { T, fill } from '../hooks/text'
import type { LocalTime } from '../hooks/clock'
import type { Observation } from '../hooks/detect'
import type { GrantDate, ReplyDate, TimedDate } from '../hooks/spoiler-types'
import type { Save, TimedEntry } from '../types'

// Every date comes from the spoiler data, so no date, line or egg name is written here
const dates = () => decodeSpoilers().dates
const find = <K extends 'timed' | 'grant' | 'reply'>(kind: K) =>
  Object.entries(dates()).filter(([, d]) => d.kind === kind) as [string, Extract<TimedDate | GrantDate | ReplyDate, { kind: K }>][]
const [TIMED_ID, TIMED] = find('timed')[0]!
const GRANTS = find('grant')
const [REPLY_ID, REPLY] = find('reply')[0]!
const NEEDS = dates()[REPLY.needs] as GrantDate
const pad = (n: number) => String(n).padStart(2, '0')
const first = () => 0

// Local time on a date's day (offset days later), and its epoch ms in UTC+8
function day(d: { month: number; day: number }, year: number, offset = 0, hour = 10, minute = 0): { t: LocalTime; now: number } {
  const u = new Date(Date.UTC(year, d.month - 1, d.day + offset))
  const y = u.getUTCFullYear()
  const m = u.getUTCMonth() + 1
  const dd = u.getUTCDate()
  return {
    t: { date: `${y}-${pad(m)}-${pad(dd)}`, year: y, month: m, day: dd, hour, minute },
    now: Date.UTC(y, m - 1, dd, hour - 8, minute),
  }
}
const SEC = 1000
const DANGER: Observation = { test: null, failed: false, danger: 'rm -rf /', caution: null }

// A save made a few weeks before the timed date in 2026 (so only days after that are made up)
function oldSave(installedOn = '2026-10-01'): Save {
  const s = newSave(Date.UTC(2025, 0, 1))
  s.welcomed = true
  s.installedOn = installedOn
  return s
}
const texts = (r: { effects: { text: string }[] }) => r.effects.map(e => e.text)

// ---- timed ----

test('Timed date: opening that day does not start it; the first prompt starts the countdown and pauses the egg', async () => {
  const { t, now } = day(TIMED, 2026, 0, 9)
  const opened = onSessionOpen(oldSave(), now, t, true)
  expect(opened.save.egg.record.activeDays).toEqual([])
  expect(timedBand(opened.save, t, now)).toBe(null)
  const started = onPrompt(opened.save, now, t, false)
  expect(texts(started)).toEqual([TIMED.lines.start.desktop])
  const band = timedBand(started.save, t, now + SEC)
  expect(band?.timer).toEqual({ icon: TIMED.band.timer, digits: `${Math.floor((TIMED.seconds - 1) / 60)}:${pad((TIMED.seconds - 1) % 60)}` })
  // Turns that day leave the egg as it was
  const turned = onTurn(started.save, now + 10 * SEC, t, first)
  expect(turned.save.egg).toEqual(started.save.egg)
  // A second prompt doesn't restart it
  expect(texts(onPrompt(turned.save, now + 20 * SEC, t, false))).toEqual([])
})

test('Timed date: the toasts that mention the fallback command go to terminal sessions only', async () => {
  const { t, now } = day(TIMED, 2026)
  const started = onPrompt(oldSave(), now, t, true)
  expect(texts(started)).toEqual([TIMED.lines.start.terminal])
  const warn = onTick(started.save, now + (TIMED.seconds - TIMED.warnSeconds) * SEC, t, first)
  expect(texts(warn)).toEqual([TIMED.lines.warn.terminal])
  expect(texts(onTick(warn.save, now + (TIMED.seconds - 10) * SEC, t, first))).toEqual([])
})

// The day's count so far, the way the toasts and the band count them
const count = (line: string, n: number) => fill(line, { n: String(n), need: String(TIMED.need) })
const entryOf = (s: Save, year = 2026) => s.dateMode[`${TIMED_ID}:${year}`] as TimedEntry

// Answer `n` asks in time and miss `misses` more, from the day's first prompt; each ask comes right after its rest
function play(n: number, misses = 0, year = 2026): { save: Save; at: number } {
  const { t, now } = day(TIMED, year, 0, 8)
  let s = onPrompt(oldSave(), now, t, false).save
  let at = now
  for (let i = 0; i < n + misses; i++) {
    if (i > 0) {
      at = entryOf(s, year).nextAt!
      s = onPrompt(s, at, t, false).save
    }
    s = i < n ? onCommand(s, at + 10 * SEC, t, 'refill', first).save : onTick(s, at + (TIMED.seconds + 1) * SEC, t, first).save
    expect(entryOf(s, year).phase).toBe('rest')
  }
  return { save: s, at }
}

test('Timed date: pressing in time counts one and the egg rests; /egg refill is the same as the button', async () => {
  const { t, now } = day(TIMED, 2026)
  const started = onPrompt(oldSave(), now, t, false)
  const got = onCommand(started.save, now + 30 * SEC, t, 'refill', first)
  expect(got.reply).toBe(count(TIMED.lines.got, 1))
  expect(got.save.dex[TIMED.prizes.won]).toBe(undefined) // the prize comes when the day is settled
  expect(got.save.egg.broth).toBe(started.save.egg.broth) // not a refill
  expect(dateAction(got.save, t)).toBe(null)
  expect(onCommand(got.save, now + 40 * SEC, t, 'refill', first).reply).toBe(TIMED.replies.resting)
  const band = timedBand(got.save, t, now + 40 * SEC)
  expect(band?.timer).toBe(null)
  expect(band?.look.text).toBe(TIMED.band.rest)
  expect(band?.count).toBe(count(TIMED.band.count, 1))
})

test('Timed date: an ask that runs out is missed, toasting once; the egg rests', async () => {
  const { t, now } = day(TIMED, 2026)
  const started = onPrompt(oldSave(), now, t, false)
  const late = now + (TIMED.seconds + 1) * SEC
  const missed = onTurn(started.save, late, t, first)
  expect(texts(missed)).toEqual([count(TIMED.lines.miss, 0)])
  expect(entryOf(missed.save).phase).toBe('rest')
  expect(missed.save.dex).toEqual(started.save.dex)
  expect(texts(onTick(missed.save, late + 60 * SEC, t, first))).toEqual([])
})

test('Timed date: the next ask waits for the rest, then comes with the first prompt after it', async () => {
  const { t, now } = day(TIMED, 2026)
  const pressed = now + 30 * SEC
  const s = onCommand(onPrompt(oldSave(), now, t, false).save, pressed, t, 'refill', first).save
  const next = entryOf(s).nextAt!
  expect(next).toBeGreaterThanOrEqual(pressed + TIMED.restMs[0])
  expect(next).toBeLessThanOrEqual(pressed + TIMED.restMs[1])
  // Drawn when the ask ended and kept: reopening does not draw again
  expect(entryOf(onSessionOpen(s, next - 60 * SEC, t, true).save).nextAt).toBe(next)
  expect(texts(onPrompt(s, next - SEC, t, false))).toEqual([])
  expect(texts(onTick(s, next + 60 * SEC, t, first))).toEqual([]) // no prompt, no ask
  const at = next + 60 * SEC
  const asked = onPrompt(s, at, t, true)
  expect(texts(asked)).toEqual([TIMED.lines.start.terminal])
  expect(entryOf(asked.save)).toMatchObject({ phase: 'run', startedAt: at, got: 1, asks: 2, warned: false })
  const warn = at + (TIMED.seconds - TIMED.warnSeconds) * SEC
  expect(texts(onTick(asked.save, warn, t, first))).toEqual([TIMED.lines.warn.terminal])
})

test('Timed date: the rests between asks are drawn, not all the same', async () => {
  const { t } = day(TIMED, 2026)
  let s = play(1).save
  const gaps = new Set<number>()
  for (let i = 0; i < 4; i++) {
    const at = entryOf(s).nextAt!
    s = onCommand(onPrompt(s, at, t, false).save, at + 10 * SEC, t, 'refill', first).save
    gaps.add(entryOf(s).nextAt! - (at + 10 * SEC))
  }
  expect(entryOf(s).asks).toBe(5)
  expect(gaps.size).toBeGreaterThan(1)
})

test('Timed date: settled on the first open after the day; enough of them give one prize, fewer the other', async () => {
  const next = day(TIMED, 2026, 1, 9)
  const won = play(TIMED.need + 2, 1)
  // More than needed: the count goes on past it, with nothing else said
  expect(timedBand(won.save, day(TIMED, 2026).t, won.at + 20 * SEC)?.count).toBe(count(TIMED.band.count, TIMED.need + 2))
  expect(timedBand(won.save, day(TIMED, 2026).t, won.at + 20 * SEC)?.look.text).toBe(TIMED.band.rest)
  const a = onSessionOpen(won.save, next.now, next.t, true)
  expect(texts(a)).toEqual([fill(TIMED.lines.won, { n: String(TIMED.need + 2) }) + T().newDex])
  expect(a.save.dex[TIMED.prizes.won]).toBe(1)
  expect(a.save.dex[TIMED.prizes.lost]).toBe(undefined)
  expect(timedBand(a.save, next.t, next.now)).toBe(null)
  expect(texts(onSessionOpen(a.save, next.now + 60 * SEC, next.t, false))).toEqual([])
  const lost = onSessionOpen(play(TIMED.need - 1, 3).save, next.now, next.t, true)
  expect(texts(lost)).toEqual([fill(TIMED.lines.lost, { n: String(TIMED.need - 1) }) + T().newDex])
  expect(lost.save.dex[TIMED.prizes.lost]).toBe(1)
  expect(lost.save.dex[TIMED.prizes.won]).toBe(undefined)
  // Not on the day itself; the next year starts again
  const late = day(TIMED, 2026, 0, 23)
  expect(texts(onSessionOpen(won.save, late.now, late.t, true))).toEqual([])
  const year = day(TIMED, 2027)
  expect(texts(onPrompt(a.save, year.now, year.t, false))).toContain(TIMED.lines.start.desktop) // after the other days made up
})

test('Timed date: an ask started just before midnight still counts for the day, then the day settles', async () => {
  const { t, now } = day(TIMED, 2026, 0, 23, 58)
  const started = onPrompt(oldSave(), now, t, false)
  const next = day(TIMED, 2026, 1, 0, 1)
  expect(timedNow(started.save, next.t)?.entry?.phase).toBe('run')
  // Still counting down: not settled yet
  expect(entryOf(onTurn(started.save, next.now, next.t, first).save).phase).toBe('run')
  const got = onCommand(started.save, next.now, next.t, 'refill', first)
  expect(got.reply).toBe(count(TIMED.lines.got, 1))
  const settled = onPrompt(got.save, next.now + 60 * SEC, next.t, false)
  expect(texts(settled)).toEqual([fill(TIMED.lines.lost, { n: '1' }) + T().newDex])
  expect(texts(onPrompt(settled.save, next.now + 120 * SEC, next.t, false))).toEqual([]) // no more asks
})

test('Timed date: before the first prompt the button only says it is too early; flip has its own line', async () => {
  const { t, now } = day(TIMED, 2026)
  const opened = onSessionOpen(oldSave(), now, t, true).save
  expect(onCommand(opened, now, t, 'refill', first).reply).toBe(TIMED.replies.early)
  expect(onCommand(opened, now, t, 'flip', first).reply).toBe(TIMED.replies.flip)
})

test('Timed date: dangerous commands only toast (at most once per gap); the egg does not crack', async () => {
  const { t, now } = day(TIMED, 2026)
  const s = onPrompt(oldSave(), now, t, false).save
  const a = onObserved(s, now, t, DANGER, first)
  expect(a.save.egg.record.cracked).toBe(null)
  expect(texts(a)).toEqual([TIMED.lines.danger])
  expect(texts(onObserved(a.save, now + 60 * SEC, t, DANGER, first))).toEqual([])
})

test('Timed date: a day settled the old way (a single countdown) stays settled; the next day says it is over once', async () => {
  const { t, now } = day(TIMED, 2026)
  const s = oldSave()
  s.dateMode[`${TIMED_ID}:2026`] = { phase: 'won', startedAt: now - 60 * SEC, from: 'live' }
  s.dex[TIMED.prizes.won] = 1
  expect(onCommand(s, now, t, 'refill', first).reply).toBe(TIMED.replies.afterWon)
  expect(texts(onPrompt(s, now, t, false))).toEqual([])
  expect(timedBand(s, t, now)?.look.text).toBe(TIMED.band.won.text)
  const next = day(TIMED, 2026, 1)
  const opened = onSessionOpen(s, next.now, next.t, true)
  expect(texts(opened)).toEqual([TIMED.lines.over])
  expect(opened.save.dex[TIMED.prizes.won]).toBe(1)
  expect(texts(onSessionOpen(opened.save, next.now + 60 * SEC, next.t, false))).toEqual([])
})

test('Timed date: missed (or opened without a prompt) gives the losing prize on the next open, once', async () => {
  for (const before of [oldSave(), onSessionOpen(oldSave(), day(TIMED, 2026).now, day(TIMED, 2026).t, true).save]) {
    const later = day(TIMED, 2026, 9)
    const r = onSessionOpen(before, later.now, later.t, true)
    expect(texts(r)).toEqual([TIMED.lines.makeup + T().newDex])
    expect(r.save.dex[TIMED.prizes.lost]).toBe(1)
    expect(texts(onSessionOpen(r.save, later.now + 60 * SEC, later.t, false))).toEqual([])
  }
})

test('Timed date: no make-up for a save made after the day', async () => {
  const s = oldSave()
  s.installedOn = day(TIMED, 2026, 1).t.date
  const later = day(TIMED, 2026, 9)
  expect(onSessionOpen(s, later.now, later.t, true).save.dex[TIMED.prizes.lost]).toBe(undefined)
})

test('Timed date: an older save gets installedOn on its first open, so days before it are not made up', async () => {
  const s = oldSave()
  delete s.installedOn
  const later = day(TIMED, 2026, 9)
  const r = onSessionOpen(s, later.now, later.t, true)
  expect(r.save.installedOn).toBe(later.t.date)
  expect(r.save.dex[TIMED.prizes.lost]).toBe(undefined)
})

test('Timed date: the day is left out of the gap between active days; a grant day is an ordinary day', async () => {
  const before = day(TIMED, 2026, -1)
  const after = day(TIMED, 2026, 1)
  let s = onTurn(oldSave(), before.now, before.t, first).save
  s = onTurn(s, after.now, after.t, first).save
  expect(s.egg.record.maxGapDays).toBe(0)
  const [, grant] = GRANTS[0]!
  const g0 = day(grant, 2027, -1)
  const g2 = day(grant, 2027, 1)
  let g = onTurn(oldSave(), g0.now, g0.t, first).save
  g = onTurn(g, g2.now, g2.t, first).save
  expect(g.egg.record.maxGapDays).toBe(1)
})

test('Timed date: the band keeps the timer and drops the name first when narrow', async () => {
  const { t, now } = day(TIMED, 2026)
  const s = onPrompt(oldSave(), now, t, false).save
  const segs = bandSegments(s, t, now + SEC)
  // No emoji left of the digits while it redraws every second (a terminal drawing them one column wide misplaces what
  // follows); the timer's emoji comes right after the digits
  const at = segs.findIndex(x => /^\d:\d\d$/.test(x.text))
  for (const x of segs.slice(0, at + 1)) expect(/\p{Extended_Pictographic}/u.test(x.text)).toBe(false)
  expect(segs[at + 1]!.text).toBe(` ${TIMED.band.timer}`)
  expect(/\p{Extended_Pictographic}/u.test(TIMED.button)).toBe(false)
  const digits = segs[at]!.text
  const narrow = fitSegments(segs, [segs[0]!.text, T().separator, digits].reduce((w, x) => w + strWidth(x), 0))
  expect(narrow.map(x => x.text)).toEqual([segs[0]!.text, T().separator, digits])
  // The pane shows the costume while counting down, with the nervous face near the end
  expect(dateArt(s, t, now + SEC)).toEqual({ base: TIMED.art.base, face: TIMED.art.face, steam: false })
  expect(dateArt(s, t, now + (TIMED.seconds - 5) * SEC)?.face).toBe(TIMED.art.warnFace)
  expect(dateAction(s, t)).toEqual({ label: TIMED.button, paneLabel: TIMED.paneButton, hotkey: TIMED.hotkey, args: 'refill' })
  // The count shows while asking, emoji-free; between asks it gets its mark, the costume stays and the timer goes
  expect(segs.map(x => x.text)).toContain(count(TIMED.band.count, 0))
  const rest = onCommand(s, now + 2 * SEC, t, 'refill', first).save
  const restSegs = bandSegments(rest, t, now + 3 * SEC).map(x => x.text)
  expect(restSegs).toContain(`${count(TIMED.band.count, 1)} ${TIMED.band.mark}`)
  expect(restSegs.some(x => /^\d:\d\d$/.test(x))).toBe(false)
  expect(dateArt(rest, t, now + 3 * SEC)).toEqual({ base: TIMED.art.base, face: TIMED.art.face, steam: false })
})

// ---- grant ----

test('Grant dates: the first prompt of the day gives the prize once; the egg goes on as usual', async () => {
  for (const [, grant] of GRANTS) {
    const { t, now } = day(grant, 2027, 0, 0, 1)
    const got = onPrompt(oldSave(day(grant, 2027, -3).t.date), now, t, false)
    expect(texts(got)).toEqual([grant.lines.got + T().newDex])
    expect(got.save.dex[grant.prize]).toBe(1)
    expect(texts(onPrompt(got.save, now + 60 * SEC, t, false))).toEqual([])
    const turned = onTurn(got.save, now + 60 * SEC, t, first)
    expect(turned.save.egg.progress).toBeGreaterThan(got.save.egg.progress)
    expect(dateLook(turned.save, t)).toEqual(grant.band)
  }
})

test('Grant dates: missed is made up once on a later open; not for a save made after the day', async () => {
  for (const [, grant] of GRANTS) {
    const later = day(grant, 2027, 3)
    const r = onSessionOpen(oldSave(), later.now, later.t, true)
    expect(texts(r)).toContain(grant.lines.makeup + T().newDex)
    expect(r.save.dex[grant.prize]).toBe(1)
    // A grant made up on another day doesn't dress up the band
    expect(dateLook(r.save, later.t)).toBe(null)
    expect(texts(onSessionOpen(r.save, later.now + 60 * SEC, later.t, false))).not.toContain(grant.lines.makeup)
    const late = oldSave()
    late.installedOn = day(grant, 2027, 1).t.date
    expect(onSessionOpen(late, later.now, later.t, true).save.dex[grant.prize]).toBe(undefined)
  }
})

test('Several missed dates are made up in date order', async () => {
  const s = oldSave()
  const sorted = [[TIMED.month, TIMED.lines.makeup] as const, ...GRANTS.map(([, g]) => [g.month, g.lines.makeup] as const)]
  const later = day({ month: 12, day: 31 }, 2027)
  const lines = texts(onSessionOpen(s, later.now, later.t, true)).map(x => x.replace(T().newDex, ''))
  const expected = sorted.sort((a, b) => a[0] - b[0]).map(([, line]) => line)
  expect(lines.filter(x => expected.includes(x))).toEqual(expected)
})

test('The first special date is still not made up when it was not opened at all', async () => {
  const dm = decodeSpoilers().dateMode
  const later = day({ month: dm.month, day: dm.day }, 2027, 5)
  expect(onSessionOpen(oldSave(), later.now, later.t, true).save.dex[dm.prize]).toBe(undefined)
})

// ---- reply ----

// A save that got `needs` on its day
function withNeeds(year = 2027): Save {
  const { t, now } = day(NEEDS, year)
  return onPrompt(oldSave(), now, t, false).save
}

test('Reply date: opens on the first prompt for someone who got the earlier prize; pressing gives its prize', async () => {
  const { t, now } = day(REPLY, 2027)
  const opened = onPrompt(withNeeds(), now, t, true)
  expect(texts(opened)).toEqual([REPLY.lines.open.terminal])
  expect(dateLook(opened.save, t)).toEqual(REPLY.band.open)
  expect(dateAction(opened.save, t)?.args).toBe(REPLY.command)
  const done = onCommand(opened.save, now + 60 * SEC, t, REPLY.command, first)
  expect(done.reply).toBe(REPLY.lines.done + T().newDex)
  expect(done.save.dex[REPLY.prize]).toBe(1)
  expect(dateAction(done.save, t)).toEqual({ label: REPLY.doneButton, paneLabel: REPLY.doneButton, hotkey: '', args: '', done: true })
  expect(dateArt(done.save, t, now)).toEqual({ face: 'face_done' })
  // Nothing happens the next day
  const next = day(REPLY, 2027, 1)
  expect(texts(onSessionOpen(done.save, next.now, next.t, true))).toEqual([])
})

test('Reply date: unanswered, the egg is cross on the next day opened; refill and flip still work with other lines', async () => {
  const { t, now } = day(REPLY, 2027)
  const opened = onPrompt(withNeeds(), now, t, false).save
  const next = day(REPLY, 2027, 1)
  const cross = onSessionOpen(opened, next.now, next.t, true)
  expect(texts(cross)).toEqual([REPLY.lines.late])
  expect(dateLook(cross.save, next.t)).toEqual(REPLY.band.late)
  expect(dateArt(cross.save, next.t, next.now)).toEqual({ face: REPLY.art.late, steam: false })
  const s = cross.save
  s.egg.broth = 10
  const refilled = onCommand(s, next.now, next.t, 'refill', first)
  expect(refilled.save.egg.broth).toBe(100)
  expect(refilled.reply).toBe(REPLY.lines.lateRefill)
  // Cross lines when a turn ends, at most once per lineGapMs
  const a = onTurn(refilled.save, next.now + 60 * SEC, next.t, first)
  expect(texts(a)).toContain(REPLY.lines.lateLines[0]!)
  expect(texts(onTurn(a.save, next.now + 120 * SEC, next.t, first))).not.toContain(REPLY.lines.lateLines[0]!)
  expect(a.save.egg.progress).toBeGreaterThan(s.egg.progress)
})

test('Reply date: not opened at all that day; cross on whichever day comes first after, then over the next day', async () => {
  const later = day(REPLY, 2027, 6)
  const cross = onSessionOpen(withNeeds(), later.now, later.t, true)
  expect(texts(cross)).toEqual([REPLY.lines.late])
  const eased = onCommand(cross.save, later.now, later.t, REPLY.command, first)
  expect(eased.reply).toBe(REPLY.lines.eased)
  expect(eased.save.dex[REPLY.prize]).toBe(undefined)
  expect(dateAction(eased.save, later.t)).toBe(null)
  // The day after a cross day: over, once (also when it was never eased)
  for (const s of [eased.save, cross.save]) {
    const next = day(REPLY, 2027, 7)
    const over = onSessionOpen(s, next.now, next.t, true)
    expect(texts(over)).toEqual(s === cross.save ? [REPLY.lines.over] : [])
    expect(texts(onSessionOpen(over.save, next.now + SEC, next.t, false))).toEqual([])
  }
})

test('Reply date: nothing at all without the earlier prize, and the command answers like an unknown one', async () => {
  const { t, now } = day(REPLY, 2027)
  const s = oldSave()
  s.installedOn = day(NEEDS, 2027, 1).t.date
  expect(texts(onPrompt(s, now, t, false))).toEqual([])
  expect(onCommand(s, now, t, REPLY.command, first).reply).toBe(T().unknown)
  const later = day(REPLY, 2027, 2)
  expect(texts(onSessionOpen(s, later.now, later.t, true))).toEqual([])
})

test('Reply date: the earlier prize made up on the day still opens it; made up after the day, no grudge', async () => {
  const s = oldSave()
  const { t, now } = day(REPLY, 2027)
  const opened = onSessionOpen(s, now, t, true)
  expect(texts(opened)).toContain(NEEDS.lines.makeup + T().newDex)
  expect(texts(onPrompt(opened.save, now, t, false))).toEqual([REPLY.lines.open.desktop])
  const after = day(REPLY, 2027, 2)
  const r = onSessionOpen(oldSave(), after.now, after.t, true)
  expect(texts(r)).toContain(NEEDS.lines.makeup + T().newDex)
  expect(texts(r)).not.toContain(REPLY.lines.late)
})

test('Reply date: cracking the egg while cross ends the grudge', async () => {
  const later = day(REPLY, 2027, 1)
  const cross = onSessionOpen(withNeeds(), later.now, later.t, true).save
  const cracked = onObserved(cross, later.now, later.t, DANGER, first)
  expect(cracked.save.egg.no).toBe(cross.egg.no + 1)
  expect(dateLook(cracked.save, later.t)).toBe(null)
})

test('Reply command on an ordinary day answers like an unknown command; help never mentions it', async () => {
  const { t, now } = day(REPLY, 2027, 40)
  expect(onCommand(oldSave(), now, t, REPLY.command, first).reply).toBe(T().unknown)
  expect(T().help).not.toContain(REPLY.command)
})

// ---- save ----

test('An older save keyed the first special date by year: it moves under d1, still version 1', async () => {
  const s = oldSave() as Save & { dateMode: Record<string, unknown> }
  s.dateMode['2027'] = { seen: true, revealed: true, human: 40, lastToast: {} }
  const parsed = parseSave(JSON.parse(JSON.stringify(s)), Date.UTC(2027, 5, 1))
  expect(parsed.version).toBe(1)
  expect(parsed.dateMode['2027']).toBe(undefined)
  expect(parsed.dateMode[`d1:2027`]).toEqual({ seen: true, revealed: true, human: 40, lastToast: {} })
  expect(parsed.egg).toEqual(s.egg)
})

test(`Every special date's prize is a dex slot with a name and art`, async () => {
  const sp = decodeSpoilers()
  for (const d of Object.values(sp.dates)) {
    const prizes = d.kind === 'timed' ? [d.prizes.won, d.prizes.lost] : [d.prize]
    for (const id of prizes) {
      expect(sp.dexSlots).toContain(id)
      expect(sp.eggs[id]).toBeDefined()
      expect(sp.sprites[id]).toBeDefined()
    }
  }
  expect(sp.sprites[TIMED.art.base]).toBeDefined()
  expect(sp.sprites[TIMED.art.face]).toBeDefined()
  expect(sp.sprites[TIMED.art.warnFace]).toBeDefined()
  expect(sp.sprites[REPLY.art.late]).toBeDefined()
  expect(Object.keys(dates())).toEqual(['d2', 'd3', 'd4', 'd5'])
  expect(TIMED_ID).toBe('d2')
  expect(REPLY_ID).toBe('d5')
})
