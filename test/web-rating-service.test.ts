import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
const actualRequire = createRequire(import.meta.url)
function load(root: string, snapshot:()=>Promise<any> = async()=>{}) {
 const tracks:any[]=[]
 const locks=new Map<string,Promise<any>>()
 const mod={exports:{} as any}
 const require=(id:string):any=>{
    if (id === './ratingMigration' || id === '../../server/rating/ratingMigration') return actualRequire(path.resolve('src/server/rating/ratingMigration.ts'))
  if(id==='./ratingIdentityLock')return actualRequire(path.resolve('src/server/rating/ratingIdentityLock.ts'))
  if (id === './ratingValidation') return actualRequire(path.resolve('src/server/rating/ratingValidation.ts'))
  if(id==='@/user')return {getUserDirname:(user:string)=>user}
  if(id==='./ratingSnapshot')return {withMetaLock:(user:string,fn:any)=>{const p=(locks.get(user)||Promise.resolve()).then(fn);locks.set(user,p.catch(()=>{}));return p},createRatingSnapshot:snapshot}
  if(id==='../music/subsonicLocal')return {localRatingId:(track:any)=>track.platformId||track.id,getLocalTracks:async()=>tracks,localFile:(track:any)=>{const resolved=path.resolve(track.root,track.filename);return resolved.startsWith(path.resolve(track.root)+path.sep)&&fs.existsSync(resolved)?resolved:null}}
  if(id==='../music/fileCache')return {getCacheDir:(user:string)=>path.join(root,user,'audio')}
  if(id==='../music/customMusicManager')return {getCustomMusicDir:(user:string)=>path.join(root,user,'audio')}
  return actualRequire(id)
 }
 vm.runInNewContext(transformSync(fs.readFileSync('src/server/rating/ratingService.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module:mod,exports:mod.exports,require,URL,global:{lx:{userPath:root,dataPath:root}}})
 return {api:mod.exports,tracks}
}
test('Web评分服务并发写入不丢数据、隔离用户、保留收藏且不改歌单',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-web-rating-unit-'))
 try{
  const {api}=load(root);fs.mkdirSync(path.join(root,'a'),{recursive:true});const file=path.join(root,'a','subsonic-meta.json');fs.writeFileSync(file,JSON.stringify({starredArtists:['artist'],ratings:{}}));const list=path.join(root,'a','list.json');fs.writeFileSync(list,'playlist-marker')
  await Promise.all(Array.from({length:20},(_,n)=>api.writeRating('a','wy_'+n,5,'web',{name:'歌'+n,singer:'人',source:'wy',url:'secret-url'})))
  const data=api.readRatings('a');assert.equal(Object.keys(data.ratings).length,20);assert.equal(data.starredArtists[0],'artist');assert.equal(data.ratingOrigins.wy_0.channel,'web');assert.equal(fs.readFileSync(list,'utf8'),'playlist-marker');assert.equal(Object.keys(api.readRatings('b').ratings).length,0)
  assert.ok(!fs.readFileSync(path.join(root,'a','rating','songs.json'),'utf8').includes('secret-url'))
  for(const r of [-1,6,1.5,'5'])await assert.rejects(()=>api.writeRating('a','wy_bad',r,'web'))
  await api.writeRating('a','wy_0',0,'web');assert.equal(api.readRatings('a').ratings.wy_0,undefined);assert.equal(api.readRatings('a').ratingOrigins.wy_0,undefined)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('本地未关联按本地ID，关联及重新关联后按对应在线ID，拒绝越权',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-web-rating-local-'))
 try{
  const {api,tracks}=load(root);const audio=path.join(root,'a','audio');fs.mkdirSync(audio,{recursive:true});fs.writeFileSync(path.join(audio,'song.wav'),'audio');tracks.push({id:'local_stable',root:audio,filename:'song.wav',platformId:undefined})
  const song={isLocal:true,_localFilename:'song.wav',_localFolder:'custom',_localUsername:'a',source:'tx',songmid:'old'}
  assert.equal(await api.resolveRatingId('a',song),'local_stable');tracks[0].platformId='wy_new';assert.equal(await api.resolveRatingId('a',{...song,source:'wy',songmid:'new'}),'wy_new')
  await api.writeRating('a','local_stable',2,'web')
  assert.equal(api.readRatings('a').ratings.wy_new,2)
  tracks[0].platformId='tx_other'
  assert.equal(await api.resolveStoredRatingId('a','local_stable'),'tx_other')
  assert.equal(api.readRatings('a').ratings.tx_other,undefined)
  await api.writeRating('a','local_stable',4,'subsonic')
  assert.equal(api.readRatings('a').ratings.tx_other,4)
  assert.equal(api.readRatings('a').ratings.wy_new,2)
  await assert.rejects(()=>api.resolveRatingId('b',song));await assert.rejects(()=>api.resolveRatingId('a',{...song,_localFilename:'../subsonic-meta.json'}))
  assert.equal(await api.resolveRatingId('a',{source:'tx',songmid:'abc',songId:123}),'tx_abc')
  assert.equal(await api.resolveRatingId('a',{source:'wy',id:'wy_123'}),'wy_123')
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})


test('资料合并保留封面和专辑ID，拒绝凭据及查询参数封面', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-rating-merge-'))
 try {
  const {api}=load(root)
  await api.writeRating('a','wy_1',4,'web',{name:'原歌名',source:'wy',albumId:'album',img:'https://example.com/cover.jpg'})
  await api.writeRating('a','wy_1',3,'web',{name:'',source:'wy'})
  const row=JSON.parse(fs.readFileSync(path.join(root,'a/rating/songs.json'),'utf8')).wy_1
  assert.equal(row.name,'原歌名');assert.equal(row.albumId,'album');assert.equal(row.img,'https://example.com/cover.jpg')
  assert.equal(api.safeCover('https://user:secret@example.com/a'),'');assert.equal(api.safeCover('https://example.com/a?token=secret'),'')
 } finally { fs.rmSync(root,{recursive:true,force:true}) }
})

test('排队评分在取得身份锁后重新解析关联，并清除旧本地评分',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-rating-identity-'))
 try {
  const {api,tracks}=load(root);const audio=path.join(root,'a/audio');fs.mkdirSync(audio,{recursive:true});fs.writeFileSync(path.join(audio,'a.wav'),'audio')
  const track={id:'local_a',root:audio,filename:'a.wav',platformId:undefined as string|undefined};tracks.push(track)
  await api.writeRating('a','local_a',5,'web')
  const lock=actualRequire(path.resolve('src/server/rating/ratingIdentityLock.ts')).withRatingIdentityLock
  let release!:()=>void
  const association=lock('a',async()=>{await new Promise<void>(r=>{release=r});track.platformId='wy_linked'})
  await Promise.resolve()
  const write=api.writeRating('a','local_a',2,'web')
  release();await association;await write
  assert.equal(api.readRatings('a').ratings.wy_linked,2)
  fs.writeFileSync(path.join(root,'a/subsonic-local-registry.json'),JSON.stringify({tracks:{a:track}}))
  assert.ok(!api.listRatingItems('a').some((x:any)=>x.id==='local_a'));assert.equal(api.readRatings('a').ratings.wy_linked,2)
 } finally {fs.rmSync(root,{recursive:true,force:true})}
})


test('重复同分不改来源或时间，清分记录历史；旧本地ID资料不覆盖关联在线描述',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-rating-idempotence-'))
 try {
  const {api,tracks}=load(root)
  await api.writeRating('a','wy_1',4,'web',{name:'在线曲名',source:'wy'})
  const first=api.readRatings('a');const duplicate=await api.writeRating('a','wy_1',4,'subsonic')
  assert.equal(duplicate.unchanged,true);assert.deepEqual(JSON.parse(JSON.stringify(api.readRatings('a').ratingOrigins)),JSON.parse(JSON.stringify(first.ratingOrigins)))
  assert.equal(api.readRatings('a').ratingHistory.wy_1.length,1)
  tracks.push({id:'local_old',platformId:'wy_1',title:'在线曲名',artist:'歌手',album:'专辑'})
  await api.writeRating('a','local_old',2,'web',{id:'local_old',source:'local',name:'旧本地曲名'})
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'a/rating/songs.json'),'utf8'));assert.equal(catalog.wy_1.name,'在线曲名')
  await api.writeRating('a','wy_1',0,'web');const events=api.readRatings('a').ratingHistory.wy_1
  assert.equal(events.length,3);assert.equal(events[2].from,2);assert.equal(events[2].to,0)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})


test('同分补齐描述不改评分来源，资料失败可单独重试，版本能感知变化',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-rating-repair-'))
 try {
  const {api}=load(root);await api.writeRating('a','wy_1',4,'subsonic')
  const before=api.readRatings('a');const version=api.ratingVersion('a')
  await api.writeRating('a','wy_1',4,'web',{name:'补齐曲名',source:'wy'})
  assert.equal(api.readRatings('a').ratingOrigins.wy_1.channel,'subsonic');assert.equal(api.readRatings('a').ratingHistory.wy_1.length,1)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'a/rating/songs.json'),'utf8')).wy_1.name,'补齐曲名');assert.notEqual(api.ratingVersion('a'),version)
  const rename=fs.renameSync;let failed=false
  try{fs.renameSync=((from:any,to:any)=>{if(!failed&&String(to).endsWith('songs.json')){failed=true;throw Error('disk')}return rename(from,to)}) as any
   const saved=await api.writeRating('a','wy_1',4,'web',{name:'可重试曲名',source:'wy'});assert.ok(saved.snapshotWarning)
  }finally{fs.renameSync=rename}
  assert.ok(api.readRatingTasks('a').some((t:any)=>t.kind==='catalog'))
  await api.retryRatingTasks('a');assert.equal(api.readRatingTasks('a').length,0)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'a/rating/songs.json'),'utf8')).wy_1.name,'可重试曲名');assert.equal(api.readRatings('a').ratingOrigins.wy_1.at,before.ratingOrigins.wy_1.at)
  const stable=api.ratingVersion('a');await api.writeRating('a','wy_1',4,'web',{name:'可重试曲名',source:'wy'});assert.equal(api.ratingVersion('a'),stable)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('快照失败记录状态并可重试，修复资料不能覆写较新的评分',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-rating-snapshot-retry-'))
 try{
  let fail=true;const {api}=load(root,async()=>{if(fail)throw Error('snapshot disk')})
  const result=await api.writeRating('a','wy_1',2,'web',{name:'歌曲',source:'wy'});assert.ok(result.snapshotWarning);assert.ok(api.readRatingTasks('a').some((x:any)=>x.kind==='snapshot'))
  fail=false;await api.retryRatingTasks('a');assert.equal(api.readRatingTasks('a').length,0)
  await api.writeRating('a','wy_1',5,'subsonic');await api.writeRating('a','wy_1',1,'repair',{name:'歌曲',source:'wy'},{repairOnly:true});assert.equal(api.readRatings('a').ratings.wy_1,5);assert.equal(api.readRatings('a').ratingOrigins.wy_1.channel,'subsonic')
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})


test('同步状态损坏不清空文件，主评分损坏拒绝写入与覆盖',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-rating-storage-errors-'))
 try{
  const {api}=load(root);await api.writeRating('a','wy_1',4,'web',{name:'歌曲',source:'wy'});const status=path.join(root,'a/rating/sync-status.json');fs.writeFileSync(status,'broken')
  assert.equal(api.readRatingTasks('a')[0].kind,'status');await assert.rejects(()=>api.retryRatingTasks('a'),/损坏/);assert.equal(fs.readFileSync(status,'utf8'),'broken')
  const meta=path.join(root,'a/subsonic-meta.json');fs.writeFileSync(meta,'broken');await assert.rejects(()=>api.writeRating('a','wy_1',5,'web'));assert.equal(fs.readFileSync(meta,'utf8'),'broken')
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})


test('补分主文件写入失败登记重试任务，只重试未评分项且保留较新评分',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-rating-backfill-retry-'))
 try {
  const {api}=load(root);const rename=fs.renameSync;let fail=true
  try{fs.renameSync=((from:any,to:any)=>{if(fail&&String(to).endsWith('subsonic-meta.json'))throw Error('meta disk');return rename(from,to)}) as any
   await assert.rejects(()=>api.writeRating('a','wy_1',1,'web-dislike-link',{name:'曲',source:'wy'},{onlyMissing:true}),/meta disk/)
  }finally{fs.renameSync=rename;fail=false}
  assert.ok(api.readRatingTasks('a').some((x:any)=>x.kind==='backfill'))
  await api.writeRating('a','wy_1',5,'web',{name:'曲',source:'wy'});await api.retryRatingTasks('a');assert.equal(api.readRatings('a').ratings.wy_1,5);assert.equal(api.readRatingTasks('a').length,0)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('关联迁移保留来源与历史，在线评分优先且删除本地所有当前记录',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-rating-migrate-'))
 try {
  const {api}=load(root);const dir=path.join(root,'a');fs.mkdirSync(path.join(dir,'rating'),{recursive:true})
  const file=path.join(dir,'subsonic-meta.json')
  fs.writeFileSync(file,JSON.stringify({ratings:{local_a:5,local_b:2,wy_b:4},ratingOrigins:{local_a:{channel:'web',at:1},local_b:{channel:'web',at:2},wy_b:{channel:'subsonic',at:3}},ratingHistory:{local_a:[{from:0,to:5,channel:'web',at:1}],local_b:[]},starredArtists:['keep']}))
  fs.writeFileSync(path.join(dir,'rating/songs.json'),JSON.stringify({local_a:{name:'原歌名'},local_b:{name:'删除'}}))
  fs.writeFileSync(path.join(dir,'subsonic-local-registry.json'),JSON.stringify({tracks:{a:{id:'local_a',platformId:'wy_a'},b:{id:'local_b',platformId:'wy_b'}}}))
  const data=api.readRatings('a');assert.deepEqual(JSON.parse(JSON.stringify(data.ratings)),{wy_a:5,wy_b:4});assert.equal(data.ratingOrigins.wy_a.at,1);assert.equal(data.ratingOrigins.wy_b.channel,'subsonic');assert.equal(data.ratingHistory.wy_a.length,1);assert.equal(data.ratingHistory.local_a,undefined);assert.equal(data.starredArtists[0],'keep')
  const catalog=JSON.parse(fs.readFileSync(path.join(dir,'rating/songs.json'),'utf8'));assert.equal(catalog.local_a,undefined);assert.equal(catalog.local_b,undefined);assert.equal(catalog.wy_a.name,'原歌名')
  const before=fs.readFileSync(file,'utf8');api.readRatings('a');assert.equal(fs.readFileSync(file,'utf8'),before)
 } finally {fs.rmSync(root,{recursive:true,force:true})}
})
