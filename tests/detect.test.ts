import { test, expect } from 'claude-code/testing'
import { dangerKeyword, isTestCommand, observe } from '../hooks/detect'

test('辨識測試指令', async () => {
  for (const cmd of [
    'npm test', 'npm run test', 'pnpm test', 'yarn test', 'npx jest', 'npx vitest', 'vitest run', 'jest --watch=false',
    'pytest -q', 'python -m pytest', 'py -m pytest tests', 'go test ./...', 'cargo test', 'mvn test', 'gradle test',
    './gradlew test', 'dotnet test', 'rspec', 'phpunit', 'cd web && npm test', 'npm run test:unit',
  ]) expect(isTestCommand(cmd)).toBe(true)
  for (const cmd of ['npm install', 'git status', 'echo latest', 'cat jest.config.js', 'npm run build']) {
    expect(isTestCommand(cmd)).toBe(false)
  }
})

test('辨識危險指令', async () => {
  expect(dangerKeyword('rm -rf build')).toBe('rm -rf')
  expect(dangerKeyword('rm -fr build')).toBe('rm -rf')
  expect(dangerKeyword('rm -r -f build')).toBe('rm -rf')
  expect(dangerKeyword('sudo rm -Rf /tmp/x')).toBe('rm -rf')
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

test('只是提到危險指令時不算', async () => {
  expect(dangerKeyword('git commit -m "移除 rm -rf 的用法"')).toBe(null)
  expect(dangerKeyword("grep 'git reset --hard' docs.md")).toBe(null)
  expect(dangerKeyword('rm -r build')).toBe(null)
  expect(dangerKeyword('rm file.txt')).toBe(null)
  expect(dangerKeyword('git push origin main')).toBe(null)
  expect(dangerKeyword('truncate -s 0 log.txt')).toBe(null)
  expect(dangerKeyword('chmod 755 run.sh')).toBe(null)
})

test('觀察結果：被拒絕的呼叫不算、PowerShell 也觀察', async () => {
  expect(observe('Bash', 'rm -rf x', { deny: '使用者拒絕' })).toBe(null)
  expect(observe('Bash', 'npm test', { isError: true })).toEqual({ failed: true, test: 'fail', danger: null })
  expect(observe('PowerShell', 'npm test', { isError: false })).toEqual({ failed: false, test: 'pass', danger: null })
  expect(observe('Read', '', { isError: true })).toEqual({ failed: true, test: null, danger: null })
  expect(observe('Read', '', {})).toBe(null)
})

test('引號內的測試指令不算', async () => {
  expect(isTestCommand('git commit -m "fix npm test flake"')).toBe(false)
  expect(isTestCommand('echo "run pytest"')).toBe(false)
  expect(isTestCommand('npm test -- -t "x"')).toBe(true)
})

test('TRUNCATE 模式嚴格度', async () => {
  expect(dangerKeyword('grep -rn truncate src')).toBe(null)
  expect(dangerKeyword('truncate out.log')).toBe(null)
  expect(dangerKeyword('git commit -m "truncate long titles"')).toBe(null)
  expect(dangerKeyword('psql -c "truncate table logs"')).toBe('TRUNCATE')
  expect(dangerKeyword('sqlite3 a.db "TRUNCATE logs"')).toBe('TRUNCATE')
})

test('git clean 乾執行模式不危險', async () => {
  expect(dangerKeyword('git clean -nfd')).toBe(null)
})

test('Windows 測試指令形式', async () => {
  expect(isTestCommand('.\\gradlew test')).toBe(true)
  expect(isTestCommand('gradlew.bat test')).toBe(true)
})

test('SQL 關鍵字只在 SQL 客戶端裡才算', async () => {
  expect(dangerKeyword('grep -rn "DROP TABLE" migrations/')).toBe(null)
  expect(dangerKeyword('git commit -m "never drop table again"')).toBe(null)
  expect(dangerKeyword('Select-String -Pattern "DROP TABLE"')).toBe(null)
  expect(dangerKeyword('echo "TRUNCATE logs" > note.txt')).toBe(null)
  expect(dangerKeyword('PSQL -c "DROP TABLE users"')).toBe('DROP TABLE')
  expect(dangerKeyword('cd db && sqlcmd -Q "DROP DATABASE app"')).toBe('DROP DATABASE')
  expect(dangerKeyword('Invoke-Sqlcmd -Query "drop table t"')).toBe('DROP TABLE')
  expect(dangerKeyword('duckdb a.db "truncate table logs"')).toBe('TRUNCATE')
})

test('heredoc 內文不算指令', async () => {
  expect(dangerKeyword("cat > clean.sh <<'EOF'\nrm -rf build\nEOF")).toBe(null)
  expect(dangerKeyword('cat > clean.sh <<-EOF\nrm -rf build\nEOF\nls')).toBe(null)
  expect(dangerKeyword("cat > x.sh <<'EOF'\necho hi\nEOF\nrm -rf build")).toBe('rm -rf')
  expect(isTestCommand('cat > run.sh <<EOF\nnpm test\nEOF')).toBe(false)
})

test('測試執行器必須是指令字', async () => {
  for (const cmd of ['npm i -D jest', 'pip install pytest', 'grep -r pytest .', 'ls jest']) {
    expect(isTestCommand(cmd)).toBe(false)
  }
  expect(isTestCommand('cd web && jest')).toBe(true)
  expect(isTestCommand('sudo pytest')).toBe(true)
  expect(isTestCommand('python3 -m pytest -q')).toBe(true)
})

test('被拒絕或失敗的呼叫不算危險', async () => {
  expect(observe('Bash', 'git reset --hard', { isError: true })).toEqual({ failed: true, test: null, danger: null })
})

test('observe 呼叫中含危險指令與非 Shell 工具', async () => {
  expect(observe('Bash', 'rm -rf x', {})).toEqual({ failed: false, test: null, danger: 'rm -rf' })
  expect(observe('PowerShell', 'git reset --hard', {})).toEqual({ failed: false, test: null, danger: 'git reset --hard' })
  expect(observe('Read', 'rm -rf x', {})).toBe(null)
})
