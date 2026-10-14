import { test, expect, mock } from 'claude-code/testing'
import { newSave, STORE_KEY } from '../hooks/model'

// Tests load the Mod from the repo folder, not the install cache: the same as a --plugin-dir load
const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
const ENV = { TEA_EGG_LANG: 'zh-TW', USERPROFILE: 'C:/u' }
const DIR = 'C:/u/.claude/plugins/store'
const PERSON = { kind: 'person' } as const

type On = Parameters<Parameters<typeof test>[1]>[1]
type Files = Record<string, unknown>

const norm = (p: string) => p.replaceAll('\\', '/')

// A store folder holding the given files; writes to $.store are recorded
function setup(on: On, files: Files | null, own: unknown, toasts: string[], writes: string[]): void {
  mock.clock(on, { now: Date.UTC(2026, 9, 14, 2) })
  mock.env(on, ENV)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  let mine = own
  on('store.get', (_, e) => ({ value: (e as { key: string }).key === STORE_KEY ? mine : undefined }))
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    writes.push(key)
    if (key === STORE_KEY) mine = value
    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    if (files === null) throw new Error('EACCES')
    expect(norm(e.path)).toBe(DIR)
    return {
      value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
    }
  })
  on('fs.read', (_, e) => {
    const name = norm(e.path).slice(DIR.length + 1)
    return { value: JSON.stringify(files?.[name]) }
  })
}

test('Another save exists and ours is empty: stays off and writes nothing', async ($, on) => {
  const toasts: string[] = []
  const writes: string[] = []
  setup(on, { 'tea-egg_tea-egg-1.json': { [STORE_KEY]: newSave(1) } }, undefined, toasts, writes)
  await $.session.start(START)
  const reply = await $.command.run({ command: 'egg', args: '', origin: PERSON } as never)
  const band = await $.command.run({ command: 'egg', args: 'band', origin: PERSON } as never)
  expect(writes).toEqual([])
  expect(toasts.length).toBe(1)
  expect(reply.text).toContain('--plugin-dir')
  expect(band.text).toContain('--plugin-dir')
})

test('Another save differs from ours: stays off', async ($, on) => {
  const toasts: string[] = []
  const writes: string[] = []
  const ours = newSave(2)
  setup(
    on,
    { 'tea-egg_inline-1.json': { [STORE_KEY]: ours }, 'tea-egg_tea-egg-1.json': { [STORE_KEY]: newSave(1) } },
    ours,
    toasts,
    writes,
  )
  await $.session.start(START)
  expect(writes).toEqual([])
  expect(toasts.length).toBe(1)
})

test('The only save is ours, whatever the identity: runs normally', async ($, on) => {
  const toasts: string[] = []
  const writes: string[] = []
  const ours = newSave(2)
  setup(
    on,
    { 'tea-egg_inline-1.json': { [STORE_KEY]: ours }, 'other_x.json': { [STORE_KEY]: newSave(1) } },
    ours,
    toasts,
    writes,
  )
  await $.session.start(START)
  expect(writes).toContain(STORE_KEY)
  expect(toasts.some(t => t.includes('--plugin-dir'))).toBe(false)
})

test('First run with no save anywhere: runs and starts the one save', async ($, on) => {
  const toasts: string[] = []
  const writes: string[] = []
  setup(on, { 'tea-egg_tea-egg-1.json': { 'tea-egg/band-hidden': false } }, undefined, toasts, writes)
  await $.session.start(START)
  expect(writes).toContain(STORE_KEY)
})

test('Store folder unreadable and not run from an install: stays off', async ($, on) => {
  const toasts: string[] = []
  const writes: string[] = []
  setup(on, null, undefined, toasts, writes)
  await $.session.start(START)
  expect(writes).toEqual([])
  expect(toasts.length).toBe(1)
})
