'use strict'
// 歌词文件名对齐：零依赖逻辑测试（node --test test/*.test.cjs）
// 被测逻辑镜像在 ./cache-lyric-mirror.cjs，对应 src/server/fileCache.ts 的 alignStaleLyricName。
// 场景全部取自真实缓存目录的文件名（NAS 上 cache/_open 里的残留样本）。

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  LYRIC_PENDING_QUALITY,
  getFileNameSimple,
  alignStaleLyricName,
  mkDir,
  touch,
  listDir,
} = require('./cache-lyric-mirror.cjs')

test('align: 兜底 unknown 名对齐到 flac 音频', () => {
  const dir = mkDir()
  const song = { name: '辞九门回忆', singer: '邓寓君(等什么君)', albumName: '辞九门回忆' }
  touch(dir, '辞九门回忆 - 邓寓君(等什么君) - unknown - 辞九门回忆.lrc')
  alignStaleLyricName(song, dir, getFileNameSimple(song, 'flac'), [LYRIC_PENDING_QUALITY, 'flac', song.quality])
  assert.deepStrictEqual(listDir(dir), ['辞九门回忆 - 邓寓君(等什么君) - flac - 辞九门回忆.lrc'])
})

test('align: 歌名含点号（A.I.N.Y. 爱你 / 专辑 18）', () => {
  const dir = mkDir()
  const song = { name: 'A.I.N.Y. 爱你', singer: 'G.E.M.邓紫棋', albumName: '18' }
  touch(dir, 'A.I.N.Y. 爱你 - G.E.M.邓紫棋 - unknown - 18.lrc')
  alignStaleLyricName(song, dir, getFileNameSimple(song, 'flac'), [LYRIC_PENDING_QUALITY, 'flac'])
  assert.deepStrictEqual(listDir(dir), ['A.I.N.Y. 爱你 - G.E.M.邓紫棋 - flac - 18.lrc'])
})

test('align: 专辑名以点号结尾（T.I.M.E.）', () => {
  const dir = mkDir()
  const song = { name: '唯一', singer: 'G.E.M.邓紫棋', albumName: 'T.I.M.E.' }
  touch(dir, '唯一 - G.E.M.邓紫棋 - unknown - T.I.M.E..lrc')
  alignStaleLyricName(song, dir, getFileNameSimple(song, 'flac'), [LYRIC_PENDING_QUALITY, 'flac'])
  assert.deepStrictEqual(listDir(dir), ['唯一 - G.E.M.邓紫棋 - flac - T.I.M.E..lrc'])
})

test('align: 期望音质与修正后音质不同（128k -> flac）', () => {
  const dir = mkDir()
  const song = { name: '雨阑珊', singer: '浅影阿', albumName: '雨阑珊' }
  touch(dir, '雨阑珊 - 浅影阿 - 128k - 雨阑珊.lrc')
  alignStaleLyricName(song, dir, getFileNameSimple(song, 'flac'), [LYRIC_PENDING_QUALITY, '128k', song.quality])
  assert.deepStrictEqual(listDir(dir), ['雨阑珊 - 浅影阿 - flac - 雨阑珊.lrc'])
})

test('align: 目标歌词已存在时不覆盖，两个文件都保留', () => {
  const dir = mkDir()
  const song = { name: '春涧', singer: '浅影阿', albumName: '春涧' }
  touch(dir, '春涧 - 浅影阿 - flac - 春涧.lrc', 'good')
  touch(dir, '春涧 - 浅影阿 - unknown - 春涧.lrc', 'stale')
  alignStaleLyricName(song, dir, getFileNameSimple(song, 'flac'), [LYRIC_PENDING_QUALITY, 'flac'])
  assert.deepStrictEqual(listDir(dir), ['春涧 - 浅影阿 - flac - 春涧.lrc', '春涧 - 浅影阿 - unknown - 春涧.lrc'])
  assert.strictEqual(fs.readFileSync(path.join(dir, '春涧 - 浅影阿 - flac - 春涧.lrc'), 'utf8'), 'good')
})

test('align: 没有本歌的兜底歌词时不动别的歌的歌词', () => {
  const dir = mkDir()
  const song = { name: '春涧', singer: '浅影阿', albumName: '春涧' }
  touch(dir, '谪居 (DJ默涵版) - 浅影阿 - unknown - 谪居.lrc')
  touch(dir, '难解 - 邓寓君(等什么君) - unknown - 难解.lrc')
  alignStaleLyricName(song, dir, getFileNameSimple(song, 'flac'), [LYRIC_PENDING_QUALITY, 'flac'])
  assert.deepStrictEqual(listDir(dir), [
    '谪居 (DJ默涵版) - 浅影阿 - unknown - 谪居.lrc',
    '难解 - 邓寓君(等什么君) - unknown - 难解.lrc',
  ])
})

test('align: 目录里没有歌词时静默跳过', () => {
  const dir = mkDir()
  const song = { name: '壁上观', singer: '邓寓君(等什么君)', albumName: '壁上观' }
  alignStaleLyricName(song, dir, getFileNameSimple(song, 'flac'), [LYRIC_PENDING_QUALITY, 'flac'])
  assert.deepStrictEqual(listDir(dir), [])
})
