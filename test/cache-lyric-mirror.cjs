'use strict'
// 共享镜像模块（不是测试文件：文件名不带 .test，不会被 npm test 的 test/*.test.cjs 匹配到）
//
// 本仓库没有装 node_modules 时无法 import src 下的 TS 源，所以这里镜像 src/server/fileCache.ts
// 中几段纯逻辑，供 test/*.test.cjs 断言"判定规则"：
//   getFileNameSimple      -> getFileName 的 SIMPLE 分支 (fileCache.ts:583-608)，不含防碰撞后缀
//   alignStaleLyricName    -> fileCache.ts:1988 起
//   resolveLyricQuality    -> saveLyricCache 的 lyricQuality || songInfo.quality || LYRIC_PENDING_QUALITY
//   findOrphanLyrics       -> getOrphanLyricFiles (fileCache.ts:1029 起)
//   checkCacheHitsAudio    -> checkCache 只把 item.filename 指向的音频算命中 (fileCache.ts:1546-1575)
// 类型与接线不在这里覆盖，由 tsc 负责。改上面那几处源码时，同步改本文件。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const LYRIC_PENDING_QUALITY = 'unknown'
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.ogg', '.wav']

const sanitize = s => String(s || '').replace(/[\\/:*?"<>|]/g, '_')

const getFileNameSimple = (songInfo, quality) =>
  `${sanitize(songInfo.name || 'Unknown')} - ${sanitize(songInfo.singer || 'Unknown')} - ` +
  `${sanitize(quality || songInfo.quality || LYRIC_PENDING_QUALITY)} - ${sanitize(songInfo.albumName || 'Unknown Album')}`

const alignStaleLyricName = (songInfo, dir, finalBaseName, fallbackQualities) => {
  const target = path.join(dir, finalBaseName + '.lrc')
  if (fs.existsSync(target)) return
  for (const q of [...new Set(fallbackQualities.filter(Boolean))]) {
    const staleBaseName = getFileNameSimple(songInfo, q)
    if (!staleBaseName || staleBaseName === finalBaseName) continue
    const stalePath = path.join(dir, staleBaseName + '.lrc')
    if (!fs.existsSync(stalePath)) continue
    fs.renameSync(stalePath, target)
    return
  }
}

const resolveLyricQuality = (lyricQuality, songInfo) => lyricQuality || songInfo.quality || LYRIC_PENDING_QUALITY

const findOrphanLyrics = (dir, indexItems) => {
  const referenced = new Set(indexItems.map(i => i.lyricFilename).filter(Boolean).map(p => String(p).replace(/\\/g, '/')))
  const lrcFiles = []
  const audioBases = new Set()
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) { walk(childRel); continue }
      if (entry.name.endsWith('.lrc')) { lrcFiles.push(childRel); continue }
      const ext = path.extname(entry.name).toLowerCase()
      if (AUDIO_EXTENSIONS.includes(ext)) audioBases.add(childRel.slice(0, -ext.length))
    }
  }
  walk('')
  return lrcFiles.filter(f => !referenced.has(f) && !audioBases.has(f.slice(0, -'.lrc'.length))).sort()
}

const checkCacheHitsAudio = (item, dir) => {
  if (!item?.filename) return false
  if (!AUDIO_EXTENSIONS.includes(path.extname(item.filename).toLowerCase())) return false
  return fs.existsSync(path.join(dir, item.filename))
}

const mkDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lx-cache-lyric-'))

const touch = (dir, name, content = 'x') => {
  fs.mkdirSync(path.join(dir, path.dirname(name)), { recursive: true })
  fs.writeFileSync(path.join(dir, name), content)
}

const listDir = dir => fs.readdirSync(dir).sort()

const audioName = (song, quality) => getFileNameSimple(song, quality)

module.exports = {
  LYRIC_PENDING_QUALITY,
  AUDIO_EXTENSIONS,
  getFileNameSimple,
  alignStaleLyricName,
  resolveLyricQuality,
  findOrphanLyrics,
  checkCacheHitsAudio,
  mkDir,
  touch,
  listDir,
  audioName,
}
