// Non-spoiler UI text. Spoiler text lives in spoilers.ts.
export const TEXT = {
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
  unknown: '不認得這個指令，輸入 /egg help 看看',
  error: '蛋暫時聯絡不上，稍後再試 🥚',
  help: [
    '茶葉蛋養成計畫',
    '/egg            開啟／關閉面板',
    '/egg refill     加滷汁',
    '/egg flip       翻面',
    '/egg dex        顯示圖鑑',
    '/egg name 名字  幫目前的蛋取名',
    '/egg help       說明',
  ].join('\n'),
} as const

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '')
}

export function pick<T>(list: readonly T[], rng: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!
}
