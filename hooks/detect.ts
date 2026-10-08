// Which of your commands this Mod looks at: only the text and success/failure of Bash / PowerShell commands,
// used to tell "ran tests" and "ran a dangerous command". It only observes; it never blocks or modifies anything.
// Only real execution counts: quoted strings, heredoc bodies and grep patterns are just "mentions" and don't count.

export const OBSERVED_TOOLS = ['Bash', 'PowerShell'] as const

// Test commands: the test runner must be the command word (first word) of a segment, or directly follow one of these launchers
// - npm / pnpm / yarn [run] test (including test:unit and the like)
// - npx jest, npx vitest
// - vitest, jest, pytest, rspec, phpunit
// - python -m pytest, python3 -m pytest, py -m pytest
// - go / cargo / mvn / gradle / dotnet test
// - gradlew test (including ./gradlew, .\gradlew, gradlew.bat)
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

// Strip heredoc bodies: from the line after <<WORD up to a line containing only WORD
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

// Strip quoted strings: merely "mentioning" a dangerous command (commit messages, grep patterns) doesn't count
function unquoted(cmd: string): string {
  return cmd.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '""')
}

// Split on ; & | ( ) and newlines; drop a leading sudo and VAR=value
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

// Dangerous commands we watch for:
// - rm -rf (recursive + forced delete)
// - git push --force / -f / --force-with-lease (force push)
// - git reset --hard
// - git clean -fd (not with -n / --dry-run)
// - chmod -R 777
// - SQL DROP TABLE / DROP DATABASE / TRUNCATE: only when the command word of some segment is an SQL client
//   (psql, mysql, mariadb, sqlite3, sqlcmd, duckdb, sqlplus, clickhouse-client, Invoke-Sqlcmd)

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
  // SQL usually sits inside quotes or a heredoc, so when an SQL client is present we match against the raw text
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
  // Dangerous commands only count when they actually ran successfully (denied or failed calls don't)
  const danger = isShell && !failed ? dangerKeyword(cmd) : null
  if (!failed && test === null && danger === null) return null
  return { failed, test, danger }
}
