import { httpFetch } from '../../request'
import { formatPlayTime } from '../../index'
import { buildQualitys } from './quality'

const getSinger = (singers) => {
  let arr = []
  singers.forEach(singer => {
    arr.push(singer.name)
  })
  return arr.join('、')
}

export default (songmid) => {
  const requestObj = httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'post',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
    },
    body: {
      comm: {
        ct: '19',
        cv: '1859',
        uin: '0',
      },
      req: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: {
          song_type: 0,
          song_mid: songmid,
        },
      },
    },
  })
  return requestObj.promise.then(({ body }) => {
    // console.log(body)
    if (body.code != 0 || body.req.code != 0) return Promise.reject(new Error('获取歌曲信息失败'))
    const item = body.req.data.track_info
    if (!item.file?.media_mid) return null

    const file = item.file
    const { types, _types } = buildQualitys(file)
    // types.reverse()
    let albumId = ''
    let albumName = ''
    if (item.album) {
      albumName = item.album.name
      albumId = item.album.mid
    }
    return {
      singer: getSinger(item.singer),
      name: item.title,
      albumName,
      albumId,
      source: 'tx',
      interval: formatPlayTime(item.interval),
      songId: item.id,
      albumMid: item.album?.mid ?? '',
      strMediaMid: item.file.media_mid,
      songmid: item.mid,
      img: (albumId === '' || albumId === '空')
        ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R800x800M000${item.singer[0].mid}.jpg` : ''
        : `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albumId}.jpg`,
      types,
      _types,
      typeUrl: {},
    }
  })
}
