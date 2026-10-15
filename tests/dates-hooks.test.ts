import { test, expect, mock } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { fill } from '../hooks/text'
import type { ReplyDate, TimedDate } from '../hooks/spoiler-types'

// Special dates through the real hooks: a fake date on the day, a prompt, the band's and the pane's buttons
const ZH = { TEA_EGG_LANG: 'zh-TW' }
const pad = (n: number) => String(n).padStart(2, '0')
const spec = <K extends 'timed' | 'reply'>(kind: K) =>
  Object.values(decodeSpoilers().dates).find(d => d.kind === kind) as Extract<TimedDate | ReplyDate, { kind: K }>
const got = (d: TimedDate, n: number) => fill(d.lines.got, { n: String(n), need: String(d.need) })
const BAND = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} } as const
const PANE = { title: '茶葉蛋養成計畫', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

type On = Parameters<Parameters<typeof test>[1]>[1]

// shared: the store as every session sees it (another session's writes go straight in)
function wire(on: On, fakeDate: string, surfaces: string[], toasts: string[], shared?: Record<string, unknown>) {
  if (shared) {
    on('store.get', (_, e) => ({ value: shared[(e as { key: string }).key] }) as never)
    on('store.set', (_, e) => {
      const { key, value } = e as { key: string; value: unknown }
      shared[key] = value
      return { value: undefined } as never
    })
  } else mock.store(on)
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 1, 2) })
  mock.env(on, { ...ZH, TEA_EGG_FAKE_DATE: fakeDate })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'session-1' }) as never)
  on('session.surfaces', () => ({ value: surfaces }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  return clock
}

test('Timed date: the first prompt starts an ask; the band shows a button with a hotkey that answers it', async ($, on) => {
  const d = spec('timed')
  const toasts: string[] = []
  wire(on, `2026-${pad(d.month)}-${pad(d.day)}T10:00`, ['terminal'], toasts)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'tea-egg', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Button', key: 'date-action' })).toBeUndefined()
  await $.prompt.submit({ text: 'hi' })
  expect(toasts).toContain(d.lines.start.terminal)
  const button = await band.find({ type: 'Button', key: 'date-action' })
  expect(button).toBeDefined()
  expect((button as { props?: { hotkey?: string } }).props?.hotkey).toBe(d.hotkey)
  expect(await band.find({ type: 'Text', text: /^\d:\d\d$/ })).toBeDefined()
  await band.press({ key: 'date-action' })
  expect(toasts).toContain(got(d, 1))
  expect(await band.find({ type: 'Button', key: 'date-action' })).toBeUndefined()
  await band.unmount()
})

test('Timed date: on the pane, Refill becomes the day button', async ($, on) => {
  const d = spec('timed')
  const toasts: string[] = []
  wire(on, `2026-${pad(d.month)}-${pad(d.day)}T10:00`, ['desktop'], toasts)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'hi' })
  expect(toasts).toContain(d.lines.start.desktop)
  const pane = await $.ui.mount({ plugin: 'tea-egg', surface: 'desktop', component: 'Pane', requestId: 'tea-egg', props: PANE })
  const refill = (await pane.find({ type: 'Button', key: 'refill' })) as { props?: { label?: string; hotkey?: string } } | undefined
  expect(refill?.props?.label).toBe(d.paneButton)
  expect(refill?.props?.hotkey).toBe(d.hotkey)
  await pane.press({ key: 'refill' })
  expect(toasts).toContain(got(d, 1))
  await pane.unmount()
})

test('Timed date: an ask started in another session shows up here within seconds, and its timer moves', async ($, on) => {
  const d = spec('timed')
  const shared: Record<string, unknown> = {}
  const clock = wire(on, `2026-${pad(d.month)}-${pad(d.day)}T10:00`, ['terminal'], [], shared)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'tea-egg', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^\d:\d\d$/ })).toBeUndefined()
  // The other session's first prompt of the day: its ask lands in the shared save
  const key = Object.keys(shared).find(k => k.endsWith('-fake'))!
  const save = structuredClone(shared[key]) as { dateMode: Record<string, unknown> }
  const id = Object.entries(decodeSpoilers().dates).find(([, x]) => x.kind === 'timed')![0]
  save.dateMode[`${id}:2026`] = { phase: 'run', startedAt: Date.UTC(2026, 9, 1, 2), from: 'live', got: 0, asks: 1, warned: false }
  shared[key] = save
  // Picked up within FOLLOW_MS, then redrawn every second
  await clock.advance(5_000)
  expect(await band.find({ type: 'Text', text: '4:55' })).toBeDefined()
  await clock.advance(2_000)
  expect(await band.find({ type: 'Text', text: '4:53' })).toBeDefined()
  await band.unmount()
})

test('Reply date: /egg <command> is hidden from help and answers like an unknown command on other days', async ($, on) => {
  const d = spec('reply')
  const toasts: string[] = []
  wire(on, `2027-${pad(d.month)}-${pad(d.day)}T10:00`, ['terminal'], toasts)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hi' })
  // This save never got the earlier prize: nothing opens, and the command is unknown
  expect(toasts).not.toContain(d.lines.open.terminal)
  const unknown = (await $.command.run({ command: 'egg', args: 'nonsense' } as never)).text
  expect((await $.command.run({ command: 'egg', args: d.command } as never)).text).toBe(unknown)
  expect((await $.command.run({ command: 'egg', args: 'help' } as never)).text).not.toContain(d.command)
})
