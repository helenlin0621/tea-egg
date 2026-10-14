import { test, expect, mock } from 'claude-code/testing'
import { newSave, STORE_KEY } from '../hooks/model'

// Tests load the Mod from the repo folder, i.e. not from the install cache: the same as a --plugin-dir load
const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
const ENV = { TEA_EGG_LANG: 'zh-TW', USERPROFILE: 'C:/u' }
const CANONICAL = 'C:/u/.claude/plugins/store/tea-egg_tea-egg-7a383064f644.json'

type On = Parameters<Parameters<typeof test>[1]>[1]
function base(on: On, toasts: string[], writes: string[]): void {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? e))
    return { value: undefined }
  })
  on('store.set', (_, e) => {
    writes.push((e as { key: string }).key)
    return { value: undefined }
  })
  on('store.get', () => ({ value: undefined }))
}

test('Loaded outside the install with no installed save: stays off and writes nothing', async ($, on) => {
  const toasts: string[] = []
  const writes: string[] = []
  mock.clock(on, { now: Date.UTC(2026, 9, 14, 2) })
  mock.env(on, ENV)
  base(on, toasts, writes)
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  await $.session.start(START)
  const reply = await $.command.run({ command: 'egg', args: '', origin: { kind: 'person' } } as never)
  const band = await $.command.run({ command: 'egg', args: 'band', origin: { kind: 'person' } } as never)
  expect(writes).toEqual([])
  expect(toasts.length).toBe(1)
  expect(reply.text).toContain('--plugin-dir')
  expect(band.text).toContain('--plugin-dir')
})

test('Loaded outside the install while the installed save differs: stays off', async ($, on) => {
  const toasts: string[] = []
  const writes: string[] = []
  mock.clock(on, { now: Date.UTC(2026, 9, 14, 2) })
  mock.env(on, ENV)
  base(on, toasts, writes)
  on('fs.read', (_, e) => {
    expect(e.path.replaceAll('\\', '/')).toBe(CANONICAL)
    return { value: JSON.stringify({ [STORE_KEY]: newSave(1) }) }
  })
  await $.session.start(START)
  expect(writes).toEqual([])
  expect(toasts.length).toBe(1)
})
