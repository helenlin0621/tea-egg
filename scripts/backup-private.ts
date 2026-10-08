// Back up the files that never go into the public repo to a separate private repo.
//
// Usage:
//   npm run backup                 commit any changes and push
//   npm run backup -- "message"    same, with your own commit message
//
// The private repo lives in .git-private/ (same folder, so paths don't change). Its own config holds the
// remote and the noreply identity; it has no hooks, so the spoiler check doesn't run on it.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GIT_DIR = join(ROOT, '.git-private')
// Same list as the "never commit" part of .gitignore
const PATHS = ['tea-egg-design.md', 'spoilers.source.json', 'art-source', 'art-build', 'docs/superpowers', '.superpowers']
const SKIP = [':(exclude,glob)**/__pycache__/**', ':(exclude,glob)**/*.pyc']

function git(...args: string[]): string {
  return execFileSync('git', ['--git-dir', GIT_DIR, '--work-tree', ROOT, ...args], { cwd: ROOT, encoding: 'utf8' })
}

if (!existsSync(GIT_DIR)) {
  console.error('No .git-private/ here. See "Private backup" in docs/superpowers/notes.md to set it up.')
  process.exit(1)
}

const present = PATHS.filter(p => existsSync(join(ROOT, p)))
// -f because the public .gitignore lists exactly these files; -A also records deletions
git('add', '-f', '-A', '--', ...present, ...SKIP)
const staged = git('diff', '--cached', '--name-status')
if (staged.trim() === '') {
  console.log('Nothing changed since the last backup.')
} else {
  const stamp = new Date().toLocaleString('sv', { timeZone: 'Asia/Taipei' }).slice(0, 16)
  const message = process.argv[2] ?? `backup ${stamp}`
  console.log(staged.trimEnd())
  git('commit', '-q', '-m', message)
  console.log(`Committed: ${message}`)
}
execFileSync('git', ['--git-dir', GIT_DIR, '--work-tree', ROOT, 'push', '-u', 'origin', 'main'], { cwd: ROOT, stdio: 'inherit' })
console.log('Backed up to the private repo.')
