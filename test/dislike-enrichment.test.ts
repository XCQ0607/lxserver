import test from 'node:test'
import assert from 'node:assert/strict'
import { DislikeDataManage } from '../src/modules/dislike/dislikeDataManage'
import { parseDislikeRules, isDisliked } from '../src/modules/dislike/match'
const make = () => new DislikeDataManage({ snapshotInfo: {}, getSnapshotInfo: async () => ({latest:null}) } as any)
test('新规则：括号空格去重，保留显示歌名、有效字段，补齐空字段和嵌套资料', async()=>{
 const dm=make()
 await dm.addDislikeInfo([{name:'晴天 (Live)',singer:'周杰伦',source:'tx',id:'tx_123',img:'',meta:{albumName:'原专辑'},provenance:{channel:'web',at:1}}] as any)
 await dm.addDislikeInfo([{name:'晴天(LIVE)',singer:'周杰伦',source:'tx',id:'123',img:'cover',meta:{albumName:'新专辑',albumId:'a'},provenance:{channel:'subsonic-rating',at:2}}] as any)
 const item:any=dm.dislikeRules.dislikeList[0]
 assert.equal(dm.dislikeRules.dislikeList.length,1);assert.equal(item.name,'晴天 (Live)');assert.equal(item.img,'cover');assert.equal(item.meta.albumName,'原专辑');assert.equal(item.meta.albumId,'a');assert.equal(item.provenance.channel,'web');assert.equal(item.enrichedBy.channel,'subsonic-rating')
 await dm.removeDislikeInfo('晴天 (live)@周杰伦','tx');assert.equal(dm.dislikeRules.dislikeList.length,0)
})
test('不同来源和冲突歌曲身份不能合并资料',async()=>{
 const dm=make();await dm.addDislikeInfo([{name:'歌',singer:'人',source:'tx',id:'1'}]);await dm.addDislikeInfo([{name:'歌',singer:'人',source:'wy',id:'2',pic:'wy'}]);await dm.addDislikeInfo([{name:'歌',singer:'人',source:'tx',id:'3',pic:'wrong'}]);assert.equal(dm.dislikeRules.dislikeList.length,2);assert.equal(dm.dislikeRules.dislikeList[0].pic,undefined)
})
test('来源隔离开关实际控制歌曲、歌手、专辑',async()=>{
 const dm=make();await dm.addDislikeInfo([{name:'歌',singer:'人',source:'tx'}]);await dm.addDislikeAlbums([{albumName:'专辑',singer:'人',source:'tx'}]);
 const rules=parseDislikeRules(dm.getDislikeRulesString())
 assert.equal(isDisliked({name:'歌',singer:'人',source:'tx'},rules),true)
 assert.equal(isDisliked({name:'歌',singer:'人',source:'wy'},rules),false)
 assert.equal(isDisliked({name:'歌',singer:'人',source:'wy'},rules,{crossSource:true}),true)
 assert.equal(isDisliked({name:'其他',singer:'人',albumName:'专辑',source:'wy'},rules),false)
 assert.equal(isDisliked({name:'其他',singer:'人',albumName:'专辑',source:'wy'},rules,{crossSource:true}),true)
})


test('多评分原因与手动原因独立，重算预览不写入，执行读取最新规则',async()=>{
 const dm=make()
 const base={name:'歌',singer:'人',source:'tx'}
 await dm.addDislikeInfo([{...base,provenance:{channel:'web-rating-link',at:1,ratingId:'tx_1'}}])
 await dm.addDislikeInfo([{...base,provenance:{channel:'subsonic-rating',at:2,ratingId:'tx_2'}}])
 assert.equal(dm.dislikeRules.dislikeList[0].reasons?.length,2)
 assert.equal(dm.reconcileRatingReasons(new Set(['tx_2']),true).removedReasons,1)
 assert.equal(dm.dislikeRules.dislikeList[0].reasons?.length,2)
 await dm.addDislikeInfo([{...base,provenance:{channel:'web',at:3}}])
 const result=dm.reconcileRatingReasons(new Set(),false)
 assert.equal(result.removedReasons,2);assert.equal(result.removedRules,0)
 assert.equal(dm.dislikeRules.dislikeList[0].reasons?.[0].channel,'web')
})

test('专辑同规则保留多个原因，仅移除无剩余原因的规则，来源不明保留',async()=>{
 const dm=make()
 await dm.addDislikeAlbums([{albumName:'专辑',singer:'人',source:'wy',provenance:{channel:'subsonic-rating',at:1,ratingId:'alb_wy_1'}}])
 await dm.addDislikeAlbums([{albumName:'专辑',singer:'人',source:'wy',provenance:{channel:'web',at:2}}])
 await dm.addDislikeInfo([{name:'其他歌',singer:'人',provenance:{channel:'web-rating-link',at:1,ratingId:'wy_2'}},{name:'未知',singer:'人'}])
 const result=dm.reconcileRatingReasons(new Set(),false)
 assert.equal(result.removedRules,1);assert.equal(dm.dislikeRules.dislikeList.length,2)
 assert.equal(dm.dislikeRules.dislikeList[0].reasons?.[0].channel,'web')
})
