const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')

async function harness(t, opts = {}) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-rename-test-'))
    const state = {
        temp,
        pattern: opts.pattern || 'standard',
        root: '/lx',
        // CACHE_ROOTS 的 ROOT 走 process.cwd()，桩里把两个位置都映射到临时 dataPath
        dirs: {
            data: { cache: path.join(temp, 'data', 'cache', 'user1'), music: path.join(temp, 'data', 'music', 'user1') },
            root: { cache: path.join(temp, 'data', 'cache', 'user1'), music: path.join(temp, 'data', 'music', 'user1') },
        },
        indexes: new Map(),
        rows: [],
        attachments: [],
        remote: new Map(),
        renames: [],
        uploads: [],
        localFileUpdates: [],
        busy: false,
    }
    for (const d of Object.values(state.dirs.data)) fs.mkdirSync(d, { recursive: true })

    const indexKey = (user, folder, location) => `${location}:${user}:${folder}`
    const indexManager = {
        getAll(user, folder, location) {
            const key = indexKey(user, folder, location)
            if (!state.indexes.has(key)) state.indexes.set(key, [])
            return state.indexes.get(key)
        },
        save(user, folder, location) {
            const key = indexKey(user, folder, location)
            const list = state.indexes.get(key) || []
            const dir = state.dirs[location || 'data'][folder]
            fs.writeFileSync(path.join(dir, folder === 'music' ? 'music_index.json' : 'cache_index.json'), JSON.stringify(list))
        },
        update() { throw new Error('should not rebuild index key') },
    }

    const boundary = `
        const s = global.__renameTest
        export const CACHE_ROOTS = { ROOT: 'data', DATA: 'data' }
        export function getCacheDir(user, isMusic, location) { return s.dirs[location || 'data'][isMusic ? 'music' : 'cache'] }
        export function getUserNamingPattern() { return s.pattern }
        export function migrateCoverCacheOnRename() {}
        export function getFileName(song, quality, isMusic, user, pattern) {
            const p = pattern || s.pattern
            if (p === 'simple') return song.name + ' - ' + song.singer + ' - ' + (quality || 'unknown') + ' - ' + song.albumName
            return song.name + '_-_' + song.singer + '_-_' + song.source + '_-_' + song.id + '_-_' + (quality || 'unknown')
        }
        export const indexManager = globalThis.__renameIndexManager
    `

    const dbBoundary = `
        const s = global.__renameTest
        const match = (sql) => ({
            get: (...a) => {
                if (sql.includes('remote_path = ?')) return s.rows.find(r => r.user === a[0] && r.folder_type === a[1] && r.remote_path === a[2] && !r.deleted_at) || null
                if (sql.includes('WHERE id = ?')) return s.rows.find(r => r.id === a[0]) || null
                return null
            },
            run: (...a) => {
                if (sql.startsWith('UPDATE openlist_backup_files')) {
                    const row = s.rows.find(r => r.id === a[5])
                    if (row) { row.local_path = a[0]; row.remote_path = a[1]; row.name = a[2]; row.cache_metadata = a[3] }
                } else if (sql.startsWith('UPDATE openlist_local_files')) {
                    s.localFileUpdates.push({ localPath: a[0], filename: a[1] })
                } else if (sql.startsWith('UPDATE openlist_backup_attachments')) {
                    const att = s.attachments.find(x => x.id === a[3])
                    if (att) { att.local_path = a[0]; att.remote_path = a[1] }
                }
                return {}
            },
            all: () => [],
        })
        export function getBackupDb() { return { prepare: (sql) => match(sql) } }
        export function getBackupByLocalPath(user, folder, lp) {
            return s.rows.find(r => r.user === user && r.folder_type === folder && r.local_path === lp && !r.deleted_at) || null
        }
        export function listAttachments(id) { return s.attachments.filter(a => a.backup_file_id === id && !a.deleted_at) }
    `

    const clientBoundary = `
        const path = require('node:path')
        const s = global.__renameTest
        export const OpenListNotFoundError = globalThis.__renameNotFoundError
        export function getClient() {
            return {
                resolveRemotePath(rel) { return (s.root + '/' + String(rel).replace(/^\\/+/, '')).replace(/\\/+/g, '/') },
                async listFilesRecursive() { return [...s.remote.keys()].map(p => ({ path: p, name: path.posix.basename(p), size: 1, modified: '', isDir: false })) },
                async getFileInfo(p) { if (!s.remote.has(p)) throw new OpenListNotFoundError('missing'); return { size: 1 } },
                async rename(oldPath, newName) {
                    const next = path.posix.join(path.posix.dirname(oldPath), newName)
                    if (!s.remote.has(oldPath)) throw new OpenListNotFoundError('missing')
                    s.renames.push({ oldPath, newPath: next })
                    s.remote.set(next, s.remote.get(oldPath)); s.remote.delete(oldPath)
                },
                async upload() { s.uploads.push([...arguments]) },
            }
        }
        export function isOpenlistBusy() { return !!s.busy }
    `

    await build({
        stdin: { contents: "export * from './src/server/openlist/openlistRenameSync'", resolveDir: root, loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temp, 'rename.cjs'),
        plugins: [{
            name: 'rename-boundaries',
            setup(b) {
                b.onResolve({ filter: /^(@\/server\/music\/fileCache|\.\/openlistBackupDb|\.\/openlistBackup|\.\/openlistClient)$/ }, a => ({ path: a.path, namespace: 'rb' }))
                b.onLoad({ filter: /.*/, namespace: 'rb' }, a => ({
                    loader: 'js',
                    contents: a.path === '@/server/music/fileCache' ? boundary
                        : a.path === './openlistBackupDb' ? dbBoundary : clientBoundary,
                }))
            },
        }],
    })

    global.__renameTest = state
    global.__renameIndexManager = indexManager
    global.__renameNotFoundError = class OpenListNotFoundError extends Error {}
    global.lx = { dataPath: path.join(temp, 'data'), config: { 'openlist.root': state.root } }
    const api = require(path.join(temp, 'rename.cjs'))
    t.after(() => {
        delete global.__renameTest
        delete global.__renameIndexManager
        delete global.__renameNotFoundError
        delete global.lx
        fs.rmSync(temp, { recursive: true, force: true })
    })
    return { state, api, indexManager }
}

function seed(state, indexManager, opts = {}) {
    const dir = state.dirs.data.cache
    const oldName = opts.oldName || '旧名 - 歌手 - 128k - 专辑.mp3'
    const lrcName = oldName.replace(/\.mp3$/, '.lrc')
    const oldLocal = path.join(dir, oldName)
    fs.writeFileSync(oldLocal, 'audio')
    fs.writeFileSync(path.join(dir, lrcName), 'lyric')
    const item = {
        id: 'tx_001', songmid: 'tx_001', name: '夜曲', singer: '周杰伦', album: '专辑',
        source: 'tx', quality: '128k', ext: 'mp3', filename: oldName, lyricFilename: lrcName,
        folder: 'cache', size: 5, mtime: Date.now(),
    }
    indexManager.getAll('user1', 'cache', 'data').push(item)
    const oldRemote = state.root + '/user1/cache/' + oldName
    const lrcRemote = state.root + '/user1/cache/' + lrcName
    state.remote.set(oldRemote, { body: 'audio' })
    state.remote.set(lrcRemote, { body: 'lyric' })
    state.rows.push({
        id: 1, user: 'user1', folder_type: 'cache', local_path: oldLocal, remote_path: oldRemote,
        name: oldName, cache_metadata: JSON.stringify({ filename: oldName, lyricFilename: lrcName }), deleted_at: null,
    })
    state.attachments.push({
        id: 11, backup_file_id: 1, user: 'user1', folder_type: 'cache',
        local_path: path.join(dir, lrcName), remote_path: lrcRemote, deleted_at: null,
    })
    return { oldName, oldLocal, oldRemote, lrcRemote, item, dir }
}

const EXPECTED = '夜曲_-_周杰伦_-_tx_-_tx_001_-_128k.mp3'
const EXPECTED_LRC = '夜曲_-_周杰伦_-_tx_-_tx_001_-_128k.lrc'

test('只读预览不改动本地、索引、备份库与云端', async t => {
    const { state, api, indexManager } = await harness(t)
    const s = seed(state, indexManager)
    const before = {
        local: fs.readdirSync(s.dir).sort(),
        index: JSON.stringify(indexManager.getAll('user1', 'cache', 'data')),
        rows: JSON.stringify(state.rows), remote: [...state.remote.keys()].sort(),
    }
    const plan = await api.planCacheRename({ limit: 100 })
    assert.equal(plan.scanned, 1)
    assert.equal(plan.ready, 1)
    assert.equal(plan.items[0].status, 'ready')
    assert.equal(plan.items[0].oldFilename, s.oldName)
    assert.equal(plan.items[0].newFilename, EXPECTED)
    assert.equal(plan.namingPatterns.user1, 'standard')
    assert.deepEqual(fs.readdirSync(s.dir).sort(), before.local)
    assert.equal(JSON.stringify(indexManager.getAll('user1', 'cache', 'data')), before.index)
    assert.equal(JSON.stringify(state.rows), before.rows)
    assert.deepEqual([...state.remote.keys()].sort(), before.remote)
    assert.equal(state.renames.length, 0)
})

test('执行同步改本地文件名、歌词、索引、备份库与云端，不重传音频', async t => {
    const { state, api, indexManager } = await harness(t)
    const s = seed(state, indexManager)
    const result = await api.applyCacheRename({})
    assert.equal(result.renamed, 1)
    assert.equal(result.failed, 0)
    assert.equal(result.cloudRenamed, 2)
    assert.equal(result.dbUpdated, 1)
    assert.equal(state.uploads.length, 0, 'cloud rename must not re-upload audio bytes')

    assert.ok(fs.existsSync(path.join(s.dir, EXPECTED)))
    assert.ok(!fs.existsSync(s.oldLocal))
    assert.ok(fs.existsSync(path.join(s.dir, EXPECTED_LRC)))
    assert.equal(indexManager.getAll('user1', 'cache', 'data')[0].filename, EXPECTED)
    assert.equal(state.rows[0].local_path, path.join(s.dir, EXPECTED))
    assert.equal(state.rows[0].name, EXPECTED)
    assert.equal(state.rows[0].remote_path, state.root + '/user1/cache/' + EXPECTED)
    assert.equal(JSON.parse(state.rows[0].cache_metadata).filename, EXPECTED)
    assert.ok(state.remote.has(state.root + '/user1/cache/' + EXPECTED))
    assert.ok(!state.remote.has(s.oldRemote))
    assert.ok(state.remote.has(state.root + '/user1/cache/' + EXPECTED_LRC))
    assert.equal(state.attachments[0].remote_path, state.root + '/user1/cache/' + EXPECTED_LRC)
    assert.equal(state.localFileUpdates[0].filename, EXPECTED)
})

test('重复执行可重入：已是目标格式时跳过且不产生重复改名', async t => {
    const { state, api, indexManager } = await harness(t)
    seed(state, indexManager)
    const first = await api.applyCacheRename({})
    const renameCount = state.renames.length
    const second = await api.applyCacheRename({})
    assert.equal(first.renamed, 1)
    assert.equal(second.renamed, 0)
    assert.equal(second.skipped, 1)
    assert.equal(state.renames.length, renameCount)
})

test('目标文件名冲突时跳过且不覆盖已有文件', async t => {
    const { state, api, indexManager } = await harness(t)
    const s = seed(state, indexManager)
    fs.writeFileSync(path.join(s.dir, EXPECTED), 'other')
    const plan = await api.planCacheRename({})
    assert.equal(plan.conflicts, 1)
    const result = await api.applyCacheRename({})
    assert.equal(result.renamed, 0)
    assert.equal(result.conflicts, 1)
    assert.equal(fs.readFileSync(path.join(s.dir, EXPECTED), 'utf8'), 'other')
    assert.ok(fs.existsSync(s.oldLocal))
})

test('切换命名格式按当前配置生成目标名，不写死格式', async t => {
    const { state, api, indexManager } = await harness(t, { pattern: 'simple' })
    seed(state, indexManager)
    const plan = await api.planCacheRename({})
    assert.equal(plan.namingPatterns.user1, 'simple')
    assert.equal(plan.items[0].newFilename, '夜曲 - 周杰伦 - 128k - 专辑.mp3')
})

test('未启用云端时仍改本地与备份库，且 remote_path 不写空', async t => {
    const { state, api, indexManager } = await harness(t)
    seed(state, indexManager)
    const result = await api.applyCacheRename({ cloud: false })
    assert.equal(result.renamed, 1)
    assert.equal(result.cloudRenamed, 0)
    assert.equal(state.rows[0].remote_path, state.root + '/user1/cache/' + EXPECTED)
    assert.ok(state.rows[0].remote_path.length > 0)
    assert.equal(state.renames.length, 0)
})

test('rename refuses to start while a sync, verify or upload is still running', async t => {
    const { state, api, indexManager } = await harness(t)
    const s = seed(state, indexManager)
    state.busy = true
    await assert.rejects(() => api.applyCacheRename({}), /正在同步或校验/)
    // 拒绝时不能留下任何半成品改动。
    assert.equal(state.renames.length, 0)
    assert.ok(fs.existsSync(s.oldLocal))
    assert.equal(state.rows[0].remote_path, s.oldRemote)
    state.busy = false
    const result = await api.applyCacheRename({})
    assert.equal(result.renamed, 1)
})
