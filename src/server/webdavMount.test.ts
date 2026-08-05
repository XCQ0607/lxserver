import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'wdmount-test2-'))
;(global as any).lx = { dataPath: tmpData }

import * as wm from './webdavMount'

// ===== 简易 WebDAV mock 服务器 =====
// 目录结构:
//   / (root)
//     music/            (dir)
//       a.mp3           (file, 1024)
//       b.flac          (file, 2048)
//       sub/            (dir)
//         c.ogg         (file, 512)
//     notes.txt         (file, 100)
const tree: Record<string, Array<{ name: string; type: 'file' | 'directory'; size: number }>> = {
  '': [
    { name: 'music', type: 'directory', size: 0 },
    { name: 'notes.txt', type: 'file', size: 100 },
  ],
  '/music': [
    { name: 'a.mp3', type: 'file', size: 1024 },
    { name: 'b.flac', type: 'file', size: 2048 },
    { name: 'sub', type: 'directory', size: 0 },
  ],
  '/music/sub': [
    { name: 'c.ogg', type: 'file', size: 512 },
  ],
}

// 文件内容生成：按路径确定性生成，便于验证 Range
const fileContent = (filePath: string, size: number): Buffer => {
  const buf = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buf[i] = (filePath.charCodeAt(i % filePath.length) + i) % 256
  return buf
}

const parseDavPath = (urlPath: string): string => {
  const u = new URL(urlPath, 'http://localhost')
  return decodeURIComponent(u.pathname).replace(new RegExp('^/dav'), '')
}

const server = http.createServer((req, res) => {
  const davPath = parseDavPath(req.url || '/')
  res.setHeader('Content-Type', 'application/xml')
  const dir = (davPath === '/' ? '' : davPath).replace(/\/+$/, '')
  const list = tree[dir]
  const effectivePath = dir === '' ? '/' : dir
  if (req.method === 'GET') {
    // GET 返回文件内容（支持 Range）
    const name = dir.split('/').pop() || ''
    const parent = dir.substring(0, dir.lastIndexOf('/'))
    const parentDir = parent === '' ? '/' : parent
    const base = tree[parentDir] || []
    const entry = base.find(it => it.name === name && it.type === 'file')
    if (!entry) { res.statusCode = 404; res.end('<error/>'); return }
    const content = fileContent('/dav' + dir, entry.size)
    const range = req.headers.range as string | undefined
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      const start = m && m[1] ? parseInt(m[1], 10) : 0
      const end = m && m[2] ? parseInt(m[2], 10) : entry.size - 1
      const chunk = content.subarray(start, end + 1)
      res.writeHead(206, {
        'Content-Type': 'audio/mpeg',
        'Content-Range': `bytes ${start}-${end}/${entry.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunk.length,
      })
      res.end(chunk)
    } else {
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Content-Length': entry.size,
      })
      res.end(content)
    }
    return
  }
  if (req.method === 'PROPFIND' && list) {
    const entries = list.map((it, i) => {
      const href = effectivePath.replace(/\/$/, '') + '/' + it.name
      const isDir = it.type === 'directory'
      return `<response><href>/dav${encodeURI(href)}</href><propstat><prop><resourcetype>${isDir ? '<collection/>' : ''}</resourcetype><getcontentlength>${it.size}</getcontentlength><getlastmodified>${new Date(1700000000000 + i).toUTCString()}</getlastmodified><displayname>${it.name}</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response>`
    })
    res.end(`<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:ns0="DAV:"><response><href>${encodeURI(effectivePath)}</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>${entries.join('')}</multistatus>`)
    return
  }
  res.statusCode = 404
  res.end('<error/>')
})

let port = 0
const listen = (): Promise<number> => new Promise(resolve => {
  server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port))
})

describe('webdavMount 基础框架', () => {
  test('CRUD: 新增/查询/更新/删除挂载源', () => {
    const m = wm.addMount({
      name: '测试WebDAV',
      baseUrl: 'alist.example.com/dav/音乐',
      username: 'user1',
      password: 'secret',
      rootPath: '/',
    })
    assert.ok(m.id)
    assert.ok(m.id.startsWith('wd_'))
    assert.equal(m.baseUrl, 'http://alist.example.com/dav/音乐', '无协议应补 http://')
    assert.equal(m.enabled, true)

    const got = wm.getMount(m.id)
    assert.ok(got)
    assert.equal(got.name, '测试WebDAV')

    const updated = wm.updateMount(m.id, { name: '改名' })
    assert.ok(updated)
    assert.equal(wm.getMount(m.id)!.name, '改名')

    assert.ok(wm.deleteMount(m.id))
    assert.equal(wm.getMount(m.id), null)
  })

  test('删除挂载源会清理其缓存目录', () => {
    const m = wm.addMount({ name: '缓存清理', baseUrl: 'http://x.example.com' })
    const cacheDir = path.join(tmpData, 'webdav-cache', m.id)
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(path.join(cacheDir, 'a.mp3'), 'x')
    assert.ok(fs.existsSync(cacheDir))
    assert.ok(wm.deleteMount(m.id))
    assert.equal(fs.existsSync(cacheDir), false, '删除挂载源应清理缓存目录')
  })

  test('缺 baseUrl 新增应抛错', () => {
    assert.throws(() => wm.addMount({ name: 'no-url' }), /缺少 WebDAV 地址/)
  })

  test('持久化到 webdav-mounts.json', () => {
    wm.addMount({ name: '持久化', baseUrl: 'http://persist.example.com', username: 'u', password: 'p' })
    const file = path.join(tmpData, 'webdav-mounts.json')
    assert.ok(fs.existsSync(file))
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.ok(Array.isArray(parsed.mounts))
    assert.ok(parsed.mounts.length >= 1)
    assert.ok(parsed.mounts.some((m: any) => m.name === '持久化'))
  })

  test('浏览不存在的挂载源返回错误', async () => {
    const res = await wm.listFiles({ id: 'nope', name: 'x', baseUrl: 'http://127.0.0.1:1', username: '', password: '', rootPath: '/', enabled: true, createdAt: 0 } as any, '/', 1000)
    assert.ok(res.items.length === 0)
    assert.ok(res.error, '应返回连接错误信息')
  })

  test('testConnection: 不存在的挂载源返回失败', async () => {
    const res = await wm.testConnection('not-exist-id')
    assert.equal(res.ok, false)
    assert.match(res.message, /挂载源不存在/)
  })

  test('testConnection: 无法连接返回失败信息', async () => {
    const m = wm.addMount({ name: '无法连接', baseUrl: 'http://127.0.0.1:1' })
    const res = await wm.testConnection(m.id)
    assert.equal(res.ok, false)
    assert.ok(res.message)
  })
})

describe('webdavMount 音频索引', () => {
  test('browse 返回目录与文件列表', async () => {
    port = await listen()
    const m = wm.addMount({ name: 'mock', baseUrl: `http://127.0.0.1:${port}/dav`, rootPath: '/' })
    const res = await wm.browse(m.id, '/')
    assert.equal(res.success, true)
    assert.ok(res.items)
    const names = res.items!.map(i => i.name)
    assert.ok(names.includes('music'))
    assert.ok(names.includes('notes.txt'))
    const music = res.items!.find(i => i.name === 'music')
    assert.equal(music!.isDir, true)
  })

  test('collectAudioFiles 递归收集全部音频(映射为 webdav 条目)', async () => {
    const m = wm.addMount({ name: 'mock2', baseUrl: `http://127.0.0.1:${port}/dav`, rootPath: '/' })
    const files = await wm.getLocalIndex(m.id, true)
    assert.ok(Array.isArray(files))
    assert.equal(files.length, 3, '应收集 3 个音频文件(music/a.mp3, b.flac, sub/c.ogg)')

    const a = files.find((f: any) => f.name === 'a')
    assert.ok(a, '应包含 a.mp3 的条目')
    assert.equal(a.source, 'webdav')
    assert.equal(a.folder, 'webdav')
    assert.equal(a.serverId, m.id)
    assert.equal(a.path, '/music/a.mp3')
    assert.equal(a.size, 1024)
    assert.ok(a.url.startsWith('/api/webdav-mounts/stream?server='))
    assert.ok(a.url.includes(encodeURIComponent('/music/a.mp3')))
    assert.ok(a.id.startsWith('webdav_'))

    const c = files.find((f: any) => f.name === 'c')
    assert.ok(c, '应递归到子目录 sub 收集 c.ogg')
    assert.equal(c.subPath, '/music/sub')
  })

  test('local-index 缓存: 第二次调用不重新扫描(TTL 内直接返回)', async () => {
    const m = wm.addMount({ name: 'mock3', baseUrl: `http://127.0.0.1:${port}/dav`, rootPath: '/' })
    const first = await wm.getLocalIndex(m.id, true)
    const second = await wm.getLocalIndex(m.id)
    assert.equal(second.length, first.length)
  })

  test('getAllLocalIndex 合并全部启用挂载源', async () => {
    const merged = await wm.getAllLocalIndex()
    assert.ok(Array.isArray(merged))
  })

  test('clearLocalIndex 清空索引缓存', async () => {
    const m = wm.addMount({ name: 'mock4', baseUrl: `http://127.0.0.1:${port}/dav`, rootPath: '/' })
    await wm.getLocalIndex(m.id, true)
    wm.clearLocalIndex(m.id)
    const files = await wm.getLocalIndex(m.id)
    assert.ok(Array.isArray(files))
  })

  test('禁用或缺失挂载源返回空索引', async () => {
    const files = await wm.getLocalIndex('not-exist')
    assert.deepEqual(files, [])
    const m = wm.addMount({ name: 'disabled', baseUrl: `http://127.0.0.1:${port}/dav`, rootPath: '/', enabled: false })
    const files2 = await wm.getLocalIndex(m.id)
    assert.deepEqual(files2, [])
  })
})

describe('webdavMount 边播边缓存', () => {
  test('缓存路径: hash 命名保留扩展名, 同一文件幂等', () => {
    const m = { id: 'wd_1', name: 'x', baseUrl: 'http://x', username: '', password: '', rootPath: '/', enabled: true, createdAt: 0 } as any
    const p1 = wm.getCacheFilePath(m, '/music/a.mp3')
    const p2 = wm.getCacheFilePath(m, '/music/a.mp3')
    assert.equal(p1, p2)
    assert.ok(p1.endsWith('.mp3'))
    assert.ok(p1.includes(path.join('webdav-cache', 'wd_1')))
    const p3 = wm.getCacheFilePath(m, '/music/b.flac')
    assert.ok(p3.endsWith('.flac'))
    assert.notEqual(p1, p3, '不同文件 hash 不同')
  })

  test('downloadToCache 完整下载落盘并支持后续缓存命中', async () => {
    const m = wm.addMount({ name: 'cache-mock', baseUrl: `http://127.0.0.1:${port}/dav`, rootPath: '/' })
    const filePath = '/music/a.mp3'
    assert.equal(wm.isFileCached(m, filePath), false)
    const ok = await wm.downloadToCache(m, filePath)
    assert.equal(ok, true)
    assert.equal(wm.isFileCached(m, filePath), true)

    const cacheFile = wm.getCacheFilePath(m, filePath)
    const stat = fs.statSync(cacheFile)
    assert.equal(stat.size, 1024, '缓存文件大小应与源一致')

    const progress = wm.getCacheProgress(m.id, filePath)
    assert.ok(progress)
    assert.equal(progress.done, true)
    assert.equal(progress.received, 1024)
  })

  test('downloadToCache 单飞去重: 并发调用只下载一次', async () => {
    const m = wm.addMount({ name: 'dedup-mock', baseUrl: `http://127.0.0.1:${port}/dav`, rootPath: '/' })
    const filePath = '/music/b.flac'
    const [r1, r2, r3] = await Promise.all([
      wm.downloadToCache(m, filePath),
      wm.downloadToCache(m, filePath),
      wm.downloadToCache(m, filePath),
    ])
    assert.deepEqual([r1, r2, r3], [true, true, true])
    assert.equal(wm.isFileCached(m, filePath), true)
  })

  test('serveCacheFile: 完整与 Range 响应', async () => {
    const m = wm.addMount({ name: 'serve-mock', baseUrl: `http://127.0.0.1:${port}/dav`, rootPath: '/' })
    await wm.downloadToCache(m, '/music/a.mp3')
    const cacheFile = wm.getCacheFilePath(m, '/music/a.mp3')

    // 完整响应
    let captured: any = null
    const fakeResFull: any = new (class {
      writeHead(code: number, headers: any) { captured = { code, headers } }
      write(chunk: any, cb?: any) { if (typeof cb === 'function') cb(); return true }
      end() { }
      on() { }
      once() { }
      emit() { }
      destroy() { }
    })()
    const served = wm.serveCacheFile(cacheFile, undefined, fakeResFull)
    assert.equal(served, true)
    assert.equal(captured.code, 200)
    assert.equal(captured.headers['Content-Length'], 1024)
    assert.equal(captured.headers['Accept-Ranges'], 'bytes')

    // Range 响应
    let capturedRange: any = null
    const fakeResRange: any = new (class {
      writeHead(code: number, headers: any) { capturedRange = { code, headers } }
      write(chunk: any, cb?: any) { if (typeof cb === 'function') cb(); return true }
      end() { }
      on() { }
      once() { }
      emit() { }
      destroy() { }
    })()
    wm.serveCacheFile(cacheFile, 'bytes=0-99', fakeResRange)
    assert.equal(capturedRange.code, 206)
    assert.equal(capturedRange.headers['Content-Length'], 100)
    assert.equal(capturedRange.headers['Content-Range'], 'bytes 0-99/1024')
  })

  test('serveCacheFile: 无效 Range 返回 416, 不存在的文件返回 false', () => {
    let captured: any = null
    const fakeRes: any = { writeHead: (code: number, headers: any) => { captured = { code, headers } }, end: () => { } }
    const served = wm.serveCacheFile('/nonexistent', undefined, fakeRes)
    assert.equal(served, false)

    // 超出文件大小的 range
    const tmp = path.join(tmpData, 'tiny.mp3')
    fs.writeFileSync(tmp, Buffer.alloc(50))
    wm.serveCacheFile(tmp, 'bytes=500-600', fakeRes)
    assert.equal(captured.code, 416)
  })

  test('stream: 原生代理 GET 返回文件流(带 Range)', async () => {
    const m = wm.addMount({ name: 'stream-mock', baseUrl: `http://127.0.0.1:${port}/dav`, rootPath: '/' })
    const data = await new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      const proxyReq = wm.stream(m, '/music/a.mp3', 'bytes=0-31')
      proxyReq.on('error', reject)
      proxyReq.on('response', (resp: any) => {
        const chunks: Buffer[] = []
        resp.on('data', (c: Buffer) => chunks.push(c))
        resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks) }))
      })
    })
    assert.equal(data.status, 206)
    assert.equal(data.body.length, 32, 'Range 0-31 应为 32 字节')
  })

  test('cacheStatus / clearCache: 汇总与清空', async () => {
    const m = wm.addMount({ name: 'status-mock', baseUrl: `http://127.0.0.1:${port}/dav`, rootPath: '/' })
    await wm.downloadToCache(m, '/music/a.mp3')
    const st = wm.cacheStatus(m.id)
    assert.equal(st.fileCount, 1)
    assert.equal(st.size, 1024)

    wm.clearCache(m.id)
    const st2 = wm.cacheStatus(m.id)
    assert.equal(st2.fileCount, 0)
    assert.equal(wm.isFileCached(m, '/music/a.mp3'), false)
  })
})

import { after } from 'node:test'
after(() => {
  server.close()
  try { fs.rmSync(tmpData, { recursive: true, force: true }) } catch (e) { /* ignore */ }
})
void crypto
