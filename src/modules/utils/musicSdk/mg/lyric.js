import { httpFetch } from '../../request'
import { getMusicInfo } from './musicInfo'
import { decrypt } from './utils/mrc'

const mrcTools = {
  rxps: {
    lineTime: /^\s*\[(\d+),\d+\]/,
    wordTime: /\(\d+,\d+\)/,
    wordTimeAll: /(\(\d+,\d+\))/g,
  },
  parseLyric(str) {
    str = str.replace(/\r/g, '')
    const lines = str.split('\n')
    const lxlrcLines = []
    const lrcLines = []

    for (const line of lines) {
      if (line.length < 6) continue
      let result = this.rxps.lineTime.exec(line)
      if (!result) continue

      const startTime = parseInt(result[1])
      let time = startTime
      let ms = (time % 1000).toString().padStart(3, '0')
      time /= 1000
      let m = parseInt(time / 60).toString().padStart(2, '0')
      time %= 60
      let s = parseInt(time).toString().padStart(2, '0')
      time = `${m}:${s}.${ms}`

      let words = line.replace(this.rxps.lineTime, '')

      lrcLines.push(`[${time}]${words.replace(this.rxps.wordTimeAll, '')}`)

      let times = words.match(this.rxps.wordTimeAll)
      if (!times) continue
      times = times.map(time => {
        const result = /\((\d+),(\d+)\)/.exec(time)
        return `<${parseInt(result[1]) - startTime},${result[2]}>`
      })
      const wordArr = words.split(this.rxps.wordTime)
      const newWords = times.map((time, index) => `${time}${wordArr[index]}`).join('')
      lxlrcLines.push(`[${time}]${newWords}`)
    }
    return {
      lyric: lrcLines.join('\n'),
      lxlyric: lxlrcLines.join('\n'),
    }
  },
  getText(url, tryNum = 0) {
    const requestObj = httpFetch(url, {
      headers: {
        Referer: 'https://app.c.nf.migu.cn/',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36',
        channel: '0146921',
      },
    })
    return requestObj.promise.then(({ statusCode, body }) => {
      if (statusCode == 200) return body
      if (tryNum > 5 || statusCode == 404) return Promise.reject(new Error('歌词获取失败'))
      return this.getText(url, ++tryNum)
    })
  },
  getMrc(url) {
    return this.getText(url).then(text => {
      return this.parseLyric(decrypt(text))
    })
  },
  // Legacy implementation retained for reference; inactive.
  // getLrc(url) {
  //     return this.getText(url).then(text => {
  //       // 咪咕的lrcUrl可能返回纯文本歌词（没有时间标签）
  //       // 需要检查并添加假时间标签
  //       const lines = text.split('\n')
  //       const hasTimeTag = /^\[(\d+):(\d+)\.(\d+)\]/.test(text)
  //
  //       // 如果已经有时间标签，直接返回
  //       if (hasTimeTag) {
  //         const linesWithTime = lines.filter(line => /^\[(\d+):(\d+)\.(\d+)\]/.test(line))
  //         // 如果大部分行都有时间标签（>50%），认为是标准LRC
  //         if (linesWithTime.length > lines.length * 0.5) {
  //           return { lxlyric: '', lyric: text }
  //         }
  //       }
  //
  //       // 否则，为纯文本歌词添加假时间标签
  //       let currentTime = 0
  //       const lrcLines = lines.map((line, index) => {
  //         line = line.trim()
  //         if (!line || line.startsWith('@')) return '' // 跳过空行和头部
  //
  //         // 为每行添加时间标签，每行间隔3秒
  //         const minutes = Math.floor(currentTime / 60)
  //         const seconds = currentTime % 60
  //         const timeTag = `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.00]`
  //         currentTime += 3
  //
  //         return `${timeTag}${line}`
  //       }).filter(line => line) // 移除空行
  //
  //       return { lxlyric: '', lyric: lrcLines.join('\n') }
  //     })
  //   }
  getLrc(url) {
    return this.getText(url).then(text => ({ lxlyric: '', lyric: text }))
  },
  getTrc(url) {
    if (!url) return Promise.resolve('')
    return this.getText(url)
  },
  async getMusicInfo(songInfo) {
    return songInfo.mrcUrl == null
      // Legacy: getMusicInfo(songInfo.copyrightId)
      ? getMusicInfo(songInfo.songmid)
      : songInfo
  },
  getLyric(songInfo) {
    return {
      promise: this.getMusicInfo(songInfo).then(info => {
        let p
        if (info.mrcUrl) p = this.getMrc(info.mrcUrl)
        else if (info.lrcUrl) p = this.getLrc(info.lrcUrl)
        if (p == null) return Promise.reject(new Error('获取歌词失败'))
        return Promise.all([p, this.getTrc(info.trcUrl)]).then(([lrcInfo, tlyric]) => {
          lrcInfo.tlyric = tlyric
          return lrcInfo
        })
      }),
      cancelHttp() { },
    }
  },
}

export default {
  getLyric(songInfo) {
    let requestObj = mrcTools.getLyric(songInfo)
    return requestObj
  },
}
