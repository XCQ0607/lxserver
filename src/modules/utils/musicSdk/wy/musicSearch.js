// import { httpFetch } from '../../request'
// import { weapi } from './utils/crypto'
import { formatPlayTime } from '../../index'
// import musicDetailApi from './musicDetail'
import { eapiRequest } from './utils/index'
import { buildQualitys } from './quality'

export default {
  // 每页条数：2026-10-09 实测（关键词「周杰伦」第 1 页）。请求 20/25/30/50 都只返回 20 条，
  // 网易这个接口按 20 固定分页，请求更大的值不会多给。深页 20/页 时第 13 页起整页与已见重复，
  // 14 页共 260 条原始结果里只有约 156 条是新条目，所以取回后要按 id 去重。
  limit: 20,
  total: 0,
  page: 0,
  allPage: 1,
  musicSearch(str, page, limit) {
    // const searchRequest = eapiRequest('/api/cloudsearch/pc', {
    //   s: str,
    //   type: 1, // 1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频
    //   limit,
    //   total: page == 1,
    //   offset: limit * (page - 1),
    // })
    const searchRequest = eapiRequest('/api/search/song/list/page', {
      keyword: str,
      needCorrect: '1',
      channel: 'typing',
      offset: limit * (page - 1),
      scene: 'normal',
      total: page == 1,
      limit,
    })
    return searchRequest.promise.then(({ body }) => body)
  },
  getSinger(singers) {
    let arr = []
    singers.forEach(singer => {
      arr.push(singer.name)
    })
    return arr.join('、')
  },
  handleResult(rawList) {
    // console.log(rawList)
    if (!rawList) return []
    return rawList.map(item => {
      item = item.baseInfo.simpleSongData
      const { types, _types } = buildQualitys(item, item.privilege)

      return {
        singer: this.getSinger(item.ar),
        name: item.name,
        albumName: item.al.name,
        albumId: item.al.id,
        source: 'wy',
        interval: formatPlayTime(item.dt / 1000),
        songmid: item.id,
        img: item.al.picUrl,
        lrc: null,
        types,
        _types,
        typeUrl: {},
      }
    })
  },
  search(str, page = 1, limit, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'))
    if (limit == null) limit = this.limit
    return this.musicSearch(str, page, limit).then(result => {
      // console.log(result)
      if (!result || result.code !== 200) return this.search(str, page, limit, retryNum)
      let list = this.handleResult(result.data.resources || [])
      // console.log(list)

      if (list == null) return this.search(str, page, limit, retryNum)

      this.total = result.data.totalCount || 0
      this.page = page
      // allPage/limit 按本次请求真正用的每页条数算，不能用 this.limit（默认值 30 会把页数少算约 1/3）
      this.allPage = Math.ceil(this.total / limit)

      return {
        list,
        allPage: this.allPage,
        limit,
        total: this.total,
        source: 'wy',
      }
      // return result.data
    })
  },
}
