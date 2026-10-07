'use strict'
// 兜底音质名解析 / 未引用歌词差集 / 播放命中不变量：零依赖逻辑测试（node --test test/*.test.cjs）
// 被测逻辑镜像在 ./cache-lyric-mirror.cjs，对应 src/server/fileCache.ts 的
// saveLyricCache 音质解析、getOrphanLyricFiles、checkCache。
// 歌词文件名对齐的用例在 ./lrc-align.test.cjs。

const test = require('node:test')
const assert = require('node:assert')

const {
  LYRIC_PENDING_QUALITY,
  resolveLyricQuality,
  findOrphanLyrics,
  checkCacheHitsAudio,
  mkDir,
  touch,
} = require('./cache-lyric-mirror.cjs')

test('quality: 参数优先于 songInfo.quality，都没有时用占位值', () => {
  const song = { name: 'X', singer: 'Y', albumName: 'Z', quality: '128k' }
  assert.strictEqual(resolveLyricQuality('flac', song), 'flac')
  assert.strictEqual(resolveLyricQuality(undefined, song), '128k')
  assert.strictEqual(resolveLyricQuality(undefined, { name: 'X', singer: 'Y', albumName: 'Z' }), LYRIC_PENDING_QUALITY)
})

test('quality: 不传参数时与旧行为完全一致', () => {
  // 旧实现：songInfo.quality || 'unknown'
  for (const song of [{ quality: 'flac' }, { quality: '' }, {}]) {
    assert.strictEqual(resolveLyricQuality(undefined, song), song.quality || 'unknown')
  }
})

test('orphans: 被索引 lyricFilename 引用的不算残留', () => {
  const dir = mkDir()
  const f = '春涧 - 浅影阿 - unknown - 春涧.lrc'
  touch(dir, f)
  assert.deepStrictEqual(findOrphanLyrics(dir, [{ filename: '春涧 - 浅影阿 - flac - 春涧.flac', lyricFilename: f }]), [])
})

test('orphans: 同名音频就在旁边的不算残留（目录同步会认领）', () => {
  const dir = mkDir()
  touch(dir, '春涧 - 浅影阿 - unknown - 春涧.lrc')
  touch(dir, '春涧 - 浅影阿 - unknown - 春涧.flac')
  assert.deepStrictEqual(findOrphanLyrics(dir, []), [])
})

test('orphans: 音频已删、歌词留下 -> 判为残留', () => {
  const dir = mkDir()
  touch(dir, '难解 - 邓寓君(等什么君) - unknown - 难解.lrc')
  assert.deepStrictEqual(findOrphanLyrics(dir, []), ['难解 - 邓寓君(等什么君) - unknown - 难解.lrc'])
})

test('orphans: 子目录（subPath）用相对路径参与比对', () => {
  const dir = mkDir()
  touch(dir, '国风/探故知 - 浅影阿、汐音社 - unknown - 探故知.lrc')
  touch(dir, '国风/探故知 - 浅影阿、汐音社 - flac - 探故知.flac')
  const items = [{
    filename: '国风/探故知 - 浅影阿、汐音社 - flac - 探故知.flac',
    lyricFilename: '国风/探故知 - 浅影阿、汐音社 - flac - 探故知.lrc',
  }]
  assert.deepStrictEqual(findOrphanLyrics(dir, items), ['国风/探故知 - 浅影阿、汐音社 - unknown - 探故知.lrc'])
})

test('playback: 仅有歌词、无音频时不得被判定为已缓存', () => {
  const dir = mkDir()
  const lyricName = '难解 - 邓寓君(等什么君) - unknown - 难解.lrc'
  touch(dir, lyricName)
  // 差集会把它列为残留；同时任何"已缓存"判定都必须落空——这是不往索引里塞仅歌词条目的核心理由
  assert.deepStrictEqual(findOrphanLyrics(dir, []), [lyricName])
  assert.strictEqual(checkCacheHitsAudio({ filename: lyricName }, dir), false)
  assert.strictEqual(checkCacheHitsAudio({ filename: '不存在.flac' }, dir), false)
  touch(dir, '难解 - 邓寓君(等什么君) - flac - 难解.flac')
  assert.strictEqual(checkCacheHitsAudio({ filename: '难解 - 邓寓君(等什么君) - flac - 难解.flac' }, dir), true)
})
