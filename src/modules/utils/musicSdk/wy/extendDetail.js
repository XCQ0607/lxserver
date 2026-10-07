import { weapiRequest } from './utils/index'
import { formatSingerName } from '../utils'
import musicDetail from './musicDetail'

export default {
    /**
     * 获取歌手详情
     * @param {*} id 歌手 ID
     */
    getArtistDetail(id) {
        return weapiRequest('/artist/head/info/get', { id }).promise.then(({ body }) => {
            if (!body || body.code !== 200) throw new Error('Get artist detail failed')
            const data = body.data || {}
            const artist = data.artist || {}
            return {
                source: 'wy',
                id: artist.id || id,
                name: artist.name || '未知歌手',
                desc: artist.briefDesc || '',
                avatar: (data.user && data.user.avatarUrl) || artist.avatar || artist.cover || artist.picUrl || '',
                musicSize: artist.musicSize || 0,
                albumSize: artist.albumSize || 0,
            }
        })
    },

    /**
     * 获取歌手歌曲
     * @param {*} id 歌手 ID 
     */
    getArtistSongs(id, page = 1, limit = 100, order = 'hot') {
        return weapiRequest('/v1/artist/songs', {
            id,
            limit,
            offset: limit * (page - 1),
            order,
            private_cloud: 'true',
            work_type: 1,
        }).promise.then(({ body }) => {
            if (!body || body.code !== 200) throw new Error('Get artist songs failed')
            return {
                list: musicDetail.filterList({ songs: body.songs, privileges: body.songs.map(s => s.privilege || {}) }),
                total: body.total,
                source: 'wy',
            }
        })
    },

    /**
     * 获取歌手专辑列表
     * @param {*} id 歌手 ID
     */
    getArtistAlbums(id, page = 1, limit = 50) {
        return weapiRequest(`/artist/albums/${id}`, {
            limit,
            offset: limit * (page - 1),
            total: true,
        }).promise.then(({ body }) => {
            if (!body || body.code !== 200) throw new Error('Get artist albums failed')
            return {
                source: 'wy',
                list: (body.hotAlbums || []).map(item => ({
                    id: item.id,
                    name: item.name,
                    img: item.picUrl,
                    singer: formatSingerName(item.artists),
                    publishTime: item.publishTime ? new Date(item.publishTime).toISOString().split('T')[0] : undefined,
                    total: item.size,
                })),
                total: body.artist ? body.artist.albumSize : (body.hotAlbums ? body.hotAlbums.length : 0),
            }
        })
    },

    /**
     * 获取专辑歌曲
     * @param {*} id 专辑 ID
     */
    getAlbumSongs(id) {
        return weapiRequest(`/v1/album/${id}`, {}).promise.then(({ body }) => {
            if (!body || (body.code !== 200 && body.code !== 502)) {
                throw new Error(`Get album songs failed: ${body ? body.code : 'No body'}`)
            }

            // Handle common error codes
            if (body.code === 502) {
                return {
                    list: [],
                    total: 0,
                    source: 'wy'
                }
            }

            const songs = body.songs || []

            // Log for debugging if empty
            if (songs.length === 0) {
                console.warn(`[WY SDK] Album ${id} returned no songs. Body code: ${body.code}`);
            }

            const albumObj = body.album || {}
            const artistObj = albumObj.artist || (albumObj.artists && albumObj.artists[0]) || {}
            return {
                list: musicDetail.filterList({
                    songs,
                    privileges: songs.map(s => s.privilege || { id: s.id })
                }),
                total: songs.length,
                name: albumObj.name || undefined,
                artistName: artistObj.name || formatSingerName(albumObj.artists) || (songs[0] && formatSingerName(songs[0].ar)) || undefined,
                artistId: artistObj.id ? String(artistObj.id) : undefined,
                desc: albumObj.description || albumObj.briefDesc || '',
                img: albumObj.picUrl || undefined,
                picUrl: albumObj.picUrl || undefined,
                publishTime: albumObj.publishTime ? new Date(albumObj.publishTime).toISOString().split('T')[0] : undefined,
                source: 'wy',
            }
        })
    },
}
