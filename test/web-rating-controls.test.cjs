const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function setup(fetch){const storage=new Map([['lx_sync_user','a'],['lx_user_token','token-a']]);const window={addEventListener(){}};const context={window,localStorage:{getItem:k=>storage.get(k)||null},document:{addEventListener(){},hidden:false},setInterval(){},queueMicrotask(){},fetch,ensureUserAuthToken:async()=>true,getUserAuthHeaders:()=>({'x-user-token':storage.get('lx_user_token')})};vm.runInNewContext(fs.readFileSync('public/music/js/library/rating_manager.js','utf8'),context);return{manager:window.RatingManager,storage,context}}
const button=()=>({isConnected:true,textContent:'',setAttribute(){}});
test('评分按100首分批查询，不上传播放URL或鉴权封面',async()=>{const bodies=[];const{manager}=setup(async(_u,options)=>{const body=JSON.parse(options.body);bodies.push(body);return{ok:true,json:async()=>({entries:body.songs.map(s=>({id:s.id,rating:4}))})}});const buttons=[];for(let n=0;n<101;n++){const b=button();buttons.push(b);manager.attach(b,{id:'wy_'+n,source:'wy',url:'secret',pic:'token-cover'})}await manager.refresh();assert.equal(bodies.length,2);assert.equal(bodies[0].songs.length,100);assert.ok(!JSON.stringify(bodies).includes('secret'));assert.ok(!JSON.stringify(bodies).includes('token-cover'));assert.ok(buttons.every(x=>x.textContent==='★'))});
test('账号切换与播放器换歌后，旧请求不能刷新新控件',async()=>{let release;const{manager,storage}=setup(()=>new Promise(r=>{release=r}));const b=button();manager.attach(b,{id:'wy_old',source:'wy'});const pending=manager.refresh();await new Promise(r=>setImmediate(r));manager.attach(b,{id:'wy_new',source:'wy'});release({ok:true,json:async()=>({entries:[{id:'wy_old',rating:5}]})});await pending;assert.equal(b.textContent,'☆');const pending2=manager.refresh();await new Promise(r=>setImmediate(r));storage.set('lx_sync_user','b');storage.set('lx_user_token','token-b');release({ok:true,json:async()=>({entries:[{id:'wy_new',rating:5}]})});await pending2;assert.equal(b.textContent,'☆')});


test('同账号重叠刷新只采用最后请求，旧响应不能覆盖新评分',async()=>{
 const waiting=[];const {manager}=setup(()=>new Promise(resolve=>waiting.push(resolve)));const b=button();manager.attach(b,{id:'wy_1',source:'wy'});
 const old=manager.refresh();await new Promise(r=>setImmediate(r));const latest=manager.refresh();await new Promise(r=>setImmediate(r));
 waiting[1]({ok:true,json:async()=>({entries:[{id:'wy_1',rating:5}]})});await latest;
 waiting[0]({ok:true,json:async()=>({entries:[{id:'wy_1',rating:1}]})});await old;assert.equal(b.textContent,'★');
});


test('分数tag仅在已评分时显示，清分和退出账号立即隐藏',async()=>{
 let rating=4;const {manager,storage}=setup(async()=>({ok:true,json:async()=>({entries:[{id:'wy_1',rating}]})}));const tag=button();manager.attach(tag,{id:'wy_1',source:'wy'},true);assert.equal(tag.hidden,true);await manager.refresh();assert.equal(tag.hidden,false);assert.equal(tag.textContent,'★ 4');rating=0;await manager.refresh();assert.equal(tag.hidden,true);rating=5;await manager.refresh();assert.equal(tag.hidden,false);storage.delete('lx_sync_user');await manager.refresh();assert.equal(tag.hidden,true);
});


test('歌单操作区接入评分，合集刷新重新读服务端并保留滚动',()=>{
 const list=fs.readFileSync('public/music/js/library/songlist_manager.js','utf8');assert.match(list,/data-songlist-rating/);assert.match(list,/RatingManager\?\.attach\(button, entry.item\)/);
 const rating=fs.readFileSync('public/music/js/library/rating_manager.js','utf8');assert.match(rating,/data = latest; render\(\); list.scrollTop = scroll/);assert.match(rating,/collectionDialog\?\.open.*collectionReload/);
});


test('同账号认证更新Token后用户偏好仍能回显并解除禁用',async()=>{
 const {manager,storage,context}=setup(async()=>({ok:true,json:async()=>({dislikeAutoRating:true})}));const toggle={disabled:false,checked:false};const status={};context.document.getElementById=id=>id==='setting-dislike-auto-rating'?toggle:status;context.ensureUserAuthToken=async()=>{storage.set('lx_user_token','renewed-token')};await manager.loadPreference();assert.equal(toggle.checked,true);assert.equal(toggle.disabled,false);
});


test('版本不变仅查询版本，版本变化再批量刷新分数',async()=>{
 let version='v1',resolved=0,polled=0;const {manager}=setup(async(_u,opt)=>{const body=JSON.parse(opt.body);if(body.operation==='version'){polled++;return{ok:true,json:async()=>({version})}}resolved++;return{ok:true,json:async()=>({version,entries:[{id:'wy_1',rating:4}]})}});manager.attach(button(),{id:'wy_1',source:'wy'});await manager.refresh();await manager.refresh();assert.equal(resolved,1);assert.equal(polled,1);version='v2';await manager.refresh();assert.equal(resolved,2)
});
