import { test, expect, mock } from 'claude-code/testing'

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
const PROPS = {
  title: '茶葉蛋養成計畫',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

test('面板在 terminal 與 desktop 都畫得出來，按鈕可用', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 6) })
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'tea-egg', surface, component: 'Pane', requestId: 'tea-egg', props: PROPS })
    expect(await ui.find({ type: 'Text', text: /小蛋 #1/ })).toBeDefined()
    expect(await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).toBeDefined()
    toasts.length = 0
    await ui.press({ key: 'refill' })
    expect(toasts.some(t => t.includes('滷汁加滿了'))).toBe(true)
    await ui.press({ key: 'dex' })
    expect(await ui.find({ type: 'Text', text: /蛋圖鑑 0\/9/ })).toBeDefined()
    await ui.press({ key: 'dex' })
    await ui.unmount()
  }
})
