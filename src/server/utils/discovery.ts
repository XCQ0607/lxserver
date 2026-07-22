import { httpFetch } from '../../modules/utils/request'

/**
 * 发现页助手: 获取流派分类与电台列表
 */

const TAG_CONF_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg'
const RADIO_LIST_URL = 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_radiolist.fcg'
const RADIO_SONGS_URL = 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_radiosong.fcg'
const SONG_LISTS_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg'
const PLAYLIST_DETAIL_URL = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg'

const commonHeaders = {
    'Referer': 'https://y.qq.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Cookie': process.env.QQ_MUSIC_COOKIE || ''
}

/**
 * 获取流派分类 (Genres)
 */
export const fetchGenres = async () => {
    try {
        const url = new URL(TAG_CONF_URL)
        url.searchParams.set('format', 'json')
        url.searchParams.set('outCharset', 'utf-8')

        const { body } = await (httpFetch as any)(url.toString(), {
            headers: commonHeaders
        }).promise

        if (!body || body.code !== 0) {
            console.error('[Discovery] fetchGenres API Error:', body)
            return []
        }

        const categories = body.data?.categories || []
        console.log(`[Discovery] fetchGenres categories found: ${categories.length}`)

        const targetGroups = ['语种', '流派']
        const filteredGroups = categories.filter((c: any) => targetGroups.includes(c.categoryGroupName))

        const allItems: any[] = []
        for (const group of filteredGroups) {
            allItems.push(...group.items)
        }

        return allItems.map((item: any) => ({
            value: item.categoryName,
            id: item.categoryId.toString(),
            songCount: 1000,
            albumCount: 100
        }))
    } catch (e) {
        console.error('[Discovery] fetchGenres unexpected error:', e)
        return []
    }
}

/**
 * 获取某流派标签下的热门歌单
 */
export const fetchPlaylistsByGenre = async (categoryId: string, size: number = 20) => {
    try {
        const url = new URL(SONG_LISTS_URL)
        url.searchParams.set('format', 'json')
        url.searchParams.set('outCharset', 'utf-8')
        url.searchParams.set('categoryId', categoryId)
        url.searchParams.set('sortId', '5')
        url.searchParams.set('sin', '0')
        url.searchParams.set('ein', (size - 1).toString())

        const { body } = await (httpFetch as any)(url.toString(), {
            headers: commonHeaders
        }).promise
        const list = body?.data?.list || []

        return list.map((item: any) => ({
            id: `alb_tx_playlist_${item.dissid}`,
            name: item.dissname,
            title: item.dissname,
            album: item.dissname,
            artist: item.creator?.name || 'QQ音乐歌单',
            artistId: `artist_tx_playlist`,
            isDir: true,
            coverArt: item.imgurl || `alb_tx_playlist_${item.dissid}`,
            songCount: 50,
            duration: 3600,
            created: item.createtime || new Date().toISOString(),
            playCount: item.listennum || 0
        }))
    } catch (e) {
        console.error('[Discovery] fetchPlaylistsByGenre error:', e)
        return []
    }
}

/**
 * 获取歌单详情 (歌曲列表)
 */
export const fetchPlaylistSongs = async (dissid: string) => {
    try {
        const url = new URL(PLAYLIST_DETAIL_URL)
        url.searchParams.set('format', 'json')
        url.searchParams.set('outCharset', 'utf-8')
        url.searchParams.set('disstid', dissid)
        url.searchParams.set('type', '1')
        url.searchParams.set('json', '1')
        url.searchParams.set('utf8', '1')
        url.searchParams.set('onlysong', '0')

        // @ts-ignore
        const { body } = await (httpFetch as any)(url.toString(), {
            headers: commonHeaders
        }).promise

        const cd = body?.cdlist?.[0]
        if (!cd) return { name: '未知歌单', list: [] }

        return {
            name: cd.dissname,
            list: (cd.songlist || []).map((s: any) => ({
                id: `tx_${s.songmid || s.mid}`,
                name: s.songname || s.name,
                singer: (s.singer || []).map((si: any) => si.name).join('、'),
                source: 'tx',
                songmid: s.songmid || s.mid,
                interval: s.interval,
                img: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : '',
                meta: {
                    albumName: s.albumname || '未知专辑',
                    albumId: s.albummid ? `alb_tx_${s.albummid}` : '',
                    picUrl: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : ''
                }
            }))
        }
    } catch (e) {
        console.error('[Discovery] fetchPlaylistSongs error:', e)
        return { name: '错误歌单', list: [] }
    }
}

/**
 * 获取流派随机歌曲 (通过抓取该流派下的第一个热门歌单实现)
 */
export const fetchSongsByGenre = async (categoryId: string, size: number = 20): Promise<any[]> => {
    try {
        const playlists = await fetchPlaylistsByGenre(categoryId)
        if (playlists.length === 0) return []

        // 同时抓取前 3 个热门歌单
        const targetPlaylists = playlists.slice(0, 3)
        const allResults = await Promise.all(
            targetPlaylists.map((pl: any) => {
                const dissid = pl.id.replace('alb_tx_playlist_', '')
                return fetchPlaylistSongs(dissid).catch(() => null)
            })
        )

        // 汇聚去重
        const songMap = new Map<string, any>()
        for (const res of allResults) {
            if (!res || !res.list) continue
            for (const s of res.list) {
                if (!songMap.has(s.id)) {
                    songMap.set(s.id, s)
                }
            }
        }

        const allSongs = Array.from(songMap.values())

        // 随机大洗牌 (Fisher-Yates)
        for (let i = allSongs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allSongs[i], allSongs[j]] = [allSongs[j], allSongs[i]]
        }

        return allSongs.slice(0, size)
    } catch (e) {
        console.error(`[Discovery] fetchSongsByGenre error:`, e)
        return []
    }
}

/**
 * 获取电台歌曲 (使用最新接口)
 */
export const fetchRadioSongs = async (radioId: string) => {
    try {
        const data = {
            radio: {
                module: 'music.radio.MusicRadioSvr',
                method: 'GetRadioSong',
                param: {
                    radioId: parseInt(radioId),
                    songNum: 10
                }
            }
        }
        const url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg')
        url.searchParams.set('data', JSON.stringify(data))

        const { body } = await (httpFetch as any)(url.toString(), {
            headers: commonHeaders
        }).promise

        console.log(`[Discovery] fetchRadioSongs response for ${radioId}:`, JSON.stringify(body).slice(0, 200))

        const tracks = body?.radio?.data?.tracks || []
        return tracks.map((t: any) => ({
            ...t,
            songmid: t.mid,
            songname: t.name
        }))
    } catch (e) {
        console.error('[Discovery] fetchRadioSongs error:', e)
        return []
    }
}

/**
 * 获取电台列表
 */
export const fetchRadios = async () => {
    try {
        const url = new URL(RADIO_LIST_URL)
        url.searchParams.set('format', 'json')
        url.searchParams.set('outCharset', 'utf-8')
        url.searchParams.set('channel', 'radio')
        url.searchParams.set('page', 'index')
        url.searchParams.set('tpl', 'wk')
        url.searchParams.set('new', '1')

        const { body } = await (httpFetch as any)(url.toString(), {
            headers: commonHeaders
        }).promise
        const groupList = body?.data?.data?.groupList || []

        const radioMap = new Map<string, any>()
        for (const group of groupList) {
            if (!group.radioList) continue
            for (const r of group.radioList) {
                const id = `radio_tx_${r.radioId}`
                if (!radioMap.has(id)) {
                    radioMap.set(id, {
                        id: id,
                        name: r.radioName,
                        streamUrl: `/rest/stream?id=${id}`,
                        coverArt: r.radioImg || id
                    })
                }
            }
        }
        return Array.from(radioMap.values())
    } catch (e) {
        console.error('[Discovery] fetchRadios error:', e)
        return []
    }
}
