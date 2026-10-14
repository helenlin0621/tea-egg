import { test, expect, mock } from 'claude-code/testing'
import { newSave, STORE_KEY, SYNC_BACKUP_KEY, SYNC_DISMISSED_KEY } from '../hooks/model'
import { compareLines, fingerprint, offerFor, pickOther } from '../hooks/sync'
import { setLang } from '../hooks/i18n'
import type { Save } from '../types'
import { at } from './helpers'

function save(no: number, tick: number, dex: Record<string, number> = {}, progress = 0): Save {
  const s = newSave(tick)
  return { ...s, egg: { ...s.egg, no, progress }, dex, welcomed: true }
}

// ---- Choosing what to offer ----

test('Nothing to offer when the other saves equal ours or are not saves', async () => {
  const own = save(3, 100)
  expect(pickOther(own, [own, undefined, { version: 9 }])).toBe(null)
})

test('Offers a different save even when ours has the later tick: the person decides', async () => {
  const own = save(1, 900)
  const other = save(13, 100, { e1: 12 })
  expect(pickOther(own, [own, other])).toEqual(other)
})

test('Several other saves: offers the furthest along', async () => {
  const got = pickOther(save(1, 1), [save(5, 100), save(7, 50), save(7, 80)])
  expect(got?.egg.no).toBe(7)
  expect(got?.clocks.lastTickAt).toBe(80)
})

test('A declined save is not offered again until it changes', async () => {
  const other = save(13, 100)
  expect(offerFor(save(1, 1), [other], fingerprint(other))).toBe(null)
  const moved = save(13, 160)
  expect(offerFor(save(1, 1), [moved], fingerprint(other))?.save).toEqual(moved)
})

test('The comparison shows both saves', async () => {
  setLang('zh-TW')
  const time = () => at('2026-10-14', 1, 32)
  const lines = compareLines(save(1, 1, {}, 16), save(13, 1, { e1: 12 }, 32.7), time)
  expect(lines[1]).toContain('#1、入味 16%、圖鑑 0 種（0 次），最後遊玩 10/14 01:32')
  expect(lines[2]).toContain('#13、入味 32%、圖鑑 1 種（12 次）')
})

// ---- Through the Mod ----

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
const ENV = { TEA_EGG_LANG: 'zh-TW', USERPROFILE: 'C:/u' }
const DIR = 'C:/u/.claude/plugins/store'
const PERSON = { kind: 'person' } as const
const norm = (p: string) => p.replaceAll('\\', '/')

type On = Parameters<Parameters<typeof test>[1]>[1]
type Store = Record<string, unknown>

// Our store in memory, plus the other identities' files in the store folder (ours is listed too, as on disk)
function setup(on: On, store: Store, others: Record<string, unknown>, toasts: string[]): void {
  mock.clock(on, { now: Date.UTC(2026, 9, 14, 2) })
  mock.env(on, ENV)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('store.get', (_, e) => ({ value: store[(e as { key: string }).key] }))
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store[key] = value
    return { value: undefined }
  })
  const files = () => ({ ...others, 'tea-egg_mine.json': { [STORE_KEY]: store[STORE_KEY] } })
  on('fs.list', (_, e) => {
    expect(norm(e.path)).toBe(DIR)
    return { value: Object.keys(files()).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_, e) => ({ value: JSON.stringify((files() as Record<string, unknown>)[norm(e.path).slice(DIR.length + 1)]) }))
}

const egg = async ($: { command: { run: (i: never) => Promise<{ text?: string }> } }, args: string) =>
  (await $.command.run({ command: 'egg', args, origin: PERSON } as never)).text ?? ''

test('Another save is announced, compared, and copied over ours on yes; ours is backed up', async ($, on) => {
  const toasts: string[] = []
  const mine = save(1, Date.UTC(2026, 9, 14, 1), {}, 16)
  const theirs = save(13, Date.UTC(2026, 9, 13, 17), { e1: 12 }, 32)
  const store: Store = { [STORE_KEY]: mine }
  setup(on, store, { 'tea-egg_inline-1.json': { [STORE_KEY]: theirs } }, toasts)
  await $.session.start(START)
  expect(toasts.some(t => t.includes('/egg sync'))).toBe(true)
  const shown = await egg($, 'sync')
  expect(shown).toContain('#13')
  expect(shown).toContain('/egg sync yes')
  expect(await egg($, 'sync yes')).toContain('已同步')
  expect((store[STORE_KEY] as Save).egg.no).toBe(13)
  expect((store[STORE_KEY] as Save).dex).toEqual({ e1: 12 })
  expect((store[SYNC_BACKUP_KEY] as Save).egg.no).toBe(1)
  expect(await egg($, 'sync')).toContain('沒有其他')
})

test('No keeps ours, remembers the choice, and the other file is never written', async ($, on) => {
  const toasts: string[] = []
  const mine = save(4, Date.UTC(2026, 9, 14, 1))
  const theirs = save(2, Date.UTC(2026, 9, 13, 1))
  const store: Store = { [STORE_KEY]: mine }
  setup(on, store, { 'tea-egg_inline-1.json': { [STORE_KEY]: theirs } }, toasts)
  await $.session.start(START)
  expect(await egg($, 'sync no')).toContain('不同步')
  expect((store[STORE_KEY] as Save).egg.no).toBe(4)
  expect(store[SYNC_DISMISSED_KEY]).toBe(fingerprint(theirs))
  expect(await egg($, 'sync')).toContain('沒有其他')
})

test('Only one save: no announcement', async ($, on) => {
  const toasts: string[] = []
  setup(on, { [STORE_KEY]: save(4, Date.UTC(2026, 9, 14, 1)) }, {}, toasts)
  await $.session.start(START)
  expect(toasts.some(t => t.includes('/egg sync'))).toBe(false)
  expect(await egg($, 'sync')).toContain('沒有其他')
})

const PANE_PROPS = {
  title: '茶葉蛋養成計畫',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

test('The pane shows the comparison with Sync / No buttons on both surfaces, and Sync copies', async ($, on) => {
  const toasts: string[] = []
  const store: Store = { [STORE_KEY]: save(1, Date.UTC(2026, 9, 14, 1)) }
  setup(on, store, { 'tea-egg_inline-1.json': { [STORE_KEY]: save(13, Date.UTC(2026, 9, 13, 17), { e1: 12 }) } }, toasts)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'tea-egg', surface, component: 'Pane', requestId: 'tea-egg', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /發現另一份存檔/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /另一份.*#13/ })).toBeDefined()
    if (surface === 'desktop') {
      await ui.press({ key: 'sync-yes' })
      expect((store[STORE_KEY] as Save).egg.no).toBe(13)
    }
    await ui.unmount()
  }
})
