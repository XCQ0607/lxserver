import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import defaultConfig from '../src/defaultConfig'
import { getNextConfigBackupTime, configBackupTimerDelay } from '../src/utils/configBackupSchedule'

const hour = 3_600_000
test('empty anchor schedules from now, configured anchor aligns to local time', () => {
  const now = new Date(2026, 10, 6, 10, 30).getTime()
  assert.equal(getNextConfigBackupTime('', 2 * hour, now), now + 2 * hour)
  assert.equal(getNextConfigBackupTime('12:00', 24 * hour, now), new Date(2026, 10, 6, 12).getTime())
  assert.equal(getNextConfigBackupTime('00:00', 2 * hour, now), new Date(2026, 10, 6, 12).getTime())
  assert.equal(getNextConfigBackupTime('99:99', hour, now), now + hour)
})
test('multi-day and missed schedules advance from the previous planned run', () => {
  const previous = new Date(2026, 10, 6, 12).getTime()
  assert.equal(getNextConfigBackupTime('12:00', 48 * hour, previous + 1, previous), previous + 48 * hour)
  assert.equal(getNextConfigBackupTime('12:00', 48 * hour, previous + 50 * hour, previous), previous + 96 * hour)
  assert.equal(configBackupTimerDelay(previous + 8760 * hour, previous), 2_147_483_647)
  assert.equal(configBackupTimerDelay(previous + hour, previous), hour)
})

test('startup and hot reload retain saved backup interval and empty anchor', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-backup-reload-'))
  try {
    const configFile = path.join(temp, 'config.js')
    fs.writeFileSync(configFile, 'module.exports = { "configBackup.intervalHours": 3, "configBackup.scheduleTime": "" }')
    const source = fs.readFileSync(path.resolve('src/index.ts'), 'utf8')
    const body = source.slice(source.indexOf('const margeConfig ='), source.indexOf('// 配置文件加载与平滑迁移'))
    let rescheduled = 0
    const lx = { config: { ...defaultConfig }, rescheduleConfigBackup: () => rescheduled++ }
    const context = vm.createContext({ fs, path, require: createRequire(configFile), defaultConfig, global: { lx }, mergeConfigFileEnv() {}, console: { log() {}, warn() {} } })
    vm.runInContext(transformSync(body + '\nglobal.load = margeConfig', { loader: 'ts' }).code, context)
    assert.equal(context.global.load(configFile), true)
    assert.equal(lx.config['configBackup.intervalHours'], 3)
    assert.equal(lx.config['configBackup.scheduleTime'], '')
    assert.equal(rescheduled, 1)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
