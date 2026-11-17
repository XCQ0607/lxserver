import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commitRatingFiles, recoverRatingTransaction, planRatingMigration, registerDislikeMigration } from '../src/server/rating/ratingMigration'
const fixture = (fn: (dir: string) => void) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-rating-transaction-')); try { fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) } }
test('跨文件提交第二次写入失败完整回滚，删除事务日志',()=>fixture(dir=>{
 const a=path.join(dir,'rating/songs.json'),b=path.join(dir,'subsonic-meta.json');fs.mkdirSync(path.dirname(a),{recursive:true});fs.writeFileSync(a,'old catalog');fs.writeFileSync(b,'old ratings')
 const rename=fs.renameSync;let failed=false
 try { fs.renameSync=((from:any,to:any)=>{if(to===b&&!failed){failed=true;throw Error('disk failure')}return rename(from,to)}) as any
 assert.throws(()=>commitRatingFiles(dir,new Map([[a,'new catalog'],[b,'new ratings']])),/disk failure/)
 }finally{fs.renameSync=rename}
 assert.equal(fs.readFileSync(a,'utf8'),'old catalog');assert.equal(fs.readFileSync(b,'utf8'),'old ratings');assert.ok(!fs.existsSync(path.join(dir,'rating/transaction.json')))
}))
test('中断后由日志完成所有文件提交，重复恢复幂等，拒绝越界日志',()=>fixture(dir=>{
 fs.mkdirSync(path.join(dir,'rating'));fs.writeFileSync(path.join(dir,'rating/transaction.json'),JSON.stringify([{file:'rating/songs.json',after:'catalog'},{file:'subsonic-meta.json',after:'ratings'}]))
 recoverRatingTransaction(dir);recoverRatingTransaction(dir);assert.equal(fs.readFileSync(path.join(dir,'subsonic-meta.json'),'utf8'),'ratings')
 fs.writeFileSync(path.join(dir,'rating/transaction.json'),JSON.stringify([{file:'../escape',after:'bad'}]));assert.throws(()=>recoverRatingTransaction(dir),/Invalid/)
}))
test('迁移全部原因ID，保留手动原因和旧快照，并同步运行时规则及快照索引',()=>fixture(dir=>{
 const dislike=path.join(dir,'dislike');fs.mkdirSync(path.join(dislike,'snapshot'),{recursive:true})
 const rules={dislikeList:[{name:'歌',provenance:{channel:'web-rating-link',ratingId:'local_a'},reasons:[{channel:'web-rating-link',ratingId:'local_a'},{channel:'web'}]}]}
 const info={latest:'old',list:[],imported:[],clients:{}}
 fs.writeFileSync(path.join(dislike,'snapshot/snapshot_old'),JSON.stringify(rules));fs.writeFileSync(path.join(dislike,'snapshotInfo.json'),JSON.stringify(info))
 const manager={dislikeRules:rules,snapshotDataManage:{snapshotInfo:info}};registerDislikeMigration(dir,manager)
 const data={ratings:{local_a:1},ratingOrigins:{local_a:{channel:'web',at:1}}},catalog={local_a:{name:'歌'}}
 const changes=planRatingMigration(dir,data,catalog,[{id:'local_a',platformId:'wy_a'}]);changes.set(path.join(dir,'subsonic-meta.json'),JSON.stringify(data));commitRatingFiles(dir,changes)
 assert.equal(manager.dislikeRules.dislikeList[0].provenance.ratingId,'wy_a');assert.equal(manager.dislikeRules.dislikeList[0].reasons[0].ratingId,'wy_a');assert.equal(manager.dislikeRules.dislikeList[0].reasons[1].channel,'web');assert.notEqual(manager.snapshotDataManage.snapshotInfo.latest,'old');assert.ok(fs.existsSync(path.join(dislike,'snapshot/snapshot_old')))
 assert.equal(planRatingMigration(dir,data,catalog,[{id:'local_a',platformId:'wy_a'}]).size,0)
}))

test('只有收藏没有ratings也能整理关联，不生成虚假分数',()=>fixture(dir=>{
 const data:any={starredArtists:['keep']},catalog={}
 const changes=planRatingMigration(dir,data,catalog,[{id:'local_a',platformId:'wy_a'}])
 assert.deepEqual(data.ratings,{});assert.deepEqual(data.starredArtists,['keep']);assert.equal(changes.size,0)
}))
test('仅提交评分文件不能覆盖尚未保存的运行时不喜欢',()=>fixture(dir=>{
 const dislike=path.join(dir,'dislike');fs.mkdirSync(path.join(dislike,'snapshot'),{recursive:true})
 const info={latest:'old',list:[],imported:[],clients:{}}
 fs.writeFileSync(path.join(dislike,'snapshotInfo.json'),JSON.stringify(info));fs.writeFileSync(path.join(dislike,'snapshot/snapshot_old'),JSON.stringify({dislikeList:[]}))
 const manager={snapshotDataManage:{snapshotInfo:info},dislikeRules:{dislikeList:[{name:'尚未保存'}]}}
 registerDislikeMigration(dir,manager)
 commitRatingFiles(dir,new Map([[path.join(dir,'subsonic-meta.json'),JSON.stringify({ratings:{wy_a:3}})]]))
 assert.equal(manager.dislikeRules.dislikeList[0].name,'尚未保存')
}))
test('初始化不喜欢管理器时先完成遗留事务，不必访问评分接口',()=>fixture(dir=>{
 fs.mkdirSync(path.join(dir,'rating'));fs.mkdirSync(path.join(dir,'dislike/snapshot'),{recursive:true})
 const id='a'.repeat(32),info={latest:id,list:[],clients:{},imported:[]}
 fs.writeFileSync(path.join(dir,'rating/transaction.json'),JSON.stringify([{file:'dislike/snapshot/snapshot_'+id,after:JSON.stringify({dislikeList:[{name:'已恢复'}]})},{file:'dislike/snapshotInfo.json',after:JSON.stringify(info)}]))
 const manager={snapshotDataManage:{snapshotInfo:{}},dislikeRules:{dislikeList:[] as any[]}}
 registerDislikeMigration(dir,manager)
 assert.equal(manager.dislikeRules.dislikeList[0].name,'已恢复');assert.ok(!fs.existsSync(path.join(dir,'rating/transaction.json')))
}))
