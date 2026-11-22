import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url)),{chromium}=require('playwright');
const out=path.resolve('artifacts/playback-repair-20261121');await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=path.join(path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets'),new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const report=[];
const cover='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
try{for(const platform of ['Android','HarmonyOS']){
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.calls=[];window.LumeNative={dispatch:raw=>{const r=JSON.parse(raw);calls.push(r);}};});
 await page.goto('http://127.0.0.1:'+server.address().port+'/player/index.html');await page.waitForFunction(()=>typeof lumeUpdate==='function');
 await page.evaluate(({platform,cover})=>{
  window.lumeSongDetails.load=async(s,list)=>list?cover:{cover,lyrics:'[00:00.00]<00:00.00>かな<00:02.00>の歌\n[00:00.00][romaji] kana no uta\n[00:00.00]译文：假名之歌\n[00:05.00]下一行',lyricsSource:'embedded'};
  lumeUpdate({platform,songs:[{id:'song-a',title:'真实封面测试',artist:'测试',bytes:80},{id:'song-b',title:'第二首'}],id:'song-a',title:'真实封面测试',counts:{},playing:true,pos:0,duration:10});
 },{platform,cover});
 await page.waitForFunction(()=>document.querySelector('.hero-cover').style.backgroundImage.includes('data:image'));
 await page.waitForFunction(()=>document.querySelector('#home-recent lume-list-cover').style.backgroundImage.includes('data:image'));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lume-home-activity')||'{"days":{}}').days[Object.keys(JSON.parse(localStorage.getItem('lume-home-activity')||'{"days":{}}').days)[0]]?.starts||0),0);
 await page.evaluate(()=>openPlayer());await page.waitForTimeout(450);
 await page.evaluate(()=>swipeLyricPage(-100));await page.waitForTimeout(350);
 assert(await page.locator('#lyrics-panel').isVisible());assert(!(await page.locator('.transport').isVisible()));assert(await page.locator('.full-head [data-action="player-queue"]').isVisible());
 await page.locator('#style-settings').click();await page.waitForTimeout(350);await page.screenshot({path:path.join(out,platform+'-plain-settings.png')});
 await page.locator('#plain-hide-controls').uncheck();assert(await page.locator('.transport').isVisible());
 await page.locator('#plain-hide-controls').check();assert(!(await page.locator('.transport').isVisible()));
 await page.locator('#plain-font-scale').fill('29');await page.locator('#plain-font-scale').dispatchEvent('input');
 await page.locator('#plain-font-weight').fill('600');await page.locator('#plain-font-weight').dispatchEvent('input');
 await page.locator('#plain-blur').uncheck();await page.locator('#plain-center').check();
 await page.locator('#plain-romaji').selectOption('never');assert.equal(await page.locator('.lyric-romaji').count(),0);
 await page.locator('#plain-romaji').selectOption('auto');assert.equal(await page.locator('.lyric-romaji').count(),1);
 await page.locator('#plain-karaoke').selectOption('never');assert.equal(await page.locator('.plain-word').count(),0);
 await page.locator('#plain-karaoke').selectOption('always');assert.equal(await page.locator('.plain-word').count(),2);
 assert.equal(await page.locator('#lyrics-panel').evaluate(e=>getComputedStyle(e).fontSize),'29px');
 assert.equal(await page.locator('#plain-lyrics-source').textContent(),'EMBEDDED · 内嵌歌词');
 await page.keyboard.press('Escape');await page.locator('#plain-lyric-settings').waitFor({state:'hidden'});await page.screenshot({path:path.join(out,platform+'-portrait-lyrics.png')});
 await page.evaluate(()=>swipeLyricPage(100));await page.waitForTimeout(350);assert(await page.locator('#album').isVisible());
 for(const mode of ['repeatOne','shuffle','sequence']){await page.locator('#play-order').click();assert.equal(await page.evaluate(()=>calls.at(-1).mode),mode);await page.evaluate(mode=>lumeUpdate({playMode:mode,shuffle:mode==='shuffle'}),mode);assert.equal(await page.locator('#play-order').getAttribute('aria-pressed'),null);}
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(350);
 await page.evaluate(()=>swipeLyricPage(-100));await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>showLyrics&&!moreLyrics),true);
 await page.evaluate(()=>swipeLyricPage(-100));await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>moreLyrics),true);
 await page.evaluate(()=>swipeLyricPage(100));await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>showLyrics&&!moreLyrics),true);
 await page.evaluate(()=>swipeLyricPage(100));await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>!showLyrics),true);
 await page.evaluate(({cover})=>{lumeUpdate({joined:true,hosting:false,host:'remote-host',id:'remote-a',title:'空间歌曲',songs:[{id:'remote-a',title:'空间歌曲'}],roomDetails:{id:'remote-a',cover,lyrics:'[00:00.00]来自另一台手机的歌词',lyricsSource:'sidecar'}});}, {cover});
 assert((await page.locator('#album').evaluate(e=>e.style.backgroundImage)).includes('data:image'));
 assert.equal(await page.evaluate(()=>timedLines[0].text),'来自另一台手机的歌词');
 await page.evaluate(()=>lumeUpdate({id:'remote-b',songs:[{id:'remote-b',title:'另一首'}],roomDetails:{id:'remote-a',cover:'',lyrics:'过期歌词'}}));assert.equal(await page.evaluate(()=>timedLines.length),0);
 await page.evaluate(()=>{lumeUpdate({completion:{eventId:'done-1',id:'remote-a',duration:10,at:Date.now()}});lumeUpdate({completion:{eventId:'done-1',id:'remote-a',duration:10,at:Date.now()}});});
 assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('lume-home-activity')).days).reduce((n,d)=>n+d.starts,0)),1);
 // Exercise real touch listeners and portrait viewport allocation with safe areas.
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{player(false);});await page.waitForTimeout(400);
 await page.evaluate(()=>{
   function swipe(x2){const target=document.querySelector('#mini .meta');const touch=x=>new Touch({identifier:17,target,clientX:x,clientY:700});
     target.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[touch(190)]}));
     target.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[touch(x2)]}));
     target.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,touches:[],changedTouches:[touch(x2)]}));}
   window.gestureStart=calls.length;swipe(60);swipe(320);
 });
 assert.deepEqual(await page.evaluate(()=>calls.slice(gestureStart).filter(x=>x.type==='next'||x.type==='previous').map(x=>x.type)),['next','previous']);
 await page.evaluate(()=>{openPlayer();});await page.waitForTimeout(400);await page.evaluate(()=>setLyrics(true));await page.waitForTimeout(300);
 await page.evaluate(()=>{state.playing=false;state.duration=60;state.pos=58;translated=true;updateTranslation();renderLyrics(Array.from({length:30},(_,i)=>'[00:'+String(i*2).padStart(2,'0')+'.00]测试歌词第 '+(i+1)+' 行\n[00:'+String(i*2).padStart(2,'0')+'.00]译文：独立的译文区域').join('\n'));});
 const geometry=[];
 for(const width of [320,390,430])for(const safe of [0,34])for(const hidden of [true,false]){
   await page.setViewportSize({width,height:780});
   await page.evaluate(({safe,hidden})=>{document.documentElement.style.setProperty('--lume-safe-bottom',safe+'px');const input=document.getElementById('plain-hide-controls');input.checked=hidden;input.dispatchEvent(new Event('change'));state.pos=58;renderProgress();currentLine=-1;followLyrics();},{safe,hidden});
   await page.waitForTimeout(100);
   const rects=await page.evaluate(()=>{const box=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,display:getComputedStyle(e).display};};return {panel:box('#lyrics-panel'),controls:box('.full-playback'),transport:box('.transport'),translation:box('#translation-choice'),last:box('#lyrics-panel p:last-child'),queue:box('.full-head [data-action="player-queue"]')};});
   assert(rects.panel.height>100,JSON.stringify(rects));assert(rects.panel.bottom<=rects.controls.top+1,'lyrics clipped above controls');
   assert(rects.last.top>=rects.panel.top-1&&rects.last.bottom<=rects.panel.bottom+1,'last line inside usable lyric viewport');
   assert(rects.translation.bottom<=780-safe+1,'translation above safe area');
   if(!hidden)assert(rects.translation.top>=rects.transport.bottom-1||rects.translation.right<=rects.transport.left||rects.translation.left>=rects.transport.right,'translation separated from transport');
   assert(rects.queue.top>=0&&rects.queue.bottom<=rects.panel.top+1,'queue available in header');
   geometry.push({width,safe,hidden,panelHeight:rects.panel.height});
 }
 await writeFile(path.join(out,platform+'-layout-geometry.json'),JSON.stringify(geometry,null,2));
 await page.setViewportSize({width:390,height:844});
 for(const theme of ['dark','light']){
   await page.evaluate(theme=>{document.documentElement.dataset.phoneTheme=theme;},theme);
   await page.screenshot({path:path.join(out,platform+'-'+theme+'-lyrics-controls.png')});
   await page.locator('#style-settings').click();await page.waitForTimeout(350);
   assert(await page.locator('#plain-lyric-settings').evaluate(e=>e.scrollHeight>e.clientHeight&&e.getBoundingClientRect().height>500));
   const themeColors=await page.evaluate(()=>{const dialog=document.getElementById('plain-lyric-settings'),probe=document.createElement('dialog');probe.className='song-action-sheet';document.body.append(probe);const a=getComputedStyle(dialog),b=getComputedStyle(probe);const result=[a.backgroundColor,b.backgroundColor,a.color,b.color,a.borderTopLeftRadius,b.borderTopLeftRadius];probe.remove();return result;});
   assert.equal(themeColors[0],themeColors[1]);assert.equal(themeColors[2],themeColors[3]);assert.equal(themeColors[4],themeColors[5]);
   await page.screenshot({path:path.join(out,platform+'-'+theme+'-plain-settings.png')});await page.keyboard.press('Escape');await page.locator('#plain-lyric-settings').waitFor({state:'hidden'});
 }
 assert.deepEqual(errors,[]);report.push({platform,checks:['home hero + shelf artwork','start does not count','remote details + stale rejection','portrait controls default hidden and toggle','persisted typography, blur, romaji and karaoke','left-forward / right-back portrait and landscape','three playback modes without highlight','one completion event one count','mini left next / right previous touch listeners','320/390/430 portrait viewport clips lyrics above controls','0/34 safe areas + non-overlapping translation + visible last line','dark/light theme matches existing song sheet'],errors});await context.close();
}await writeFile(path.join(out,'ui-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}finally{await browser.close();server.close();}
