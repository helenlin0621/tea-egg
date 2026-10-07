import { test, expect } from 'claude-code/testing'
import { RULES, flip, refill, testObserved, tick, toolFailed, turnDone, pauseClocks } from '../hooks/engine'
import { newSave } from '../hooks/model'
import { outcome } from '../hooks/rules'
import { decodeSpoilers } from '../hooks/spoilers'
import { at, ms } from './helpers'

const MIN = 60_000
const never = () => 0.99

test('每完成一個 turn 入味 +1', async () => {
  const s = newSave(ms('2026-10-07'))
  const r = turnDone(s, ms('2026-10-07'), at('2026-10-07'), never)
  expect(r.save.egg.progress).toBe(1)
  expect(s.egg.progress).toBe(0) // 不修改傳入的存檔
})

test('每日入味上限 15，隔天重置', async () => {
  let s = newSave(ms('2026-10-07'))
  for (let i = 0; i < 30; i++) s = turnDone(s, ms('2026-10-07'), at('2026-10-07'), never).save
  expect(s.egg.progress).toBe(15)
  s = turnDone(s, ms('2026-10-08'), at('2026-10-08'), never).save
  expect(s.egg.progress).toBe(16)
})

test('滷汁每 15 分鐘 -4，只算 session 開著的時間', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  for (let m = 1; m <= 15; m++) s = tick(s, t0 + m * MIN, at('2026-10-07')).save
  expect(s.egg.broth).toBe(96)
  // 關掉 5 小時再開：單次最多只算 3 分鐘
  s = tick(s, t0 + 15 * MIN + 5 * 60 * MIN, at('2026-10-07', 15)).save
  expect(s.egg.broth).toBe(96)
})

test('兩個 session 同一時間 tick 不會重複扣', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  for (let m = 1; m <= 15; m++) {
    s = tick(s, t0 + m * MIN, at('2026-10-07')).save
    s = tick(s, t0 + m * MIN, at('2026-10-07')).save
  }
  expect(s.egg.broth).toBe(96)
})

test('滷汁歸零時 toast 一次，之後入味停止；refill 後恢復', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.broth = 4
  let x = s
  const toasts: string[] = []
  for (let m = 1; m <= 15; m++) {
    const st = tick(x, t0 + m * MIN, at('2026-10-07'))
    x = st.save
    toasts.push(...st.effects.map(f => f.text))
  }
  expect(x.egg.broth).toBe(0)
  expect(toasts.filter(text => text.includes('滷汁乾了')).length).toBe(1)
  const stuck = turnDone(x, t0 + 16 * MIN, at('2026-10-07'), never).save
  expect(stuck.egg.progress).toBe(0)
  const refilled = refill(stuck).save
  expect(refilled.egg.broth).toBe(100)
  expect(refilled.egg.mood >= 70).toBe(true)
  expect(turnDone(refilled, t0 + 17 * MIN, at('2026-10-07'), never).save.egg.progress).toBe(1)
})

test('10 分鐘區間內有活動才 +1', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s = turnDone(s, t0 + MIN, at('2026-10-07'), never).save // +1（turn）
  for (let m = 2; m <= 10; m++) s = tick(s, t0 + m * MIN, at('2026-10-07')).save
  expect(s.egg.progress).toBe(2) // +1（活動區間）
  for (let m = 11; m <= 20; m++) s = tick(s, t0 + m * MIN, at('2026-10-07')).save
  expect(s.egg.progress).toBe(2) // 這個區間沒有 turn
})

test('心情每小時 -5；工具失敗 -3；測試通過 +5', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  for (let m = 1; m <= 60; m++) s = tick(s, t0 + m * MIN, at('2026-10-07')).save
  expect(s.egg.mood).toBe(65)
  expect(toolFailed(s).save.egg.mood).toBe(62)
  const passed = testObserved(s, true).save
  expect(passed.egg.mood).toBe(70)
  expect(passed.egg.record.testRuns).toBe(1)
  const failed = testObserved(s, false).save
  expect(failed.egg.record.testFails).toBe(1)
})

test('累積 90 分鐘活動後想翻身，30 分鐘內翻面 +2 且不受每日上限', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.activeMinutes = RULES.flipAfterMin
  const want = tick(s, t0 + MIN, at('2026-10-07'))
  expect(want.save.egg.flipWantedAt).toBe(t0 + MIN)
  expect(want.effects.some(f => f.text.includes('/egg flip'))).toBe(true)
  const capped = { ...want.save, daily: { date: '2026-10-07', gained: 15 } }
  const flipped = flip(capped, t0 + 10 * MIN, at('2026-10-07')).save
  expect(flipped.egg.progress).toBe(2)
  expect(flipped.egg.flipWantedAt).toBe(null)
})

test('超過 30 分鐘沒翻就算了，沒有懲罰', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.flipWantedAt = t0
  s.egg.mood = 50
  s = tick(s, t0 + 31 * MIN, at('2026-10-07')).save
  expect(s.egg.flipWantedAt).toBe(null)
  const r = flip(s, t0 + 32 * MIN, at('2026-10-07'))
  expect(r.save.egg.progress).toBe(0)
  expect(r.reply).toBe('蛋現在躺得很舒服，還不用翻')
})

test('深夜第一次完成 turn 時 toast 一次', async () => {
  const s = newSave(ms('2026-10-08', 1))
  const a = turnDone(s, ms('2026-10-08', 1), at('2026-10-08', 1), never)
  expect(a.effects.length).toBe(1)
  const b = turnDone(a.save, ms('2026-10-08', 2), at('2026-10-08', 2), never)
  expect(b.effects.length).toBe(0)
})

test('活躍日與最大間隔', async () => {
  let s = newSave(ms('2026-10-01'))
  s = turnDone(s, ms('2026-10-01'), at('2026-10-01'), never).save
  s = turnDone(s, ms('2026-10-04'), at('2026-10-04'), never).save
  s = turnDone(s, ms('2026-10-05'), at('2026-10-05'), never).save
  expect(s.egg.record.activeDays).toEqual(['2026-10-01', '2026-10-04', '2026-10-05'])
  expect(s.egg.record.maxGapDays).toBe(2) // 10-02、10-03 沒開
})

test('間隔天數只算中間沒開的天數：相鄰日為 0', async () => {
  let s = newSave(ms('2026-10-01'))
  s = turnDone(s, ms('2026-10-01'), at('2026-10-01'), never).save
  s = turnDone(s, ms('2026-10-02'), at('2026-10-02'), never).save
  expect(s.egg.record.maxGapDays).toBe(0)
})

test('週末不開不算長間隔，多空一天才算', async () => {
  const rule = decodeSpoilers().rules.find(r => r.when === 'gapAtLeast')!
  const after = (next: string) => {
    let s = newSave(ms('2026-10-09')) // 週五
    s = turnDone(s, ms('2026-10-09'), at('2026-10-09'), never).save
    s = turnDone(s, ms(next), at(next), never).save
    return s.egg
  }
  const monday = after('2026-10-12')
  expect(monday.record.maxGapDays).toBe(2)
  expect(outcome(monday, ms('2026-10-12'), never)).not.toBe(rule.egg)
  const tuesday = after('2026-10-13')
  expect(tuesday.record.maxGapDays).toBe(3)
  expect(outcome(tuesday, ms('2026-10-13'), never)).toBe(rule.egg)
})

test('暫停時只推進時鐘，蛋不變', async () => {
  const t0 = ms('2026-10-07')
  const s = newSave(t0)
  const p = pauseClocks(s, t0 + 60 * MIN).save
  expect(p.clocks.lastTickAt).toBe(t0 + 60 * MIN)
  expect(p.egg).toEqual(s.egg)
})

test('加滷汁提升心情：mood 30 → 70（下限），mood 60 → 80（+20），mood 95 → 100（上限）', async () => {
  const t0 = ms('2026-10-07')

  let s = newSave(t0)
  s.egg.mood = 30
  const r1 = refill(s)
  expect(r1.save.egg.mood).toBe(70)

  s = newSave(t0)
  s.egg.mood = 60
  const r2 = refill(s)
  expect(r2.save.egg.mood).toBe(80)

  s = newSave(t0)
  s.egg.mood = 95
  const r3 = refill(s)
  expect(r3.save.egg.mood).toBe(100)
})

test('翻面在有效期內提升心情 +15', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.mood = 40
  s.egg.flipWantedAt = t0
  const r = flip(s, t0 + 10 * MIN, at('2026-10-07'))
  expect(r.save.egg.mood).toBe(55)
})

test('翻面超過有效期外不改心情', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.mood = 40
  s.egg.flipWantedAt = t0
  s = tick(s, t0 + 31 * MIN, at('2026-10-07')).save
  const r = flip(s, t0 + 32 * MIN, at('2026-10-07'))
  expect(r.save.egg.mood).toBe(40)
})

test('翻面滷汁為 0 時無入味但給心情，用 flipNoGain 回覆', async () => {
  const t0 = ms('2026-10-07')
  let s = newSave(t0)
  s.egg.broth = 0
  s.egg.flipWantedAt = t0
  s.egg.mood = 40
  const r = flip(s, t0 + 10 * MIN, at('2026-10-07'))
  expect(r.save.egg.progress).toBe(0)
  expect(r.save.egg.mood).toBe(55)
  expect(r.reply).toBe('翻好了！(•̀ᴗ•́)↻')
})
