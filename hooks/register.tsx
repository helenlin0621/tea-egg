import { update, type EngineInterface, type Register, type Timer } from 'claude-code'
import { localTime, parseFakeDate, systemOffset, type ClockConfig, type LocalTime } from './clock'
import { observe, OBSERVED_TOOLS } from './detect'
import { dexTitle, onCommand, onObserved, onSessionOpen, onTick, onTurn } from './flow'
import { BAND_STORE_KEY, FAKE_STORE_KEY, STORE_KEY, SYNC_DISMISSED_KEY } from './model'
import { compareLines, offerFor, type SyncOffer } from './sync'
import { dexArt, eggArt, nextPreview, panelLines, PREVIEW_KEYS, PREVIEW_LABELS, previewArt, SVG_PX, type Art } from './panel'
import { dexCaption, dexHeader } from './rules'
import { decodeSpoilers } from './spoilers'
import { mutate, type StoreIo } from './store'
import { parseUse, usePrompt, useStale, useTurn, type SessionUse, type UseStep, type Wait } from './usage'
import type { Step } from './engine'
import type { Save } from '../types'
import { detectLang, setLang } from './i18n'
import { T, fill } from './text'
import { RASTER_ROWS, SIZE } from './pixels'
import { bandSegments, fitSegments, strWidth } from './view'

// state refs' plugin / key must be literals, written in this file (the one that uses $.state)
const SAVE_REF = { plugin: 'tea-egg', key: 'save' } as const
const SHOW_DEX_REF = { plugin: 'tea-egg', key: 'showDex' } as const
const COUNTED_REF = { plugin: 'tea-egg', key: 'sessionCounted' } as const
const PREVIEW_REF = { plugin: 'tea-egg', key: 'preview' } as const
const BAND_REF = { plugin: 'tea-egg', key: 'bandHidden' } as const
const SYNC_REF = { plugin: 'tea-egg', key: 'syncOffer' } as const
const SYNC_CONFIRM_REF = { plugin: 'tea-egg', key: 'syncConfirming' } as const

export const PANE = 'tea-egg'
const TICK_MS = 60_000
const rng = Math.random

let clock: ClockConfig = { offsetMinutes: systemOffset, fake: null, loadedAt: 0 }
export const localNow = (now: number): LocalTime => localTime(now, clock)
// Sessions nobody is watching (claude -p, SDK scripts, schedules) don't raise the egg; becomes true once a surface attaches
let interactive = false
// Read and write a separate save while a fake date is in effect
const storeKey = () => (clock.fake ? FAKE_STORE_KEY : STORE_KEY)

// "Preview n/total: label" in the current language
function previewText(template: string, key: string): string {
  const n = PREVIEW_KEYS.indexOf(key) + 1
  return fill(template, { n: String(n), total: String(PREVIEW_KEYS.length), label: PREVIEW_LABELS[key] ?? key })
}

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

// Time spent waiting for the person within the current turn (usage.ts leaves it out). A permission prompt counts
// from when it is shown until its tool call ends (a command run after approval rides along, usually seconds);
// these tools wait for an answer the whole time they run
const WAIT_TOOLS = ['AskUserQuestion', 'ExitPlanMode'] as const
let askedAt: number | null = null
let waits: Wait[] = []

// Each session's usage record (usage.ts) sits under its own key, so sessions never overwrite each other's
const usePrefix = () => `${storeKey()}/session/`

async function sessionIdOf($: EngineInterface): Promise<string | null> {
  try {
    return await $.session.id()
  } catch {
    return null
  }
}

// Update this session's usage record and the save together; without a session id, run the rest alone
async function withUse(
  $: EngineInterface,
  track: (s: Save, use: SessionUse, at: number, t: LocalTime, tag: string) => UseStep,
  rest: (s: Save, at: number) => Step = s => ({ save: s, effects: [] }),
): Promise<void> {
  const id = await sessionIdOf($)
  if (id === null) {
    await mutate(ioOf($), rest)
    return
  }
  const key = usePrefix() + id
  const tag = id.slice(0, 8) // enough to tell sessions apart in the save
  let use = parseUse(await $.store.get(key))
  await mutate(ioOf($), (s, at) => {
    const r = track(s, use, at, localNow(at), tag)
    use = r.use
    const step = rest(r.save, at)
    return { ...step, effects: [...r.effects, ...step.effects] }
  })
  await $.store.set(key, use)
}

// Drop usage records of sessions unused for a long time so the store doesn't grow forever
async function pruneUse($: EngineInterface, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    if (!key.startsWith(usePrefix())) continue
    if (useStale(parseUse(await $.store.get(key)), now)) await $.store.delete(key)
  }
}

// Toggle the side pane: shared by /egg and the band button; returns the state after toggling
async function togglePane($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: T().title })
  return true
}

// The band's hidden flag lives in the store (kept across sessions); state mirrors it so render can read it
async function loadBand($: EngineInterface): Promise<void> {
  try {
    await $.state.set(BAND_REF, (await $.store.get(BAND_STORE_KEY)) === true)
  } catch {
    // Show the band when the flag can't be read
  }
}

// Flip the band's hidden flag; returns whether it is hidden now
async function toggleBand($: EngineInterface): Promise<boolean> {
  const hidden = (await $.state.get(BAND_REF)).value !== true
  await $.store.set(BAND_STORE_KEY, hidden)
  await $.state.set(BAND_REF, hidden)
  return hidden
}

// Claude keeps one store file per load identity (tea-egg@<marketplace> installed, tea-egg@inline by --plugin-dir).
// This load only writes its own save; the other tea-egg store files are read so the person can choose to copy one over.
const STORE_FILE = /^tea-egg_.+\.json$/

// The real saves in every tea-egg store file (ours included; pickOther skips the one equal to ours)
async function storeFileSaves($: EngineInterface): Promise<unknown[]> {
  try {
    const configDir =
      (await $.env.get('CLAUDE_CONFIG_DIR')) ??
      `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''}/.claude`
    const dir = `${configDir}/plugins/store`
    const saves: unknown[] = []
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !STORE_FILE.test(entry.name)) continue
      try {
        saves.push((JSON.parse((await $.fs.read(`${dir}/${entry.name}`)) as string) as Record<string, unknown>)[STORE_KEY])
      } catch {
        // A file mid-write or unreadable is skipped
      }
    }
    return saves
  } catch {
    return []
  }
}

// Look for another save to offer; shows the offer in state and toasts once when there is one
async function findSyncOffer($: EngineInterface, announce: boolean): Promise<SyncOffer | null> {
  if (clock.fake) return null
  const offer = offerFor(await $.store.get(STORE_KEY), await storeFileSaves($), await $.store.get(SYNC_DISMISSED_KEY))
  await $.state.set(SYNC_REF, offer)
  if (offer && announce) $.ui.toast(T().sync.found)
  return offer
}

const currentOffer = async ($: EngineInterface): Promise<SyncOffer | null> =>
  (await $.state.get(SYNC_REF)).value ?? (await findSyncOffer($, false))

// Step 1 of syncing: the person chose Sync; ask them to confirm the overwrite. false when there is nothing to copy
async function askSync($: EngineInterface): Promise<boolean> {
  if (!(await currentOffer($))) return false
  await $.state.set(SYNC_CONFIRM_REF, true)
  return true
}

// Step 2: overwrite ours with the offered save, no backup (the person confirmed it can't be undone)
async function confirmSync($: EngineInterface): Promise<'done' | 'ask-first' | 'nothing'> {
  if ((await $.state.get(SYNC_CONFIRM_REF)).value !== true) return 'ask-first'
  await $.state.set(SYNC_CONFIRM_REF, false)
  const offer = await currentOffer($)
  if (!offer) return 'nothing'
  await mutate(ioOf($), () => ({ save: offer.save, effects: [] }))
  await $.state.set(SYNC_REF, null)
  return 'done'
}

// Back out of the confirmation; the offer stays, so it is not a "No"
async function cancelSync($: EngineInterface): Promise<void> {
  await $.state.set(SYNC_CONFIRM_REF, false)
}

// Keep ours and don't ask again until the other save changes; false when there was nothing to decline
async function declineSync($: EngineInterface): Promise<boolean> {
  await $.state.set(SYNC_CONFIRM_REF, false)
  const offer = await currentOffer($)
  if (!offer) return false
  await $.store.set(SYNC_DISMISSED_KEY, offer.fingerprint)
  await $.state.set(SYNC_REF, null)
  return true
}

const confirmReply = (r: 'done' | 'ask-first' | 'nothing') =>
  r === 'done' ? T().sync.accepted : r === 'ask-first' ? T().sync.confirmFirst : T().sync.nothing

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
    // Also decided here in case this load never saw session.start
    setLang(detectLang(await $.env.get('TEA_EGG_LANG')))
    const now = await $.clock.now()
    clock = {
      offsetMinutes: systemOffset,
      fake: parseFakeDate(await $.env.get('TEA_EGG_FAKE_DATE')),
      loadedAt: now,
    }
    try {
      await findSyncOffer($, true)
    } catch {
      // No offer when the other saves can't be read
    }
    const counted = (await $.state.get(COUNTED_REF)).value === true
    await mutate(ioOf($), (s, at) => onSessionOpen(s, at, localNow(at), !counted))
    if (!counted) await $.state.set(COUNTED_REF, true)
    await pruneUse($, now).catch(() => undefined)
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
      // Pick the language first: the command description below is already localized.
      // A failed env read must not stop /egg from being registered, so fall back to the locale.
      let envLang: string | undefined
      try {
        envLang = await $.env.get('TEA_EGG_LANG')
      } catch {
        envLang = undefined
      }
      setLang(detectLang(envLang))
      await $.command.register({ name: 'egg', description: T().commandDescription })
      await loadBand($)
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
      if (interactive) await withUse($, usePrompt)
    } catch {
      // Ignore silently
    }
    return next(e)
  })

  // A permission prompt is about to be shown: the wait runs until that tool call ends
  on('classic.PermissionRequest', async ($, e, next) => {
    try {
      if (interactive) askedAt = await $.clock.now()
    } catch {
      // Ignore silently
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (interactive && e.agentId === undefined && e.reason !== 'error') {
        const turnWaits = waits
        waits = []
        await withUse($, (s, use, at, t, tag) => useTurn(s, use, at, t, tag, turnWaits), (s, at) => onTurn(s, at, localNow(at), rng))
      }
    } catch {
      // Ignore silently
    }
    return ran
  })

  // Observe only: always call next(e) and return its result unchanged
  on('tool.call', async ($, e, next) => {
    let started: number | null = null
    try {
      if (interactive) started = await $.clock.now()
    } catch {
      // Ignore silently
    }
    const ran = await next(e)
    try {
      if (!interactive) return ran
      const tool = String(e.tool)
      // Waiting for the person: a tool that asks them, or a permission prompt raised during this call
      const ended = await $.clock.now()
      const asked = askedAt !== null && started !== null && askedAt >= started ? askedAt : null
      if (asked !== null) askedAt = null
      const from = (WAIT_TOOLS as readonly string[]).includes(tool) ? started : asked
      if (from !== null && ended > from) waits.push([from, ended])
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
      if ((await $.state.get(BAND_REF)).value === true) return next(e)
      const save = (await $.state.get(SAVE_REF)).value
      if (!save) return next(e)
      const now = await $.clock.now()
      const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 80
      // Reserve room on the right for the panel and × buttons (1 space + label + 1 space + × + 1 column of margin)
      const reserve = strWidth(T().buttons.panel) + 4
      const segs = fitSegments(bandSegments(save, localNow(now), now), Math.max(10, columns - reserve))
      const { Box, Text, Button } = $.ui.resolve(e)
      const onPanel = async () => {
        try {
          await togglePane($)
        } catch {
          // A button error must never affect the user
        }
      }
      const onHide = async () => {
        try {
          if (await toggleBand($)) $.ui.toast(T().bandHidden)
        } catch {
          // A button error must never affect the user
        }
      }
      return (
        // Stats on the left; the panel and × buttons pinned to the right edge
        <Box justifyContent="space-between" width="100%">
          <Box key="stats">
            {segs.map((seg, i) => (
              <Text key={String(i)} color={seg.color} dimColor={seg.dim}>{seg.text}</Text>
            ))}
          </Box>
          <Box key="actions">
            <Text key="gap"> </Text>
            <Button key="panel" label={T().buttons.panel} plain dimColor onPress={onPanel} />
            <Text key="gap2"> </Text>
            <Button key="hide" label="×" plain dimColor onPress={onHide} />
          </Box>
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
      const bandHidden = (await $.state.get(BAND_REF)).value === true
      if (!save) return <Text dimColor>{T().waiting}</Text>
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
          return <Svg key={key} source={art.source} alt={T().eggAlt} width={SVG_PX} height={SVG_PX} />
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
      const syncPress = (choice: 'yes' | 'no' | 'overwrite' | 'cancel') => async () => {
        try {
          if (choice === 'yes') {
            if (!(await askSync($))) $.ui.toast(T().sync.nothing)
          } else if (choice === 'overwrite') $.ui.toast(confirmReply(await confirmSync($)))
          else if (choice === 'cancel') await cancelSync($)
          else $.ui.toast((await declineSync($)) ? T().sync.declined : T().sync.nothing)
        } catch {
          // A button error must never affect the user
        }
      }
      const offer = (await $.state.get(SYNC_REF)).value ?? null
      const confirming = (await $.state.get(SYNC_CONFIRM_REF)).value === true
      const slots = decodeSpoilers().dexSlots
      const preview = (await $.state.get(PREVIEW_REF)).value ?? null
      const art = preview !== null ? previewArt(preview, e.surface, columns) : eggArt(save, t, now, e.surface, columns)
      return (
        <Box flexDirection="column">
          {preview !== null && (
            <Text key="preview" dimColor>
              {previewText(T().previewBanner, preview)}
            </Text>
          )}
          {offer !== null && (
            <Box key="sync" flexDirection="column" marginBottom={1}>
              {compareLines(save, offer.save, localNow).map((line, i) => (
                <Text key={`sync-line-${i}`} color={i === 0 ? 'yellow' : undefined}>{line}</Text>
              ))}
              {confirming ? (
                <Box key="sync-confirm" flexDirection="column">
                  <Text key="sync-confirm-text" color="red">{T().sync.confirm}</Text>
                  <Box key="sync-confirm-buttons">
                    <Button key="sync-overwrite" label={T().sync.overwrite} onPress={syncPress('overwrite')} />
                    <Button key="sync-cancel" label={T().sync.cancel} onPress={syncPress('cancel')} />
                  </Box>
                </Box>
              ) : (
                <Box key="sync-buttons">
                  <Button key="sync-yes" label={T().sync.yes} onPress={syncPress('yes')} />
                  <Button key="sync-no" label={T().sync.no} onPress={syncPress('no')} />
                </Box>
              )}
            </Box>
          )}
          {draw(art, 'egg')}
          {panelLines(save, t, now).map((line, i) => <Text key={String(i)}>{line}</Text>)}
          <Box>
            <Button key="refill" label={T().buttons.refill} onPress={press('refill')} />
            <Button key="flip" label={T().buttons.flip} onPress={press('flip')} />
            <Button key="dex" label={T().buttons.dex} onPress={() => update($, SHOW_DEX_REF, v => !v)} />
            <Button
              key="band"
              label={bandHidden ? T().buttons.showBand : T().buttons.hideBand}
              onPress={async () => {
                try {
                  await toggleBand($)
                } catch {
                  // A button error must never affect the user
                }
              }}
            />
          </Box>
          {showDex && <Text>{dexHeader(save, dexTitle(t))}</Text>}
          {showDex && (
            <Box flexWrap="wrap">
              {slots.map(id => {
                const cap = dexCaption(save, id)
                const owned = (save.dex[id] ?? 0) > 0
                return (
                  <Box key={`dex-${id}`} flexDirection="column" alignItems="center" marginRight={1}>
                    {draw(dexArt(id, owned, e.surface), `dex-art-${id}`)}
                    <Text key={`dex-name-${id}`} dimColor={!owned}>{cap.name}</Text>
                    <Text key={`dex-count-${id}`} dimColor>{cap.count}</Text>
                  </Box>
                )
              })}
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
      if (!interactive) return { text: T().help }
      const args = e.args.trim()
      if (args === '') return { text: (await togglePane($)) ? T().paneOpened : T().paneClosed }
      if (args === 'band') return { text: (await toggleBand($)) ? T().bandHidden : T().bandShown }
      // Another load identity's save: compare, copy it over ours, or keep ours
      if (args === 'sync yes') {
        if (!(await askSync($))) return { text: T().sync.nothing }
        return { text: [T().sync.confirm, T().sync.confirmUsage].join('\n') }
      }
      if (args === 'sync confirm') return { text: confirmReply(await confirmSync($)) }
      if (args === 'sync cancel') {
        await cancelSync($)
        return { text: T().sync.cancelled }
      }
      if (args === 'sync no') return { text: (await declineSync($)) ? T().sync.declined : T().sync.nothing }
      if (args === 'sync') {
        // Always look again: the other save may have moved on since this session started
        const offer = await findSyncOffer($, false)
        if (!offer) return { text: T().sync.nothing }
        const lines = compareLines(await $.store.get(STORE_KEY), offer.save, localNow)
        return { text: [...lines, T().sync.usage].join('\n') }
      }
      // Dev preview: only switches the displayed sprite; never reads or changes the save
      if (args === 'preview' || args.startsWith('preview ')) {
        const current = (await $.state.get(PREVIEW_REF)).value ?? null
        const chosen = nextPreview(current, args.slice('preview'.length))
        if (chosen === undefined) return { text: fill(T().previewUsage, { total: String(PREVIEW_KEYS.length) }) }
        await $.state.set(PREVIEW_REF, chosen)
        if (chosen === null) return { text: T().previewOff }
        if (!(await $.ui.panes()).some(p => p.id === PANE)) await $.ui.open({ id: PANE, title: T().title })
        return { text: previewText(T().previewReply, chosen) }
      }
      const step = await mutate(ioOf($), (s, at) => onCommand(s, at, localNow(at), args, rng))
      return { text: step.reply ?? '' }
    } catch {
      return { text: T().error }
    }
  })
}
