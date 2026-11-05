import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import WebDAVSync from '../src/utils/webdavSync'

const create = () => new WebDAVSync({ enable: true, url: 'http://test.invalid', username: '', password: '', syncPath: '/sync', backupPath: '/backups' }, '.')

test('connection test inspects configured directories, never the failing root or writes', async () => {
    const sync = create()
    const calls: string[] = []
    ;(sync as any).client = {
        getDirectoryContents: async (remote: string, options: any) => {
            calls.push(remote)
            assert.ok(options.signal instanceof AbortSignal)
            assert.equal(options.deep, false)
            if (remote === '/') throw Object.assign(new Error('Bad Gateway'), { status: 502 })
            return []
        },
    }
    const result = await sync.testConnection()
    assert.equal(result.success, true)
    assert.deepEqual(calls.sort(), ['/backups', '/sync'])
    assert.match(result.message, /上传、删除权限及完整恢复能力尚未验证/)
})

test('each directory retains its result and actionable HTTP diagnostics', async t => {
    for (const [status, expected] of [[401, '认证失败'], [403, '权限'], [404, '首次上传'], [405, 'PROPFIND'], [501, 'PROPFIND'], [502, '不代表上传一定失败'], [503, '网关'], [504, '网关']] as const) {
        await t.test(String(status), async () => {
            const sync = create()
            ;(sync as any).client = {
                getDirectoryContents: async (remote: string) => {
                    if (remote === '/backups') throw Object.assign(new Error('secret password upstream body'), { response: { status } })
                    return []
                },
            }
            const result = await sync.testConnection()
            assert.equal(result.success, false)
            assert.match(result.message, /部分目录/)
            assert.equal(result.checks![0].success, true)
            assert.equal(result.checks![1].success, false)
            assert.match(result.checks![1].message, new RegExp(expected))
            assert.match(result.checks![1].message, new RegExp(`HTTP ${status}`))
            assert.doesNotMatch(JSON.stringify(result), /secret password/)
        })
    }
})

test('network, certificate and timeout failures give specific guidance', async () => {
    for (const [code, expected] of [['ENOTFOUND', '域名解析'], ['ECONNREFUSED', '连接被拒绝'], ['SELF_SIGNED_CERT_IN_CHAIN', '证书'], ['ECONNABORTED', '超时']]) {
        const sync = create()
        ;(sync as any).client = { getDirectoryContents: async () => { throw Object.assign(new Error('request failed'), { code }) } }
        const result = await sync.testConnection()
        assert.equal(result.success, false)
        assert.ok(result.checks!.every(check => check.message.includes(expected)))
    }
})

test('real WebDAV HTTP requests use configured paths when root returns 502', async t => {
    const requests: string[] = []
    const server = http.createServer((req, res) => {
        requests.push(`${req.method} ${req.url}`)
        req.resume()
        req.on('end', () => {
            if (req.url === '/') { res.writeHead(502); res.end(); return }
            res.writeHead(207, { 'Content-Type': 'application/xml' })
            res.end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>')
        })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
    const address = server.address() as { port: number }
    const sync = new WebDAVSync({ enable: true, url: `http://127.0.0.1:${address.port}`, username: '', password: '', syncPath: '/sync', backupPath: '/backups' }, '.')
    const result = await sync.testConnection()
    assert.equal(result.success, true, JSON.stringify(result))
    assert.deepEqual(requests.sort(), ['PROPFIND /backups/', 'PROPFIND /sync/'])
})

test('disabled and missing configuration do not initialize a client', async () => {
    for (const config of [{ enable: false, url: 'http://test.invalid' }, { enable: true, url: '' }]) {
        const sync = new WebDAVSync({ ...config, username: '', password: '' }, '.')
        ;(sync as any).initClient = () => { throw new Error('must not initialize') }
        assert.equal((await sync.testConnection()).success, false)
    }
})

test('a stalled directory request is aborted after ten seconds', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const sync = create()
    let aborted = 0
    ;(sync as any).client = {
        getDirectoryContents: async (_remote: string, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => { aborted++; reject(new Error('request aborted')) })
        }),
    }
    const pending = sync.testConnection()
    await Promise.resolve()
    t.mock.timers.tick(10000)
    const result = await pending
    assert.equal(aborted, 2)
    assert.equal(result.success, false)
    assert.ok(result.checks!.every(check => check.message.includes('超时')))
})
