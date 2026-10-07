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
