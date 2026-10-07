// 這個 Mod 會看你的哪些指令：只看 Bash / PowerShell 的指令文字與成功與否，
// 用來判斷「跑了測試」與「下了危險指令」。只觀察，不阻擋、不修改。

export const OBSERVED_TOOLS = ['Bash', 'PowerShell'] as const

const SEP = String.raw`(?:^|[\s;&|(])`

export const TEST_COMMANDS: readonly RegExp[] = [
  new RegExp(String.raw`${SEP}(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b`),
  new RegExp(String.raw`${SEP}npx\s+(?:jest|vitest)\b`),
  new RegExp(String.raw`${SEP}(?:vitest|jest|pytest|rspec|phpunit)(?=\s|$)`),
  new RegExp(String.raw`${SEP}(?:python3?|py)\s+-m\s+pytest\b`),
  new RegExp(String.raw`${SEP}(?:go|cargo|mvn|gradle|dotnet)\s+test\b`),
  new RegExp(String.raw`${SEP}(?:\.(?:\/|\\))?gradlew(?:\.bat)?\s+test\b`),
]

export function isTestCommand(cmd: string): boolean {
  const clean = unquoted(cmd)
  return TEST_COMMANDS.some(re => re.test(clean))
}

// 去掉引號內的字串：只是「提到」危險指令（commit 訊息、grep 關鍵字）不算
function unquoted(cmd: string): string {
  return cmd.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '""')
}

function segments(cmd: string): string[][] {
  return unquoted(cmd)
    .split(/[;&|()\n]+/)
    .map(seg => seg.trim().split(/\s+/).filter(Boolean))
    .map(words => (words[0] === 'sudo' ? words.slice(1) : words))
    .filter(words => words.length > 0)
}

function shortFlags(words: string[]): string {
  return words.filter(w => /^-[A-Za-z]+$/.test(w)).map(w => w.slice(1)).join('')
}

// Watched dangerous commands:
// - rm -rf (recursive + force delete)
// - git push --force (force push)
// - git reset --hard (hard reset)
// - git clean -fd (clean with remove untracked)
// - chmod -R 777 (world writable recursive)
// - SQL DROP TABLE / DROP DATABASE / TRUNCATE

const SQL: readonly [RegExp, string][] = [
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+DATABASE\b/i, 'DROP DATABASE'],
  [/\bTRUNCATE\s+TABLE\s+[A-Za-z_]/i, 'TRUNCATE'],
  [/\bTRUNCATE\s+[A-Za-z_][A-Za-z0-9_]*\b/, 'TRUNCATE'],
]

export function dangerKeyword(cmd: string): string | null {
  for (const words of segments(cmd)) {
    const [head, sub] = words
    const flags = shortFlags(words)
    if (head === 'rm') {
      const recursive = /[rR]/.test(flags) || words.includes('--recursive')
      const force = flags.includes('f') || words.includes('--force')
      if (recursive && force) return 'rm -rf'
    }
    if (head === 'git' && sub === 'push') {
      if (words.some(w => w === '--force' || w === '--force-with-lease' || w.startsWith('--force-with-lease=')) || flags.includes('f')) {
        return 'git push --force'
      }
    }
    if (head === 'git' && sub === 'reset' && words.includes('--hard')) return 'git reset --hard'
    if (head === 'git' && sub === 'clean' && flags.includes('f') && flags.includes('d') && !flags.includes('n') && !words.includes('--dry-run')) return 'git clean -fd'
    if (head === 'chmod' && (flags.includes('R') || words.includes('--recursive')) && words.some(w => w === '777' || w === '0777')) {
      return 'chmod -R 777'
    }
  }
  // SQL 通常寫在引號裡，所以對全文比對
  for (const [re, keyword] of SQL) if (re.test(cmd)) return keyword
  return null
}

export type Observation = { failed: boolean; test: 'pass' | 'fail' | null; danger: string | null }

export function observe(tool: string, command: string, ran: { deny?: string; isError?: boolean }): Observation | null {
  if (ran.deny !== undefined) return null
  const failed = ran.isError === true
  const isShell = (OBSERVED_TOOLS as readonly string[]).includes(tool)
  const cmd = typeof command === 'string' ? command : ''
  const test = isShell && isTestCommand(cmd) ? (failed ? 'fail' : 'pass') : null
  const danger = isShell ? dangerKeyword(cmd) : null
  if (!failed && test === null && danger === null) return null
  return { failed, test, danger }
}
