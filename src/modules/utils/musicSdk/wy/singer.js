import { eapiRequest } from './utils/index'
import { formatPlayTime } from '../../index'
import { formatSingerName } from '../utils'
import { buildQualitys } from './quality'

export default {
  /**
   * 获取歌手信息
   * @param {*} id
   */
  // Legacy implementation retained for reference; inactive.
  // getInfo(id) {
  //     return weapiRequest('/artist/head/info/get', { id }).promise.then(({ body }) => {
  //       if (!body || body.code != 200) throw new Error('get singer info faild.')
  //       const data = body.data || {}
  //       return {
  //         source: 'wy',
  //         id: data.artist.id,
  //         info: {
  //           name: data.artist.name,
  //           desc: data.artist.briefDesc,
  //           avatar: (data.user && data.user.avatarUrl) || (data.artist && data.artist.picUrl) || '',
  //           gender: data.user ? (data.user.gender === 1 ? 'man' : 'woman') : 'man',
  //         },
  //         count: {
  //           music: data.artist.musicSize,
  //           album: data.artist.albumSize,
  //         },
  //       }
  //     })
  //   }
  getInfo(id) {
    return eapiRequest('/api/artist/head/info/get', { id }).promise.then(({ body }) => {
      if (!body || body.code != 200) throw new Error('get singer info faild.')
      const data = body.data || body
      return {
        source: 'wy',
        id: data.artist.id,
        info: {
          name: data.artist.name,
          desc: data.artist.briefDesc,
          avatar: data.user?.avatarUrl || data.artist.picUrl || '',
          gender: data.user?.gender === 1 ? 'man' : 'woman',
        },
        count: {
          music: data.artist.musicSize,
          album: data.artist.albumSize,
        },
      }
    })
  },
  /**
   * 获取歌手歌曲列表
   * @param {*} id
   * @param {*} page
   * @param {*} limit
   */
  // Legacy implementation retained for reference; inactive.
  // getSongList(id, page = 1, limit = 100) {
  //     if (page === 1) page = 0
  //     return weapiRequest('/v1/artist/songs', {
  //       id,
  //       limit,
  //       offset: limit * page,
  //       private_cloud: 'true',
  //       work_type: 1,
  //     }).promise.then(({ body }) => {
  //       if (!body.songs || body.code != 200) throw new Error('get singer song list faild.')
  //
  //       const list = this.filterSongList(body.songs)
  //       return {
  //         list,
  //         limit,
  //         page,
  //         total: body.total,
  //         source: 'wy',
  //       }
  //     })
  //   }
  getSongList(id, page = 1, limit = 100) {
    return eapiRequest('/api/v2/artist/songs', {
      id,
      limit,
      offset: limit * (page - 1),
    }).promise.then(({ body }) => {
      if (!body.songs || body.code != 200) throw new Error('get singer song list faild.')

      const list = this.filterSongList(body.songs)
      return {
        list,
        limit,
        page,
        total: body.total,
        source: 'wy',
      }
    })
  },
  /**
   * 获取歌手专辑列表
   * @param {*} id
   * @param {*} page
   * @param {*} limit
   */
  // Legacy implementation retained for reference; inactive.
  // getAlbumList(id, page = 1, limit = 10) {
  //     if (page === 1) page = 0
  //     return weapiRequest(`/artist/albums/${id}`, {
  //       limit,
  //       offset: limit * page,
  //       total: true,
  //     }).promise.then(({ body }) => {
  //       if (!body.hotAlbums || body.code != 200) throw new Error('get singer album list faild.')
  //
  //       const list = this.filterAlbumList(body.hotAlbums)
  //       return {
  //         source: 'wy',
  //         list,
  //         limit,
  //         page,
  //         total: body.artist.albumSize,
  //       }
  //     })
  //   }
  getAlbumList(id, page = 1, limit = 10) {
    return eapiRequest(`/api/artist/albums/${id}`, {
      limit,
      offset: limit * (page - 1),
    }).promise.then(({ body }) => {
      if (!body.hotAlbums || body.code != 200) throw new Error('get singer album list faild.')

      const list = this.filterAlbumList(body.hotAlbums)
      const data = body.data || body
      return {
        source: 'wy',
        list,
        limit,
        page,
        total: data.artist.albumSize,
      }
    })
  },
  filterAlbumList(raw) {
    const list = []
    raw.forEach(item => {
      if (!item.id) return
      list.push({
        id: item.id,
        count: item.size,
        info: {
          name: item.name,
          author: formatSingerName(item.artists),
          img: item.picUrl,
          desc: null,
        },
      })
    })
    return list
  },
  filterSongList(raw) {
    const list = []
    raw.forEach(item => {
      if (!item.id) return

      const { types, _types } = buildQualitys({
        ...item,
        l: item.l || item.lMusic,
        h: item.h || item.hMusic,
        sq: item.sq || item.sqMusic,
        hr: item.hr || item.hrMusic,
      }, item.privilege)

      list.push({
        singer: formatSingerName(item.ar || item.artists),
        name: item.name,
        albumName: (item.al || item.album)?.name || '',
        albumId: (item.al || item.album)?.id,
        songmid: item.id,
        source: 'wy',
        interval: formatPlayTime((item.dt ?? item.duration) / 1000),
        img: (item.al || item.album)?.picUrl || null,
        lrc: null,
        otherSource: null,
        types,
        _types,
        typeUrl: {},
      })
    })
    return list
  },
}
