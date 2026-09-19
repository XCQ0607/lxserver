import { httpFetch } from '../../request'

const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

const createSearchFetch = (str, searchType, resultNum, pageNum) => {
    // [修复] 该接口现在只认 GET + data=URL 编码 JSON；POST 到 musicu.fcg 会被拒（{"code":500001}），
    // 会导致 searchSinger 永远失败 → getSingerMid 拿不到 MID → 歌手页专辑退化为本地聚合（歌曲量偏少）。
    const payload = {
        comm: { ct: '19', cv: '1859', uin: '0' },
        req: {
            method: 'DoSearchForQQMusicDesktop',
            module: 'music.search.SearchCgiService',
            param: {
                grp: 1,
                num_per_page: resultNum,
                page_num: pageNum,
                query: str,
                search_type: searchType,
            },
        },
    }
    return httpFetch(`${MUSICU_URL}?format=json&data=${encodeURIComponent(JSON.stringify(payload))}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
        },
    })
}

export default {
    /**
     * 搜索歌手
     * @param {string} str 搜索关键词
     * @param {number} page 页码
     * @param {number} limit 每页数量
     */
    searchSinger(str, page = 1, limit = 20) {
        return createSearchFetch(str, 1, limit, page).promise.then(({ body }) => {
            if (body.code !== 0) throw new Error('TX singer search failed: ' + body.code)
            // searchType=1 时，singer 结果在 body.req.data.body.singer
            const singerData = body.req?.data?.body?.singer
            const rawList = (singerData && singerData.list) || []
            const list = this.handleSingerResult(rawList)
            return {
                list,
                total: (singerData && singerData.total) || list.length,
                allPage: Math.ceil(((singerData && singerData.total) || list.length) / limit),
                limit,
                source: 'tx',
            }
        })
    },

    /**
     * 搜索专辑
     * @param {string} str 搜索关键词
     * @param {number} page 页码
     * @param {number} limit 每页数量
     */
    searchAlbum(str, page = 1, limit = 20) {
        return createSearchFetch(str, 2, limit, page).promise.then(({ body }) => {
            if (body.code !== 0) throw new Error('TX album search failed: ' + body.code)
            // searchType=2 时，album 结果在 body.req.data.body.album
            const albumData = body.req?.data?.body?.album
            const rawList = (albumData && albumData.list) || []
            const list = this.handleAlbumResult(rawList)
            return {
                list,
                total: (albumData && albumData.total) || list.length,
                allPage: Math.ceil(((albumData && albumData.total) || list.length) / limit),
                limit,
                source: 'tx',
            }
        })
    },

    /**
     * 格式化歌手搜索结果
     * @param {Array} rawList
     */
    handleSingerResult(rawList) {
        if (!rawList || !rawList.length) return []
        return rawList.map(item => {
            const mid = item.singerMID || item.mid || ''
            return {
                id: mid,
                mid,
                name: item.singerName || item.name || '',
                picUrl: mid ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${mid}.jpg` : '',
                albumSize: item.albumNum || 0,
                source: 'tx',
            }
        })
    },

    /**
     * 格式化专辑搜索结果
     * @param {Array} rawList
     */
    handleAlbumResult(rawList) {
        if (!rawList || !rawList.length) return []
        return rawList.map(item => {
            const mid = item.albumMID || item.mid || ''
            const singerName = item.singerName || (item.singer && item.singer[0] && item.singer[0].name) || ''
            const singerId = (item.singer && item.singer[0] && item.singer[0].mid) || ''
            return {
                id: mid,
                mid,
                name: item.albumName || item.name || '',
                picUrl: mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : '',
                artistName: singerName,
                artistId: singerId,
                size: item.song_count || item.songNum || 0,
                publishTime: item.pubTime || '',
                source: 'tx',
            }
        })
    },
}
