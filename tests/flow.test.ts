import { test, expect } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { onCommand, onObserved, onSessionOpen, onTick, onTurn } from '../hooks/flow'
import { newSave } from '../hooks/model'
import { at, ms } from './helpers'
import type { LocalTime } from '../hooks/clock'

const never = () => 0.99
const dm = () => decodeSpoilers().dateMode
const pad = (n: number) => String(n).padStart(2, '0')
const special = (hour = 10): LocalTime => at(`2027-${pad(dm().month)}-${pad(dm().day)}`, hour)

test('Welcome only on the first open', async () => {
  const a = onSessionOpen(newSave(1), 1, at('2026-10-07'), true)
  expect(a.effects[0]!.text.startsWith('🥚 你領到了第一顆蛋')).toBe(true)
  expect(onSessionOpen(a.save, 2, at('2026-10-07'), true).effects.length).toBe(0)
})

test('Reloading the same session does not count the session twice', async () => {
  const a = onSessionOpen(newSave(1), 1, at('2026-10-07'), true).save
  const b = onSessionOpen(a, 2, at('2026-10-07'), false).save
  expect(b.egg.record.sessionCount).toBe(1)
  expect(b.egg.record.activeDays).toEqual(['2026-10-07'])
})

test('Opening a session resets the active bucket', async () => {
  const s = newSave(1)
  s.clocks.bucketStart = 1
  s.clocks.bucketActive = true
  const r = onSessionOpen(s, 5_000_000, at('2026-10-07'), true).save
  expect(r.clocks.bucketStart).toBe(5_000_000)
  expect(r.clocks.bucketActive).toBe(false)
})

test('A turn that brings flavor to 100 harvests the egg', async () => {
  const s = newSave(ms('2026-10-07'))
  s.egg.progress = 99
  const r = onTurn(s, ms('2026-10-07'), at('2026-10-07'), never)
  expect(r.save.egg.no).toBe(2)
  expect(r.effects.some(f => f.text.startsWith('🎉 出鍋了'))).toBe(true)
})

test('A dangerous command cracks the egg', async () => {
  const r = onObserved(newSave(1), 1, at('2026-10-07'), { failed: false, test: null, danger: 'rm -rf' }, never)
  expect(r.save.dex[decodeSpoilers().rules[0]!.egg]).toBe(1)
})

test('Special-date mode: the real egg stats stay exactly the same', async () => {
  const s = newSave(ms('2026-10-07'))
  s.egg.progress = 40
  s.egg.broth = 50
  let x = onSessionOpen(s, 10, special(), true).save
  x = onTick(x, 10 + 60_000, special(), never).save
  x = onTurn(x, 10 + 120_000, special(), never).save
  x = onObserved(x, 10 + 180_000, special(), { failed: true, test: 'fail', danger: 'rm -rf' }, never).save
  expect(x.egg).toEqual(s.egg)
})

test('Special-date mode: command replies and the dex title change', async () => {
  expect(onCommand(newSave(1), 1, special(), 'refill', never).reply).toBe(dm().replies.refill)
  expect(onCommand(newSave(1), 1, special(), 'flip', never).reply).toBe(dm().replies.flip)
  expect(onCommand(newSave(1), 1, special(), 'dex', never).reply!.includes(dm().dexTitle)).toBe(true)
})

test('The day after the special date it resumes automatically from where the egg paused', async () => {
  const s = newSave(ms('2026-10-07'))
  s.egg.progress = 40
  const next = at(`2027-${pad(dm().month)}-${pad(dm().day + 1)}`)
  const r = onTurn(s, 5, next, never)
  expect(r.save.egg.progress).toBe(41)
})

test('Regular commands', async () => {
  const s = newSave(1)
  expect(onCommand(s, 1, at('2026-10-07'), 'refill', never).save.egg.broth).toBe(100)
  expect(onCommand(s, 1, at('2026-10-07'), 'name 阿滷', never).save.egg.name).toBe('阿滷')
  expect(onCommand(s, 1, at('2026-10-07'), 'name', never).reply).toBe('用法：/egg name <名字>（最多 12 個字）')
  expect(onCommand(s, 1, at('2026-10-07'), 'name 一二三四五六七八九十壹貳參', never).save.egg.name).toBe('小蛋')
  expect(onCommand(s, 1, at('2026-10-07'), 'help', never).reply!.includes('/egg refill')).toBe(true)
  expect(onCommand(s, 1, at('2026-10-07'), 'dex', never).reply!.startsWith(' 蛋圖鑑 0/9')).toBe(true)
  expect(onCommand(s, 1, at('2026-10-07'), 'xyz', never).reply).toBe('不認得這個指令，輸入 /egg help 看看')
})
