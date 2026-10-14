import { test, expect, mock } from 'claude-code/testing'
import { detectLang, lang, setLang } from '../hooks/i18n'
import { decodeSpoilers } from '../hooks/spoilers'
import { onCommand, onSessionOpen } from '../hooks/flow'
import { newSave } from '../hooks/model'
import { panelLines } from '../hooks/panel'
import { settle } from '../hooks/rules'
import { bandSegments, fitSegments, strWidth } from '../hooks/view'
import { at, ms } from './helpers'
import type { LocalTime } from '../hooks/clock'

const never = () => 0.99
const NOW = ms('2026-10-07', 14)
const text = (segs: { text: string }[]) => segs.map(s => s.text).join('')
const pad = (n: number) => String(n).padStart(2, '0')
const special = (): LocalTime => {
  const dm = decodeSpoilers().dateMode
  return at(`2027-${pad(dm.month)}-${pad(dm.day)}`)
}

// Run in English, always switching back so the zh-TW default holds for every other test
async function inEnglish(fn: () => void | Promise<void>): Promise<void> {
  setLang('en')
  try {
    await fn()
  } finally {
    setLang('zh-TW')
  }
}

test('detectLang: the env var wins over the system locale', async () => {
  expect(detectLang('en', 'zh-TW')).toBe('en')
  expect(detectLang('zh-TW', 'en-US')).toBe('zh-TW')
  expect(detectLang(' EN ', 'zh-TW')).toBe('en')
  expect(detectLang('zh', 'en-US')).toBe('zh-TW')
})

test('detectLang: Chinese locales map to zh-TW, everything else to en', async () => {
  expect(detectLang(undefined, 'zh-Hant')).toBe('zh-TW')
  expect(detectLang(undefined, 'zh-TW')).toBe('zh-TW')
  expect(detectLang(undefined, 'zh-CN')).toBe('zh-TW')
  expect(detectLang(undefined, 'en-US')).toBe('en')
  expect(detectLang(undefined, 'ja')).toBe('en')
  expect(detectLang('', 'ja-JP')).toBe('en')
  expect(detectLang('fr', 'zh-TW')).toBe('zh-TW') // unknown env value: fall back to the locale
})

test('The default language is zh-TW', async () => {
  expect(lang()).toBe('zh-TW')
})

test('English: welcome, help and refill reply', async () => {
  await inEnglish(() => {
    const open = onSessionOpen(newSave(1), 1, at('2026-10-07'), true)
    expect(open.effects[0]!.text.startsWith('🥚 You got your first egg!')).toBe(true)
    const help = onCommand(newSave(1), 1, at('2026-10-07'), 'help', never).reply!
    expect(help.includes('/egg refill')).toBe(true)
    expect(help.includes('Top up the broth')).toBe(true)
    expect(onCommand(newSave(1), 1, at('2026-10-07'), 'refill', never).reply).toBe('Broth topped up! The egg looks happy (•ᴗ•)')
    expect(onCommand(newSave(1), 1, at('2026-10-07'), 'xyz', never).reply).toBe('Unknown command. Try /egg help')
  })
})

test('English: a new egg is named Eggy; an existing name is kept', async () => {
  await inEnglish(() => {
    expect(newSave(1).egg.name).toBe('Eggy')
  })
  expect(newSave(1).egg.name).toBe('小蛋')
})

test('English: the band uses English labels and fits in 80 columns', async () => {
  await inEnglish(() => {
    const s = newSave(NOW)
    s.egg.progress = 62
    s.egg.broth = 60
    s.egg.no = 3
    const line = text(bandSegments(s, at('2026-10-07', 14), NOW))
    expect(line.includes('Eggy #3')).toBe(true)
    expect(line.includes('Flavor ██████░░░░ 62%')).toBe(true)
    expect(line.includes('Broth ███░░')).toBe(true)
    // 80 columns minus the panel button: name, flavor and broth all stay
    const fitted = text(fitSegments(bandSegments(s, at('2026-10-07', 14), NOW), 80 - 7))
    expect(fitted.includes('Broth ███░░')).toBe(true)
    s.egg.broth = 20
    const low = text(fitSegments(bandSegments(s, at('2026-10-07', 14), NOW), 80 - 7))
    expect(low.includes('Broth is low')).toBe(true)
    expect(strWidth(low) <= 80 - 7).toBe(true)
  })
})

test('English: panel stat labels', async () => {
  await inEnglish(() => {
    const lines = panelLines(newSave(NOW), at('2026-10-07', 14), NOW).join('\n')
    expect(lines.includes('Flavor')).toBe(true)
    expect(lines.includes('Broth')).toBe(true)
    expect(lines.includes('Mood')).toBe(true)
  })
})

test('English: dex title', async () => {
  await inEnglish(() => {
    expect(onCommand(newSave(1), 1, at('2026-10-07'), 'dex', never).reply!.startsWith(' Eggdex 0/9')).toBe(true)
  })
})

test('English: the harvest toast uses the English egg name', async () => {
  await inEnglish(() => {
    const s = newSave(NOW)
    s.egg.progress = 100
    const r = settle({ save: s, effects: [] }, NOW, never)
    const id = Object.keys(r.save.dex)[0]!
    const en = decodeSpoilers('en').eggs[id]!.name
    expect(en).not.toBe(decodeSpoilers('zh-TW').eggs[id]!.name)
    expect(r.effects[0]!.text.startsWith('🎉 Done marinating!')).toBe(true)
    expect(r.effects[0]!.text.includes(en)).toBe(true)
    expect(r.save.egg.name).toBe('Eggy')
  })
})

test('English: spoiler text is translated; structure and numbers are shared', async () => {
  const zh = decodeSpoilers('zh-TW')
  const en = decodeSpoilers('en')
  expect(en).toBe(decodeSpoilers('en'))
  expect(zh).toBe(decodeSpoilers())
  expect(en.rules).toEqual(zh.rules)
  expect(en.dexSlots).toEqual(zh.dexSlots)
  expect(en.dateMode.month).toBe(zh.dateMode.month)
  expect(en.dateMode.prize).toBe(zh.dateMode.prize)
  expect(Object.keys(en.eggs).sort()).toEqual(Object.keys(zh.eggs).sort())
  for (const id of Object.keys(zh.eggs)) expect(en.eggs[id]!.icon).toBe(zh.eggs[id]!.icon)
  expect(Object.keys(en.hints).sort()).toEqual(Object.keys(zh.hints).sort())
  expect(en.dateMode.band.hints.length).toBe(zh.dateMode.band.hints.length)
  expect(en.dateMode.lines.turn.length).toBe(zh.dateMode.lines.turn.length)
  expect(en.crackToast).not.toBe(zh.crackToast)
  expect(en.crackToast.includes('{kw}')).toBe(true)
  expect((en as { i18n?: unknown }).i18n).toBe(undefined)
})

test('English: special-date mode replies come from the English spoiler text', async () => {
  await inEnglish(() => {
    const dm = decodeSpoilers('en').dateMode
    expect(dm.replies.refill).not.toBe(decodeSpoilers('zh-TW').dateMode.replies.refill)
    expect(onCommand(newSave(1), 1, special(), 'refill', never).reply).toBe(dm.replies.refill)
    expect(onCommand(newSave(1), 1, special(), 'flip', never).reply).toBe(dm.replies.flip)
    expect(onCommand(newSave(1), 1, special(), 'dex', never).reply!.includes(dm.dexTitle)).toBe(true)
    expect(text(bandSegments(newSave(1), special(), 1)).includes(dm.band.title)).toBe(true)
  })
})

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 5,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
} as const

test('TEA_EGG_LANG=en switches the command, band and replies to English', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 7, 6) })
  mock.env(on, { TEA_EGG_LANG: 'en' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const described: string[] = []
  on('command.register', (_, e) => {
    described.push(e.description ?? '')
    return { value: { command: e.name } }
  })
  on('ui.toast', () => ({ value: undefined }))
  try {
    await $.session.start(START)
    expect(described.some(d => d.startsWith('Tea Egg'))).toBe(true)
    expect((await $.command.run({ command: 'egg', args: 'refill' })).text).toBe('Broth topped up! The egg looks happy (•ᴗ•)')
    const ui = await $.ui.mount({ plugin: 'tea-egg', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: /Eggy #1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Flavor/ })).toBeDefined()
    await ui.unmount()
  } finally {
    setLang('zh-TW')
  }
})
