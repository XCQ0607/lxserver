import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

/**
 * 提取 SnapshotDataManage 中与 imported 相关的真实成员，放进最小 Harness 里执行。
 * 歌单与不喜欢两份实现分别加载，用同一组断言验证行为对称。
 */
const MEMBERS = [
  'private getImported =',
  'private persistSnapshotInfo =',
  'markImported =',
  'unmarkImported =',
  'isImported =',
  'getSnapshotListWithMeta =',
]

const extractMember = (lines: string[], marker: string): string => {
  const start = lines.findIndex(line => line.includes(marker))
  assert.ok(start >= 0, `找不到成员 ${marker}`)
  let end = start + 1
  for (; end < lines.length; end++) {
    if (/^  [A-Za-z_]\w*\s*[=(]/.test(lines[end])) break
  }
  return lines.slice(start, end).join('\n')
}

const build = (rel: string, dir: string) => {
  const src = fs.readFileSync(path.resolve(rel), 'utf8')
  const lines = src.split('\n')
  const members = MEMBERS.map(m => extractMember(lines, m)).join('\n')
  const infoPath = path.join(dir, 'snapshotInfo.json')
  const snapshotDir = path.join(dir, 'snapshot')
  fs.mkdirSync(snapshotDir, { recursive: true })
  const harness = `
class Harness {
  snapshotInfo = { latest: null, time: 0, list: [], clients: {} }
  snapshotInfoFilePath = ${JSON.stringify(infoPath)}
  snapshotDir = ${JSON.stringify(snapshotDir)}
${members}
}
globalThis.Harness = Harness
`
  const context = vm.createContext({
    fs,
    path,
    syncLog: { warn() {}, error() {} },
    console,
    global: { lx: {} },
  })
  vm.runInContext(transformSync(harness, { loader: 'ts', format: 'cjs', target: 'node20' }).code, context)
  return { instance: new (context as any).Harness(), infoPath, snapshotDir }
}

const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const md5 = 'a'.repeat(32)

for (const rel of ['src/modules/list/snapshotDataManage.ts', 'src/modules/dislike/snapshotDataManage.ts']) {
  const label = rel.includes('/list/') ? '歌单' : '不喜欢'

  test(`S6 ${label}：旧索引无 imported 字段时兼容降级`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-imported-'))
    try {
      const { instance } = build(rel, dir)
      assert.equal(instance.isImported(md5), false, '32 位 md5 应视为系统快照')
      assert.equal(instance.isImported('user-backup'), true, '非 md5 文件名应视为用户导入')
      assert.deepEqual(plain(instance.snapshotInfo.imported), [])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  test(`S6 ${label}：来源登记幂等且落盘持久化`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-imported-'))
    try {
      const { instance, infoPath } = build(rel, dir)
      instance.markImported('backup-1')
      instance.markImported('backup-1')
      instance.markImported('backup-2')
      assert.deepEqual(plain(instance.snapshotInfo.imported), ['backup-1', 'backup-2'])
      assert.deepEqual(JSON.parse(fs.readFileSync(infoPath, 'utf8')).imported, ['backup-1', 'backup-2'])
      instance.unmarkImported('not-there')
      assert.deepEqual(plain(instance.snapshotInfo.imported), ['backup-1', 'backup-2'])
      instance.unmarkImported('backup-1')
      assert.deepEqual(plain(instance.snapshotInfo.imported), ['backup-2'])
      instance.markImported(md5)
      assert.equal(instance.isImported(md5), true, '显式登记应优先于 md5 推断')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  test(`S6 ${label}：快照列表 origin 判定与按时间倒序`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-imported-'))
    try {
      const { instance, snapshotDir } = build(rel, dir)
      const autoFile = path.join(snapshotDir, `snapshot_${md5}`)
      const importFile = path.join(snapshotDir, 'snapshot_user-backup')
      fs.writeFileSync(autoFile, '{}')
      fs.writeFileSync(importFile, '{}')
      fs.utimesSync(importFile, new Date(1000), new Date(1000))
      fs.utimesSync(autoFile, new Date(2000), new Date(2000))
      const list = plain(await instance.getSnapshotListWithMeta())
      assert.equal(list.length, 2)
      assert.equal(list[0].id, md5)
      assert.equal(list[0].origin, 'auto')
      assert.equal(list[1].id, 'user-backup')
      assert.equal(list[1].origin, 'imported')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
}

test('S7 双实现对称性：歌单与不喜欢的 imported 语义一致', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-imported-a-'))
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-imported-b-'))
  try {
    const x = build('src/modules/list/snapshotDataManage.ts', a).instance
    const y = build('src/modules/dislike/snapshotDataManage.ts', b).instance
    for (const inst of [x, y]) {
      inst.markImported('same')
      inst.markImported('same')
      inst.markImported(md5)
    }
    assert.deepEqual(plain(x.snapshotInfo.imported), plain(y.snapshotInfo.imported))
    assert.equal(x.isImported('same'), y.isImported('same'))
    assert.equal(x.isImported(md5), y.isImported(md5))
    assert.equal(x.isImported('other'), y.isImported('other'))
    for (const inst of [x, y]) inst.unmarkImported('same')
    assert.deepEqual(plain(x.snapshotInfo.imported), plain(y.snapshotInfo.imported))
  } finally {
    fs.rmSync(a, { recursive: true, force: true })
    fs.rmSync(b, { recursive: true, force: true })
  }
})
