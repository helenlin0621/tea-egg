import { update, type EngineInterface, type Register, type Timer } from 'claude-code'
import { localTime, parseFakeDate, systemOffset, type ClockConfig, type LocalTime } from './clock'
import { observe, OBSERVED_TOOLS } from './detect'
import { dexTitle, onCommand, onObserved, onSessionOpen, onTick, onTurn } from './flow'
import { FAKE_STORE_KEY, STORE_KEY } from './model'
import { dexArt, eggArt, nextPreview, panelLines, PREVIEW_KEYS, PREVIEW_LABELS, previewArt, SVG_PX, type Art } from './panel'
import { dexText } from './rules'
import { decodeSpoilers } from './spoilers'
import { mutate, type StoreIo } from './store'
import { TEXT } from './text'
import { RASTER_ROWS, SIZE } from './pixels'
import { bandSegments, fitSegments } from './view'

// state refs' plugin / key must be literals, written in this file (the one that uses $.state)
const SAVE_REF = { plugin: 'tea-egg', key: 'save' } as const
const SHOW_DEX_REF = { plugin: 'tea-egg', key: 'showDex' } as const
const COUNTED_REF = { plugin: 'tea-egg', key: 'sessionCounted' } as const
const PREVIEW_REF = { plugin: 'tea-egg', key: 'preview' } as const

export const PANE = 'tea-egg'
const TICK_MS = 60_000
const rng = Math.random

let clock: ClockConfig = { offsetMinutes: systemOffset, fake: null, loadedAt: 0 }
export const localNow = (now: number): LocalTime => localTime(now, clock)
// Sessions nobody is watching (claude -p, SDK scripts, schedules) don't raise the egg; becomes true once a surface attaches
let interactive = false
// Read and write a separate save while a fake date is in effect
const storeKey = () => (clock.fake ? FAKE_STORE_KEY : STORE_KEY)

function commandOf(e: { tool: string }): string {
  const command = (e as { command?: unknown }).command
  return typeof command === 'string' ? command : ''
}

// The loader doesn't follow $ across imports: every $.xxx call is written in this file
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

// Toggle the side pane: shared by /egg and the band button; returns the state after toggling
async function togglePane($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: '茶葉蛋養成計畫' })
  return true
}

// Activate only once per load; keep the timer handle and cancel it before registering again
let tick: Timer | null = null

// On desktop a new session's surface often attaches after the Mod loads, so the attach signal is missed:
// if session.start sees no surface, poll every 3 seconds for up to 10 minutes and activate once one shows up
const WATCH_MS = 3_000
const WATCH_LIMIT = 200
let watch: Timer | null = null

async function hasSurface($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).length > 0
  } catch {
    return false
  }
}

function watchForSurface($: EngineInterface): void {
  watch?.cancel()
  let tries = 0
  watch = $.clock.every(WATCH_MS, () => {
    void (async () => {
      tries++
      if (interactive || tries > WATCH_LIMIT) {
        watch?.cancel()
        watch = null
        return
      }
      if (await hasSurface($)) {
        watch?.cancel()
        watch = null
        await activate($)
      }
    })().catch(() => undefined)
  })
}

async function activate($: EngineInterface): Promise<void> {
  // Claim the slot synchronously so start and attach arriving together don't activate twice
  if (interactive) return
  interactive = true
  try {
    const now = await $.clock.now()
    clock = {
      offsetMinutes: systemOffset,
      fake: parseFakeDate(await $.env.get('TEA_EGG_FAKE_DATE')),
      loadedAt: now,
    }
    const counted = (await $.state.get(COUNTED_REF)).value === true
    await mutate(ioOf($), (s, at) => onSessionOpen(s, at, localNow(at), !counted))
    if (!counted) await $.state.set(COUNTED_REF, true)
    tick?.cancel()
    tick = $.clock.every(TICK_MS, () => {
      void mutate(ioOf($), (s, at) => onTick(s, at, localNow(at), rng)).catch(() => undefined)
    })
  } catch {
    // An egg error must never affect the user
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'egg', description: '茶葉蛋養成計畫：/egg [refill|flip|dex|name 名字|help]' })
      // Activate only if someone is watching: an interactive session, or a surface already attached (a desktop hot reload sends no new attach)
      const seen = e.isInteractive === true || (await hasSurface($))
      if (seen) await activate($)
      else watchForSurface($)
    } catch {
      // An egg error must never affect the user
    }
    return next(e)
  })

  // Desktop (SDK host): no surface at session.start; it connects later
  on('session.attach', async ($, e, next) => {
    try {
      await activate($)
    } catch {
      // Ignore silently
    }
    return next(e)
  })

  // If a surface is attached when the user submits a message, activate here even if earlier signals were missed (so this turn's flavor counts)
  on('prompt.submit', async ($, e, next) => {
    try {
      if (!interactive && (await hasSurface($))) await activate($)
    } catch {
      // Ignore silently
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
      // Ignore silently
    }
    return ran
  })

  // Observe only: always call next(e) and return its result unchanged
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (!interactive) return ran
      const tool = String(e.tool)
      const command = (OBSERVED_TOOLS as readonly string[]).includes(tool) ? commandOf(e) : ''
      const obs = observe(tool, command, ran)
      if (obs !== null) await mutate(ioOf($), (s, at) => onObserved(s, at, localNow(at), obs, rng))
    } catch {
      // Ignore silently
    }
    return ran
  })

  // The band above the prompt; always steps aside on errors or when a survey is showing
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      // The prompt being drawn means a surface is attached; state can't be written during render, so activate on the next tick
      if (!interactive) $.clock.after(0, () => void activate($))
      if (e.props.hasSurvey) return next(e)
      const save = (await $.state.get(SAVE_REF)).value
      if (!save) return next(e)
      const now = await $.clock.now()
      const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 80
      // Reserve 6 columns on the right for the panel button (1 space + 2 full-width chars + margin)
      const segs = fitSegments(bandSegments(save, localNow(now), now), Math.max(10, columns - 6))
      const { Box, Text, Button } = $.ui.resolve(e)
      const onPanel = async () => {
        try {
          await togglePane($)
        } catch {
          // A button error must never affect the user
        }
      }
      return (
        <Box>
          {segs.map((seg, i) => (
            <Text key={String(i)} color={seg.color} dimColor={seg.dim}>{seg.text}</Text>
          ))}
          <Text key="gap"> </Text>
          <Button key="panel" label="面板" plain dimColor onPress={onPanel} />
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
      // Only terminal has Raster; other surfaces only have Svg
      const draw = (art: Art | null, key: string) => {
        if (art === null) return null
        if (art.kind === 'raster' && e.surface === 'terminal') {
          const { Raster } = $.ui.resolve(e)
          return <Raster key={key} columns={SIZE} rows={RASTER_ROWS} cells={art.cells} />
        }
        if (art.kind === 'svg' && e.surface !== 'terminal') {
          const { Svg } = $.ui.resolve(e)
          return <Svg key={key} source={art.source} alt="茶葉蛋" width={SVG_PX} height={SVG_PX} />
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
          // A button error must never affect the user
        }
      }
      const slots = decodeSpoilers().dexSlots
      const preview = (await $.state.get(PREVIEW_REF)).value ?? null
      const art = preview !== null ? previewArt(preview, e.surface, columns) : eggArt(save, t, now, e.surface, columns)
      return (
        <Box flexDirection="column">
          {preview !== null && (
            <Text key="preview" dimColor>
              預覽 {PREVIEW_KEYS.indexOf(preview as (typeof PREVIEW_KEYS)[number]) + 1}/{PREVIEW_KEYS.length}：{PREVIEW_LABELS[preview] ?? preview}（不影響存檔）
            </Text>
          )}
          {draw(art, 'egg')}
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
      // Someone typed /egg by hand, so someone is watching (on desktop the attach signal may come before the Mod loads and be missed)
      if (!interactive && e.origin.kind !== 'plugin') await activate($)
      if (!interactive) return { text: TEXT.help }
      const args = e.args.trim()
      if (args === '') return { text: (await togglePane($)) ? TEXT.paneOpened : TEXT.paneClosed }
      // Dev preview: only switches the displayed sprite; never reads or changes the save
      if (args === 'preview' || args.startsWith('preview ')) {
        const current = (await $.state.get(PREVIEW_REF)).value ?? null
        const chosen = nextPreview(current, args.slice('preview'.length))
        if (chosen === undefined) return { text: `用法：/egg preview [1-${PREVIEW_KEYS.length}|off]` }
        await $.state.set(PREVIEW_REF, chosen)
        if (chosen === null) return { text: '已結束預覽' }
        if (!(await $.ui.panes()).some(p => p.id === PANE)) await $.ui.open({ id: PANE, title: '茶葉蛋養成計畫' })
        const n = PREVIEW_KEYS.indexOf(chosen as (typeof PREVIEW_KEYS)[number]) + 1
        return { text: `預覽 ${n}/${PREVIEW_KEYS.length}：${PREVIEW_LABELS[chosen]}（/egg preview 下一張、/egg preview off 結束）` }
      }
      const step = await mutate(ioOf($), (s, at) => onCommand(s, at, localNow(at), args, rng))
      return { text: step.reply ?? '' }
    } catch {
      return { text: TEXT.error }
    }
  })
}
