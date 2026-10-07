// 這個 Mod 會看你的哪些指令：只看 Bash / PowerShell 的指令文字與成功與否，
// 用來判斷「跑了測試」與「下了危險指令」。只觀察，不阻擋、不修改。
// 只有「真的執行」才算：引號內的字串、heredoc 的內文、grep 的搜尋字都只是「提到」，不算。

export const OBSERVED_TOOLS = ['Bash', 'PowerShell'] as const

// 測試指令：測試執行器必須是某一段的指令字（第一個字），或緊接在下列啟動方式之後
// - npm / pnpm / yarn [run] test（含 test:unit 這類）
// - npx jest、npx vitest
// - vitest、jest、pytest、rspec、phpunit
// - python -m pytest、python3 -m pytest、py -m pytest
// - go / cargo / mvn / gradle / dotnet test
// - gradlew test（含 ./gradlew、.\gradlew、gradlew.bat）
export const TEST_COMMANDS: readonly RegExp[] = [
  /^(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b/,
  /^npx\s+(?:jest|vitest)\b/,
  /^(?:vitest|jest|pytest|rspec|phpunit)(?=\s|$)/,
  /^(?:python3?|py)\s+-m\s+pytest\b/,
  /^(?:go|cargo|mvn|gradle|dotnet)\s+test\b/,
  /^(?:\.(?:\/|\\))?gradlew(?:\.bat)?\s+test\b/,
]

export function isTestCommand(cmd: string): boolean {
  return segments(cmd).some(words => {
    const line = words.join(' ')
    return TEST_COMMANDS.some(re => re.test(line))
  })
}

// 去掉 heredoc 的內文：從 <<WORD 那一行之後，到單獨一行 WORD 為止
function withoutHeredocs(cmd: string): string {
  const out: string[] = []
  let end: string | null = null
  for (const line of cmd.split('\n')) {
    if (end !== null) {
      if (line.trim() === end) end = null
      continue
    }
    out.push(line)
    const m = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(line)
    if (m) end = m[1]!
  }
  return out.join('\n')
}

// 去掉引號內的字串：只是「提到」危險指令（commit 訊息、grep 關鍵字）不算
function unquoted(cmd: string): string {
  return cmd.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '""')
}

// 依 ; & | ( ) 換行 分段；去掉開頭的 sudo 與 VAR=value
function segments(cmd: string): string[][] {
  return unquoted(withoutHeredocs(cmd))
    .split(/[;&|()\n]+/)
    .map(seg => seg.trim().split(/\s+/).filter(Boolean))
    .map(words => {
      let i = 0
      while (i < words.length && (words[i] === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!))) i++
      return words.slice(i)
    })
    .filter(words => words.length > 0)
}

function shortFlags(words: string[]): string {
  return words.filter(w => /^-[A-Za-z]+$/.test(w)).map(w => w.slice(1)).join('')
}

// 監看的危險指令：
// - rm -rf（遞迴 + 強制刪除）
// - git push --force / -f / --force-with-lease（強制推送）
// - git reset --hard
// - git clean -fd（不含 -n / --dry-run 乾執行）
// - chmod -R 777
// - SQL 的 DROP TABLE / DROP DATABASE / TRUNCATE：只在某一段的指令字是 SQL 客戶端時才算
//   （psql、mysql、mariadb、sqlite3、sqlcmd、duckdb、sqlplus、clickhouse-client、Invoke-Sqlcmd）

const SQL_CLIENTS = new Set([
  'psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'duckdb', 'sqlplus', 'clickhouse-client', 'invoke-sqlcmd',
])

const SQL: readonly [RegExp, string][] = [
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+DATABASE\b/i, 'DROP DATABASE'],
  [/\bTRUNCATE\s+TABLE\s+[A-Za-z_]/i, 'TRUNCATE'],
  [/\bTRUNCATE\s+[A-Za-z_][A-Za-z0-9_]*\b/, 'TRUNCATE'],
]

const isSqlClient = (word: string) => SQL_CLIENTS.has(word.toLowerCase().replace(/\.exe$/, ''))

export function dangerKeyword(cmd: string): string | null {
  const segs = segments(cmd)
  for (const words of segs) {
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
  // SQL 通常寫在引號或 heredoc 裡，所以有 SQL 客戶端時對原始全文比對
  if (segs.some(words => isSqlClient(words[0]!))) {
    for (const [re, keyword] of SQL) if (re.test(cmd)) return keyword
  }
  return null
}

export type Observation = { failed: boolean; test: 'pass' | 'fail' | null; danger: string | null }

export function observe(tool: string, command: string, ran: { deny?: string; isError?: boolean }): Observation | null {
  if (ran.deny !== undefined) return null
  const failed = ran.isError === true
  const isShell = (OBSERVED_TOOLS as readonly string[]).includes(tool)
  const cmd = typeof command === 'string' ? command : ''
  const test = isShell && isTestCommand(cmd) ? (failed ? 'fail' : 'pass') : null
  // 危險指令只在真的執行成功時才算（被拒絕、失敗的不算）
  const danger = isShell && !failed ? dangerKeyword(cmd) : null
  if (!failed && test === null && danger === null) return null
  return { failed, test, danger }
}
