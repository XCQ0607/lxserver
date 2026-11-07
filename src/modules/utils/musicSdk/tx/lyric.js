import { httpFetch } from '../../request'
import getMusicInfo from './musicInfo'
import { decodeQrc } from './qrcDecode'

const songIdMap = new Map()
const promises = new Map()
export const decodeLyric = async(lrc, tlrc, rlrc) => ({
  lyric: await decodeQrc(lrc),
  tlyric: await decodeQrc(tlrc),
  rlyric: await decodeQrc(rlrc),
})


const parseTools = {
  rxps: {
    info: /^{"/,
    lineTime: /^\[(\d+),\d+\]/,
    lineTime2: /^\[([\d:.]+)\]/,
    wordTime: /\(\d+,\d+\)/,
    wordTimeAll: /(\(\d+,\d+\))/g,
    timeLabelFixRxp: /(?:\.0+|0+)$/,
  },
  msFormat(timeMs) {
    if (Number.isNaN(timeMs)) return ''
    let ms = (timeMs % 1000).toString().padStart(3, '0')
    timeMs /= 1000
    let m = parseInt(timeMs / 60).toString().padStart(2, '0')
    timeMs %= 60
    let s = parseInt(timeMs).toString().padStart(2, '0')
    return `[${m}:${s}.${ms}]`
  },
  parseLyric(lrc) {
    lrc = lrc.trim()
    lrc = lrc.replace(/\r/g, '')
    if (!lrc) return { lyric: '', lxlyric: '' }
    const lines = lrc.split('\n')

    const lxlrcLines = []
    const lrcLines = []

    for (let line of lines) {
      line = line.trim()
      let result = this.rxps.lineTime.exec(line)
      if (!result) {
        if (line.startsWith('[offset')) {
          lxlrcLines.push(line)
          lrcLines.push(line)
        }
        if (this.rxps.lineTime2.test(line)) {
          // lxlrcLines.push(line)
          lrcLines.push(line)
        }
        continue
      }

      const startMsTime = parseInt(result[1])
      const startTimeStr = this.msFormat(startMsTime)
      if (!startTimeStr) continue

      let words = line.replace(this.rxps.lineTime, '')

      lrcLines.push(`${startTimeStr}${words.replace(this.rxps.wordTimeAll, '')}`)

      let times = words.match(this.rxps.wordTimeAll)
      if (!times) continue
      times = times.map(time => {
        const result = /\((\d+),(\d+)\)/.exec(time)
        return `<${Math.trunc(Math.max(parseInt(result[1]) - startMsTime, 0))},${result[2]}>`
      })
      const wordArr = words.split(this.rxps.wordTime)
      const newWords = times.map((time, index) => `${time}${wordArr[index]}`).join('')
      lxlrcLines.push(`${startTimeStr}${newWords}`)
    }
    return {
      lyric: lrcLines.join('\n'),
      lxlyric: lxlrcLines.join('\n'),
    }
  },
  parseRlyric(lrc) {
    lrc = lrc.trim()
    lrc = lrc.replace(/\r/g, '')
    if (!lrc) return { lyric: '', lxlyric: '' }
    const lines = lrc.split('\n')

    const lrcLines = []

    for (let line of lines) {
      line = line.trim()
      let result = this.rxps.lineTime.exec(line)
      if (!result) continue

      const startMsTime = parseInt(result[1])
      const startTimeStr = this.msFormat(startMsTime)
      if (!startTimeStr) continue

      let words = line.replace(this.rxps.lineTime, '')

      lrcLines.push(`${startTimeStr}${words.replace(this.rxps.wordTimeAll, '')}`)
    }
    return lrcLines.join('\n')
  },
  removeTag(str) {
    return str.replace(/^[\S\s]*?LyricContent="/, '').replace(/"\/>[\S\s]*?$/, '')
  },
  getIntv(interval) {
    if (!interval) return 0
    if (!interval.includes('.')) interval += '.0'
    let arr = interval.split(/:|\./)
    while (arr.length < 3) arr.unshift('0')
    const [m, s, ms] = arr
    return parseInt(m) * 3600000 + parseInt(s) * 1000 + parseInt(ms)
  },
  fixRlrcTimeTag(rlrc, lrc) {
    // console.log(lrc)
    // console.log(rlrc)
    const rlrcLines = rlrc.split('\n')
    let lrcLines = lrc.split('\n')
    // let temp = []
    let newLrc = []
    rlrcLines.forEach((line) => {
      const result = this.rxps.lineTime2.exec(line)
      if (!result) return
      const words = line.replace(this.rxps.lineTime2, '')
      if (!words.trim()) return
      const t1 = this.getIntv(result[1])

      while (lrcLines.length) {
        const lrcLine = lrcLines.shift()
        const lrcLineResult = this.rxps.lineTime2.exec(lrcLine)
        if (!lrcLineResult) continue
        const t2 = this.getIntv(lrcLineResult[1])
        if (Math.abs(t1 - t2) < 100) {
          newLrc.push(line.replace(this.rxps.lineTime2, lrcLineResult[0]))
          break
        }
        // temp.push(line)
      }
      // lrcLines = [...temp, ...lrcLines]
      // temp = []
    })
    return newLrc.join('\n')
  },
  fixTlrcTimeTag(tlrc, lrc) {
    // console.log(lrc)
    // console.log(tlrc)
    const tlrcLines = tlrc.split('\n')
    let lrcLines = lrc.split('\n')
    // let temp = []
    let newLrc = []
    tlrcLines.forEach((line) => {
      const result = this.rxps.lineTime2.exec(line)
      if (!result) return
      const words = line.replace(this.rxps.lineTime2, '')
      if (!words.trim()) return
      let time = result[1]
      if (time.includes('.')) {
        time += ''.padStart(3 - time.split('.')[1].length, '0')
      }
      const t1 = this.getIntv(time)

      while (lrcLines.length) {
        const lrcLine = lrcLines.shift()
        const lrcLineResult = this.rxps.lineTime2.exec(lrcLine)
        if (!lrcLineResult) continue
        const t2 = this.getIntv(lrcLineResult[1])
        if (Math.abs(t1 - t2) < 100) {
          newLrc.push(line.replace(this.rxps.lineTime2, lrcLineResult[0]))
          break
        }
        // temp.push(line)
      }
      // lrcLines = [...temp, ...lrcLines]
      // temp = []
    })
    return newLrc.join('\n')
  },
  parse(lrc, tlrc, rlrc) {
    const info = {
      lyric: '',
      tlyric: '',
      rlyric: '',
      lxlyric: '',
    }
    if (lrc) {
      let { lyric, lxlyric } = this.parseLyric(this.removeTag(lrc))
      info.lyric = lyric
      info.lxlyric = lxlyric
      // console.log(lyric)
      // console.log(lxlyric)
    }
    if (rlrc) info.rlyric = this.fixRlrcTimeTag(this.parseRlyric(this.removeTag(rlrc)), info.lyric)
    if (tlrc) info.tlyric = this.fixTlrcTimeTag(tlrc, info.lyric)
    // console.log(info.lyric)
    // console.log(info.tlyric)
    // console.log(info.rlyric)

    return info
  },
}


export default {
  successCode: 0,
  async getSongId({ songId, songmid }) {
    if (songId) return songId
    if (songIdMap.has(songmid)) return songIdMap.get(songmid)
    if (!songmid) throw new Error('QQ song MID unavailable')
    if (promises.has(songmid)) return promises.get(songmid)
    const promise = getMusicInfo(songmid).then(info => {
      if (!info?.songId) throw new Error('QQ song ID unavailable')
      songIdMap.set(songmid, info.songId)
      return info.songId
    })
    promises.set(songmid, promise)
    try {
      return await promise
    } finally { promises.delete(songmid) }
  },
  async parseLyric(lrc, tlrc, rlrc) {
    const { lyric, tlyric, rlyric } = await decodeLyric(lrc, tlrc, rlrc)
    return parseTools.parse(lyric, tlyric, rlyric)
  },
  getLyric(mInfo, retryNum = 0) {
    if (typeof mInfo === 'string') mInfo = { songmid: mInfo }
    else if (typeof mInfo === 'number') mInfo = { songId: mInfo }
    if (retryNum > 3) return { promise: Promise.reject(new Error('Get lyric failed')), cancelHttp() {} }

    let activeRequest
    let cancelled = false
    const result = {
      cancelHttp() {
        cancelled = true
        activeRequest?.cancelHttp()
      },
      promise: this.getSongId(mInfo).then(songId => {
        if (cancelled) throw new Error('Cancel Request')
        const requestObj = httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
          method: 'post',
          headers: {
            referer: 'https://y.qq.com',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
          },
          body: {
            comm: {
              ct: '19',
              cv: '1859',
              uin: '0',
            },
            req: {
              method: 'GetPlayLyricInfo',
              module: 'music.musichallSong.PlayLyricInfo',
              param: {
                format: 'json',
                crypt: 1,
                ct: 19,
                cv: 1873,
                interval: 0,
                lrc_t: 0,
                qrc: 1,
                qrc_t: 0,
                roma: 1,
                roma_t: 0,
                songID: songId,
                trans: 1,
                trans_t: 0,
                type: -1,
              },
            },
          },
        })
        activeRequest = requestObj
        return requestObj.promise.then(({ body }) => {
          if (cancelled) throw new Error('Cancel Request')
          if (body.code != this.successCode || body.req?.code != this.successCode) {
            activeRequest = this.getLyric({ ...mInfo, songId }, ++retryNum)
            return activeRequest.promise
          }
          const data = body.req.data
          return this.parseLyric(data.lyric, data.trans, data.roma).then(info => { if (!info.lyric) throw new Error('Get lyric failed'); return info })
        })
      }),
    }
    return result
  },
}


// Legacy implementation retained for reference; inactive.
// import { httpFetch } from '../../request'
// // import getMusicInfo from './musicInfo'
//
// const decodeName = (str = '') => {
//   if (!str) return ''
//   return str.replace(/&#(\d+);/g, (match, dec) => {
//     return String.fromCharCode(dec)
//   }).replace(/&amp;/g, '&')
//     .replace(/&lt;/g, '<')
//     .replace(/&gt;/g, '>')
//     .replace(/&quot;/g, '"')
//     .replace(/&apos;/g, "'")
// }
//
// const b64DecodeUnicode = (str) => {
//   return Buffer.from(str, 'base64').toString('utf8')
// }
//
// export default {
//   regexps: {
//     matchLrc: /.+"lyric":"([\w=+/]*)".+/,
//   },
//   getLyric(songmid) {
//     const songId = songmid.songmid || songmid
//     const requestObj = httpFetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songId}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq`, {
//       headers: {
//         Referer: 'https://y.qq.com/portal/player.html',
//       },
//     })
//     requestObj.promise = requestObj.promise.then(({ body }) => {
//       if (body.code != 0 || !body.lyric) return Promise.reject(new Error('Get lyric failed'))
//       return {
//         lyric: decodeName(b64DecodeUnicode(body.lyric)),
//         tlyric: decodeName(b64DecodeUnicode(body.trans)),
//       }
//     })
//     return requestObj
//   },
// }
//
