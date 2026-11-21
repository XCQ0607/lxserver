import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'
import { withSourceRequestSignal } from '../src/server/sources/requestScope'

async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return address.port
}

test('ordinary and radio SDK requests both reach the real origin once through the selected proxy', { timeout: 5000 }, async t => {
  const { httpFetch } = await import('../src/modules/utils/request.js')
  const originPaths: string[] = [], authorities: string[] = []
  const origin = http.createServer((req, res) => {
    originPaths.push(req.url!)
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
    res.end(JSON.stringify({ path: req.url }))
  })
  const port = await listen(origin)
  const authority = 'music.invalid:' + port
  const proxy = http.createServer()
  const sockets = new Set<import('node:stream').Duplex>()
  proxy.on('connect', (req, downstream, head) => {
    authorities.push(req.url!)
    // This fixture only forwards to its own loopback origin, never to arbitrary hosts.
    if (req.url !== authority) { downstream.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return }
    const upstream = net.connect(port, '127.0.0.1', () => {
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      downstream.pipe(upstream).pipe(downstream)
    })
    for (const [a, b] of [[upstream, downstream], [downstream, upstream]]) {
      sockets.add(a)
      a.on('error', () => b.destroy())
      a.once('close', () => { sockets.delete(a); b.destroy() })
    }
  })
  const proxyPort = await listen(proxy)
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all([origin, proxy].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  })

  const keys = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']
  const previous = keys.map(key => process.env[key])
  t.after(() => keys.forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]
  }))
  for (const key of keys) delete process.env[key]
  process.env.HTTPS_PROXY = 'http://127.0.0.1:' + proxyPort

  const fetchTrack = (path: string) => httpFetch('http://' + authority + path).promise
  const ordinary = await fetchTrack('/ordinary')
  const radio = await withSourceRequestSignal(new AbortController().signal, () => fetchTrack('/radio'))
  assert.deepEqual([ordinary.body, radio.body], [{ path: '/ordinary' }, { path: '/radio' }])
  assert.deepEqual(authorities, [authority, authority])
  assert.deepEqual(originPaths, ['/ordinary', '/radio'])
})
