// Live, read-only SDK audit. Run before and after a migration with the same cases.
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const phase = process.argv[2] || 'after'
if (!['before', 'after'].includes(phase)) throw new Error('Expected phase: before or after')
const dir = path.resolve('reports/sdk-interface-audit')
const buildDir = path.resolve('cache/sdk-interface-audit')
await fs.mkdir(dir, { recursive: true })
await fs.mkdir(buildDir, { recursive: true })
const baselineRef = process.env.SDK_AUDIT_BASE_REF || execFileSync('git', ['-c', 'safe.directory=E:/Antigravity/lxserver', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const root = path.resolve('src/modules/utils/musicSdk').replaceAll('\\', '/')
const names = ['tx/musicSearch', 'tx/musicInfo', 'tx/singer', 'tx/songList', 'tx/lyric', 'kg/musicSearch', 'kg/songList', 'kg/leaderboard', 'kw/musicSearch', 'kw/songList', 'kw/lyric', 'wy/musicSearch', 'wy/songList', 'wy/singer', 'wy/lyric', 'mg/musicSearch', 'mg/pic', 'mg/lyric']
await build({
  stdin: { contents: names.map((n, i) => `import m${i} from ${JSON.stringify(root + '/' + n + '.js')};`).join('\n') + '\nexport default {' + names.map((n, i) => `${JSON.stringify(n)}:m${i}`).join(',') + '}', resolveDir: process.cwd(), loader: 'js' },
  outfile: path.join(buildDir, phase + '.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'audit-request-observer', setup(b) {
    if (phase === 'before') b.onLoad({ filter: /[\\/]musicSdk[\\/].*\.[jt]s$/ }, ({ path: p }) => {
      const relative = path.relative(process.cwd(), p).replaceAll('\\', '/')
      return { contents: execFileSync('git', ['-c', 'safe.directory=E:/Antigravity/lxserver', 'show', baselineRef + ':' + relative], { encoding: 'utf8' }), loader: p.endsWith('.ts') ? 'ts' : 'js', resolveDir: path.dirname(p) }
    })
    b.onLoad({ filter: /[\\/]utils[\\/]request\.js$/ }, async ({ path: p }) => {
      let contents = await fs.readFile(p, 'utf8')
      contents = contents.replace('export const httpFetch =', 'const originalHttpFetch =')
      contents += `\nexport const httpFetch = (url, options = {}) => {
        const record = { url: String(url).split('?')[0], method: options.method || 'GET' };
        globalThis.__auditRequests?.push(record);
        const req = originalHttpFetch(url, { ...options, timeout: 6000 });
        globalThis.__auditActive?.add(req);
        req.promise = req.promise.then(resp => { record.status = resp.statusCode; record.code = resp.body?.code ?? resp.body?.errcode ?? resp.body?.error_code;
          record.modules = Object.fromEntries(Object.entries(resp.body || {}).filter(([k,v]) => v && typeof v === 'object' && 'code' in v).map(([k,v]) => [k, {code:v.code, keys:Object.keys(v.data || {})}]));
          if (resp.body?.resource) record.resource = { count:resp.body.resource.length, keys:Object.keys(resp.body.resource[0] || {}) };
          return resp; })
          .catch(err => { record.error = err.message; throw err; }).finally(() => globalThis.__auditActive?.delete(req));
        return req;
      };`
      return { contents, loader: 'js', resolveDir: path.dirname(p) }
    })
  } }],
})
globalThis.lx = { config: {} }
globalThis.__auditRequests = []
globalThis.__auditActive = new Set()
process.on('unhandledRejection', error => console.error('SDK unhandled rejection:', error?.message || error))
const sdk = (await import(pathToFileURL(path.join(buildDir, phase + '.cjs')).href)).default.default
const results = []
const samples = {}
const unwrap = value => value?.promise || value
async function check(name, call, validate) {
  const start = Date.now(), offset = globalThis.__auditRequests.length
  let timer
  try {
    const value = await Promise.race([Promise.resolve().then(call).then(unwrap), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('audit deadline (20s)')), 20000) })])
    const summary = validate(value)
    results.push({ name, ok: true, ms: Date.now() - start, summary })
  } catch (error) { results.push({ name, ok: false, ms: Date.now() - start, error: error.message }) }
  finally { clearTimeout(timer); for (const r of globalThis.__auditActive) r.cancelHttp?.(); globalThis.__auditActive.clear() }
  results.at(-1).requests = globalThis.__auditRequests.slice(offset)
  console.log(JSON.stringify(results.at(-1)))
  await fs.writeFile(path.join(dir, phase + '.json'), JSON.stringify({ phase, baselineRef, time: new Date().toISOString(), results }, null, 2))
}
function list(v) { if (!Array.isArray(v?.list) || !v.list.length) throw new Error('missing/non-empty list'); return { count: v.list.length, total: v.total, first: v.list[0].name || v.list[0].info?.name } }
function info(v) { if (!v?.info?.name) throw new Error('missing info.name'); return { name: v.info.name } }
function lyric(v) { if (!v?.lyric || !/\[\d+:\d+/.test(v.lyric)) throw new Error('missing timed lyric'); return { length: v.lyric.length, word: !!v.lxlyric, translation: !!v.tlyric } }
for (const source of ['tx', 'kg', 'kw', 'wy', 'mg']) {
  await check(source + '.search', async () => {
    const v = await sdk[source + '/musicSearch'].search('周杰伦', 1, 10)
    samples[source] = v.list?.[0]
    return v
  }, list)
}
// Fixed detail fixtures keep before/after comparisons independent of search rankings.
const txSample = { songmid: '0027oMO61wWi55', songId: 718475 }
const mgSample = { songmid: '1140505222', copyrightId: '60054704965' }
await check('tx.musicInfo', () => sdk['tx/musicInfo'](txSample.songmid), v => { if (!v?.songmid) throw new Error('missing songmid'); return { name: v.name } })
for (const method of ['getInfo', 'getAlbumList', 'getSongList']) await check('tx.singer.' + method, () => sdk['tx/singer'][method]('0025NhlN2yWrP4', 1, 5), method === 'getInfo' ? info : list)
await check('tx.playlist.hot', () => sdk['tx/songList'].getList(3, null, 1), v => { samples.txList = v.list?.[0]; return list(v) })
await check('tx.playlist.default', () => sdk['tx/songList'].getList('hot', null, 1), list)
await check('tx.playlist.recommend', () => sdk['tx/songList'].getList(-1, null, 1), list)
await check('tx.playlist.tag', () => sdk['tx/songList'].getList(3, '165', 1), list)
await check('tx.playlist.detail', () => sdk['tx/songList'].getListDetail('9013043487'), list)
await check('tx.lyric', () => sdk['tx/lyric'].getLyric(txSample), lyric)
await check('kw.lyric', () => sdk['kw/lyric'].getLyric({ songmid: '118990' }), lyric)
await check('kw.playlist', () => sdk['kw/songList'].getList('hot', null, 1), list)
await check('wy.tags', () => sdk['wy/songList'].getTag(), v => { if (!Array.isArray(v) || !v.length) throw new Error('missing tags'); return { count: v.length } })
for (const method of ['getInfo', 'getAlbumList', 'getSongList']) await check('wy.singer.' + method, () => sdk['wy/singer'][method]('6452', 1, 5), method === 'getInfo' ? info : list)
await check('wy.lyric', () => sdk['wy/lyric']('186016'), lyric)
await check('mg.pic', () => sdk['mg/pic'].getPic(mgSample), v => { if (typeof v !== 'string' || !/^https?:/.test(v)) throw new Error('expected image URL, got ' + typeof v); return { url: v } })
await check('mg.lyric', () => sdk['mg/lyric'].getLyric(mgSample), lyric)
await check('kg.playlist', () => sdk['kg/songList'].getList('5', null, 1), v => { samples.kgList = v.list?.[0]; return list(v) })
await check('kg.playlist.detail', () => sdk['kg/songList'].getListDetail('id_1067062', 1), list)
// Real shared chain/code values must be supplied; invented codes are not success tests.
if (process.env.KG_SHARE_LINK) await check('kg.playlist.share', () => sdk['kg/songList'].getListDetail(process.env.KG_SHARE_LINK, 1), list)
if (process.env.KG_SHARE_CODE) await check('kg.playlist.code', () => sdk['kg/songList'].getListDetail(process.env.KG_SHARE_CODE, 1), list)
console.log(`Completed ${results.length} cases: ${results.filter(r => r.ok).length} passed. Report: ${dir}/${phase}.json`)
process.exitCode = results.some(r => !r.ok) ? 1 : 0
