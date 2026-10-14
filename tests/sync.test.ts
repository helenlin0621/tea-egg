import { test, expect, mock } from 'claude-code/testing'
import { newSave, reconcileSaves, STORE_KEY } from '../hooks/model'
import type { Save } from '../types'

function save(no: number, tick: number, dex: Record<string, number>): Save {
  const s = newSave(tick)
  return { ...s, egg: { ...s.egg, no }, dex, welcomed: true }
}

test('Keeps our own save when it is the furthest along', async () => {
  const own = save(13, 200, { e1: 12 })
  expect(reconcileSaves(own, [save(1, 900, {})])).toBe(null)
})

test('Adopts the other save when its egg number is higher, even with an older tick', async () => {
  const other = save(13, 100, { e1: 12 })
  const got = reconcileSaves(save(1, 900, {}), [other])
  expect(got?.egg.no).toBe(13)
  expect(got?.dex).toEqual({ e1: 12 })
})

test('Same egg number: the later tick wins', async () => {
  const got = reconcileSaves(save(5, 100, {}), [save(5, 300, {})])
  expect(got?.clocks.lastTickAt).toBe(300)
})

test('Dex keeps the highest count of each id across saves', async () => {
  const got = reconcileSaves(save(4, 100, { e1: 3, e2: 1 }), [save(3, 50, { e1: 2, e5: 1 })])
  expect(got?.egg.no).toBe(4)
  expect(got?.dex).toEqual({ e1: 3, e2: 1, e5: 1 })
})

test('Broken or missing saves are ignored', async () => {
  expect(reconcileSaves(undefined, [null, 'x', { version: 2 }])).toBe(null)
  const got = reconcileSaves(undefined, [save(2, 10, { e1: 1 })])
  expect(got?.egg.no).toBe(2)
})

// End to end: the desktop session opens under a new identity and picks up the other store file
const ZH = { TEA_EGG_LANG: 'zh-TW', USERPROFILE: 'C:/u' }
const DIR = 'C:/u/.claude/plugins/store'
const peekPlugin = {
  name: 'peek',
  register: (on: Parameters<Parameters<typeof test>[1]>[1]) => {
    on('command.run', { command: 'peek' }, async $ => {
      const { value } = await $.state.get({ plugin: 'tea-egg', key: 'save' })
      return { text: JSON.stringify(value ?? null) }
    })
  },
}

test('Session start adopts the save from the other store file', { plugins: [peekPlugin] }, async ($, on) => {
  const now = Date.UTC(2026, 9, 14, 2)
  const old = save(13, now - 60_000, { e1: 12 })
  mock.store(on, { [STORE_KEY]: save(1, now - 30_000, {}) })
  mock.clock(on, { now })
  mock.env(on, ZH)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.list', (_, e) => {
    expect(e.path.replaceAll("\\", "/")).toBe(DIR)
    return {
      value: [
        { name: 'tea-egg_inline-abc.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
        { name: 'other-plugin_x.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
      ],
    }
  })
  on('fs.read', (_, e) => {
    expect(e.path.replaceAll("\\", "/")).toBe(`${DIR}/tea-egg_inline-abc.json`)
    return { value: JSON.stringify({ [STORE_KEY]: old }) }
  })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const value = JSON.parse((await $.command.run({ command: 'peek', args: '' })).text!) as Save
  expect(value.egg.no).toBe(13)
  expect(value.dex).toEqual({ e1: 12 })
})
