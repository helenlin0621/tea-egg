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

// Split into segments of words like segments(), but keep what's inside quotes (rm targets are often quoted paths).
// $(...) stays inside its word. Unquoted backslash escapes the next character, as in bash.
function quotedSegments(cmd: string): string[][] {
  const segs: string[][] = []
  let words: string[] = []
  let word: string | null = null
  const endWord = () => { if (word !== null) words.push(word); word = null }
  const endSeg = () => { endWord(); if (words.length > 0) segs.push(words); words = [] }
  const text = withoutHeredocs(cmd)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === "'") {
      const end = text.indexOf("'", i + 1)
      const stop = end === -1 ? text.length : end
      word = (word ?? '') + text.slice(i + 1, stop)
      i = stop
    } else if (ch === '"') {
      let j = i + 1
      let s = ''
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < text.length && '"\\$`'.includes(text[j + 1]!)) j++
        s += text[j]
        j++
      }
      word = (word ?? '') + s
      i = j
    } else if (ch === '$' && text[i + 1] === '(') {
      let depth = 0
      let j = i + 1
      for (; j < text.length; j++) {
        if (text[j] === '(') depth++
        else if (text[j] === ')' && --depth === 0) break
      }
      word = (word ?? '') + text.slice(i, j + 1)
      i = j
    } else if (ch === '\\' && i + 1 < text.length) {
      word = (word ?? '') + text[++i]
    } else if (';&|()\n'.includes(ch)) {
      endSeg()
    } else if (/\s/.test(ch)) {
      endWord()
    } else {
      word = (word ?? '') + ch
    }
  }
  endSeg()
  return segs
}

// rm -rf only counts when some target lies outside a temp location. Temp locations:
// - a path segment named tmp / temp / scratchpad with something below it (the folder itself still counts)
// - anything under node_modules / bin / obj / build / .superpowers (including the folder itself), unless it sits
//   under a system folder such as /usr or C:/Program Files
// Paths are resolved with VAR=value / export / cd from earlier in the same command; $TEMP / $TMP / $TMPDIR and
// $(mktemp ...) count as temp. Anything we can't resolve (unknown variables, ~, $(...) other than mktemp) counts.

const TEMP_VARS: Record<string, string> = { TEMP: '/tmp', TMP: '/tmp', TMPDIR: '/tmp', LOCALAPPDATA: '/AppData/Local' }

type Env = Map<string, string | null>

function expand(word: string, env: Env): string | null {
  if (/^\$\(\s*mktemp\b[^)]*\)$/.test(word)) return '/tmp/mktemp'
  if (word.includes('$(') || word.includes('`') || word.startsWith('~')) return null
  let unresolved = false
  const out = word.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a: string | undefined, b: string | undefined) => {
    const name = (a ?? b)!
    const value = env.has(name) ? env.get(name)! : TEMP_VARS[name] ?? null
    if (value === null) unresolved = true
    return value ?? ''
  })
  return unresolved ? null : out
}

const isAbsolute = (p: string) => /^(?:\/|[A-Za-z]:)/.test(p)

function resolvePath(word: string, env: Env, cwd: string | null): string | null {
  const p = expand(word, env)
  if (p === null) return null
  const path = p.replace(/\\/g, '/')
  if (isAbsolute(path)) return path
  return cwd === null ? path : `${cwd}/${path}`
}

const OUTPUT_DIRS = new Set(['node_modules', 'bin', 'obj', 'build', '.superpowers'])
const SYSTEM_ROOT = /^(?:usr|bin|sbin|etc|opt|lib|lib64|var|boot|system|library|windows|program files|program files \(x86\)|programdata)$/i

// /usr/bin, C:/Program Files/App/bin and the like are system folders, not build output
function underSystemRoot(path: string, parts: string[]): boolean {
  if (!isAbsolute(path)) return false
  const drive = /^[A-Za-z]:$/.test(parts[0]!) || (path.startsWith('/') && /^[A-Za-z]$/.test(parts[0]!))
  const first = drive ? parts[1] : parts[0]
  return first !== undefined && SYSTEM_ROOT.test(first)
}

function isTempPath(path: string): boolean {
  const parts = path.split('/').filter(part => part !== '' && part !== '.')
  if (parts.includes('..')) return false
  if (parts.some(part => OUTPUT_DIRS.has(part)) && !underSystemRoot(path, parts)) return true
  const i = parts.findIndex(part => /^(?:tmp|temp|scratchpad)$/i.test(part))
  return i !== -1 && i < parts.length - 1
}

const isRedirect = (w: string) => /^\d*[<>]/.test(w)

function unsafeRm(cmd: string): boolean {
  const env: Env = new Map()
  let cwd: string | null = null
  for (const segment of quotedSegments(cmd)) {
    let words = segment
    if (words[0] === 'export') words = words.slice(1)
    let i = 0
    while (i < words.length && (words[i] === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!))) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(words[i]!)
      if (m) env.set(m[1]!, expand(m[2]!, env))
      i++
    }
    words = words.slice(i).filter(w => !isRedirect(w))
    const [head, ...args] = words
    if (head === 'cd') {
      const dest = args[0]
      cwd = dest === undefined ? null : resolvePath(dest, env, cwd)
      continue
    }
    if (head !== 'rm') continue
    const flags = shortFlags(words)
    const recursive = /[rR]/.test(flags) || words.includes('--recursive')
    const force = flags.includes('f') || words.includes('--force')
    if (!recursive || !force) continue
    const targets = args.filter(w => !w.startsWith('-'))
    if (targets.length === 0) continue
    for (const t of targets) {
      const path = resolvePath(t, env, cwd)
      if (path === null || !isTempPath(path)) return true
    }
  }
  return false
}

// Dangerous commands we watch for:
// - rm -rf (recursive + forced delete), unless every target is in a temp location (see unsafeRm)
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
      if (recursive && force && unsafeRm(cmd)) return 'rm -rf'
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
