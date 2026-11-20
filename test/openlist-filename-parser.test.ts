import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCloudFilename } from '../src/server/openlist/openlistFilenameParser'

test('解析默认 SIMPLE 命名（歌名 - 歌手 - 音质 - 专辑），不伪造歌曲 ID', () => {
  const r = parseCloudFilename('17岁 - 刘德华 - 128k - 如果有一天.mp3')
  assert.equal(r.pattern, 'simple')
  assert.equal(r.confidence, 'exact')
  assert.equal(r.name, '17岁')
  assert.equal(r.singer, '刘德华')
  assert.equal(r.quality, '128k')
  assert.equal(r.album, '如果有一天')
  assert.equal(r.idResolvable, false)
  assert.equal(r.songId, undefined)
})

test('解析 STANDARD 命名可还原 source + songId', () => {
  const r = parseCloudFilename('传奇_-_王菲_-_tx_-_tx_001abc_-_flac.flac', 'standard')
  assert.equal(r.pattern, 'standard')
  assert.equal(r.confidence, 'exact')
  assert.equal(r.source, 'tx')
  assert.equal(r.songId, 'tx_001abc')
  assert.equal(r.quality, 'flac')
  assert.equal(r.idResolvable, true)
})

test('配置为 STANDARD 但存量文件是 SIMPLE 时按其他模式兜底并标注', () => {
  const r = parseCloudFilename('隔岸 (女版) - 可楼 - 128k - 隔岸 (女版).mp3', 'standard')
  assert.equal(r.pattern, 'simple')
  assert.equal(r.matchesConfiguredPattern, false)
  assert.equal(r.confidence, 'fallback')
  assert.equal(r.name, '隔岸 (女版)')
  assert.equal(r.idResolvable, false)
})

test('各命名模式均按传入配置解析，不写死格式', () => {
  const cases: Array<[string, string, string, string]> = [
    ['singer_name_quality_album', '王菲 - 传奇 - 320k - 传奇专辑', '王菲', '传奇'],
    ['singer_name', '王菲 - 传奇', '王菲', '传奇'],
    ['name_singer', '传奇 - 王菲', '传奇', '王菲'],
  ]
  for (const [pattern, base, first, second] of cases) {
    const r = parseCloudFilename(`${base}.mp3`, pattern)
    assert.equal(r.pattern, pattern)
    assert.equal(r.confidence, 'exact')
    if (pattern === 'name_singer') {
      assert.equal(r.name, first)
      assert.equal(r.singer, second)
    } else {
      assert.equal(r.singer, first)
      assert.equal(r.name, second)
    }
  }
})

test('冲突后缀 (id) 能补出歌曲 ID', () => {
  const r = parseCloudFilename('传奇 - 王菲 - 128k - 专辑 (kw_123456).mp3')
  assert.equal(r.songId, 'kw_123456')
  assert.equal(r.idResolvable, true)
  assert.equal(r.name, '传奇')
})

test('未知格式不猜测', () => {
  const r = parseCloudFilename('random-track.bin')
  assert.equal(r.confidence, 'none')
  assert.equal(r.pattern, null)
  assert.equal(r.idResolvable, false)
})
