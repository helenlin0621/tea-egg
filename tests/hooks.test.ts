import { test, expect, mock } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
const BASH_OK = { result: { stdout: 'ok', stderr: '', interrupted: false }, isError: false }

type SaveValue = {
  egg: { no: number; progress: number; record: { sessionCount: number } }
  dateMode: Record<string, { human: number }>
}

// 外掛底下沒有核心：測試要自己回答被接線的事件。
// 測試 kit 沒有 mock.state，外掛的 $.state 在這裡不存在（hook 已容忍）；
// 存檔改從自己記的 store.set 讀。
let last: unknown
const saved = (): SaveValue => last as SaveValue
function setup(on: Parameters<Parameters<typeof test>[1]>[1], env: Record<string, string> = {}): void {
  last = undefined
  // 自己記存檔（mock.store 不給測試讀回的口），行為同 mock.store 的 get / set
  const entries = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: entries.get(e.key) }))
  on('store.set', (_, e) => {
    entries.set(e.key, e.value)
    if (e.key === 'tea-egg/v1') last = e.value
    return { value: undefined }
  })
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, env)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
}

test('觀察 Bash：結果原樣回傳、沒有被阻擋', async ($, on) => {
  setup(on)
  on('tool.call', { tool: 'Bash' }, () => BASH_OK)
  await $.session.start(START)
  const ran = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran.deny).toBe(undefined)
  expect(ran.isError).not.toBe(true)
  expect((ran.result as { stdout: string }).stdout).toBe('ok')
})

test('危險指令讓蛋立即出鍋', async ($, on) => {
  setup(on)
  on('tool.call', { tool: 'Bash' }, () => BASH_OK)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  const value = saved()
  expect(value.egg.no).toBe(2)
})

test('subagent 的 turn 不算入味', async ($, on) => {
  setup(on)
  await $.session.start(START)
  const progress = async () => saved().egg.progress
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
  expect(await progress()).toBe(0)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(await progress()).toBe(1)
})

// 「同一 session 不重複計算」靠 $.state 的旗標，測試 kit 無法模擬 $.state，
// 該邏輯由 flow.test.ts 的 onSessionOpen(isNewSession=false) 涵蓋；這裡只確認重複觸發不出錯。
test('重新觸發 session.start 不出錯、存檔仍有效', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await $.session.start(START)
  const value = saved()
  expect(value.egg.record.sessionCount).toBeGreaterThanOrEqual(1)
})

test('/egg 子指令有回覆', async ($, on) => {
  setup(on)
  await $.session.start(START)
  const r = await $.command.run({ command: 'egg', args: 'refill' })
  expect(r.text).toBe('滷汁加滿了！蛋看起來很開心 (•ᴗ•)')
})

test('特殊日期模式：假日期環境變數生效、原本的蛋不動', async ($, on) => {
  const dm = decodeSpoilers().dateMode
  const pad = (n: number) => String(n).padStart(2, '0')
  setup(on, { TEA_EGG_FAKE_DATE: `2027-${pad(dm.month)}-${pad(dm.day)}T10:00` })
  await $.session.start(START)
  const read = async () => saved()
  const before = (await read()).egg
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const after = await read()
  expect(after.egg).toEqual(before)
  expect(after.dateMode['2027']!.human).toBe(dm.humanStep)
})
