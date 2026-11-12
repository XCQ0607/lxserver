import test from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import {
    isLosslessQualityRequest,
    isLikelyLossyAudio,
    probeReturnedMusicUrl,
    selectCandidateMusicUrl,
    type CandidateApiLike,
} from '../src/server/sources/userApi'

function startTestServer(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler)
        server.on('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address()
            if (!addr || typeof addr === 'string') {
                reject(new Error('Failed to bind test server'))
                return
            }
            resolve({
                baseUrl: `http://127.0.0.1:${addr.port}`,
                close: () => new Promise((res) => server.close(() => res())),
            })
        })
    })
}

test('isLosslessQualityRequest identifies lossless and lossy quality labels', () => {
    for (const q of ['flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master', 'wav']) {
        assert.equal(isLosslessQualityRequest(q), true, `${q} should be lossless`)
    }
    for (const q of ['128k', '320k', '']) {
        assert.equal(isLosslessQualityRequest(q), false, `${q} should not be lossless`)
    }
})

test('isLikelyLossyAudio handles explicit extensions, QQ prefixes, and mislabeled FLAC Content-Type', () => {
    // Some CDNs serve .flac with Content-Type: audio/mpeg; explicit .flac must win
    assert.equal(isLikelyLossyAudio('https://cdn.example.com/track.flac', 'audio/mpeg; charset=UTF-8'), false)
    assert.equal(isLikelyLossyAudio('https://cdn.example.com/F0M0002h34qL0ltUrq.mflac', 'audio/x-ogg'), false)

    // Explicit lossy extensions and QQ lossy prefixes
    assert.equal(isLikelyLossyAudio('https://cdn.example.com/9c7496bff34d7dccdf4f808437e58b5a.mp3', 'audio/mpeg'), true)
    assert.equal(isLikelyLossyAudio('https://cdn.example.com/C4000001gcyS052HCj.m4a', 'application/x-www-form-urlencoded'), true)
    assert.equal(isLikelyLossyAudio('https://cdn.example.com/M5000001gcyS052HCj.mp3', 'audio/mpeg'), true)
    assert.equal(isLikelyLossyAudio('https://cdn.example.com/M8000001gcyS052HCj.mp3', 'audio/mpeg'), true)

    // Extensionless URL with audio/mpeg header is treated as lossy
    assert.equal(isLikelyLossyAudio('https://cdn.example.com/stream?id=123', 'audio/mpeg'), true)
    assert.equal(isLikelyLossyAudio('https://cdn.example.com/stream?id=123', 'audio/flac'), false)
})

test('probeReturnedMusicUrl rejects 401/403/404 and non-audio pages while tolerating 405 HEAD', async () => {
    const srv = await startTestServer((req, res) => {
        if (req.url === '/unauth.flac') {
            res.writeHead(401)
            res.end()
            return
        }
        if (req.url === '/missing.flac') {
            res.writeHead(404)
            res.end()
            return
        }
        if (req.url === '/html-err') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end()
            return
        }
        if (req.url === '/head-unsupported.flac') {
            res.writeHead(405)
            res.end()
            return
        }
        if (req.url === '/mislabeled.flac') {
            res.writeHead(200, { 'Content-Type': 'audio/mpeg; charset=UTF-8' })
            res.end()
            return
        }
        if (req.url === '/downgrade.mp3') {
            res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
            res.end()
            return
        }
        res.writeHead(200, { 'Content-Type': 'audio/flac' })
        res.end()
    })

    try {
        const p401 = await probeReturnedMusicUrl(`${srv.baseUrl}/unauth.flac`, 'master', 'SrcA')
        assert.equal(p401.ok, false)
        assert.match(p401.reason || '', /401/)

        const p404 = await probeReturnedMusicUrl(`${srv.baseUrl}/missing.flac`, 'flac', 'SrcA')
        assert.equal(p404.ok, false)
        assert.match(p404.reason || '', /404/)

        const pHtml = await probeReturnedMusicUrl(`${srv.baseUrl}/html-err`, 'flac', 'SrcA')
        assert.equal(pHtml.ok, false)
        assert.match(pHtml.reason || '', /非音频内容/)

        const p405 = await probeReturnedMusicUrl(`${srv.baseUrl}/head-unsupported.flac`, 'flac', 'SrcA')
        assert.equal(p405.ok, true)
        assert.equal(p405.isLossyDowngrade, false)

        const pMislabeled = await probeReturnedMusicUrl(`${srv.baseUrl}/mislabeled.flac`, 'hires', 'SrcA')
        assert.equal(pMislabeled.ok, true)
        assert.equal(pMislabeled.isLossyDowngrade, false)

        const pLossy = await probeReturnedMusicUrl(`${srv.baseUrl}/downgrade.mp3`, 'hires', 'SrcA')
        assert.equal(pLossy.ok, true)
        assert.equal(pLossy.isLossyDowngrade, true)

        const pLossyRequested = await probeReturnedMusicUrl(`${srv.baseUrl}/downgrade.mp3`, '320k', 'SrcA')
        assert.equal(pLossyRequested.ok, true)
        assert.equal(pLossyRequested.isLossyDowngrade, false)
    } finally {
        await srv.close()
    }
})

test('selectCandidateMusicUrl skips 401 and silent lossy downgrades to prefer lossless, falling back if needed', async () => {
    const srv = await startTestServer((req, res) => {
        if (req.url === '/unauth.flac') {
            res.writeHead(401)
            res.end()
            return
        }
        if (req.url === '/silent-128k.mp3') {
            res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
            res.end()
            return
        }
        if (req.url === '/real-hires.flac') {
            res.writeHead(200, { 'Content-Type': 'audio/flac' })
            res.end()
            return
        }
        res.writeHead(404)
        res.end()
    })

    try {
        const makeApi = (id: string, name: string, urlOrErr: string | Error): CandidateApiLike => ({
            info: { id, name, owner: 'open' },
            async callRequest() {
                if (urlOrErr instanceof Error) throw urlOrErr
                return urlOrErr
            },
        })

        // 1. Source 1 returns 401, Source 2 returns silent .mp3, Source 3 returns real .flac -> picks Source 3
        const res1 = await selectCandidateMusicUrl(
            [
                makeApi('s1', 'DeadAuth', `${srv.baseUrl}/unauth.flac`),
                makeApi('s2', 'SilentDowngrade', `${srv.baseUrl}/silent-128k.mp3`),
                makeApi('s3', 'RealLossless', `${srv.baseUrl}/real-hires.flac`),
            ],
            'wy',
            { name: 'Song', singer: 'Artist' },
            'hires'
        )
        assert.equal(res1.sourceId, 's3')
        assert.equal(res1.url, `${srv.baseUrl}/real-hires.flac`)

        // 2. Source 1 returns silent .mp3, Source 2 throws -> falls back to Source 1's working .mp3
        const res2 = await selectCandidateMusicUrl(
            [
                makeApi('s1', 'SilentDowngrade', `${srv.baseUrl}/silent-128k.mp3`),
                makeApi('s2', 'Broken', new Error('后端失败')),
            ],
            'wy',
            { name: 'Song', singer: 'Artist' },
            'hires'
        )
        assert.equal(res2.sourceId, 's1')
        assert.equal(res2.url, `${srv.baseUrl}/silent-128k.mp3`)

        // 3. When 320k is requested, Source 1's .mp3 is accepted immediately without trying Source 2
        let s2Called = false
        const res3 = await selectCandidateMusicUrl(
            [
                makeApi('s1', 'LossyFirst', `${srv.baseUrl}/silent-128k.mp3`),
                {
                    info: { id: 's2', name: 'Second', owner: 'open' },
                    async callRequest() {
                        s2Called = true
                        return `${srv.baseUrl}/real-hires.flac`
                    },
                },
            ],
            'wy',
            { name: 'Song', singer: 'Artist' },
            '320k'
        )
        assert.equal(res3.sourceId, 's1')
        assert.equal(s2Called, false)
    } finally {
        await srv.close()
    }
})
