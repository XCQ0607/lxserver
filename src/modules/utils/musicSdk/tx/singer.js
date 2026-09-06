import { httpFetch } from '../../request'

import { formatPlayTime } from '../../index'
import { formatSingerName } from '../utils'
import { buildQualitys } from './quality'

export const filterMusicInfoItem = item => {
  const { types, _types } = buildQualitys(item.file)

  const albumId = item.album.id ?? ''
  const albumMid = item.album.mid ?? ''
  const albumName = item.album.name ?? ''
  return {
    source: 'tx',
    singer: formatSingerName(item.singer, 'name'),
    name: item.title,
    albumName,
    albumId,
    albumMid,
    interval: formatPlayTime(item.interval),
    songId: item.id,
    songmid: item.mid,
    strMediaMid: item.file.media_mid,
    img: (albumId === '' || albumId === '空')
      ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R800x800M000${item.singer[0].mid}.jpg` : ''
      : `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albumMid}.jpg`,
    types,
    _types,
    typeUrl: {},
  }
}


/**
 * 创建一个适用于TX的Http请求
 * @param {*} url
 * @param {*} options
 * @param {*} retryNum
 */
const createMusicuFetch = async (data, options, retryNum = 0) => {
  if (retryNum > 2) throw new Error('try max num')

  let result
  try {
    result = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      body: {
        comm: {
          cv: 4747474,
          ct: 24,
          format: 'json',
          inCharset: 'utf-8',
          outCharset: 'utf-8',
          uin: 0,
        },
        ...data,
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
      },
    }).promise
  } catch (err) {
    console.log(err)
    return createMusicuFetch(data, options, ++retryNum)
  }
  if (result.statusCode !== 200 || result.body.code != 0) return createMusicuFetch(data, options, ++retryNum)

  return result.body
}

export default {
  /**
   * 获取歌手信息
   * @param {*} id
   */
  getInfo(id) {
    return createMusicuFetch({
      singer: {
        method: 'get_singer_detail_info',
        param: {
          sort: 5,
          singermid: id,
          sin: 0,
          num: 50,
        },
        module: 'music.web_singer_info_svr',
      },
    }).then(body => {
      if (body.singer.code != 0) throw new Error('get singer info faild.')

      const data = body.singer.data
      return {
        source: 'tx',
        id: data.singer_info.mid,
        info: {
          name: data.singer_info.name,
          desc: data.singer_info.desc || '',
          avatar: `https://y.gtimg.cn/music/photo_new/T001R300x300M000${data.singer_info.mid}.jpg`,
        },
        count: {
          music: data.total_song || 0,
          album: data.total_album || 0,
        },
      }
    })
  },
  /**
   * 获取歌手完整介绍 (Bio)
   * @param {string} id 歌手 MID
   */
  getDesc(id) {
    return httpFetch(`https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_singer_desc.fcg?singermid=${id}&format=xml&utf8=1&outCharset=utf-8`, {
      headers: {
        'Referer': 'https://y.qq.com/portal/singer_detail.html',
      },
    }).promise.then(({ body }) => {
      const match = body.match(/<desc><!\[CDATA\[([\s\S]*?)\]\]><\/desc>/)
      return match ? match[1].replace(/\n/g, '\n') : ''
    }).catch(() => '')
  },
  /**
   * 获取歌手专辑列表
   * @param {*} id
   * @param {*} page
   * @param {*} limit
   */
  getAlbumList(id, page = 1, limit = 10, order = 'hot') {
    return createMusicuFetch({
      singerAlbum: {
        method: 'get_singer_album',
        param: {
          singermid: id,
          begin: (page - 1) * limit,
          num: limit,
          order: 'time',
        },
        module: 'music.web_singer_info_svr',
      },
    }).then(body => {
      if (body.singerAlbum.code != 0) throw new Error('get singer album faild.')

      const list = this.filterAlbumList(body.singerAlbum.data.list)
      return {
        source: 'tx',
        list,
        limit,
        page,
        total: body.singerAlbum.data.total,
      }
    })
  },
  /**
   * 获取歌手歌曲列表
   * @param {*} id
   * @param {*} page
   * @param {*} limit
   */
  async getSongList(id, page = 1, limit = 100, order = 'hot') {
    return createMusicuFetch({
      req: {
        module: 'musichall.song_list_server',
        method: 'GetSingerSongList',
        param: {
          singerMid: id,
          order: order === 'time' ? 0 : 1, // 0: 最新, 1: 热门
          begin: (page - 1) * limit,
          num: limit,
        },
      },
    }).then(body => {
      if (body.req.code != 0) throw new Error('get singer song list faild.')

      const list = this.filterSongList(body.req.data.songList)
      return {
        source: 'tx',
        list,
        limit,
        page,
        total: body.req.data.totalNum,
      }
    })
  },
  filterAlbumList(raw) {
    return raw.map(item => {
      return {
        id: item.album_id || item.albumID,
        mid: item.album_mid || item.albumMid,
        count: item.latest_song?.song_count || item.total_num || item.song_count || item.totalNum || 0,
        info: {
          name: item.album_name || item.albumName,
          author: item.singer_name || item.singerName,
          img: `https://y.gtimg.cn/music/photo_new/T002R800x800M000${item.album_mid || item.albumMid}.jpg`,
          desc: null,
          publishTime: item.pub_time || '',
        },
      }
    })
  },
  filterSongList(raw) {
    return raw.map(item => {
      return filterMusicInfoItem(item.songInfo)
    })
  },
}
