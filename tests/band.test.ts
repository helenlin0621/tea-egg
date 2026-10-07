import { test, expect, mock } from 'claude-code/testing'

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 5,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
} as const

test('橫條在 terminal 與 desktop 都畫得出來', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 6) })
  mock.env(on, {})
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
