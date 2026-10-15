// Usage profile: a summary of how you use Claude Code, to help tune the game's balance.
//
// It reads your local Claude Code transcripts (~/.claude/projects, or $CLAUDE_CONFIG_DIR/projects) and writes
// tea-egg-profile.json in the current folder. Nothing is sent anywhere: you decide whether to share the file.
//
// The file holds only per-day counts and minutes, and per-session minutes under made-up names (s1, s2, ...).
// It holds no prompts, no answers, no commands, no file or folder names and no session titles. Open it and check.
// The commands are looked at only to count them, with the same public lists the Mod uses (hooks/detect.ts).
//
// Needs Node 22.18 or newer (it runs TypeScript directly).
//   npm run profile
//   node scripts/usage-profile.ts [projects folder]

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { cautionKeyword, dangerKeyword, isTestCommand } from '../hooks/detect.ts'

const MIN = 60_000
// Same as the Mod: a prompt 30+ minutes after the last finished turn starts a new stretch of use
const GAP_MS = 30 * MIN
const BUCKET_MS = 10 * MIN
// Waiting for the person is not use. The Mod sees permission prompts as they happen; transcripts don't record them,
// so here a tool call counts as waiting when it is one that asks the person, or when it took 30+ minutes
const WAIT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const LONG_CALL_MS = 30 * MIN

const root = process.argv[2] ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
if (!existsSync(root)) {
  console.error(`No transcripts found at ${root}`)
  process.exit(1)
}

// Local date of a moment, in this computer's time zone (the Mod uses the same)
function dateOf(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * MIN)
  return d.toISOString().slice(0, 10)
}

function transcripts(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...transcripts(p))
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

type Rec = {
  type?: string
  timestamp?: string
  isSidechain?: boolean
  origin?: { kind?: string }
  message?: { stop_reason?: string; content?: unknown }
}
type Block = { type?: string; id?: string; name?: string; input?: { command?: unknown }; tool_use_id?: string; is_error?: boolean; content?: unknown }

type Day = {
  date: string
  turns: number
  buckets: number // 10-minute stretches with at least one finished turn
  useMinutes: number // time with at least one session in use
  overlapMinutes: number // time with two or more sessions in use
  testRuns: number
  testFails: number
  dangerous: number
  caution: number
}
const days = new Map<string, Day>()
const dayOf = (date: string): Day => {
  let d = days.get(date)
  if (!d) days.set(date, (d = { date, turns: 0, buckets: 0, useMinutes: 0, overlapMinutes: 0, testRuns: 0, testFails: 0, dangerous: 0, caution: 0 }))
  return d
}

type Session = { prompts: number[]; turnEnds: number[]; waits: [number, number][] }
const byKey = new Map<string, Session>()
const sessionOf = (key: string): Session => {
  let x = byKey.get(key)
  if (!x) byKey.set(key, (x = { prompts: [], turnEnds: [], waits: [] }))
  return x
}
const bucketsSeen = new Set<number>()

for (const file of transcripts(root)) {
  const isSub = file.includes(`${sep}subagents${sep}`)
  let recs: Rec[]
  try {
    recs = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Rec)
  } catch {
    continue
  }
  const calls = new Map<string, { command: string; t: number }>()
  const started = new Map<string, { name: string; t: number }>()
  // A subagent's transcript sits in <session>/subagents/; its waits hold up that session's turn
  const session = sessionOf(isSub ? dirname(dirname(file)) : file.replace(/\.jsonl$/, ''))
  for (const r of recs) {
    const t = Date.parse(r.timestamp ?? '')
    if (!Number.isFinite(t)) continue
    if (!isSub && !r.isSidechain) {
      if (r.type === 'user' && r.origin?.kind === 'human') session.prompts.push(t)
      if (r.type === 'assistant' && r.message?.stop_reason === 'end_turn') session.turnEnds.push(t)
    }
    const content = Array.isArray(r.message?.content) ? (r.message.content as Block[]) : []
    for (const c of content) {
      if (c.type === 'tool_use' && c.id) started.set(c.id, { name: c.name ?? '', t })
      if (c.type === 'tool_result' && c.tool_use_id) {
        const call = started.get(c.tool_use_id)
        if (call && t > call.t && (WAIT_TOOLS.has(call.name) || t - call.t >= LONG_CALL_MS)) session.waits.push([call.t, t])
      }
      if (c.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell') && c.id) {
        calls.set(c.id, { command: typeof c.input?.command === 'string' ? c.input.command : '', t })
      }
      if (c.type === 'tool_result' && c.tool_use_id) {
        const call = calls.get(c.tool_use_id)
        if (!call) continue
        const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? '')
        // A call the person refused never ran, and the Mod doesn't count it
        if (/doesn't want to proceed|was rejected|Permission to use/i.test(text.slice(0, 300))) continue
        const d = dayOf(dateOf(call.t))
        const failed = c.is_error === true
        if (isTestCommand(call.command)) {
          d.testRuns++
          if (failed) d.testFails++
        }
        if (!failed && dangerKeyword(call.command) !== null) d.dangerous++
        if (!failed && cautionKeyword(call.command) !== null) d.caution++
      }
    }
  }
}
const sessions = [...byKey.values()].filter(x => x.prompts.length > 0)
for (const session of byKey.values()) {
  for (const t of session.turnEnds) {
    dayOf(dateOf(t)).turns++
    bucketsSeen.add(Math.floor(t / BUCKET_MS))
  }
}
for (const b of bucketsSeen) dayOf(dateOf(b * BUCKET_MS)).buckets++

// [from, to] with the waits taken out (same as the Mod's usage.ts)
function withoutWaits(from: number, to: number, waits: [number, number][]): [number, number][] {
  let pieces: [number, number][] = [[from, to]]
  for (const [a, b] of waits) {
    pieces = pieces.flatMap(([x, y]): [number, number][] => {
      if (b <= x || a >= y) return [[x, y]]
      const out: [number, number][] = []
      if (a > x) out.push([x, a])
      if (b < y) out.push([b, y])
      return out
    })
  }
  return pieces
}

// Stretches of use per session, the way the Mod measures them: from a prompt to the last turn that finished
// after it, less the time spent waiting for the person; a turn with no prompt long after the last one starts over
const spans: { s: number; a: number; b: number }[] = []
sessions.forEach((session, s) => {
  const events = [...session.prompts.map(t => ({ t, prompt: true })), ...session.turnEnds.map(t => ({ t, prompt: false }))]
  events.sort((x, y) => x.t - y.t || Number(y.prompt) - Number(x.prompt))
  let segStart: number | null = null
  let lastEnd: number | null = null
  let lastPrompt: number | null = null
  const lastActive = () => (segStart === null ? null : lastEnd !== null && lastEnd >= segStart ? lastEnd : segStart)
  for (const e of events) {
    const last = lastActive()
    if (e.prompt) {
      if (last === null || e.t - last >= GAP_MS) segStart = e.t
      lastPrompt = e.t
      continue
    }
    const prompted = lastPrompt !== null && (lastEnd === null || lastPrompt > lastEnd)
    if (last === null || (!prompted && e.t - last >= GAP_MS)) segStart = e.t
    else if (e.t > last) for (const [a, b] of withoutWaits(last, e.t, session.waits)) spans.push({ s, a, b })
    lastEnd = e.t
  }
})

// Per session: minutes in use per day (by the day each stretch ended, as the Mod adds them) and the days it got a prompt
const sessionOut = sessions.map((session, s) => {
  const minutes: Record<string, number> = {}
  for (const x of spans) if (x.s === s) minutes[dateOf(x.b)] = (minutes[dateOf(x.b)] ?? 0) + (x.b - x.a) / MIN
  const promptDays = [...new Set(session.prompts.map(dateOf))].sort()
  return { minutes, promptDays }
})

// Per day: time with one or more, and two or more, sessions in use (a sweep over all stretches)
const edges: [number, number][] = []
for (const x of spans) edges.push([x.a, 1], [x.b, -1])
edges.sort((x, y) => x[0] - y[0] || x[1] - y[1])
let open = 0
let prev: number | null = null
for (const [t, step] of edges) {
  if (prev !== null && open > 0 && t > prev) {
    // Split at local midnight so each day gets its own share
    for (let a = prev; a < t; ) {
      const date = dateOf(a)
      const next = Math.min(t, Date.parse(`${date}T00:00:00Z`) + new Date(a).getTimezoneOffset() * MIN + 24 * 60 * MIN)
      const end = next > a ? next : t
      const d = dayOf(date)
      d.useMinutes += (end - a) / MIN
      if (open >= 2) d.overlapMinutes += (end - a) / MIN
      a = end
    }
  }
  open += step
  prev = t
}

const round = (n: number) => Math.round(n * 10) / 10
const dayList = [...days.values()]
  .filter(d => d.turns > 0 || d.useMinutes > 0)
  .sort((x, y) => x.date.localeCompare(y.date))
  .map(d => ({ ...d, useMinutes: round(d.useMinutes), overlapMinutes: round(d.overlapMinutes) }))
const profile = {
  tool: 'tea-egg usage profile',
  version: 1,
  days: dayList,
  sessions: sessionOut
    .filter(x => x.promptDays.length > 0)
    .map((x, i) => ({ name: `s${i + 1}`, promptDays: x.promptDays, minutes: Object.fromEntries(Object.entries(x.minutes).map(([k, v]) => [k, round(v)])) })),
}

const out = join(process.cwd(), 'tea-egg-profile.json')
writeFileSync(out, JSON.stringify(profile, null, 1) + '\n')
const first = dayList[0]?.date ?? '-'
const last = dayList[dayList.length - 1]?.date ?? '-'
console.log(`Read ${sessions.length} sessions over ${dayList.length} active days (${first} ~ ${last}).`)
console.log(`Wrote ${out}`)
console.log('It holds only counts and minutes: no prompts, commands, file names or titles. Open it to check before sharing.')
