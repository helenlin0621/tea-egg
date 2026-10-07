import type { EngineInterface, Register } from 'claude-code'
import { localTime, parseFakeDate, systemOffset, type ClockConfig, type LocalTime } from './clock'
import { observe, OBSERVED_TOOLS } from './detect'
import { onCommand, onObserved, onSessionOpen, onTick, onTurn } from './flow'
import { STORE_KEY } from './model'
import { COUNTED_REF, SAVE_REF, mutate, type StoreIo } from './store'
import { TEXT } from './text'

export const PANE = 'tea-egg'
const TICK_MS = 60_000
const rng = Math.random

let clock: ClockConfig = { offsetMinutes: systemOffset, fake: null, loadedAt: 0 }
export const localNow = (now: number): LocalTime => localTime(now, clock)

function commandOf(e: { tool: string }): string {
  const command = (e as { command?: unknown }).command
  return typeof command === 'string' ? command : ''
}

// 載入器不跟隨 $ 跨 import：所有 $.xxx 呼叫都寫在這個檔案裡
const ioOf = ($: EngineInterface): StoreIo => ({
  now: () => $.clock.now(),
  read: () => $.store.get(STORE_KEY),
  write: async save => {
    await $.store.set(STORE_KEY, save)
    try {
      await $.state.set(SAVE_REF, save) // 給畫面讀的鏡像；$.store 才是存檔本體，失敗不影響存檔
    } catch {
      // 靜默略過
    }
  },
  toast: text => {
    $.ui.toast(text)
  },
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const now = await $.clock.now()
      clock = {
        offsetMinutes: systemOffset,
        fake: parseFakeDate(await $.env.get('TEA_EGG_FAKE_DATE')),
        loadedAt: now,
      }
      await $.command.register({ name: 'egg', description: '茶葉蛋養成計畫：/egg [refill|flip|dex|name 名字|help]' })
      let counted = false
      try {
        counted = (await $.state.get(COUNTED_REF)).value === true
      } catch {
        // 讀不到就當作還沒算過
      }
      await mutate(ioOf($), (s, at) => onSessionOpen(s, at, localNow(at), !counted))
      if (!counted) {
        try {
          await $.state.set(COUNTED_REF, true)
        } catch {
          // 靜默略過
        }
      }
      $.clock.every(TICK_MS, () => {
        void mutate(ioOf($), (s, at) => onTick(s, at, localNow(at), rng)).catch(() => undefined)
      })
    } catch {
      // 蛋出錯不影響使用者
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (e.agentId === undefined && e.reason !== 'error') {
        await mutate(ioOf($), (s, at) => onTurn(s, at, localNow(at), rng))
      }
    } catch {
      // 靜默略過
    }
    return ran
  })

  // 只觀察：一定呼叫 next(e)，並原樣回傳它的結果
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const tool = String(e.tool)
      const command = (OBSERVED_TOOLS as readonly string[]).includes(tool) ? commandOf(e) : ''
      const obs = observe(tool, command, ran)
      if (obs !== null) await mutate(ioOf($), (s, at) => onObserved(s, at, localNow(at), obs, rng))
    } catch {
      // 靜默略過
    }
    return ran
  })

  on('command.run', { command: 'egg' }, async ($, e) => {
    try {
      const args = e.args.trim()
      if (args === '') {
        const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
        if (isOpen) {
          await $.ui.close({ id: PANE })
          return { text: TEXT.paneClosed }
        }
        await $.ui.open({ id: PANE, title: '茶葉蛋養成計畫' })
        return { text: TEXT.paneOpened }
      }
      const step = await mutate(ioOf($), (s, at) => onCommand(s, at, localNow(at), args, rng))
      return { text: step.reply ?? '' }
    } catch {
      return { text: TEXT.error }
    }
  })
}
