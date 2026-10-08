// Spoiler-leak check. Shared by pre-commit, commit-msg and manual runs.
//
// Usage:
//   npm run check -- --staged      check the index (pre-commit)
//   npm run check -- --msg FILE    check a commit message (commit-msg)
//   npm run check -- --all         check all tracked files, history messages and branch names
//
// Forbidden words come from the local spoilers.source.json (not in the repo); without it only file-name rules are checked.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'spoilers.source.json')
const NEVER_TRACK = ['tea-egg-design.md', 'spoilers.source.json']
const NEVER_TRACK_DIRS = ['art-source/', 'art-build/', 'docs/superpowers/', '.superpowers/', '.git-private/', 'node_modules/']
const NEVER_TRACK_EXT = ['.png']
// The encoded spoiler files themselves aren't scanned (their content is base64)
const SKIP_CONTENT = ['hooks/spoilers.ts', 'hooks/sprites-hd.ts']
const SCISSORS = '# ------------------------ >8'

type Guard = { words: string[]; patterns: RegExp[]; invalid: string[] }

function git(...args: string[]): Buffer {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 })
}

// -z: NUL-separated paths without quoting, so non-ASCII file names match
function gitPaths(...args: string[]): string[] {
  return git(...args, '-z').toString('utf8').split('\0').filter(Boolean)
}

function loadGuard(): Guard {
  if (!existsSync(SOURCE)) return { words: [], patterns: [], invalid: [] }
  const guard = (JSON.parse(readFileSync(SOURCE, 'utf8')) as { guard?: { words?: string[]; patterns?: string[] } }).guard ?? {}
  const patterns: RegExp[] = []
  const invalid: string[] = []
  ;(guard.patterns ?? []).forEach((p, i) => {
    try {
      patterns.push(new RegExp(p))
    } catch {
      invalid.push(`pattern #${i + 1} is invalid`) // never print the pattern itself
    }
  })
  return { words: (guard.words ?? []).map(w => w.toLowerCase()), patterns, invalid }
}

// Print only the word length, never the word itself, so pasted output can't leak it
function scanText(label: string, text: string, guard: Guard): string[] {
  const problems: string[] = []
  const low = text.toLowerCase()
  for (const w of guard.words) if (low.includes(w)) problems.push(`${label}: contains a forbidden word (${[...w].length} chars)`)
  for (const p of guard.patterns) if (p.test(text)) problems.push(`${label}: contains a forbidden date format`)
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
  paths.forEach((path, i) => {
    // If the file name itself contains a forbidden word, refer to the file by number in every message so the word isn't printed
    const nameHits = scanText(`file #${i + 1} (name)`, path, guard)
    const label = nameHits.length > 0 ? `file #${i + 1}` : path
    problems.push(...nameHits)
    if (isBadPath(path)) {
      problems.push(`${label}: this file must never be committed`)
      return
    }
    if (SKIP_CONTENT.includes(path)) return
    let data: Buffer
    try {
      data = read(path)
    } catch {
      problems.push(`${label}: could not read it; please check manually`)
      return
    }
    if (data.subarray(0, 4096).includes(0)) return
    problems.push(...scanText(label, data.toString('utf8'), guard))
  })
  return problems
}

// Commit message: drop # comment lines and everything after the scissors line (the diff from git commit -v)
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
    problems = scanText('commit message', messageBody(readFileSync(argv[1], 'utf8')), guard)
  } else if (mode === '--all') {
    problems = checkFiles(gitPaths('ls-files'), p => readFileSync(join(ROOT, p)), guard)
    problems.push(...scanText('commit history messages', git('log', '--all', '--format=%B').toString('utf8'), guard))
    problems.push(...scanText('branch names', git('branch', '-a', '--format=%(refname)').toString('utf8'), guard))
  } else {
    console.log('Usage: npm run check -- --staged | --msg FILE | --all')
    return 2
  }
  problems.push(...guard.invalid)
  if (guard.words.length === 0) console.log('(Note: spoilers.source.json not found; only file-name rules were checked)')
  for (const line of problems) console.log('✗', line)
  if (problems.length > 0) {
    console.log('Spoiler check failed: please fix it before committing.')
    return 1
  }
  console.log('✓ Spoiler check passed')
  return 0
}

process.exitCode = main(process.argv.slice(2))
