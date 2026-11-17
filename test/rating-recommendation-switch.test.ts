import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
const source=fs.readFileSync('src/server/integrations/subsonic.ts','utf8')
const start=source.indexOf('    private async handleGetRecommendedSongs(')
const end=source.indexOf('    private async ',start+20)
const filterStart=source.indexOf('    private async filterRecommendationEntries(')
const filterEnd=source.indexOf('    private async renderRandomSongs(',filterStart)
for(const enabled of [false,true]) test(`每日推荐低分排除遵守开关 ${enabled}`,async()=>{
 const context:any={global:{lx:{config:{'subsonic.dislikeNoRecommend':enabled,'subsonic.dislikeRating':1}}},localRatingId:(t:any)=>t.platformId||t.id,fetchRecommendedSongs:async()=>[{id:'wy_1'},{id:'wy_2'}],subsonicLog:{error(){}}}
 vm.runInNewContext(transformSync(`class Harness { async filterDislikedEntries(_u,entries){return entries} async getUserSubsonicMeta(){ return {ratings:{wy_1:1,wy_2:5}} } renderRandomSongs(_res,rows){return rows} ${source.slice(filterStart,filterEnd)} ${source.slice(start,end)} }; globalThis.instance=new Harness()`,{loader:'ts',format:'cjs'}).code,context)
 const rows=await context.instance.handleGetRecommendedSongs({},'a',new URLSearchParams(),'json')
 assert.equal(rows.length,enabled?1:2)
})
