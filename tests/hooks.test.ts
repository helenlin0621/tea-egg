import { test, expect, mock } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { STORE_KEY, newSave } from '../hooks/model'

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
// Pin the language so the zh-TW expectations hold whatever the system locale
const ZH = { TEA_EGG_LANG: 'zh-TW' }
// There's no core under the plugin: tests must answer the wired events themselves
function base(on: Parameters<Parameters<typeof test>[1]>[1]): void {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
}
const BASH_OK = { result: { stdout: 'ok', stderr: '', interrupted: false }, isError: false }

// The test $ has no $.state (the kit only offers event calls); an inline plugin acts as a probe that reads tea-egg.save (any plugin may read it)
const peekPlugin = {
  name: 'peek',
  register: (on: Parameters<Parameters<typeof test>[1]>[1]) => {
    on('command.run', { command: 'peek' }, async ($, e) => {
      const { value } = await $.state.get({ plugin: 'tea-egg', key: 'save' })
      return { text: JSON.stringify(value ?? null) }
    })
  },
}
const OPTS = { plugins: [peekPlugin] }
async function saved($: { command: { run: (i: { command: string; args: string }) => Promise<{ text?: string }> } }): Promise<SaveValue> {
  return JSON.parse((await $.command.run({ command: 'peek', args: '' })).text!) as SaveValue
}
type SaveValue = {
  egg: { no: number; progress: number; record: { sessionCount: number } }
  dateMode: Record<string, { human: number }>
}

test('Observing Bash: the result is returned unchanged and not blocked', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  on('tool.call', { tool: 'Bash' }, () => BASH_OK)
  await $.session.start(START)
  const ran = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran.deny).toBe(undefined)
  expect(ran.isError).not.toBe(true)
  expect((ran.result as { stdout: string }).stdout).toBe('ok')
})

test('A dangerous command harvests the egg immediately', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  on('tool.call', { tool: 'Bash' }, () => BASH_OK)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  const value = await saved($)
  expect(value!.egg.no).toBe(2)
})

test('Subagent turns do not add flavor', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  await $.session.start(START)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
  expect((await saved($)).egg.progress).toBe(0)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect((await saved($)).egg.progress).toBe(1)
})

test('Re-firing session.start does not count the session twice', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  await $.session.start(START)
  await $.session.start(START)
  expect((await saved($)).egg.record.sessionCount).toBe(1)
})

test('Non-interactive sessions do not take part', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  on('tool.call', { tool: 'Bash' }, () => BASH_OK)
  await $.session.start({ cwd: '.', surface: null, isInteractive: false })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect((ran.result as { stdout: string }).stdout).toBe('ok')
  const value = await saved($)
  expect(value?.egg.progress ?? 0).toBe(0)
  expect(value?.egg.record.sessionCount ?? 0).toBe(0)
  expect(value?.egg.no ?? 1).toBe(1)
})

const HEADLESS = { cwd: '.', surface: null, isInteractive: false } as const
const ATTACH = { surface: 'desktop', clientId: 'c1' } as const

test('Desktop: no surface at start; activates only after attach', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  await $.session.start(HEADLESS)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', reason: 'answer' })
  expect((await saved($))?.egg?.progress ?? 0).toBe(0)
  await $.session.attach(ATTACH)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const value = await saved($)
  expect(value.egg.progress).toBe(1)
  expect(value.egg.record.sessionCount).toBe(1)
})

test('Attaching twice does not count the session twice', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  await $.session.start(HEADLESS)
  await $.session.attach(ATTACH)
  await $.session.attach({ surface: 'desktop', clientId: 'c2' })
  expect((await saved($)).egg.record.sessionCount).toBe(1)
})

test('A fake date never touches the real save', OPTS, async ($, on) => {
  const real = newSave(Date.UTC(2026, 9, 7, 2))
  real.egg.progress = 42
  mock.store(on, { [STORE_KEY]: real })
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  const dm = decodeSpoilers().dateMode
  mock.env(on, { ...ZH, TEA_EGG_FAKE_DATE: `2026-${String((dm.month % 12) + 1).padStart(2, '0')}-15` }) // not the special date
  base(on)
  await $.session.start(START)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await saved($)).egg.progress).toBe(1) // starts from the other save, not 43
})

test('Without a fake date the real save is read and written', OPTS, async ($, on) => {
  const real = newSave(Date.UTC(2026, 9, 7, 2))
  real.egg.progress = 42
  mock.store(on, { [STORE_KEY]: real })
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  await $.session.start(START)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await saved($)).egg.progress).toBe(43)
})

test('/egg subcommands reply', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  await $.session.start(START)
  const r = await $.command.run({ command: 'egg', args: 'refill' })
  expect(r.text).toBe('滷汁加滿了！蛋看起來很開心 (•ᴗ•)')
})

test('Special-date mode: the fake-date env var takes effect; the real egg is untouched', OPTS, async ($, on) => {
  const dm = decodeSpoilers().dateMode
  const pad = (n: number) => String(n).padStart(2, '0')
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, { ...ZH, TEA_EGG_FAKE_DATE: `2027-${pad(dm.month)}-${pad(dm.day)}T10:00` })
  base(on)
  await $.session.start(START)
  const before = (await saved($)).egg
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const after = (await saved($))
  expect(after.egg).toEqual(before)
  expect(after.dateMode['2027']!.human).toBe(dm.humanStep)
})

const SDK_START = { cwd: '.', surface: null, isInteractive: false } as const

test('Desktop: no surface at start; activates automatically when one attaches a few seconds later', OPTS, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  let surfaces: string[] = []
  on('session.surfaces', () => ({ value: surfaces }) as never)
  await $.session.start(SDK_START)
  expect(await saved($)).toBe(null)
  surfaces = ['desktop']
  await clock.advance(3_000)
  expect((await saved($)).egg.record.sessionCount).toBe(1)
})

test('Sessions with no surface at all (-p, scripts) never activate', OPTS, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  on('session.surfaces', () => ({ value: [] }) as never)
  await $.session.start(SDK_START)
  await clock.advance(60_000)
  expect(await saved($)).toBe(null)
})

test('Activates on prompt submit when a surface is attached, and that turn still adds flavor', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, ZH)
  base(on)
  let surfaces: string[] = []
  on('session.surfaces', () => ({ value: surfaces }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.session.start(SDK_START)
  surfaces = ['desktop']
  await $.prompt.submit({ text: 'hi' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await saved($)).egg.progress).toBe(1)
})
