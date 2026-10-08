import { test, expect, mock } from 'claude-code/testing'

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
// Pin the language so the zh-TW expectations hold whatever the system locale
const ZH = { TEA_EGG_LANG: 'zh-TW' }
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 5,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
} as const

test('The band renders on both terminal and desktop', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 6) })
  mock.env(on, ZH)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'tea-egg', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: /小蛋 #1/ })).toBeDefined()
    await ui.unmount()
  }
})

test('The × button and /egg band hide the band, and it stays hidden in the next session', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 6) })
  mock.env(on, ZH)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  // The engine's own band: what shows once the egg steps aside
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', children: [] }))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'tea-egg', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /小蛋 #1/ })).toBeUndefined()
  await ui.unmount()
  // A new session reads the flag back from the store
  await $.session.start(START)
  const again = await $.ui.mount({ plugin: 'tea-egg', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await again.find({ type: 'Text', text: /小蛋 #1/ })).toBeUndefined()
  expect((await $.command.run({ command: 'egg', args: 'band' })).text).toBe('已顯示橫條')
  expect(await again.find({ type: 'Text', text: /小蛋 #1/ })).toBeDefined()
  expect((await $.command.run({ command: 'egg', args: 'band' })).text).toContain('已隱藏橫條')
  await again.unmount()
})
