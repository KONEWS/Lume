import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
const assets=path.resolve('mobile/player-assets/player');
const server=createServer(async(req,res)=>{
  try {
    const file=path.join(assets,new URL(req.url,'http://localhost').pathname);
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  for(const platform of ['Android','HarmonyOS']){
    const ctx=await browser.newContext({viewport:{width:360,height:780},hasTouch:true,reducedMotion:'reduce'});
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.addInitScript(()=>{
      window.calls=[];
      window.LumeNative={dispatch:msg=>{
        const call=JSON.parse(msg);calls.push(call);
        if(call.type==='detailRead')queueMicrotask(()=>lumeReadResult(call.token,
          call.kind==='cover' && call.id==='song-0' && call.offset===0 ? window.testCover||'' : ''));
      }};
      localStorage.setItem('lume-phone-reduced','true');
      if(!localStorage.getItem('lume-dock-pages'))localStorage.setItem('lume-dock-pages',JSON.stringify(['home','library','artists','space','playlists','albums']));
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    const status=await page.evaluate(()=>({scripts:typeof window.lumeUpdate,side:document.querySelectorAll('.side-link').length}));
    assert.ok(status.side && status.scripts==='function',JSON.stringify(errors));
    const songs=Array.from({length:40},(_,i)=>({id:'song-'+i,title:'Song '+i,album:i<3?'Zebra':'Album '+i,year:i<3?2020:2024,artist:i<3?'Ayase':'9Lana'}));
    songs[0].hasSideCover=true;songs.at(-1).year=null;
    await page.evaluate(({platform,songs})=>{
      const c=document.createElement('canvas');c.width=c.height=1200;
      const ctx=c.getContext('2d');ctx.fillStyle='#29c';ctx.fillRect(0,0,1200,1200);
      window.testCover=c.toDataURL('image/png').split(',')[1];
      lumeUpdate({platform,songs,id:'song-0'});
    },{platform,songs});
    assert.equal(await page.locator('#dock-tabs button').count(),5);
    await page.locator('#open-menu').click();
    await page.locator('#sidebar [data-section=albums]').click();
    assert.equal(await page.locator('.album-card').count(),38);
    const columns=()=>page.locator('.album-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
    assert.equal(await columns(),2);
    await page.getByRole('button',{name:'跳到 Z',exact:true}).click();
    assert.ok(await page.locator('#scroll').evaluate(e=>e.scrollTop)>0);
    await page.waitForFunction(()=>document.querySelector('.album-card:last-child .collection-art').style.backgroundImage.includes('data:image'));
    const dimensions=await page.evaluate(async()=>{
      const urls=[document.querySelector('.album-card:last-child .collection-art').style.backgroundImage,$('album').style.backgroundImage];
      return Promise.all(urls.map(async css=>{const img=new Image();img.src=css.match(/url\("(.*?)"\)/)[1];await img.decode();return img.naturalWidth;}));
    });
    assert.deepEqual(dimensions,[1024,1200]);
    await page.locator('#album-options').click();
    await page.getByRole('radio',{name:'年份'}).check();
    assert.deepEqual(await page.locator('.album-year-list h2').allTextContents(),['2024','2020','未知年份']);
    assert.equal(await page.locator('.album-year-row').count(),38);
    assert.equal(await page.getByRole('radio',{name:'4',exact:true}).count(),0);
    await page.getByRole('radio',{name:'数量'}).check();
    await page.getByRole('radio',{name:'4',exact:true}).check();
    assert.equal(await columns(),4);
    assert.match(await page.locator('.album-card').first().innerText(),/Zebra/);
    await page.evaluate(()=>lumeBack());
    await page.locator('.album-card').first().click();
    assert.equal(await page.locator('#browse-content .song').count(),3);
    await page.evaluate(()=>lumeBack());
    await page.locator('#dock-tabs [data-browse=artists]').click();
    assert.equal(await page.locator('.artist-row').count(),2);
    assert.match(await page.locator('.artist-row').first().innerText(),/9Lana/);
    await page.locator('.artist-row').last().click();
    assert.equal(await page.locator('#browse-content .song').count(),3);
    await page.evaluate(()=>openBrowse('settings'));
    await page.getByRole('switch',{name:'横屏播放时保持屏幕常亮'}).check();
    assert.ok(await page.evaluate(()=>calls.some(x=>x.type==='landscapeAwake' && x.enabled)));
    assert.equal(await page.locator('html').getAttribute('data-glass'),'full');
    await page.getByRole('button',{name:/底部控制栏/}).click();
    const setting=page.locator('#dock-editor [data-page="home"]');
    assert.equal(await setting.locator('label').evaluate(e=>getComputedStyle(e).webkitTapHighlightColor),'rgba(0, 0, 0, 0)');
    await setting.locator('label').tap();
    assert.equal(await setting.locator('input').isChecked(),false);
    assert.equal(await setting.locator('.cover-switch-track').evaluate(e=>getComputedStyle(e).outlineStyle),'none');
    await setting.locator('label').tap();
    await setting.locator('input').focus();
    await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    assert.equal(await setting.locator('.cover-switch-track').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
    assert.ok(await page.getByRole('switch',{name:'专辑',exact:true}).isDisabled());
    for(const label of ['聆听','艺术家','歌单'])await page.getByRole('switch',{name:label,exact:true}).uncheck();
    for(const label of ['专辑','音乐库','播放统计'])await page.getByRole('switch',{name:label,exact:true}).check();
    assert.ok(await page.getByRole('switch',{name:'聆听',exact:true}).isDisabled());
    const row=page.locator('.dock-selected [data-page=albums]'),firstRow=page.locator('.dock-selected [data-page=library]');
    assert.equal(await page.locator('.dock-selected button').count(),0);
    await row.scrollIntoViewIfNeeded();
    const box=await row.boundingBox(),first=await firstRow.boundingBox();
    const touch=await ctx.newCDPSession(page);
    const x=box.x+box.width/3,y=box.y+box.height/2;
    const finger=(type,at)=>touch.send('Input.dispatchTouchEvent',{type,touchPoints:at===undefined?[]:[{x,y:at}]});
    await page.emulateMedia({reducedMotion:'no-preference'});
    await finger('touchStart',y);await page.waitForSelector('.dock-selected .sorting');
    await finger('touchMove',y-24);
    await page.waitForFunction(expected=>Math.abs(document.querySelector('.dock-selected .sorting')?.getBoundingClientRect().top-expected)<2,box.y-24,{timeout:2000});
    await finger('touchMove',first.y+4);await page.waitForTimeout(200);
    assert.ok((await firstRow.boundingBox()).y>first.y+20,'neighbor makes space before release');
    await finger('touchCancel');await page.waitForTimeout(200);
    assert.equal(await page.locator('.dock-selected .sorting').count(),0,'cancel releases lifted row');
    assert.equal(await page.locator('#dock-tabs button').first().getAttribute('aria-label'),'曲库');
    await row.scrollIntoViewIfNeeded();
    const rowAfterCancel=await row.boundingBox(),firstAfterCancel=await firstRow.boundingBox();
    await finger('touchStart',rowAfterCancel.y+rowAfterCancel.height/2);
    await page.waitForSelector('.dock-selected .sorting',{timeout:2500});
    await finger('touchMove',firstAfterCancel.y+4);await finger('touchEnd');
    assert.equal(await page.locator('#dock-tabs button').first().getAttribute('aria-label'),'专辑');
    assert.equal(await page.locator('.dock-selected input:checked').count(),5);
    await page.waitForTimeout(200);
    const startScroll=await page.locator('#scroll').evaluate(e=>e.scrollTop);
    await finger('touchStart',y);await finger('touchMove',y-30);await finger('touchMove',y-100);
    await finger('touchEnd');await page.waitForTimeout(150);
    assert.ok(await page.locator('#scroll').evaluate(e=>e.scrollTop)>startScroll,'quick swipe scrolls normally');
    await page.evaluate(()=>{
      window.entrances=[];
      const animate=Element.prototype.animate;
      Element.prototype.animate=function(frames,opts){
        if(this.parentElement?.id==='scroll')entrances.push(this.id);
        return animate.call(this,frames,opts);
      };
    });
    await page.locator('#dock-tabs [data-browse=stats]').click();
    assert.equal(await page.locator('lume-play-stats').count(),1);
    await page.locator('#dock-tabs [data-browse=sources]').click();
    assert.equal(await page.locator('lume-library-report').count(),1);
    assert.deepEqual(await page.evaluate(()=>entrances),['browse','browse']);
    await page.reload();
    assert.equal(await page.locator('#dock-tabs button').first().getAttribute('aria-label'),'专辑');
    await page.evaluate(({platform,songs})=>lumeUpdate({platform,songs}),{platform,songs});
    await page.locator('#dock-tabs [data-browse=albums]').click();
    assert.equal(await columns(),4);
    for(const width of [320,390,844]){
      await page.setViewportSize({width,height:width===844?390:780});
      const dims=await page.locator('#dock-tabs [data-tab=space]').evaluate(b=>{
        const svg=b.querySelector('svg').getBoundingClientRect(),nav=b.parentElement;
        return [svg.width,svg.height,b.clientWidth,nav.scrollWidth,nav.clientWidth];
      });
      assert.ok(dims[0]===dims[1] && dims[0]>=20 && dims[2]>=44,JSON.stringify(dims));
    }
    const ink=await page.locator('#dock-tabs [data-tab=space] svg').evaluate(async svg=>{
      const copy=svg.cloneNode(true);copy.setAttribute('stroke','black');
      const img=new Image();
      img.src='data:image/svg+xml,'+encodeURIComponent(new XMLSerializer().serializeToString(copy));
      await img.decode();
      const c=document.createElement('canvas');c.width=c.height=96;
      const ctx=c.getContext('2d');ctx.drawImage(img,0,0,96,96);
      const pixels=ctx.getImageData(0,0,96,96).data;
      const occupied=[];
      for(let x=0;x<96;x++)if(pixels[(48*96+x)*4+3]>128)occupied.push(x);
      return [occupied[0],95-occupied.at(-1)];
    });
    assert.ok(ink[0]>=3 && Math.abs(ink[0]-ink[1])<=1,JSON.stringify(ink));
    await page.evaluate(()=>openBrowse('settings','dock'));
    for(const name of ['专辑','曲库','播放空间','音乐库','播放统计'])await page.getByRole('switch',{name,exact:true}).uncheck();
    assert.equal(await page.locator('#dock-tabs button').count(),0);
    assert.ok(await page.locator('#mini').isVisible());
    await page.getByRole('switch',{name:'播放空间',exact:true}).check();
    await page.locator('#dock-nav-button').click();
    await page.locator('#dock-tabs [data-tab=space]').click();
    assert.ok(await page.locator('#space').isVisible());
    assert.deepEqual(errors,[]);
    console.log(platform+' shared UI passed');
    await ctx.close();
  }
} finally {
  await browser?.close();
  server.close();
}
