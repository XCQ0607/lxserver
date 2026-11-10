const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/app.js','utf8');
function harness(data) {
 const start=source.indexOf('    dislikeOriginLabel('),end=source.indexOf('    getPlaylistsSectionHtml(',start);
 assert.ok(start>=0&&end>start);
 const context=vm.createContext({});
 vm.runInContext(`class Harness { escapeHtml(s) { return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;') } getSourceLabel(s) { return s } ${source.slice(start,end)} }; globalThis.instance=new Harness()`,context);
 const app=context.instance;app.currentUserData={username:'test',data};return app;
}
const fixture={dislikeList:[{name:'<script>track</script>',singer:'artist',source:'tx',id:'tx_1',songmid:'1',img:'javascript:alert(1)',dislikeRule:'track@artist',provenance:{channel:'web',at:1}},{name:'',singer:'',source:'wy',dislikeRule:'!album@artist',provenance:{channel:'subsonic-rating',at:2}}],dislikeArtists:[{name:'Artist',source:'tx',picUrl:'https://example.com/cover.jpg'}],userRatings:{tx_1:5},ratingOrigins:{tx_1:{channel:'subsonic',at:3}}};
test('管理查看合并三类记录，准确区分添加来源与平台，保留原始字段',()=>{
 const app=harness(fixture);const rows=app.getDislikeEntries(fixture);
 assert.deepEqual(Array.from(rows,x=>x.kind),['song','album','artist']);assert.equal(rows[0].cover,'');assert.equal(rows[1].title,'album');assert.equal(rows[2].channel,'unknown');
 const html=app.getDislikeSectionHtml(fixture);assert.match(html,/Web 添加/);assert.match(html,/Subsonic 低分联动/);assert.match(html,/来源未记录/);assert.match(html,/查看详情/);assert.ok([...app._adminDetails.values()].every(m=>m.raw&&m.sections.length));assert.ok(!html.includes('<pre>'));assert.match(html,/aria-label="5 星"/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.match(html,/referrerpolicy="no-referrer"/);
});
test('类型、来源、关键字筛选与分页边界',()=>{
 const app=harness(fixture);const rows=app.getDislikeEntries(fixture);
 app._dislikeFilters={kind:'album',channel:'subsonic-rating',query:'album',source:'wy'};let html=app.getDislikeResultsHtml(rows);assert.match(html,/共 1 条/);assert.ok(!html.includes('&lt;script&gt;'));
 app._dislikeFilters={query:'no-match'};assert.match(app.getDislikeResultsHtml(rows),/暂无符合条件/);
 app._dislikeFilters={page:999};html=app.getDislikeResultsHtml(Array.from({length:30},(_,i)=>({...rows[0],title:'song'+i})));assert.match(html,/第 2 \/ 2 页/);assert.match(html,/song29/);assert.ok(!html.includes('<h4>song0</h4>'));
});


test('平台固定展示且包含0条，评分来源中文化并使用有效状态默认值',()=>{
 const data={ratingItems:[{id:'tx_1',name:'晴天',singer:'周杰伦',source:'tx',kind:'song',rating:1,origin:{channel:'manual-dislike-to-rating',at:Date.now()}}]};const app=harness(data);
 const html=app.getRatingSectionHtml(data);assert.match(html,/value="wy"/);assert.match(html,/value="local"/);assert.match(html,/wy（0）/);assert.match(html,/tx（1）/);assert.match(html,/后台补分/);assert.ok(!html.includes('aria-label="评分状态"'));assert.match(html,/评分分布/);assert.match(html,/导出筛选结果/);
});

test('评分支持组合关键词、范围星级、时间、封面、来源与休眠历史',()=>{
 const now=Date.now();const rows=[{id:'tx_1',name:'晴天',singer:'周杰伦',source:'tx',kind:'song',rating:1,img:'cover',origin:{channel:'web',at:now}},{id:'wy_2',name:'晴天',singer:'其他',source:'wy',kind:'song',rating:5,origin:{channel:'subsonic',at:now-40*86400000}},{id:'local_old',name:'本地',source:'local',kind:'song',rating:5,dormant:true,effectiveId:'tx_1'}];const app=harness({ratingItems:rows});
 assert.equal(app.getFilteredRatingRows(rows).length,3);
 app._ratingFilters={query:'晴天 周杰伦',stars:'low',cover:'yes',period:'7',source:'tx',origin:'web'};assert.equal(app.getFilteredRatingRows(rows).length,1);assert.match(app.getRatingResultsHtml(rows),/共 1 条/);
 app._ratingFilters={stars:'high',cover:'no',period:'unknown',status:'all'};assert.equal(app.getFilteredRatingRows(rows)[0].id,'local_old');
 app._ratingFilters={source:'kg'};assert.match(app.getRatingResultsHtml(rows),/暂无符合条件/);
});

test('多原因来源可检索，组合关键词与封面筛选同步作用于不喜欢',()=>{
 const data={dislikeList:[{name:'晴天',singer:'周杰伦',source:'tx',img:'https://example.com/a',provenance:{channel:'web',at:Date.now()},reasons:[{channel:'web',at:1},{channel:'subsonic-rating',ratingId:'tx_1',at:2}]}]};const app=harness(data);app._dislikeFilters={channel:'subsonic-rating',query:'晴天 周杰伦',cover:'yes',period:'7'};const rows=app.getDislikeEntries(data);
 assert.equal(app.getFilteredDislikeRows(rows).length,1);app.getDislikeResultsHtml(rows);assert.ok(JSON.stringify([...app._adminDetails.values()]).includes('全部添加原因'));
 app._dislikeFilters.cover='no';assert.equal(app.getFilteredDislikeRows(rows).length,0);
});

test('每页条数限制有效，导出筛选与列表使用同一选择函数',()=>{
 const app=harness({});assert.equal(app.adminPageSize({pageSize:'96'},30),96);assert.equal(app.adminPageSize({pageSize:'9999'},30),30);
 const rows=Array.from({length:55},(_,n)=>({id:'tx_'+n,name:'歌'+n,source:'tx',kind:'song',rating:3}));app._ratingFilters={pageSize:'24',page:999};const html=app.getRatingResultsHtml(rows);assert.match(html,/第 3 \/ 3 页/);assert.ok([...app._adminDetails.values()].some(m=>m.raw.id==='tx_54'));assert.ok(!html.includes('tx_0</p>'));
 assert.match(source,/section === 'rating' \? this.getFilteredRatingRows/);assert.match(source,/contentContainer.innerHTML = html;\s*this.initCustomSelects\(\)/);
});


test('评分来源筛选固定四种，不从历史记录混入规则来源或未记录选项',()=>{
 const app=harness({});const html=app.getRatingSectionHtml({ratingItems:[]});const select=html.match(/<select[^>]*aria-label="评分来源"[^>]*>([\s\S]*?)<\/select>/)[1];assert.equal((select.match(/<option/g)||[]).length,5);for(const key of ['web','subsonic','web-dislike-link','manual-dislike-to-rating'])assert.ok(select.includes(`value="${key}"`));assert.ok(!select.includes('来源未记录'));assert.ok(!select.includes('低分联动'));
});


test('平台筛选不显示百度，历史百度记录不会重新注入选项',()=>{
 const app=harness({});const html=app.adminPlatformOptions([{source:'bd'},{source:'tx'}],'','全部平台');assert.ok(!html.includes('value="bd"'));assert.ok(html.includes('value="tx"'));
 const web=fs.readFileSync('public/music/js/library/rating_manager.js','utf8');assert.match(web,/filter\(source => source !== 'bd'\)/);assert.ok(!web.includes("bd: '百度'"));
});
