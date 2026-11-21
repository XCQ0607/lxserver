const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(process.argv[2] || 'public/music'), out=process.argv[3];
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 const rel=u.pathname.slice('/music/'.length);
 if(!rel){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));}
 const f=path.resolve(root,rel);
 if(!f.startsWith(root+'/')||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type',({'.css':'text/css','.svg':'image/svg+xml','.js':'text/javascript','.woff2':'font/woff2'})[path.extname(f)]||'application/octet-stream');
 fs.createReadStream(f).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let count=0;
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await launcher.launch();
  try {
   for(const [width,height,touch] of [[320,568,true],[360,640,true],[375,667,true],[376,650,true],[390,844,true],[460,740,true],[461,740,true],[844,390,true],[951,584,true],[1440,900,false]]){
    const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,deviceScaleFactor:1});
    const page=await context.newPage();
    await page.goto('http://127.0.0.1:'+server.address().port+'/music/');
    await page.evaluate(()=>{
      document.documentElement.dataset.theme='emerald';
      window.settings={};window.tapResults=[];
      window.playNext=()=>window.tapResults.push('next');
      window.togglePlaybackRateMenu=()=>window.tapResults.push('speed');
      document.querySelector('#btn-airplay').onclick=()=>window.tapResults.push('airplay');
      document.querySelector('#btn-cast').onclick=()=>window.tapResults.push('cast');
    });
    await page.addScriptTag({path:path.join(root,'js/ui/ui_accessibility.js')});
    await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
    const playButton=page.locator('#btn-play'), nextButton=page.locator('#player-controls [onclick="playNext()"]');
    const routeProof=[];
    for(const [route,shown] of [['none',[]],['airplay',['btn-airplay']],['cast',['btn-cast']],['both',['btn-airplay','btn-cast']]]){
      await page.evaluate(shown=>{
        for(const id of ['btn-airplay','btn-cast']) {
          const button=document.getElementById(id);
          button.hidden=!shown.includes(id);button.disabled=button.hidden;
        }
      },shown);
      const next=await nextButton.boundingBox(), play=await playButton.boundingBox();
      const footer=await page.locator('#player-footer').boundingBox();
      assert.ok(next && play && footer,engine+' '+width+' '+route+' transport visible');
      assert.equal(play.width,48,'do not shrink Play');
      assert.ok(Math.abs(play.x+play.width/2-(await page.locator('#player-controls').boundingBox()).x-(await page.locator('#player-controls').boundingBox()).width/2)<1, 'center play');
      if (touch) assert.equal(next.width,44,'do not shrink Next');
      const speed=await page.locator('#playback-rate-btn').boundingBox();
      assert.ok(next.x+next.width<=speed.x || next.y+next.height<=speed.y || speed.x+speed.width<=next.x || speed.y+speed.height<=next.y,engine+' '+width+' '+route+': Next overlaps Speed');
      assert.equal(await nextButton.evaluate(el=>{
        const b=el.getBoundingClientRect();
        for(let x=b.left+3;x<b.right-2;x+=4) for(let y=b.top+4;y<b.bottom-2;y+=5) {
          if(!el.contains(document.elementFromPoint(x,y))) return false;
        }
        return true;
      }),true,engine+' '+width+' '+route+': whole Next target belongs to the button');
      const x=next.x+next.width-6,y=next.y+next.height/2;
      if(touch) await page.touchscreen.tap(x,y); else await page.mouse.click(x,y);
      assert.equal(await page.evaluate(()=>window.tapResults.at(-1)), 'next',engine+' '+width+' '+route+': right-edge tap');
      for(const id of shown) {
        const button=page.locator('#'+id),box=await button.boundingBox();
        assert.ok(box.width>0 && box.x>=0 && box.y>=footer.y && box.y+box.height<=height+1,engine+' '+width+' '+id+' usable');
        if(id==='btn-cast') {
          assert.equal(await button.evaluate(el=>getComputedStyle(el).borderWidth),'1px','Chromecast chrome is unchanged');
        } else {
          const style=()=>button.evaluate(el=>{
            const css=getComputedStyle(el), dot=getComputedStyle(el,'::after');
            return {border:css.borderWidth,background:css.backgroundColor,color:css.color,dot:dot.content};
          });
          const idle=await style();
          assert.equal(idle.border,'0px','AirPlay must have no outer frame');
          assert.equal(idle.background,'rgba(0, 0, 0, 0)','AirPlay must not paint a background box');
          assert.ok(box.width>=44 && box.height>=44,'AirPlay keeps a 44 px target');
          assert.equal(await button.evaluate(el=>{
            const r=el.getBoundingClientRect();
            return [r.left+3,r.left+r.width/2,r.right-3].every(x=>
              [r.top+3,r.top+r.height/2,r.bottom-3].every(y=>el.contains(document.elementFromPoint(x,y))));
          }),true,'the entire AirPlay target must belong to its button');
          await button.evaluate(el=>el.setAttribute('aria-pressed','true'));
          await page.waitForTimeout(170);
          const active=await style();
          assert.equal(active.border,idle.border);
          assert.equal(active.background,idle.background);
          assert.notEqual(active.color,idle.color,'AirPlay active color changes');
          assert.notEqual(active.dot,'none','AirPlay keeps a non-color connected marker');
          if(!touch) {
            await page.keyboard.press('Tab');
            await button.focus();
            assert.equal(await button.evaluate(el=>el.matches(':focus-visible') && getComputedStyle(el).outlineWidth==='2px'),true,'keyboard focus stays visible');
            await button.evaluate(el=>el.blur());
          }
          await button.evaluate(el=>el.setAttribute('aria-pressed','false'));
          await page.waitForTimeout(170);
        }
      }
      routeProof.push({route,footerHeight:Math.round(footer.height)});
    }
    let desc='not exercised';
    if(touch && [320,390,844,951].includes(width)) {
      await page.evaluate(width=>{
        for(const id of ['btn-airplay','btn-cast']) document.getElementById(id).hidden=width!==320 || id!=='btn-airplay';
        window.ListSearch={init(){},resetState(){},getDisplayList(xs){return xs.map((item,originalIndex)=>({item,originalIndex}));},isMatched(){return false},isCurrentMatch(){return false}};
        window.selectedItems=new Set();window.isUserLoggedIn=()=>false;
        window.fetch=async()=>({json:async()=>({info:{
          name:'收藏歌單：長標題測試 / Playlist with a long title to wrap',
          author:'Fixture',desc:'這是一段歌單介紹和歌曲來歷'.repeat(75).slice(0,960),
        },total:38,list:Array.from({length:38},(_,i)=>({id:'t'+i,name:'Fixture track '+(i+1),singer:'Fixture singer',interval:'03:00',source:'wy'}))})});
        window.updatePlaylist=(_list,index)=>window.tapResults.push('track '+index);
        document.getElementById('view-songlist').classList.remove('hidden','opacity-0');
      },width);
      await page.addScriptTag({path:path.join(root,'js/library/songlist_manager.js')});
      await page.evaluate(()=>window.SongListManager.openDetail('fixture','wy'));
      await page.locator('#sl-detail-desc-btn').click({timeout:10000});
      await page.waitForTimeout(370);
      assert.equal(await page.locator('#sl-detail-desc').getAttribute('data-expanded'),'true');
      const scroller=await page.locator('#sl-detail-scroll').boundingBox(), bar=await page.locator('#player-footer').boundingBox();
      assert.ok(scroller.y+scroller.height<=bar.y+1, 'playlist scroller respects the actual footer with or without a second row');
      const hero=await page.locator('#sl-detail-header').boundingBox();
      const inner=await page.locator('#sl-detail-header > div').boundingBox();
      assert.ok(hero.height>=inner.height-1,engine+' '+width+' expanded description exceeds its container');
      const first=page.locator('#sl-detail-list > div').first();
      await first.scrollIntoViewIfNeeded();
      const clickable=await first.evaluate(el=>{
        const r=el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.left+Math.min(70,r.width/2),r.top+r.height/2));
      });
      assert.equal(clickable,true,engine+' '+width+' first track hit');
      const row=await first.boundingBox();
      await page.touchscreen.tap(row.x+70,row.y+row.height/2);
      assert.equal(await page.evaluate(()=>window.tapResults.at(-1)),'track 0',engine+' '+width+' first track click');
      await page.locator('#sl-detail-desc-btn').click();
      assert.equal(await page.locator('#sl-detail-desc').getAttribute('data-expanded'),'false','description collapse');
      // The manual compact hero controls remain available after the cap is removed.
      await page.locator('#sl-detail-header button[onclick="collapseSongListDetailHeader()"]').click();
      await page.waitForTimeout(360);
      assert.ok((await page.locator('#sl-detail-header').boundingBox()).height<1,'manual hero collapse');
      await page.locator('#sl-mini-expand-btn').click();
      await page.waitForTimeout(380);
      if(await page.locator('#sl-detail-header').evaluate(el=>el.classList.contains('sl-hero-collapsed'))) {
        await page.locator('#sl-mini-expand-btn').click();
        await page.waitForTimeout(380);
      }
      assert.equal(await page.locator('#sl-detail-header').evaluate(el=>el.classList.contains('sl-hero-collapsed')),false,'manual hero expand');
      desc='expand, first-row tap, collapse and re-expand pass';
      if(width===320 && out) await page.screenshot({path:path.join(out,engine+'-320-final.png')});
    }
    console.log(JSON.stringify({engine,width,height,routeProof,desc}));
    count++;
    await context.close();
   }
  } finally {await browser.close();}
 }
 console.log('PASS '+count+' viewport cases, four wireless states per case');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
