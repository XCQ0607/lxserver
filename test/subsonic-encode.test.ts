import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeAlbumRule, parseAlbumRule } from '../src/modules/dislike/utils.js'
import { normalizeText } from '../src/server/utils/songVersion.js'

// 这组测试是 PR #362 意见1（专辑维度 dislike 规则编码不一致）的回归护栏：
// 写入侧用 encodeAlbumRule 生成「!<专辑名>@<歌手>」，解析侧用 parseAlbumRule 按最后一个 @ 切分。
// 旧实现曾对整行做 normalizeText，把分隔符 @ 替换成 #，导致 parseAlbumRule 返回 null、
// 专辑规则整体失效且无法删除。下面用「encode→parse 往返」不变量锁定正确行为。

test('encodeAlbumRule -> parseAlbumRule 往返（含专辑名含 @ 的边界）', () => {
  const cases: Array<[string, string]> = [
    ['晴天', '周杰伦'],
    ['A@B', 'C'], // 专辑名本身含分隔符 @
    ['Hello (Live)', 'Some Singer'],
    ['周杰伦的床边故事', '周杰伦'],
  ]
  for (const [album, singer] of cases) {
    const line = encodeAlbumRule(album, singer)
    const parsed = parseAlbumRule(line)
    assert.ok(parsed, `parseAlbumRule 应能解析 ${line}`)
    // 往返必须还原为「归一化」后的专辑名/歌手（与 normalizeText 一致）
    assert.deepEqual(parsed, {
      albumName: normalizeText(album),
      singer: normalizeText(singer),
    })
    // 归一化值重新编码后应稳定（幂等）
    assert.deepEqual(parseAlbumRule(encodeAlbumRule(parsed.albumName, parsed.singer)), parsed)
  }
})

test('parseAlbumRule 对空专辑名返回 null', () => {
  assert.equal(parseAlbumRule(encodeAlbumRule('', '歌手')), null)
})

test('parseAlbumRule 对非专辑规则行返回 null', () => {
  assert.equal(parseAlbumRule('晴天@周杰伦'), null) // 歌曲维度，无 ! 前缀
  assert.equal(parseAlbumRule('随便一行无关文本'), null)
})

test('isAlbumRule 只识别 ! 前缀', () => {
  assert.equal(parseAlbumRule('!专辑@歌手') !== null, true)
  assert.equal(parseAlbumRule('专辑@歌手') === null, true)
})
