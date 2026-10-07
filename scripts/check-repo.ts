// 防劇透外洩檢查。pre-commit、commit-msg 與手動執行共用。
//
// 用法：
//   npm run check -- --staged      檢查暫存區（pre-commit）
//   npm run check -- --msg FILE    檢查 commit 訊息（commit-msg）
//   npm run check -- --all         檢查所有已追蹤檔案、歷史訊息、分支名
//
// 禁止字詞來自本機的 spoilers.source.json（不在 repo 裡）；檔案不存在時只做檔名檢查。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'spoilers.source.json')
const NEVER_TRACK = ['tea-egg-design.md', 'spoilers.source.json']
const NEVER_TRACK_DIRS = ['art-source/', 'art-build/', 'docs/superpowers/', '.superpowers/', 'node_modules/']
const NEVER_TRACK_EXT = ['.png']
// 編碼後的劇透檔本身不掃（內容是 base64）
const SKIP_CONTENT = ['hooks/spoilers.ts']
const SCISSORS = '# ------------------------ >8'

type Guard = { words: string[]; patterns: RegExp[] }

function git(...args: string[]): Buffer {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 })
}

// -z：路徑以 NUL 分隔且不做引號跳脫，中文檔名才比得到
function gitPaths(...args: string[]): string[] {
  return git(...args, '-z').toString('utf8').split('\0').filter(Boolean)
}

function loadGuard(): Guard {
  if (!existsSync(SOURCE)) return { words: [], patterns: [] }
  const guard = (JSON.parse(readFileSync(SOURCE, 'utf8')) as { guard?: { words?: string[]; patterns?: string[] } }).guard ?? {}
  return {
    words: (guard.words ?? []).map(w => w.toLowerCase()),
    patterns: (guard.patterns ?? []).map(p => new RegExp(p)),
  }
}

// 只印出字數，不印字詞本身，避免輸出被貼出去時洩漏
function scanText(label: string, text: string, guard: Guard): string[] {
  const problems: string[] = []
  const low = text.toLowerCase()
  for (const w of guard.words) if (low.includes(w)) problems.push(`${label}: 含禁止字詞（${[...w].length} 字）`)
  for (const p of guard.patterns) if (p.test(text)) problems.push(`${label}: 含禁止日期格式`)
  return problems
}

function isBadPath(path: string): boolean {
  const base = path.split('/').pop() ?? path
  return (
    NEVER_TRACK.includes(base) ||
    NEVER_TRACK_DIRS.some(dir => path.startsWith(dir) || path.includes(`/${dir}`)) ||
    NEVER_TRACK_EXT.some(ext => path.toLowerCase().endsWith(ext))
  )
}

function checkFiles(paths: string[], read: (path: string) => Buffer, guard: Guard): string[] {
  const problems: string[] = []
  for (const path of paths) {
    if (isBadPath(path)) {
      problems.push(`${path}: 這個檔案不可進 repo`)
      continue
    }
    problems.push(...scanText(`${path}（檔名）`, path, guard))
    if (SKIP_CONTENT.includes(path)) continue
    let data: Buffer
    try {
      data = read(path)
    } catch {
      problems.push(`${path}: 無法讀取，請手動確認`)
      continue
    }
    if (data.subarray(0, 4096).includes(0)) continue
    problems.push(...scanText(path, data.toString('utf8'), guard))
  }
  return problems
}

// commit 訊息：去掉 # 註解行與 scissors 線之後的內容（git commit -v 的 diff）
function messageBody(text: string): string {
  const lines: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(SCISSORS)) break
    if (!line.startsWith('#')) lines.push(line)
  }
  return lines.join('\n')
}

function main(argv: string[]): number {
  const guard = loadGuard()
  const mode = argv[0] ?? '--all'
  let problems: string[]
  if (mode === '--staged') {
    const paths = gitPaths('diff', '--cached', '--name-only', '--diff-filter=ACMR')
    problems = checkFiles(paths, p => git('show', `:${p}`), guard)
  } else if (mode === '--msg' && argv[1]) {
    problems = scanText('commit 訊息', messageBody(readFileSync(argv[1], 'utf8')), guard)
  } else if (mode === '--all') {
    problems = checkFiles(gitPaths('ls-files'), p => readFileSync(join(ROOT, p)), guard)
    problems.push(...scanText('commit 歷史訊息', git('log', '--all', '--format=%B').toString('utf8'), guard))
    problems.push(...scanText('分支名稱', git('branch', '-a', '--format=%(refname)').toString('utf8'), guard))
  } else {
    console.log('用法：npm run check -- --staged | --msg FILE | --all')
    return 2
  }
  if (guard.words.length === 0) console.log('（提醒：找不到 spoilers.source.json，只檢查了檔名規則）')
  for (const line of problems) console.log('✗', line)
  if (problems.length > 0) {
    console.log('劇透檢查沒過：請修正後再 commit。')
    return 1
  }
  console.log('✓ 劇透檢查通過')
  return 0
}

process.exit(main(process.argv.slice(2)))
