import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
const actualRequire=createRequire(import.meta.url)
test('自动补分偏好默认关闭、按用户落盘隔离、布尔校验且关闭保留其他用户',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lx-rating-preferences-'))
 try{
  const mod={exports:{} as any}
  const require=(id:string)=>id==='@/user'?{getUserDirname:(user:string)=>user}:actualRequire(id)
  vm.runInNewContext(transformSync(fs.readFileSync('src/server/rating/ratingPreferences.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module:mod,exports:mod.exports,require,global:{lx:{userPath:root}},console:{warn(){}}})
  const api=mod.exports
  assert.equal(api.readRatingPreferences('a').dislikeAutoRating,false)
  api.saveRatingPreferences('a',true);assert.equal(api.readRatingPreferences('a').dislikeAutoRating,true);assert.equal(api.readRatingPreferences('b').dislikeAutoRating,false)
  for(const value of [1,'true',null,{},undefined])assert.throws(()=>api.saveRatingPreferences('a',value))
  assert.equal(api.readRatingPreferences('a').dislikeAutoRating,true)
  api.saveRatingPreferences('b',true);api.saveRatingPreferences('a',false);assert.equal(api.readRatingPreferences('a').dislikeAutoRating,false);assert.equal(api.readRatingPreferences('b').dislikeAutoRating,true)
  const file=path.join(root,'a/rating/preferences.json');assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).dislikeAutoRating,false);assert.equal(fs.existsSync(file+'.tmp'),false)
  fs.writeFileSync(file,'broken');assert.equal(api.readRatingPreferences('a').dislikeAutoRating,false)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
