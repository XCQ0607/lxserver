import { httpFetch } from '../../request'
import { formatPlayTime } from '../../index'
import { formatSingerName } from '../utils'
import { buildQualitys } from './quality'

export default {
  limit: 50,
  total: 0,
  page: 0,
  allPage: 1,
  successCode: 0,
  musicSearch(str, page, limit, retryNum = 0) {
    if (retryNum > 5) return Promise.reject(new Error('搜索失败'))
    // searchRequest = httpFetch(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?ct=24&qqmusic_ver=1298&new_json=1&remoteplace=sizer.yqq.song_next&searchid=49252838123499591&t=0&aggr=1&cr=1&catZhida=1&lossless=0&flag_qc=0&p=${page}&n=${limit}&w=${encodeURIComponent(str)}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`)
    // const searchRequest = httpFetch(`https://shc.y.qq.com/soso/fcgi-bin/client_search_cp?ct=24&qqmusic_ver=1298&remoteplace=txt.yqq.top&aggr=1&cr=1&catZhida=1&lossless=0&flag_qc=0&p=${page}&n=${limit}&w=${encodeURIComponent(str)}&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&uin=0&hostUin=0&loginUin=0`)
    const searchRequest = httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'post',
      headers: {
        'User-Agent': 'QQMusic 14090508(android 12)',
      },
      body: {
        comm: {
          ct: '11',
          cv: '14090508',
          v: '14090508',
          tmeAppID: 'qqmusic',
          phonetype: 'EBG-AN10',
          deviceScore: '553.47',
          devicelevel: '50',
          newdevicelevel: '20',
          rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
          os_ver: '12',
          OpenUDID: '0',
          OpenUDID2: '0',
          QIMEI36: '0',
          udid: '0',
          chid: '0',
          aid: '0',
          oaid: '0',
          taid: '0',
          tid: '0',
          wid: '0',
          uid: '0',
          sid: '0',
          modeSwitch: '6',
          teenMode: '0',
          ui_mode: '2',
          nettype: '1020',
          v4ip: '',
        },
        req: {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicMobile',
          param: {
            search_type: 0,
            query: str,
            page_num: page,
            num_per_page: limit,
            highlight: 0,
            nqc_flag: 0,
            multi_zhida: 0,
            cat: 2,
            grp: 1,
            sin: 0,
            sem: 0,
          },
        },
      },
    })
    // searchRequest = httpFetch(`http://ioscdn.kugou.com/api/v3/search/song?keyword=${encodeURIComponent(str)}&page=${page}&pagesize=${this.limit}&showtype=10&plat=2&version=7910&tag=1&correct=1&privilege=1&sver=5`)
    return searchRequest.promise.then(({ body }) => {
      // console.log(body)
      if (body.code != this.successCode || body.req.code != this.successCode) return this.musicSearch(str, page, limit, ++retryNum)
      return body.req.data
    })
  },
  handleResult(rawList) {
    // console.log(rawList)
    const list = []
    rawList.forEach(item => {
      if (!item.file?.media_mid) return

      const file = item.file
      const { types, _types } = buildQualitys(file)
      // types.reverse()
      let albumId = ''
      let albumName = ''
      if (item.album) {
        albumName = item.album.name
        albumId = item.album.mid
      }
      list.push({
        singer: formatSingerName(item.singer, 'name'),
        name: item.name + (item.title_extra ?? ''),
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
      })
    })
    // console.log(list)
    return list
  },
  search(str, page = 1, limit) {
    if (limit == null) limit = this.limit
    // http://newlyric.kuwo.cn/newlyric.lrc?62355680
    return this.musicSearch(str, page, limit).then(({ body, meta }) => {
      let list = this.handleResult(body.item_song)

      this.total = meta.estimate_sum
      this.page = page
      this.allPage = Math.ceil(this.total / limit)

      return Promise.resolve({
        list,
        allPage: this.allPage,
        limit,
        total: this.total,
        source: 'tx',
      })
    })
  },
}
