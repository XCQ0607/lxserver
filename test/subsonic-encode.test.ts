import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeAlbumRule, parseAlbumRule, filterRules } from '../src/modules/dislike/utils.js'
import { normalizeText, normalizeSongName } from '../src/server/utils/songVersion.js'

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

// 回归 PR #362 意见1（覆盖 filterRules 路径）：
// 上面几个用例只走 encodeAlbumRule/parseAlbumRule，并不执行 filterRules 的整行处理。
// 若 filterRules 再次对整行调用 normalizeText，会把分隔符 @ 误写成 #（!a#b#c），
// 使 parseAlbumRule 返回 null、专辑规则整体失效——而上面的用例无法发现。
// 此用例直接断言 filterRules 对「含多个 @ 的专辑规则」保留【最后一个 @】作分隔符。
test('filterRules 保留专辑规则最后的 @ 作为分隔符（回归 PR #362 意见1）', () => {
  const result = filterRules(' !A@B@C ')
  // 输入 ' !A@B@C ' 是一个专辑规则（! 前缀），应只产出一条规则
  assert.equal(result.size, 1)
  const line = [...result][0]
  assert.equal(line.startsWith('!'), true, '应保留专辑规则 ! 前缀')

  // 关键不变量：整行应只剩【一个】@，即最后一个 @ 作为专辑/歌手分隔符，
  // 歌手内部原有的 @（B 与 C 之间）已被 normalizeText 规范为 #。
  // 若 filterRules 错误地整行 normalizeText，会得到 '!a#b#c'（无 @），此断言即失败。
  assert.equal(line.split('@').length, 2, `应只保留一个 @ 作分隔符，实际：${line}`)

  // 解析后必须按「最后一个 @」切分：
  // 'A@B@C' → 专辑=A@B（内部 @ 被归一化为 # → 'a#b'），歌手=C（'c'），
  // 产物为 '!a#b@c'——最后一个 @ 是专辑/歌手分隔符，前面的 @ 属于专辑名一部分。
  const parsed = parseAlbumRule(line)
  assert.ok(parsed, `filterRules 产出的专辑行应可被 parseAlbumRule 解析：${line}`)
  assert.deepEqual(parsed, { albumName: normalizeText('A@B'), singer: normalizeText('C') })
})

// 回归 PR #365 意见6：normalizeSongName 需支持「无括号」的连字符版本后缀（晴天 - Remix），
// 否则默认开启 normalizeName 时，dislike 跨版本匹配会漏报。同时锁定括号内形式仍生效。
test('normalizeSongName 支持无括号连字符版本后缀（回归 PR #365 意见6）', () => {
  assert.equal(normalizeSongName('晴天 - Remix'), '晴天')
  assert.equal(normalizeSongName('晴天 - Live'), '晴天')
  assert.equal(normalizeSongName('晴天 - remix'), '晴天') // 大小写不敏感
  assert.equal(normalizeSongName('晴天 - 现场'), '晴天')
  // 括号内形式仍应生效（不回归）
  assert.equal(normalizeSongName('晴天 (Live)'), '晴天')
  assert.equal(normalizeSongName('晴天（现场版）'), '晴天')
  // 无后缀不受影响
  assert.equal(normalizeSongName('晴天'), '晴天')
})
