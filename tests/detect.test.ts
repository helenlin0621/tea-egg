import { test, expect } from 'claude-code/testing'
import { dangerKeyword, isTestCommand, observe } from '../hooks/detect'

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
  expect(dangerKeyword('rm -rf build')).toBe('rm -rf')
  expect(dangerKeyword('rm -fr build')).toBe('rm -rf')
  expect(dangerKeyword('rm -r -f build')).toBe('rm -rf')
  expect(dangerKeyword('sudo rm -Rf ~/x')).toBe('rm -rf')
  expect(dangerKeyword('cd x && rm -rf y')).toBe('rm -rf')
  expect(dangerKeyword('git push --force')).toBe('git push --force')
  expect(dangerKeyword('git push -f origin main')).toBe('git push --force')
  expect(dangerKeyword('git push --force-with-lease')).toBe('git push --force')
  expect(dangerKeyword('git reset --hard HEAD~1')).toBe('git reset --hard')
  expect(dangerKeyword('git clean -fd')).toBe('git clean -fd')
  expect(dangerKeyword('git clean -f -d')).toBe('git clean -fd')
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

test('rm -rf inside temp locations does not count', async () => {
  for (const cmd of [
    'rm -rf /tmp/x',
    'sudo rm -Rf /tmp/x /var/tmp/y',
    'rm -rf "C:/Users/me/AppData/Local/Temp/claude/abc/scratchpad/wrtest"',
    'rm -rf C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\Temp\\\\build',
    'rm -rf "$TEMP/out" $TMPDIR/x ${TMP}/y',
    'rm -rf "$LOCALAPPDATA/Temp/x"',
    'rm -rf node_modules',
    'rm -rf web/node_modules packages/a/node_modules',
    'S=/c/Users/me/AppData/Local/Temp/claude/abc/scratchpad/te; rm -rf $S; mkdir -p $S',
    'SCR="C:/x/scratchpad"\nrm -rf "$SCR/restoretest" "$SCR/stage"',
    'tmp=$(mktemp -d); cd $tmp && rm -rf $tmp',
    'export T=/tmp/work && rm -rf "$T"/*',
    'cd /c/Users/me/AppData/Local/Temp/claude/abc/scratchpad && rm -rf rfs.git',
    'cd "$TEMP/claude/abc/scratchpad" 2>/dev/null; rm -rf dfcc-inspect 2>/dev/null',
  ]) expect(dangerKeyword(cmd)).toBe(null)
})

test('rm -rf still counts when any target is outside temp locations', async () => {
  for (const cmd of [
    'rm -rf /tmp',
    'rm -rf /tmp/x src',
    'rm -rf /tmp/../home/me',
    'rm -rf $UNKNOWN/x',
    'rm -rf "$HOME/project"',
    'rm -rf ~/scratch',
    'rm -rf .superpowers/sdd/2026-10-07-tea-egg',
    'D="/c/Users/me/Desktop/work"; rm -rf "$D/probe-out"',
    'cd /tmp/x && cd ~/project && rm -rf build',
    'S=/tmp/x; S=/home/me; rm -rf $S',
    'cd $(git rev-parse --show-toplevel) && rm -rf dist',
    'rm -rf /tmp/x; rm -rf build',
  ]) expect(dangerKeyword(cmd)).toBe('rm -rf')
})

test('Observation: denied calls do not count; PowerShell is observed too', async () => {
  expect(observe('Bash', 'rm -rf x', { deny: 'user denied' })).toBe(null)
  expect(observe('Bash', 'npm test', { isError: true })).toEqual({ failed: true, test: 'fail', danger: null })
  expect(observe('PowerShell', 'npm test', { isError: false })).toEqual({ failed: false, test: 'pass', danger: null })
  expect(observe('Read', '', { isError: true })).toEqual({ failed: true, test: null, danger: null })
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

test('git clean dry run is not dangerous', async () => {
  expect(dangerKeyword('git clean -nfd')).toBe(null)
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
  expect(dangerKeyword("cat > clean.sh <<'EOF'\nrm -rf build\nEOF")).toBe(null)
  expect(dangerKeyword('cat > clean.sh <<-EOF\nrm -rf build\nEOF\nls')).toBe(null)
  expect(dangerKeyword("cat > x.sh <<'EOF'\necho hi\nEOF\nrm -rf build")).toBe('rm -rf')
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
  expect(observe('Bash', 'git reset --hard', { isError: true })).toEqual({ failed: true, test: null, danger: null })
})

test('observe with dangerous commands and non-shell tools', async () => {
  expect(observe('Bash', 'rm -rf x', {})).toEqual({ failed: false, test: null, danger: 'rm -rf' })
  expect(observe('PowerShell', 'git reset --hard', {})).toEqual({ failed: false, test: null, danger: 'git reset --hard' })
  expect(observe('Read', 'rm -rf x', {})).toBe(null)
})
