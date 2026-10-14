// Non-spoiler UI text in every language. Spoiler text lives in spoilers.ts.
import { lang } from './i18n'

export type Text = {
  welcome: string
  brothLow: string
  brothEmpty: string
  brothEmptyHint: string
  flipWanted: string
  flipHint: string
  night: readonly string[]
  harvest: string // {name}
  newDex: string
  refillReply: string
  flipReply: string
  flipNoGain: string
  flipNotNeeded: string
  nameReply: string // {name}
  nameUsage: string
  paneOpened: string
  paneClosed: string
  bandHidden: string
  bandShown: string
  unknown: string
  error: string
  help: string
  sync: {
    found: string
    title: string
    current: string
    other: string
    question: string
    line: string // {name} {no} {flavor} {kinds} {count} {when}
    none: string
    usage: string
    nothing: string
    confirm: string
    confirmUsage: string
    confirmFirst: string
    accepted: string
    cancelled: string
    declined: string
    yes: string
    no: string
    overwrite: string
    cancel: string
  }
  // Name shown on the pane and in the /egg command description
  title: string
  commandDescription: string
  defaultName: string
  dexTitle: string
  // Stat labels on the band and the pane
  flavor: string
  broth: string
  mood: string
  // Band separator: full-width bar for CJK, a narrow one for English
  separator: string
  stageNames: readonly [string, string, string, string]
  buttons: { refill: string; flip: string; dex: string; panel: string; hideBand: string; showBand: string }
  waiting: string
  eggAlt: string
  previewLabels: Readonly<Record<string, string>>
  previewBanner: string // {n} {total} {label}
  previewReply: string // {n} {total} {label}
  previewUsage: string // {total}
  previewOff: string
}

const ZH: Text = {
  welcome: '🥚 你領到了第一顆蛋！把它滷成茶葉蛋吧。輸入 /egg 查看',
  brothLow: '滷汁快乾了',
  brothEmpty: '滷汁乾了，蛋停止入味 🥲 輸入 /egg refill',
  brothEmptyHint: '滷汁乾了，蛋停止入味',
  flipWanted: '蛋想翻個身 🔄 輸入 /egg flip',
  flipHint: '蛋想翻個身 🔄',
  night: ['主人，滷汁都要睡了 😴', '這麼晚還在寫，蛋都替你累', '深夜寫的 code，明天的你會看懂嗎？'],
  harvest: '🎉 出鍋了！你得到了：{name}',
  newDex: '（新圖鑑！）',
  refillReply: '滷汁加滿了！蛋看起來很開心 (•ᴗ•)',
  flipReply: '翻好了！入味 +2 (•̀ᴗ•́)↻',
  flipNoGain: '翻好了！(•̀ᴗ•́)↻',
  flipNotNeeded: '蛋現在躺得很舒服，還不用翻',
  nameReply: '好的，這顆蛋現在叫「{name}」',
  nameUsage: '用法：/egg name <名字>（最多 12 個字）',
  paneOpened: '已開啟茶葉蛋面板',
  paneClosed: '已關閉茶葉蛋面板',
  bandHidden: '已隱藏橫條，輸入 /egg band 可再顯示',
  sync: {
    found: '發現另一份茶葉蛋存檔（用別的方式載入時留下的），輸入 /egg sync 查看',
    title: '發現另一份存檔：',
    current: '目前這份：',
    other: '另一份：　',
    question: '要用另一份覆蓋目前這份嗎？',
    line: '{name} #{no}、入味 {flavor}%、圖鑑 {kinds} 種（{count} 次），最後遊玩 {when}',
    none: '（沒有存檔）',
    usage: '輸入 /egg sync yes 同步，/egg sync no 不同步',
    nothing: '沒有其他需要同步的存檔',
    confirm: '確定要用另一份覆蓋目前這份嗎？目前這份會被蓋掉，無法復原。',
    confirmUsage: '輸入 /egg sync confirm 確定覆蓋，/egg sync cancel 取消',
    confirmFirst: '請先輸入 /egg sync yes 確認要同步哪一份',
    accepted: '已同步：目前這份換成另一份的進度',
    cancelled: '已取消，目前這份沒有被覆蓋',
    declined: '不同步。那份存檔沒有新進度前不會再問',
    yes: '同步',
    no: '不要',
    overwrite: '確定覆蓋',
    cancel: '取消',
  },
  bandShown: '已顯示橫條',
  unknown: '不認得這個指令，輸入 /egg help 看看',
  error: '蛋暫時聯絡不上，稍後再試 🥚',
  help: [
    '茶葉蛋養成計畫',
    '/egg            開啟／關閉面板',
    '/egg refill     加滷汁',
    '/egg flip       翻面',
    '/egg dex        顯示圖鑑',
    '/egg band       隱藏／顯示輸入框上方的橫條',
    '/egg sync       比較／同步另一份存檔',
    '/egg name 名字  幫目前的蛋取名',
    '/egg help       說明',
  ].join('\n'),
  title: '茶葉蛋養成計畫',
  commandDescription: '茶葉蛋養成計畫：/egg [refill|flip|dex|band|name 名字|help]',
  defaultName: '小蛋',
  dexTitle: '蛋圖鑑',
  flavor: '入味',
  broth: '滷汁',
  mood: '心情',
  separator: ' ｜ ',
  stageNames: ['生蛋', '裂紋', '入味', '滷透'],
  buttons: { refill: '加滷汁', flip: '翻面', dex: '圖鑑', panel: '面板', hideBand: '隱藏橫條', showBand: '顯示橫條' },
  waiting: '蛋還在路上…',
  eggAlt: '茶葉蛋',
  previewLabels: {
    base0: '入味 0–19%（生蛋）',
    base1: '入味 20–39%（裂紋）',
    base2: '入味 40–69%（淺杏）',
    base3: '入味 70% 以上（淺褐）',
    base0_dry: '生蛋，滷汁乾了',
    base1_dry: '裂紋，滷汁乾了',
    base2_dry: '淺杏，滷汁乾了',
    base3_dry: '淺褐，滷汁乾了',
    face_happy: '表情：開心',
    face_normal: '表情：普通',
    face_bored: '表情：無聊',
    face_cry: '表情：哭（滷汁乾了）',
    face_sleep: '表情：睡覺',
    face_flip: '表情：想翻身',
    face_done: '表情：剛出鍋',
  },
  previewBanner: '預覽 {n}/{total}：{label}（不影響存檔）',
  previewReply: '預覽 {n}/{total}：{label}（/egg preview next 下一張、prev 上一張、off 結束）',
  previewUsage: '用法：/egg preview next（下一張，next 可省略）｜prev（上一張）｜1-{total}（跳到第幾張）｜off（結束）',
  previewOff: '已結束預覽',
}

const EN: Text = {
  welcome: '🥚 You got your first egg! Marinate it into a tea egg. Type /egg to take a look',
  brothLow: 'Broth is low',
  brothEmpty: 'The broth dried up, so the egg stopped soaking 🥲 Type /egg refill',
  brothEmptyHint: 'Broth dried up',
  flipWanted: 'The egg wants to roll over 🔄 Type /egg flip',
  flipHint: 'Wants a flip 🔄',
  night: [
    'Boss, even the broth is sleepy 😴',
    'Still coding this late? The egg is tired for you',
    'Will tomorrow-you understand code written at midnight?',
  ],
  harvest: '🎉 Done marinating! You got: {name}',
  newDex: ' (New in the Eggdex!)',
  refillReply: 'Broth topped up! The egg looks happy (•ᴗ•)',
  flipReply: 'Flipped! Flavor +2 (•̀ᴗ•́)↻',
  flipNoGain: 'Flipped! (•̀ᴗ•́)↻',
  flipNotNeeded: "The egg is comfy right now. No need to flip it yet",
  nameReply: 'OK, this egg is now called "{name}"',
  nameUsage: 'Usage: /egg name <name> (up to 12 characters)',
  paneOpened: 'Tea egg panel opened',
  paneClosed: 'Tea egg panel closed',
  bandHidden: 'Band hidden. Type /egg band to bring it back',
  sync: {
    found: 'Found another Tea Egg save (left by another way of loading it). Type /egg sync to compare',
    title: 'Found another save:',
    current: 'This one:  ',
    other: 'The other: ',
    question: 'Replace this one with the other?',
    line: '{name} #{no}, flavor {flavor}%, Eggdex {kinds} kinds ({count} eggs), last played {when}',
    none: '(no save)',
    usage: 'Type /egg sync yes to copy it over, /egg sync no to keep this one',
    nothing: 'No other save to sync',
    confirm: 'Replace this save with the other one? This save will be overwritten and cannot be recovered.',
    confirmUsage: 'Type /egg sync confirm to overwrite, /egg sync cancel to back out',
    confirmFirst: 'Type /egg sync yes first to choose the save to copy',
    accepted: "Synced: this save now has the other one's progress",
    cancelled: 'Cancelled. This save was not overwritten',
    declined: "Kept this one. You won't be asked again until the other save changes",
    yes: 'Sync',
    no: 'No',
    overwrite: 'Overwrite',
    cancel: 'Cancel',
  },
  bandShown: 'Band shown',
  unknown: 'Unknown command. Try /egg help',
  error: "Can't reach the egg right now. Try again later 🥚",
  help: [
    'Tea Egg',
    '/egg            Open/close the panel',
    '/egg refill     Top up the broth',
    '/egg flip       Flip the egg',
    '/egg dex        Show the Eggdex',
    '/egg band       Hide/show the band above the prompt',
    '/egg sync       Compare/sync another save',
    '/egg name NAME  Name the current egg',
    '/egg help       Show this help',
  ].join('\n'),
  title: 'Tea Egg',
  commandDescription: 'Tea Egg, a pet egg that marinates while you code: /egg [refill|flip|dex|band|name NAME|help]',
  defaultName: 'Eggy',
  dexTitle: 'Eggdex',
  flavor: 'Flavor',
  broth: 'Broth',
  mood: 'Mood',
  separator: ' | ',
  stageNames: ['Raw', 'Cracked', 'Soaking', 'Steeped'],
  buttons: { refill: 'Refill', flip: 'Flip', dex: 'Dex', panel: 'Panel', hideBand: 'Hide band', showBand: 'Show band' },
  waiting: 'Your egg is on its way…',
  eggAlt: 'Tea egg',
  previewLabels: {
    base0: 'Flavor 0–19% (raw)',
    base1: 'Flavor 20–39% (cracked)',
    base2: 'Flavor 40–69% (light amber)',
    base3: 'Flavor 70%+ (light brown)',
    base0_dry: 'Raw, broth dried up',
    base1_dry: 'Cracked, broth dried up',
    base2_dry: 'Light amber, broth dried up',
    base3_dry: 'Light brown, broth dried up',
    face_happy: 'Face: happy',
    face_normal: 'Face: normal',
    face_bored: 'Face: bored',
    face_cry: 'Face: crying (broth dried up)',
    face_sleep: 'Face: sleeping',
    face_flip: 'Face: wants a flip',
    face_done: 'Face: just done',
  },
  previewBanner: 'Preview {n}/{total}: {label} (save not affected)',
  previewReply: 'Preview {n}/{total}: {label} (/egg preview next, prev, or off to stop)',
  previewUsage: 'Usage: /egg preview next (or nothing) | prev | 1-{total} (jump) | off (stop)',
  previewOff: 'Preview ended',
}

const TABLES = { 'zh-TW': ZH, en: EN } as const

// The text table for the current language; call it at use time, never cache the result
export function T(): Text {
  return TABLES[lang()]
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '')
}

export function pick<T>(list: readonly T[], rng: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!
}
