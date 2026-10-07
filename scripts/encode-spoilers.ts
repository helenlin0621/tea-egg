// 把本機的 spoilers.source.json（+ 像素圖）編碼成 hooks/spoilers.ts。
//
// 用法：npm run encode               產生檔案
//       npm run encode -- --check    只檢查 hooks/spoilers.ts 是否與來源一致
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'spoilers.source.json')
const SPRITES = join(ROOT, 'art-build', 'spoiler_sprites.json')
const OUT = join(ROOT, 'hooks', 'spoilers.ts')
const LINE = 96

const HEADER = `// 圖鑑條件與彩蛋內容經過 base64 編碼，避免劇透收集的樂趣。
// 這裡只有文字和數字資料，沒有任何程式邏輯、網路或檔案操作。
// 想看的話：呼叫 decodeSpoilers()，或把字串貼到任何 base64 解碼工具。
// 本檔由 scripts/encode-spoilers.ts 產生，請勿手動修改。
`

const FOOTER = `
let cache: Spoilers | null = null

export function decodeSpoilers(): Spoilers {
  if (cache === null) {
    const bytes = Uint8Array.from(atob(SPOILERS), c => c.charCodeAt(0))
    cache = JSON.parse(new TextDecoder().decode(bytes)) as Spoilers
  }
  return cache
}
`

// 物件鍵排序，讓同樣的來源永遠產生同樣的字串
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(k => [k, sortDeep((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

function payload(): Record<string, unknown> {
  const data = JSON.parse(readFileSync(SOURCE, 'utf8')) as Record<string, unknown>
  delete data.guard
  if (existsSync(SPRITES)) data.sprites = JSON.parse(readFileSync(SPRITES, 'utf8'))
  data.sprites ??= {}
  return data
}

function render(data: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(sortDeep(data)), 'utf8').toString('base64')
  const chunks: string[] = []
  for (let i = 0; i < b64.length; i += LINE) chunks.push(`"${b64.slice(i, i + LINE)}"`)
  return HEADER + "import type { Spoilers } from './spoiler-types'\n\n" + `export const SPOILERS =\n  ${chunks.join(' +\n  ')}\n` + FOOTER
}

function main(argv: string[]): number {
  const rendered = render(payload())
  if (argv.includes('--check')) {
    const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === rendered
    console.log(same ? '✓ spoilers.ts 與來源一致' : '✗ spoilers.ts 過期：請重新執行 npm run encode')
    return same ? 0 : 1
  }
  writeFileSync(OUT, rendered, 'utf8')
  console.log(`已寫入 hooks/spoilers.ts（${rendered.length} 字元）`)
  return 0
}

process.exit(main(process.argv.slice(2)))
