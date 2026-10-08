import { test, expect, mock } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { STORE_KEY, newSave } from '../hooks/model'

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
// 外掛底下沒有核心：測試要自己回答被接線的事件
function base(on: Parameters<Parameters<typeof test>[1]>[1]): void {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
}
const BASH_OK = { result: { stdout: 'ok', stderr: '', interrupted: false }, isError: false }

// 測試的 $ 沒有 $.state（kit 只提供事件呼叫）；用一個內嵌外掛當探針，讀 tea-egg.save（任何外掛都可讀）
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

test('觀察 Bash：結果原樣回傳、沒有被阻擋', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
  base(on)
  on('tool.call', { tool: 'Bash' }, () => BASH_OK)
  await $.session.start(START)
  const ran = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran.deny).toBe(undefined)
  expect(ran.isError).not.toBe(true)
  expect((ran.result as { stdout: string }).stdout).toBe('ok')
})

test('危險指令讓蛋立即出鍋', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
  base(on)
  on('tool.call', { tool: 'Bash' }, () => BASH_OK)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  const value = await saved($)
  expect(value!.egg.no).toBe(2)
})

test('subagent 的 turn 不算入味', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
  base(on)
  await $.session.start(START)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
  expect((await saved($)).egg.progress).toBe(0)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect((await saved($)).egg.progress).toBe(1)
})

test('重新觸發 session.start 不重複計算 session', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
  base(on)
  await $.session.start(START)
  await $.session.start(START)
  expect((await saved($)).egg.record.sessionCount).toBe(1)
})

test('非互動 session 不參與', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
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

test('桌面版：start 時無畫面，之後 attach 才啟用', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
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

test('attach 兩次不重複計算 session', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
  base(on)
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  await $.session.start(HEADLESS)
  await $.session.attach(ATTACH)
  await $.session.attach({ surface: 'desktop', clientId: 'c2' })
  expect((await saved($)).egg.record.sessionCount).toBe(1)
})

test('假日期不動到真實存檔', OPTS, async ($, on) => {
  const real = newSave(Date.UTC(2026, 9, 7, 2))
  real.egg.progress = 42
  mock.store(on, { [STORE_KEY]: real })
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  const dm = decodeSpoilers().dateMode
  mock.env(on, { TEA_EGG_FAKE_DATE: `2026-${String((dm.month % 12) + 1).padStart(2, '0')}-15` }) // 不是特殊日期
  base(on)
  await $.session.start(START)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await saved($)).egg.progress).toBe(1) // 從另一份存檔開始，不是 43
})

test('沒有假日期時讀寫真實存檔', OPTS, async ($, on) => {
  const real = newSave(Date.UTC(2026, 9, 7, 2))
  real.egg.progress = 42
  mock.store(on, { [STORE_KEY]: real })
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
  base(on)
  await $.session.start(START)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await saved($)).egg.progress).toBe(43)
})

test('/egg 子指令有回覆', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
  base(on)
  await $.session.start(START)
  const r = await $.command.run({ command: 'egg', args: 'refill' })
  expect(r.text).toBe('滷汁加滿了！蛋看起來很開心 (•ᴗ•)')
})

test('特殊日期模式：假日期環境變數生效、原本的蛋不動', OPTS, async ($, on) => {
  const dm = decodeSpoilers().dateMode
  const pad = (n: number) => String(n).padStart(2, '0')
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, { TEA_EGG_FAKE_DATE: `2027-${pad(dm.month)}-${pad(dm.day)}T10:00` })
  base(on)
  await $.session.start(START)
  const before = (await saved($)).egg
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const after = (await saved($))
  expect(after.egg).toEqual(before)
  expect(after.dateMode['2027']!.human).toBe(dm.humanStep)
})

const SDK_START = { cwd: '.', surface: null, isInteractive: false } as const

test('桌面版：開場還沒有畫面，畫面晚幾秒接上也會自動啟用', OPTS, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
  base(on)
  let surfaces: string[] = []
  on('session.surfaces', () => ({ value: surfaces }) as never)
  await $.session.start(SDK_START)
  expect(await saved($)).toBe(null)
  surfaces = ['desktop']
  await clock.advance(3_000)
  expect((await saved($)).egg.record.sessionCount).toBe(1)
})

test('沒有任何畫面的 session（-p、腳本）不會啟用', OPTS, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
  base(on)
  on('session.surfaces', () => ({ value: [] }) as never)
  await $.session.start(SDK_START)
  await clock.advance(60_000)
  expect(await saved($)).toBe(null)
})

test('送出訊息時已有畫面就啟用，這一輪照樣入味', OPTS, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 2) })
  mock.env(on, {})
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
