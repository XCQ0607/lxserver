const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

test('integrity endpoints require admin authentication and dispatch explicit actions', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server/server.ts'), 'utf8')
  const route = source.slice(source.indexOf("      if (pathname === '/api/openlist/integrity'"), source.indexOf("      if (pathname === '/api/openlist/backups'"))
  let started = 0, cancelled = 0
  const invoke = (pathname, method, authenticated = true, body = {}) => new Promise((resolve, reject) => {
    let status = 200
    const context = { pathname, req: { method, headers: { 'x-frontend-auth': authenticated ? 'fixture' : '' } },
      global: { lx: { config: { 'admin.password': 'fixture' } } }, readBody: async () => JSON.stringify(body),
      res: { writeHead(code) { status = code }, end(text) { resolve({ status, body: text ? JSON.parse(text) : null }) } },
      integrityStatus: () => ({ job: null, results: [] }),
      prepareOpenlistIntegrity: options => ({ total: options.scope === 'all' ? 3 : 1, token: 'plan' }),
      startOpenlistIntegrity: token => { if (token !== 'plan') throw new Error('preview required'); started++; return { jobId: 'fixture-job' } },
      cancelIntegrity: () => { cancelled++ },
    }
    vm.runInNewContext(transformSync('(async () => {' + route + '})()', { loader: 'ts' }).code, context).catch(reject)
  })
  for (const suffix of ['', '/preview', '/start', '/cancel']) assert.equal((await invoke('/api/openlist/integrity' + suffix, suffix ? 'POST' : 'GET', false)).status, 401)
  assert.equal((await invoke('/api/openlist/integrity', 'GET')).body.results.length, 0)
  assert.equal((await invoke('/api/openlist/integrity/preview', 'POST', true, { scope: 'all' })).body.total, 3)
  assert.equal((await invoke('/api/openlist/integrity/start', 'POST')).status, 400)
  assert.equal((await invoke('/api/openlist/integrity/start', 'POST', true, { token: 'plan' })).body.jobId, 'fixture-job')
  assert.equal((await invoke('/api/openlist/integrity/cancel', 'POST')).status, 200)
  assert.equal((await invoke('/api/openlist/integrity/start', 'GET')).status, 404)
  assert.equal(started, 1); assert.equal(cancelled, 1)
})

test('integrity UI previews costs, renders escaped results and paginates all files', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8')
  const methods = source.slice(source.indexOf('    invalidateOpenlistIntegrity() {'), source.indexOf('    switchOpenlistTab(name) {'))
  const nodes = {}
  for (const id of ['type', 'user', 'scope', 'result-filter', 'search', 'start', 'cancel', 'estimate', 'progress', 'results']) nodes['ol-integrity-' + id] = { value: '', options: [], appendChild(option) { this.options.push(option) } }
  nodes['ol-integrity-scope'].value = 'all'
  const app = vm.runInNewContext('new (class {' + methods + '})()', {
    document: { getElementById: id => nodes[id], createElement: () => ({}) }, window: {}, setInterval: () => 1, clearInterval() {},
  })
  app.escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  app.initCustomSelects = () => {}
  let started = false
  app.request = async (url, args) => {
    if (url.endsWith('/preview')) return { total: 51, bytes: 1024, unknown: 1, token: 'fixture' }
    if (url.endsWith('/start')) { assert.equal(JSON.parse(args.body).token, 'fixture'); started = true; return {} }
    if (url.endsWith('/backups')) return { list: [{ user: 'alice' }] }
    return { job: { state: 'completed', done: 51, total: 51, bytes: 1024 }, results: Array.from({ length: 51 }, (_, n) => ({ name: '<file>' + n, remote: '/test/' + n, result: n === 50 ? 'error' : 'matched', checkedAt: Date.now(), error: n === 50 ? '<timeout>' : '' })) }
  }
  await app.previewOpenlistIntegrity()
  assert.match(nodes['ol-integrity-estimate'].textContent, /51 个文件.*1.0 KB/)
  assert.equal(nodes['ol-integrity-start'].disabled, false)
  await app.startOpenlistIntegrity(); assert.equal(started, true)
  assert.match(nodes['ol-integrity-results'].innerHTML, /&lt;file&gt;0/)
  assert.ok(!nodes['ol-integrity-results'].innerHTML.includes('<file>'))
  app._olIntegrityPage = 2; await app.loadOpenlistIntegrity()
  assert.match(nodes['ol-integrity-results'].innerHTML, /&lt;file&gt;50/)
  assert.match(nodes['ol-integrity-results'].innerHTML, /读取失败/)
  nodes['ol-integrity-search'].value = '/test/1'; await app.loadOpenlistIntegrity()
  assert.match(nodes['ol-integrity-results'].innerHTML, /共 11 条/)
})


test('record tasks remain independent of integrity filtering and legacy verified status', async () => {
  const source = fs.readFileSync('public/app.js', 'utf8')
  const start = source.indexOf('    filterOpenlistRecords(records, ignoreStatus = false) {')
  const method = source.slice(start, source.indexOf('    async retryOpenlistBackup(id)', start))
  const nodes = {
    'openlist-backups-list': {}, 'openlist-status-cards': {}, 'openlist-records-summary': {}, 'olb-filter-status': { value: '' }, 'olb-filter-integrity': { value: '' },
  }
  const app = vm.runInNewContext(`new (class {${method}})()`, { document: { getElementById: id => nodes[id] || null }, console })
  app.initCustomSelects = () => {}; app.updateOlbSelCount = () => {}
  let requests = 0
  app.request = async () => { requests++; return { list: [
    { id: 1, name: 'legacy.mp3', status: 'verified' },
    { id: 2, name: 'checked.mp3', status: 'completed', content_verification: 'matched', content_verified_at: 1000 },
    { id: 3, name: 'failed.mp3', status: 'failed', content_verification: 'matched' },
  ] } }
  await app.loadOpenlistBackups()
  assert.equal(app._olbCurrentList[0].status, 'completed')
  assert.equal(app._olbCurrentList[1].status, 'completed')
  assert.equal(app._olbCurrentList[2].status, 'failed')
  assert.doesNotMatch(nodes['openlist-status-cards'].innerHTML, /data-status="verified"/)
  assert.match(nodes['openlist-status-cards'].innerHTML, /data-status="paused"/)
  assert.match(nodes['openlist-records-summary'].innerHTML, /内容曾校验通过 <b>1/)
  nodes['olb-filter-status'].value = 'completed'
  nodes['olb-filter-integrity'].value = 'matched'
  await app.loadOpenlistBackups(true, true)
  assert.equal(requests, 1)
  assert.match(nodes['openlist-backups-list'].innerHTML, /checked.mp3/)
  assert.doesNotMatch(nodes['openlist-backups-list'].innerHTML, /legacy.mp3|failed.mp3/)
})


test('record facets combine keyword, user, local availability, dates and sorting without mutating input', () => {
  const source = fs.readFileSync('public/app.js', 'utf8')
  const start = source.indexOf('    filterOpenlistRecords(records, ignoreStatus = false) {')
  const method = source.slice(start, source.indexOf('    renderOpenlistFilterFeedback(', start))
  const snapshot = source.slice(source.indexOf('    olbSnapshotType(f) {'), source.indexOf('    gotoOpenlistPage(n)'))
  const values = {}
  const app = vm.runInNewContext(`new (class {${method}${snapshot}})()`, { document: { getElementById: id => ({ value: values[id] || '' }) } })
  const records = [
    { id: 1, user: 'admin', name: 'Song alpha.mp3', remote_path: '/cloud/Music/song', local_exists: true, status: 'completed', updated_at: new Date('2026-11-07T12:00:00').getTime(), size: 5 },
    { id: 2, user: 'admin', name: 'Song beta.mp3', local_exists: false, status: 'verified', updated_at: new Date('2026-11-07T23:59:59').getTime(), size: 10 },
    { id: 3, user: '_open', name: 'Song alpha.mp3', local_exists: true, status: 'failed', updated_at: new Date('2026-11-08T00:00:00').getTime(), size: 20 },
  ]
  values['olb-filter-from'] = '2026-11-07'; values['olb-filter-to'] = '2026-11-07'
  assert.equal(app.filterOpenlistRecords(records).length, 2)
  values['olb-filter-user'] = 'admin'; values['olb-filter-name'] = 'SONG alpha'; values['olb-filter-local'] = 'yes'
  assert.deepEqual(Array.from(app.filterOpenlistRecords(records), row => row.id), [1])
  values['olb-filter-status'] = 'verified'
  assert.equal(app.filterOpenlistRecords(records).length, 0)
  assert.equal(app.filterOpenlistRecords(records, true).length, 1)
  for (const key of Object.keys(values)) delete values[key]
  values['olb-filter-sort'] = 'size-desc'
  assert.deepEqual(Array.from(app.filterOpenlistRecords(records), row => row.id), [3, 2, 1])
  assert.deepEqual(records.map(row => row.id), [1, 2, 3])
  values['olb-filter-sort'] = 'name-desc'
  assert.deepEqual(Array.from(app.filterOpenlistRecords(records), row => row.id), [2, 1, 3])
  values['olb-filter-from'] = '2026-11-08'; values['olb-filter-to'] = '2026-11-07'
  assert.equal(app.filterOpenlistRecords(records).length, 0)
  assert.equal(app.olbSnapshotType({ folder_type: 'data', local_path: 'E:\\data\\users\\admin\\dislike\\snapshot\\snapshot_1' }), 'dislike')
})

test('metadata routes authenticate all actions and reject unsupported methods', async () => {
  const source = fs.readFileSync('src/server/server.ts', 'utf8');
  const start = source.indexOf("      if (['/api/openlist/metadata'");
  const route = source.slice(start, source.indexOf("      if (pathname === '/api/openlist/backups'", start));
  let starts = 0, stops = 0;
  const invoke = (pathname, method, auth = true, body = {}) => new Promise((resolve, reject) => {
    let status = 200;
    const context = { pathname, req: { method, headers: { 'x-frontend-auth': auth ? 'secret' : '' } },
      global: { lx: { config: { 'admin.password': 'secret' } } }, readBody: async () => JSON.stringify(body),
      res: { writeHead(code) { status = code; }, end(text) { resolve({ status, body: text ? JSON.parse(text) : null }); } },
      openlistMetadataStatus: () => ({ job: null, total: 3 }),
      startOpenlistMetadata: options => { starts++; return { job: { target: options.target } }; }, cancelMetadata: () => stops++,
    };
    vm.runInNewContext(transformSync('(async () => {' + route + '})()', { loader: 'ts' }).code, context).catch(reject);
  });
  for (const suffix of ['', '/start', '/cancel']) assert.equal((await invoke('/api/openlist/metadata' + suffix, suffix ? 'POST' : 'GET', false)).status, 401);
  assert.equal((await invoke('/api/openlist/metadata', 'GET')).body.total, 3);
  assert.equal((await invoke('/api/openlist/metadata/start', 'POST', true, { target: 'local', ids: [1] })).body.job.target, 'local');
  await invoke('/api/openlist/metadata/cancel', 'POST');
  assert.equal((await invoke('/api/openlist/metadata/start', 'GET')).status, 405);
  assert.equal(starts, 1); assert.equal(stops, 1);
});
