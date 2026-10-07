import { test, expect } from 'claude-code/testing'
import { decodeSpoilers } from '../hooks/spoilers'
import { isSpecialDay, specialEvent, specialMakeup, specialSeen, specialTurn } from '../hooks/datemode'
import { newSave } from '../hooks/model'
import type { LocalTime } from '../hooks/clock'

const dm = () => decodeSpoilers().dateMode
const pad = (n: number) => String(n).padStart(2, '0')
function day(offset: number, hour: number): LocalTime {
  const d = new Date(Date.UTC(2027, dm().month - 1, dm().day + offset))
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return { date, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour, minute: 0 }
}
const T = Date.UTC(2027, 0, 1)
const first = () => 0

test('特殊日期模式：只在那一天成立', async () => {
  expect(isSpecialDay(day(0, 10))).toBe(true)
  expect(isSpecialDay(day(1, 10))).toBe(false)
  expect(isSpecialDay(day(-1, 23))).toBe(false)
})

test('特殊日期模式：turn 讓顯示用進度增加、原本的蛋不變', async () => {
  const s = newSave(T)
  const r = specialTurn(s, T, day(0, 10), first)
  expect(r.save.egg).toEqual(s.egg)
  expect(r.save.dateMode['2027']!.human).toBe(dm().humanStep)
  expect(r.save.dateMode['2027']!.seen).toBe(true)
})

test('特殊日期模式：同類訊息 10 分鐘內最多一次', async () => {
  let s = newSave(T)
  const a = specialTurn(s, T, day(0, 10), first)
  const b = specialTurn(a.save, T + 5 * 60_000, day(0, 10), first)
  const c = specialTurn(b.save, T + 11 * 60_000, day(0, 10), first)
  expect(a.effects.length).toBe(1)
  expect(b.effects.length).toBe(0)
  expect(c.effects.length).toBe(1)
})

test('特殊日期模式：危險指令只有訊息、蛋不會破', async () => {
  const r = specialEvent(newSave(T), T, day(0, 10), 'danger', first)
  expect(r.save.egg.record.cracked).toBe(null)
  expect(r.effects[0]!.text).toBe(dm().lines.danger[0]!)
})

test('特殊日期模式：揭曉時刻後第一個 turn 解鎖第 9 格，只解鎖一次', async () => {
  const before = specialTurn(newSave(T), T, day(0, dm().revealHour - 1), first)
  expect(before.save.dex[dm().prize]).toBe(undefined)
  const after = specialTurn(before.save, T + 3_600_000, day(0, dm().revealHour), first)
  expect(after.save.dex[dm().prize]).toBe(1)
  expect(after.effects.some(f => f.text === dm().lines.reveal)).toBe(true)
  const again = specialTurn(after.save, T + 7_200_000, day(0, dm().revealHour + 1), first)
  expect(again.save.dex[dm().prize]).toBe(1)
})

test('特殊日期模式：當天有開但沒等到揭曉，隔天第一次開啟補發', async () => {
  const seen = specialSeen(newSave(T), day(0, 9)).save
  const r = specialMakeup(seen, day(1, 9))
  expect(r.save.dex[dm().prize]).toBe(1)
  expect(r.effects[0]!.text).toBe(dm().lines.makeup)
  expect(specialMakeup(r.save, day(1, 10)).effects.length).toBe(0)
})

test('特殊日期模式：當天有開，隔了很久（跨年）才再開也補發', async () => {
  const seen = specialSeen(newSave(T), day(0, 9)).save
  const muchLater: LocalTime = { date: '2028-01-15', year: 2028, month: 1, day: 15, hour: 9, minute: 0 }
  const r = specialMakeup(seen, muchLater)
  expect(r.save.dex[dm().prize]).toBe(1)
  expect(r.effects[0]!.text).toBe(dm().lines.makeup)
})

test('特殊日期模式：當天完全沒開就不補發', async () => {
  const r = specialMakeup(newSave(T), day(1, 9))
  expect(r.save.dex[dm().prize]).toBe(undefined)
})

test('特殊日期模式：每年都可以再得一次', async () => {
  let s = specialTurn(newSave(T), T, day(0, dm().revealHour), first).save
  const nextYear = { ...day(0, dm().revealHour), year: 2028, date: `2028-${pad(dm().month)}-${pad(dm().day)}` }
  s = specialTurn(s, T + 400 * 86_400_000, nextYear, first).save
  expect(s.dex[dm().prize]).toBe(2)
})
