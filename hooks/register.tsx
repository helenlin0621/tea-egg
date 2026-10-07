import { update, type EngineInterface, type Register } from 'claude-code'
import { localTime, parseFakeDate, systemOffset, type ClockConfig, type LocalTime } from './clock'
import { observe, OBSERVED_TOOLS } from './detect'
import { dexTitle, onCommand, onObserved, onSessionOpen, onTick, onTurn } from './flow'
import { FAKE_STORE_KEY, STORE_KEY } from './model'
import { dexArt, eggArt, panelLines, type Art } from './panel'
import { dexText } from './rules'
import { decodeSpoilers } from './spoilers'
import { mutate, type StoreIo } from './store'
import { TEXT } from './text'
import { RASTER_ROWS, SIZE } from './pixels'
import { bandSegments, fitSegments } from './view'

// state 參照的 plugin / key 必須是字面值，且寫在使用 $.state 的這個檔案裡
const SAVE_REF = { plugin: 'tea-egg', key: 'save' } as const
const SHOW_DEX_REF = { plugin: 'tea-egg', key: 'showDex' } as const
const COUNTED_REF = { plugin: 'tea-egg', key: 'sessionCounted' } as const

export const PANE = 'tea-egg'
const TICK_MS = 60_000
const rng = Math.random

let clock: ClockConfig = { offsetMinutes: systemOffset, fake: null, loadedAt: 0 }
export const localNow = (now: number): LocalTime => localTime(now, clock)
// 非互動 session（claude -p、SDK、排程）沒有人在看，整個 session 不參與養蛋
let interactive = true
// 假日期生效時讀寫另一份存檔
const storeKey = () => (clock.fake ? FAKE_STORE_KEY : STORE_KEY)

function commandOf(e: { tool: string }): string {
  const command = (e as { command?: unknown }).command
  return typeof command === 'string' ? command : ''
}

// 載入器不跟隨 $ 跨 import：所有 $.xxx 呼叫都寫在這個檔案裡
const ioOf = ($: EngineInterface): StoreIo => ({
  now: () => $.clock.now(),
  read: () => $.store.get(storeKey()),
  write: async save => {
    await $.store.set(storeKey(), save)
    await $.state.set(SAVE_REF, save)
  },
  toast: text => {
    $.ui.toast(text)
  },
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      interactive = e.isInteractive !== false
      await $.command.register({ name: 'egg', description: '茶葉蛋養成計畫：/egg [refill|flip|dex|name 名字|help]' })
      if (!interactive) return next(e)
      const now = await $.clock.now()
      clock = {
        offsetMinutes: systemOffset,
        fake: parseFakeDate(await $.env.get('TEA_EGG_FAKE_DATE')),
        loadedAt: now,
      }
      const counted = (await $.state.get(COUNTED_REF)).value === true
      await mutate(ioOf($), (s, at) => onSessionOpen(s, at, localNow(at), !counted))
      if (!counted) await $.state.set(COUNTED_REF, true)
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
      if (interactive && e.agentId === undefined && e.reason !== 'error') {
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
      if (!interactive) return ran
      const tool = String(e.tool)
      const command = (OBSERVED_TOOLS as readonly string[]).includes(tool) ? commandOf(e) : ''
      const obs = observe(tool, command, ran)
      if (obs !== null) await mutate(ioOf($), (s, at) => onObserved(s, at, localNow(at), obs, rng))
    } catch {
      // 靜默略過
    }
    return ran
  })

  // 輸入框上方的橫條；出錯或有問卷時一律讓路
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey) return next(e)
      const save = (await $.state.get(SAVE_REF)).value
      if (!save) return next(e)
      const now = await $.clock.now()
      const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 80
      const segs = fitSegments(bandSegments(save, localNow(now), now), columns)
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box>
          {segs.map((seg, i) => (
            <Text key={String(i)} color={seg.color} dimColor={seg.dim}>{seg.text}</Text>
          ))}
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    try {
      const { Box, Text, Button } = $.ui.resolve(e)
      const save = (await $.state.get(SAVE_REF)).value
      const showDex = (await $.state.get(SHOW_DEX_REF)).value === true
      if (!save) return <Text dimColor>蛋還在路上…</Text>
      const now = await $.clock.now()
      const t = localNow(now)
      const columns = e.props.bodyColumns ?? e.viewport?.columns ?? SIZE
      // terminal 才有 Raster，其餘 surface 才有 Svg
      const draw = (art: Art | null, key: string) => {
        if (art === null) return null
        if (art.kind === 'raster' && e.surface === 'terminal') {
          const { Raster } = $.ui.resolve(e)
          return <Raster key={key} columns={SIZE} rows={RASTER_ROWS} cells={art.cells} />
        }
        if (art.kind === 'svg' && e.surface !== 'terminal') {
          const { Svg } = $.ui.resolve(e)
          return <Svg key={key} source={art.source} alt="茶葉蛋" />
        }
        return art.kind === 'ascii' ? (
          <Box key={key} flexDirection="column">{art.lines.map((l, i) => <Text key={String(i)}>{l}</Text>)}</Box>
        ) : null
      }
      const press = (args: string) => async () => {
        try {
          const step = await mutate(ioOf($), (s, at) => onCommand(s, at, localNow(at), args, rng))
          if (step.reply) $.ui.toast(step.reply)
        } catch {
          // 按鈕出錯不影響使用者
        }
      }
      const slots = decodeSpoilers().dexSlots
      return (
        <Box flexDirection="column">
          {draw(eggArt(save, t, now, e.surface, columns), 'egg')}
          {panelLines(save, t, now).map((line, i) => <Text key={String(i)}>{line}</Text>)}
          <Box>
            <Button key="refill" label="加滷汁" onPress={press('refill')} />
            <Button key="flip" label="翻面" onPress={press('flip')} />
            <Button key="dex" label="圖鑑" onPress={() => update($, SHOW_DEX_REF, v => !v)} />
          </Box>
          {showDex && <Text>{dexText(save, dexTitle(t))}</Text>}
          {showDex && (
            <Box flexWrap="wrap">
              {slots.map(id => draw(dexArt(id, (save.dex[id] ?? 0) > 0, e.surface), `dex-${id}`))}
            </Box>
          )}
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: 'egg' }, async ($, e) => {
    try {
      // 非互動 session 只回說明，不動存檔
      if (!interactive) return { text: TEXT.help }
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
