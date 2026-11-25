import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const source = fs.readFileSync(path.resolve('src/server/integrations/subsonic.ts'), 'utf8')

const rpStart = source.indexOf('    private async handleReportPlayback')
const rpEnd = source.indexOf('    /** [书签] getBookmarks', rpStart)
assert.ok(rpStart > 0 && rpEnd > rpStart, '无法定位 handleReportPlayback')

const scStart = source.indexOf('    private async handleScrobble')
const scEnd = source.indexOf('    /**\n     * getNowPlaying', scStart)
assert.ok(scStart > 0 && scEnd > scStart, '无法定位 handleScrobble')

const methods = source.slice(rpStart, rpEnd) + '\n' + source.slice(scStart, scEnd)

const build = (opts: {
  permissionEnabled?: boolean
  userEnabled?: boolean
  location?: 'top' | 'bottom'
  initialDefault?: any[]
  metaMap?: Record<string, any>
  throwOnAdd?: boolean
} = {}) => {
  const config: Record<string, any> = {
    'subsonic.cacheOnPlay': false,
  }
  if (opts.permissionEnabled !== undefined) {
    config['subsonic.addToDefaultList'] = opts.permissionEnabled
  }
  const defaultList: any[] = [...(opts.initialDefault || [])]
  let snapshotCount = 0
  const scrobbles: any[] = []
  const responses: any[] = []

  const userSpace = {
    listManage: {
      listDataManage: {
        getListMusics: async (id: string) => {
          assert.equal(id, 'default')
          return defaultList
        },
        listMusicAdd: async (id: string, musics: any[], loc: 'top' | 'bottom') => {
          assert.equal(id, 'default')
          if (opts.throwOnAdd) throw new Error('disk full')
          if (loc === 'top') defaultList.unshift(...musics)
          else defaultList.push(...musics)
          return [id]
        },
        listMusicRemove: async (id: string, removeIds: string[]) => {
          assert.equal(id, 'default')
          const set = new Set(removeIds)
          const kept = defaultList.filter(m => !set.has(m.id))
          defaultList.splice(0, defaultList.length, ...kept)
          return [id]
        },
      },
      createSnapshot: async () => {
        snapshotCount++
      },
    },
  }

  const harness = `
class Harness {
  async resolveSongMeta(_u, id) {
    const m = mockMetaMap[id]
    return m ? { music: m, listId: 'online' } : null
  }
  sendResponse(_res, data, _format) { responses.push(data) }
  sendError(_res, code, msg) { responses.push({ error: code, msg }) }
${methods}
}
globalThis.Harness = Harness
`

  const context = vm.createContext({
    global: { lx: { config } },
    getUserSpace: () => userSpace,
    getUserConfig: () => ({ 'list.addMusicLocationType': opts.location || 'top' }),
    readSubsonicPreferences: () => ({ addToDefaultList: opts.userEnabled ?? false }),
    isLocalSong: (id: string) => id.startsWith('local_'),
    playbackReportState: new Map(),
    readScrobbles: () => scrobbles,
    writeScrobbles: (_u: string, list: any[]) => { scrobbles.splice(0, scrobbles.length, ...list) },
    onSongPlayed: () => {},
    subsonicLog: { debug() {}, warn() {}, error() {} },
    mockMetaMap: opts.metaMap || {},
    responses,
    console,
  })

  vm.runInContext(transformSync(harness, { loader: 'ts', format: 'cjs', target: 'node20' }).code, context)
  return {
    instance: new (context as any).Harness(),
    defaultList,
    getSnapshotCount: () => snapshotCount,
    scrobbles,
    responses,
  }
}

const song = (id: string) => ({ id, name: `Song ${id}`, singer: 'Singer', source: id.split('_')[0], songmid: id.split('_')[1] || id })

test('默认权限开启但用户未开启开关时，scrobble 不加入默认列表', async () => {
  const { instance, defaultList, getSnapshotCount, scrobbles } = build({
    userEnabled: false,
    metaMap: { tx_1: song('tx_1') },
  })
  await instance.handleScrobble({}, 'alice', new URLSearchParams('id=tx_1'), 'json')
  assert.equal(scrobbles.length, 1)
  assert.equal(defaultList.length, 0)
  assert.equal(getSnapshotCount(), 0)
})

test('后台权限关闭时，即使患者用户侧开启也不加入默认列表', async () => {
  const { instance, defaultList, getSnapshotCount } = build({
    permissionEnabled: false,
    userEnabled: true,
    metaMap: { tx_1: song('tx_1') },
  })
  await instance.handleScrobble({}, 'alice', new URLSearchParams('id=tx_1'), 'json')
  assert.equal(defaultList.length, 0)
  assert.equal(getSnapshotCount(), 0)
})

test('权限开启(含默认undefined)且用户开启后，scrobble 将在线歌曲元数据加入默认列表并跳过 local_ 歌曲', async () => {
  const { instance, defaultList, getSnapshotCount } = build({
    userEnabled: true,
    metaMap: { tx_1: song('tx_1'), wy_2: song('wy_2') },
  })
  await instance.handleScrobble({}, 'alice', new URLSearchParams('id=tx_1&id=local_99&id=wy_2&id=missing_1'), 'json')
  assert.deepEqual(defaultList.map(m => m.id), ['wy_2', 'tx_1'])
  assert.equal(getSnapshotCount(), 1)
})

test('同一歌曲重复 scrobble 不重复添加；已在目标位置时不再写快照', async () => {
  const { instance, defaultList, getSnapshotCount } = build({
    permissionEnabled: true,
    userEnabled: true,
    location: 'top',
    initialDefault: [song('tx_1'), song('tx_2')],
  })
  await instance.handleScrobble({}, 'alice', new URLSearchParams('id=tx_1'), 'json')
  assert.deepEqual(defaultList.map(m => m.id), ['tx_1', 'tx_2'])
  assert.equal(getSnapshotCount(), 0)

  await instance.handleScrobble({}, 'alice', new URLSearchParams('id=tx_2'), 'json')
  assert.deepEqual(defaultList.map(m => m.id), ['tx_2', 'tx_1'])
  assert.equal(getSnapshotCount(), 1)
})

test('默认列表超过 200 首时按插入方向裁剪旧歌曲', async () => {
  const initial = Array.from({ length: 200 }, (_, i) => song(`tx_${i}`))
  const { instance, defaultList } = build({
    permissionEnabled: true,
    userEnabled: true,
    location: 'top',
    initialDefault: initial,
    metaMap: { tx_new: song('tx_new') },
  })
  await instance.handleScrobble({}, 'alice', new URLSearchParams('id=tx_new'), 'json')
  assert.equal(defaultList.length, 200)
  assert.equal(defaultList[0].id, 'tx_new')
  assert.equal(defaultList[199].id, 'tx_198')
})

test('reportPlayback 仅在 stopped 且未 ignoreScrobble 时加入默认列表', async () => {
  const { instance, defaultList, getSnapshotCount } = build({
    permissionEnabled: true,
    userEnabled: true,
    metaMap: { tx_1: song('tx_1'), tx_2: song('tx_2') },
  })
  await instance.handleReportPlayback({}, 'alice', new URLSearchParams('mediaId=tx_1&state=playing'), 'json')
  await instance.handleReportPlayback({}, 'alice', new URLSearchParams('mediaId=tx_1&state=stopped&ignoreScrobble=true'), 'json')
  assert.equal(defaultList.length, 0)
  assert.equal(getSnapshotCount(), 0)

  await instance.handleReportPlayback({}, 'alice', new URLSearchParams('mediaId=tx_2&state=stopped'), 'json')
  assert.deepEqual(defaultList.map(m => m.id), ['tx_2'])
  assert.equal(getSnapshotCount(), 1)
})

test('自动收录异常不影响 scrobble 正常响应', async () => {
  const { instance, responses } = build({
    permissionEnabled: true,
    userEnabled: true,
    metaMap: { tx_1: song('tx_1') },
    throwOnAdd: true,
  })
  await instance.handleScrobble({}, 'alice', new URLSearchParams('id=tx_1'), 'json')
  assert.equal(responses.length, 1)
  assert.equal(responses[0].error, undefined)
  assert.equal(Object.keys(responses[0]).length, 0)
})
