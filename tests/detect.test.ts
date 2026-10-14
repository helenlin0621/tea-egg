import { test, expect } from 'claude-code/testing'
import { cautionKeyword, dangerKeyword, isTestCommand, observe } from '../hooks/detect'

test('Recognizes test commands', async () => {
  for (const cmd of [
    'npm test', 'npm run test', 'pnpm test', 'yarn test', 'npx jest', 'npx vitest', 'vitest run', 'jest --watch=false',
    'pytest -q', 'python -m pytest', 'py -m pytest tests', 'go test ./...', 'cargo test', 'mvn test', 'gradle test',
    './gradlew test', 'dotnet test', 'rspec', 'phpunit', 'cd web && npm test', 'npm run test:unit',
  ]) expect(isTestCommand(cmd)).toBe(true)
  for (const cmd of ['npm install', 'git status', 'echo latest', 'cat jest.config.js', 'npm run build']) {
    expect(isTestCommand(cmd)).toBe(false)
  }
})

test('Recognizes dangerous commands', async () => {
  expect(dangerKeyword('rm -rf /')).toBe('rm -rf')
  expect(dangerKeyword('rm -fr ~')).toBe('rm -rf')
  expect(dangerKeyword('rm -r -f .')).toBe('rm -rf')
  expect(dangerKeyword('sudo rm -Rf /*')).toBe('rm -rf')
  expect(dangerKeyword('cd x && rm -rf *')).toBe('rm -rf')
  expect(dangerKeyword('git push --force')).toBe('git push --force')
  expect(dangerKeyword('git push -f origin main')).toBe('git push --force')
  expect(dangerKeyword('psql -c "DROP TABLE users"')).toBe('DROP TABLE')
  expect(dangerKeyword("mysql -e 'drop database app'")).toBe('DROP DATABASE')
  expect(dangerKeyword('sqlite3 a.db "TRUNCATE TABLE logs"')).toBe('TRUNCATE')
  expect(dangerKeyword('chmod -R 777 .')).toBe('chmod -R 777')
})

test('Merely mentioning a dangerous command does not count', async () => {
  expect(dangerKeyword('git commit -m "remove the rm -rf usage"')).toBe(null)
  expect(dangerKeyword("grep 'git reset --hard' docs.md")).toBe(null)
  expect(dangerKeyword('rm -r build')).toBe(null)
  expect(dangerKeyword('rm file.txt')).toBe(null)
  expect(dangerKeyword('git push origin main')).toBe(null)
  expect(dangerKeyword('truncate -s 0 log.txt')).toBe(null)
  expect(dangerKeyword('chmod 755 run.sh')).toBe(null)
})

test('rm -rf only counts for root-like targets', async () => {
  for (const cmd of [
    'rm -rf /', 'rm -rf /*', 'rm -rf ~', 'rm -rf ~/', 'rm -rf ~/*', 'rm -rf $HOME', 'rm -rf "$HOME"', 'rm -rf ${HOME}/',
    'rm -rf .', 'rm -rf ./', 'rm -rf ./*', 'rm -rf ..', 'rm -rf ../', 'rm -rf *', 'rm --recursive --force .',
    'rm -rf C:/', "rm -rf 'C:\\'", 'rm -rf C:\\*', 'rm -rf c:/*', 'rm -rf D:',
    'rm -rf dist /', 'rm -rf src; rm -rf .',
  ]) expect(dangerKeyword(cmd)).toBe('rm -rf')
})

test('rm -rf of an ordinary path does not count', async () => {
  for (const cmd of [
    'rm -rf node_modules', 'rm -rf dist', 'rm -rf ./build', 'rm -rf src', 'rm -rf ~/scratch', 'rm -rf "$HOME/project"',
    'rm -rf $UNKNOWN/x', 'rm -rf /tmp/x', 'rm -rf /usr/bin', 'rm -rf "C:/Program Files/App"', 'rm -rf ./*.log',
    'rm -rf .git', 'rm -rf ../other', 'rm -r /', 'rm -f *',
  ]) expect(dangerKeyword(cmd)).toBe(null)
})

test('Everyday risky commands are caution level, not dangerous', async () => {
  const cases: [string, string | null][] = [
    ['git reset --hard', 'git reset --hard'],
    ['git clean -fd', 'git clean -fd'],
    ['git clean -nfd', null],
    ['git push --force-with-lease origin main', 'git push --force-with-lease'],
    ['rm -rf dist', 'rm -rf'],
    ['rm -rf src/old', 'rm -rf'],
    ['rm -rf node_modules', null], // build output and temp folders don't count at all
    ['rm -rf /tmp/x', null],
    ['rm -rf ./build', null],
    ['rm -rf /', null], // dangerous, not caution
    ['git push --force', null],
    ['git commit -m "git reset --hard"', null],
  ]
  for (const [cmd, keyword] of cases) expect(cautionKeyword(cmd)).toBe(keyword)
  expect(observe('Bash', 'git reset --hard', {})).toEqual({ failed: false, test: null, danger: null, caution: 'git reset --hard' })
  expect(observe('Bash', 'git reset --hard', { isError: true })).toEqual({ failed: true, test: null, danger: null, caution: null })
})

test('claude plugin test counts as a test command', async () => {
  for (const cmd of ['claude plugin test .', 'claude.exe plugin test .', 'C:/x/claude.exe plugin test .', 'C="/x/claude.exe"; "$C" plugin test .', '$CLAUDE plugin test .']) {
    expect(isTestCommand(cmd)).toBe(true)
  }
  for (const cmd of ['claude plugin validate .', 'echo "claude plugin test"']) expect(isTestCommand(cmd)).toBe(false)
})

test('Everyday git commands and lease-guarded pushes do not count', async () => {
  for (const cmd of [
    'git reset --hard', 'git reset --hard HEAD~1', 'git clean -fd', 'git clean -f -d',
    'git push --force-with-lease', 'git push --force-with-lease=main:abc origin main',
  ]) expect(dangerKeyword(cmd)).toBe(null)
})

test('Observation: denied calls do not count; PowerShell is observed too', async () => {
  expect(observe('Bash', 'rm -rf x', { deny: 'user denied' })).toBe(null)
  expect(observe('Bash', 'npm test', { isError: true })).toEqual({ failed: true, test: 'fail', danger: null, caution: null })
  expect(observe('PowerShell', 'npm test', { isError: false })).toEqual({ failed: false, test: 'pass', danger: null, caution: null })
  expect(observe('Read', '', { isError: true })).toEqual({ failed: true, test: null, danger: null, caution: null })
  expect(observe('Read', '', {})).toBe(null)
})

test('Test commands inside quotes do not count', async () => {
  expect(isTestCommand('git commit -m "fix npm test flake"')).toBe(false)
  expect(isTestCommand('echo "run pytest"')).toBe(false)
  expect(isTestCommand('npm test -- -t "x"')).toBe(true)
})

test('TRUNCATE pattern strictness', async () => {
  expect(dangerKeyword('grep -rn truncate src')).toBe(null)
  expect(dangerKeyword('truncate out.log')).toBe(null)
  expect(dangerKeyword('git commit -m "truncate long titles"')).toBe(null)
  expect(dangerKeyword('psql -c "truncate table logs"')).toBe('TRUNCATE')
  expect(dangerKeyword('sqlite3 a.db "TRUNCATE logs"')).toBe('TRUNCATE')
})

test('Windows test command forms', async () => {
  expect(isTestCommand('.\\gradlew test')).toBe(true)
  expect(isTestCommand('gradlew.bat test')).toBe(true)
})

test('SQL keywords only count inside an SQL client', async () => {
  expect(dangerKeyword('grep -rn "DROP TABLE" migrations/')).toBe(null)
  expect(dangerKeyword('git commit -m "never drop table again"')).toBe(null)
  expect(dangerKeyword('Select-String -Pattern "DROP TABLE"')).toBe(null)
  expect(dangerKeyword('echo "TRUNCATE logs" > note.txt')).toBe(null)
  expect(dangerKeyword('PSQL -c "DROP TABLE users"')).toBe('DROP TABLE')
  expect(dangerKeyword('cd db && sqlcmd -Q "DROP DATABASE app"')).toBe('DROP DATABASE')
  expect(dangerKeyword('Invoke-Sqlcmd -Query "drop table t"')).toBe('DROP TABLE')
  expect(dangerKeyword('duckdb a.db "truncate table logs"')).toBe('TRUNCATE')
})

test('Heredoc bodies are not commands', async () => {
  expect(dangerKeyword("cat > clean.sh <<'EOF'\nrm -rf /\nEOF")).toBe(null)
  expect(dangerKeyword('cat > clean.sh <<-EOF\nrm -rf /\nEOF\nls')).toBe(null)
  expect(dangerKeyword("cat > x.sh <<'EOF'\necho hi\nEOF\nrm -rf /")).toBe('rm -rf')
  expect(isTestCommand('cat > run.sh <<EOF\nnpm test\nEOF')).toBe(false)
})

test('The test runner must be the command word', async () => {
  for (const cmd of ['npm i -D jest', 'pip install pytest', 'grep -r pytest .', 'ls jest']) {
    expect(isTestCommand(cmd)).toBe(false)
  }
  expect(isTestCommand('cd web && jest')).toBe(true)
  expect(isTestCommand('sudo pytest')).toBe(true)
  expect(isTestCommand('python3 -m pytest -q')).toBe(true)
})

test('Denied or failed calls are not dangerous', async () => {
  expect(observe('Bash', 'rm -rf /', { isError: true })).toEqual({ failed: true, test: null, danger: null, caution: null })
})

test('observe with dangerous commands and non-shell tools', async () => {
  expect(observe('Bash', 'rm -rf .', {})).toEqual({ failed: false, test: null, danger: 'rm -rf', caution: null })
  expect(observe('PowerShell', 'git push -f', {})).toEqual({ failed: false, test: null, danger: 'git push --force', caution: null })
  expect(observe('Read', 'rm -rf .', {})).toBe(null)
})
