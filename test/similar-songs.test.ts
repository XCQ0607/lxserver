import test from 'node:test'
import assert from 'node:assert/strict'
import { creditedArtist, fetchSimilarSongs, findOriginalOfUpload, type SimilarDeps } from '../src/server/utils/similarSongs'

const song = (source: string, id: number, name: string, singer: string) => ({
    source, songId: id, songmid: `mid${id}`, name, singer,
})

function fakeDeps(overrides: Partial<SimilarDeps> = {}) {
    const calls: string[] = []
    const deps: SimilarDeps = {
        shuffle: overrides.shuffle ?? (list => list),
        radio: async (seed) => {
            calls.push(`radio:${seed.name}`)
            return overrides.radio ? overrides.radio(seed) : []
        },
        txSimilar: async (songId) => {
            calls.push(`similar:${songId}`)
            return overrides.txSimilar ? overrides.txSimilar(songId) : []
        },
        search: async (source, keyword, limit) => {
            calls.push(`search:${source}:${keyword}`)
            return overrides.search ? overrides.search(source, keyword, limit) : []
        },
    }
    return { deps, calls }
}

test('a QQ seed with a numeric id is looked up directly and the seed and duplicates are dropped', async () => {
    const { deps, calls } = fakeDeps({
        txSimilar: async () => [
            song('tx', 1, '晴天', '周杰伦'),
            song('tx', 2, '开不了口', '周杰伦'),
            song('tx', 3, '开不了口 (Live)', '周杰伦'),
            song('tx', 4, '怎样', '戴佩妮'),
            song('tx', 5, '圣诞结', '陈奕迅'),
            song('tx', 6, '开始懂了', '孙燕姿'),
            song('tx', 7, '可不可以不勇敢', '范玮琪'),
        ],
    })
    const result = await fetchSimilarSongs({ source: 'tx', songId: 97773, name: '晴天', singer: '周杰伦' }, 30, deps)
    assert.equal(result.strategy, 'similar')
    assert.deepEqual(result.list.map(s => s.songId), [2, 4, 5, 6, 7])
    assert.deepEqual(calls, ['radio:晴天', 'similar:97773'])
})

test('a seed from another platform is matched to QQ by name and singer, then topped up with same-artist songs', async () => {
    const { deps, calls } = fakeDeps({
        search: async (source, keyword) => {
            if (source === 'tx' && keyword === '晴天 周杰伦') {
                return [song('tx', 11, '晴天娃娃', '周杰伦'), song('tx', 97773, '晴天', '周杰伦、杨瑞代')]
            }
            if (source === 'wy' && keyword === '周杰伦') {
                return [song('wy', 21, '晴天', '周杰伦'), song('wy', 22, '七里香', '周杰伦'), song('wy', 23, '周杰伦', '某翻唱歌手')]
            }
            return []
        },
        txSimilar: async () => [song('tx', 2, '开不了口', '周杰伦'), song('tx', 4, '怎样', '戴佩妮')],
    })
    const result = await fetchSimilarSongs({ source: 'wy', songId: '186016', name: '晴天', singer: '周杰伦' }, 30, deps)
    assert.equal(result.strategy, 'similar')
    assert.deepEqual(result.list.map(s => `${s.source}_${s.songId}`), ['tx_2', 'tx_4', 'wy_22'])
    assert.deepEqual(calls, ['radio:晴天', 'search:tx:晴天 周杰伦', 'similar:97773', 'search:wy:周杰伦'])
})

test('a failed similar lookup falls back to same-artist songs from the next source that has any', async () => {
    const { deps, calls } = fakeDeps({
        txSimilar: async () => { throw new Error('upstream down') },
        search: async (source, keyword) => {
            if (source === 'tx' && keyword === '周杰伦') return [song('tx', 31, '稻香', '周杰伦'), song('tx', 32, '晴天', '周杰伦')]
            return []
        },
    })
    const result = await fetchSimilarSongs({ source: 'tx', songId: 97773, name: '晴天', singer: '周杰伦' }, 30, deps)
    assert.equal(result.strategy, 'artist')
    assert.deepEqual(result.list.map(s => s.songId), [31])
    assert.deepEqual(calls, ['radio:晴天', 'similar:97773', 'search:tx:周杰伦'])
})

test('nothing found returns an empty list instead of throwing', async () => {
    const { deps } = fakeDeps()
    const result = await fetchSimilarSongs({ source: 'kw', songId: 'x', name: '不存在的歌', singer: '无名' }, 30, deps)
    assert.deepEqual(result, { list: [], strategy: 'none' })
})

test('the limit caps the returned list', async () => {
    const { deps } = fakeDeps({
        txSimilar: async () => Array.from({ length: 10 }, (_, i) => song('tx', 100 + i, `歌曲${i}`, `歌手${i}`)),
    })
    const result = await fetchSimilarSongs({ source: 'tx', songId: 97773, name: '晴天', singer: '周杰伦' }, 3, deps)
    assert.equal(result.list.length, 3)
})

test('radio recommendations are matched to playable songs across artists, traditional to simplified', async () => {
    const { deps, calls } = fakeDeps({
        radio: async () => [
            { name: '晴天', singer: '周杰倫', duration: 270 },
            { name: '愛錯', singer: '王力宏', duration: 239 },
            { name: '遇見', singer: '孫燕姿', duration: 210 },
            { name: '找不到的歌', singer: '無名', duration: 200 },
            { name: '後來', singer: '劉若英', duration: 342 },
            { name: '突然好想你', singer: '五月天 (Mayday)', duration: 266 },
            { name: '紅色高跟鞋', singer: '蔡健雅', duration: 207 },
            { name: '修煉愛情', singer: '林俊傑', duration: 287 },
        ],
        search: async (source, keyword) => {
            if (source !== 'kw') return []
            const table: Record<string, any[]> = {
                '爱错 王力宏': [song('kw', 1, '爱错', '王力宏')],
                '遇见 孙燕姿': [
                    { ...song('kw', 2, '遇见 (Live)', '孙燕姿'), interval: '04:40' },
                    { ...song('kw', 3, '遇见', '孙燕姿'), interval: '03:30' },
                    song('kw', 4, '遇见', '翻唱歌手'),
                ],
                '突然好想你 五月天': [song('kw', 5, '突然好想你', '五月天')],
                '红色高跟鞋 蔡健雅': [song('kw', 60, '红色高跟鞋 (自制版伴奏)', '蔡健雅'), song('kw', 6, '红色高跟鞋 (电影《我们》插曲)', '蔡健雅')],
                '修炼爱情 林俊杰': [song('kw', 7, '修炼爱情', '林俊杰')],
                '后来 刘若英': [song('kw', 80, '后来 (MV版伴奏)', '刘若英'), song('kw', 81, '后来 (Live)', '刘若英')],
            }
            return table[keyword] || []
        },
    })
    const result = await fetchSimilarSongs({ source: 'kw', songId: '9', name: '晴天', singer: '周杰伦' }, 30, deps)
    assert.equal(result.strategy, 'radio')
    assert.deepEqual(result.list.map(s => s.songId), [1, 3, 5, 6, 7])
    assert.ok(!calls.some(call => call.startsWith('similar:')), 'enough radio songs: QQ similar is not consulted')
    assert.ok(!calls.includes('search:kw:周杰伦'), 'no same-artist top-up')
})

test('a failed radio lookup falls back to QQ similar songs', async () => {
    const { deps } = fakeDeps({
        radio: async () => { throw new Error('blocked') },
        txSimilar: async () => Array.from({ length: 6 }, (_, i) => song('tx', 200 + i, `歌曲${i}`, `歌手${i}`)),
    })
    const result = await fetchSimilarSongs({ source: 'tx', songId: 97773, name: '晴天', singer: '周杰伦' }, 30, deps)
    assert.equal(result.strategy, 'similar')
    assert.equal(result.list.length, 6)
})

test('the returned order is shuffled per request', async () => {
    const { deps } = fakeDeps({
        txSimilar: async () => Array.from({ length: 6 }, (_, i) => song('tx', 300 + i, `歌曲${i}`, `歌手${i}`)),
        shuffle: list => [...list].reverse(),
    })
    const result = await fetchSimilarSongs({ source: 'tx', songId: 97773, name: '晴天', singer: '周杰伦' }, 30, deps)
    assert.deepEqual(result.list.map(s => s.songId), [305, 304, 303, 302, 301, 300])
})

test('other versions of the seed and derivative versions are never recommended', async () => {
    const { deps } = fakeDeps({
        txSimilar: async () => [
            song('tx', 1, '晴天', '翻唱歌手'),
            song('tx', 2, '晴天 (DJ版)', '周杰伦'),
            song('tx', 3, '七里香 (Acoustic Version)', '周杰伦'),
            song('tx', 4, '稻香 - Live', '周杰伦'),
            song('tx', 5, '简单爱 DJ Remix', '周杰伦'),
            song('tx', 6, '告白气球 (抖音加速版)', '周杰伦'),
            song('tx', 7, '夜曲', '周杰伦'),
            song('tx', 8, '夜曲', '另一位歌手'),
            song('tx', 9, 'Alive', 'Sia'),
            song('tx', 10, '小幸运 (电影《我的少女时代》主题曲)', '田馥甄'),
            song('tx', 11, 'Mixed Feelings', 'Someone'),
            song('tx', 12, '后来 (feat. 某人)', '刘若英'),
        ],
    })
    const result = await fetchSimilarSongs({ source: 'tx', songId: 97773, name: '晴天', singer: '周杰伦' }, 30, deps)
    assert.deepEqual(result.list.map(s => s.songId), [7, 9, 10, 11, 12])
})

test('an uploaded copy with a made-up title is traced to the original through its album name', () => {
    const rows = [
        { id: 'a', title: 'Blinding Lights', artist: 'The Weeknd' },
        { id: 'b', title: 'Hong Kong（合作音乐人：王菲季候風）', artist: 'The Weeknd' },
        { id: 'c', title: 'Hong Kong', artist: 'Someone Else' },
    ]
    const seed = { source: 'kw', name: 'theweeknd神级现场', singer: '我的心真不冷', album: 'Hong Kong' }
    assert.equal(findOriginalOfUpload(rows, seed), 'b')
    assert.equal(findOriginalOfUpload(rows, { ...seed, name: '让我们爱到天荒地老' }), '', 'the original artist is not credited anywhere')
    assert.equal(findOriginalOfUpload(rows, { ...seed, album: 'two' }), '', 'no result is titled like the album')
    assert.equal(findOriginalOfUpload(rows, { ...seed, album: '' }), '')
})

test('the original artist is picked out of search results by the credits in the upload', () => {
    const seed = { source: 'kw', name: 'theweeknd神级现场', singer: '我的心真不冷', album: 'Hong Kong' }
    const rows = [{ artist: '方大同' }, { artist: 'The Weeknd和Ariana Grande' }, { artist: 'The Weeknd' }]
    assert.equal(creditedArtist(rows, seed), 'The Weeknd')
    assert.equal(creditedArtist([{ artist: '方大同' }], seed), '')
    assert.equal(creditedArtist([{ artist: '王菲' }], { name: '王菲经典现场', singer: '某上传者', album: '红豆' }), '王菲', 'two-character names count')
    assert.equal(creditedArtist([{ artist: 'U2' }], { name: 'u2000 remix', singer: 'x', album: 'y' }), '', 'short latin names are too ambiguous')
})

test('a version suffix without brackets or a dash is still a variant, a title that merely ends alike is not', async () => {
    const { deps } = fakeDeps({
        txSimilar: async () => [
            song('tx', 1, '稻香 Live', '周杰伦'),
            song('tx', 2, '七里香 Acoustic', '周杰伦'),
            song('tx', 3, '夜曲现场版', '周杰伦'),
            song('tx', 4, 'Alive', 'Sia'),
            song('tx', 5, 'Live', 'Someone'),
            song('tx', 6, 'Long Live', 'Taylor Swift'),
            song('tx', 7, '简单爱', '周杰伦'),
            song('tx', 8, '听妈妈的话', '周杰伦'),
            song('tx', 9, '彩虹', '周杰伦'),
        ],
    })
    const result = await fetchSimilarSongs({ source: 'tx', songId: 97773, name: '晴天', singer: '周杰伦' }, 30, deps)
    assert.deepEqual(result.list.map(s => s.songId), [4, 5, 7, 8, 9])
})

test('an original artist credited inside brackets in the upload title is recognised', () => {
    const seed = { source: 'kw', name: '经典现场（王菲）', singer: '某上传者', album: '红豆' }
    assert.equal(findOriginalOfUpload([{ id: 'x', title: '红豆', artist: '王菲' }], seed), 'x')
    assert.equal(creditedArtist([{ artist: '王菲' }], seed), '王菲')
})
