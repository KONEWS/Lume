import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=path.resolve('.'), out=path.join(root,'artifacts/lyrics-fixes-20261121');
await mkdir(out,{recursive:true});
let assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const server=createServer(async(req,res)=>{try{const file=path.join(assets,decodeURIComponent(new URL(req.url,'http://localhost').pathname));
res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const results=[];
const embeddedAudio=await readFile(path.join(out,'embedded-cover.mp3'));
try{
for(const platform of ['Android','HarmonyOS']){
 const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,deviceScaleFactor:1});
 // Start with the old disabled preferences, exercising the upgrade path.
 await context.addInitScript(()=>{
  if(window===top){localStorage.setItem('use_cover_color_bg','false');localStorage.setItem('folia.desktop.backgroundEnabled.v1','false');}
  window.testDrawn=[];const sources=new WeakMap(),bitmap=window.createImageBitmap,draw=CanvasRenderingContext2D.prototype.drawImage;
  window.createImageBitmap=async function(image,...args){const result=await bitmap.call(this,image,...args);sources.set(result,image.src);return result;};
  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){const src=sources.get(image)||image.src;if(src&&!testDrawn.includes(src))testDrawn.push(src);return draw.call(this,image,...args);};
 });
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);
 await page.waitForFunction(()=>typeof lumeUpdate==='function');
 await page.evaluate(({platform,embedded})=>{
  window.testCovers=['#f34536','#20bfd9'].map(color=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,64,64);g.fillStyle='#fff';g.fillRect(10,10,20,40);return c.toDataURL('image/jpeg');});
  window.testCalls=[];
  window.LumeNative={dispatch:raw=>{const r=JSON.parse(raw);testCalls.push(r);if(r.type==='detailRead')setTimeout(()=>lumeReadResult(r.token,r.kind==='audio'&&r.id==='a'?btoa(atob(embedded).slice(r.offset,r.offset+r.length)):r.kind==='artwork'||r.kind==='thumbnail'?testCovers[r.id==='b'?1:0].split(',')[1]:r.kind==='lyrics'?btoa('[00:00.00]Original line\n[00:00.00]Translation\n[00:10.00]Second line\n[00:10.00]Translation two'):''),r.id==='slow'?600:15);}};
  lumeUpdate({platform,songs:[{id:'a',title:'Red cover',hasSideLyrics:true,bytes:atob(embedded).length},{id:'b',title:'Blue cover',hasSideLyrics:true},{id:'slow',title:'Delayed cover',hasSideLyrics:true},{id:'empty',title:'No cover'}],id:'a',title:'Red cover',duration:120,pos:2});
  openPlayer();
 },{platform,embedded:embeddedAudio.toString('base64')});
 await page.waitForFunction(()=>stageTrack?.cover?.startsWith('data:image/webp')&&timedLines.length);
 assert(await page.evaluate(()=>testCalls.some(r=>r.kind==='audio')),'embedded ID3 artwork parsed from audio bytes');
 await page.waitForTimeout(450);
 await page.locator('#style-settings').click();
 assert(await page.locator('#plain-font-scale').isVisible(),'direct settings');
 const anchor=await page.locator('#style-settings').boundingBox(),box=await page.locator('#plain-lyric-settings').boundingBox();
 assert(box.y+box.height<=anchor.y+1&&anchor.y-(box.y+box.height)<12,'menu anchored above button');
 await page.locator('#plain-center').check();assert(await page.locator('#plain-center').isChecked());
 await page.locator('#plain-font-scale').fill('125');assert.equal(await page.locator('#plain-scale-value').textContent(),'125%');
 await page.screenshot({path:path.join(out,platform+'-plain-settings.png')});
 await page.mouse.click(15,120);assert.equal(await page.locator('#plain-lyric-settings').isVisible(),false,'outside dismiss');
 await page.locator('#translation-choice').click();
 assert.equal(await page.locator('#translation-choice').getAttribute('aria-pressed'),'true');
 assert(['none','normal'].includes(await page.locator('#translation-choice').evaluate(e=>getComputedStyle(e,'::after').content)));
 const cdp=await context.newCDPSession(page);
 async function swipe(from,to,y=170){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from,y}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from+(to-from)*i/8,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(600);}
 await swipe(500,250);assert.equal(await page.evaluate(()=>moreLyrics),false,'left swipe does not enter');
 await swipe(250,500);assert.equal(await page.evaluate(()=>moreLyrics),true,'right swipe enters');
 const stage=page.frameLocator('#folia-stage iframe');
 await stage.locator('[data-visualizer-style]').waitFor();
 const translationColors=await page.evaluate(()=>{
  const b=$('translation-choice'),on=getComputedStyle(b).color;
  b.click();const off=getComputedStyle(b).color;b.click();return {on,off};
 });
 assert.notEqual(translationColors.on,translationColors.off,'Folia active translation must remain visibly highlighted');
 // Inspect the actual renderer's host tree, not a mocked Folia mount.
 async function drawnCover(){return page.evaluate(()=>$('folia-stage').querySelector('iframe').contentWindow.testDrawn);}
 await page.waitForFunction(()=>$('folia-stage').querySelector('iframe')?.contentWindow.testDrawn?.includes(stageTrack.cover));
 const first=await page.evaluate(()=>stageTrack.cover);assert((await drawnCover()).includes(first));
 await page.screenshot({path:path.join(out,platform+'-red-folia.png')});
 await page.evaluate(()=>lumeUpdate({id:'slow',title:'Delayed cover'}));
 await page.evaluate(()=>lumeUpdate({id:'b',title:'Blue cover'}));
 await page.waitForFunction(()=>stageTrack.id==='b'&&stageTrack.cover===testCovers[1]);
 assert(await page.evaluate(()=>testCalls.some(r=>r.kind==='artwork'&&r.id==='b')),'system artwork fallback used');
 await page.waitForTimeout(1500);
 assert.equal(await page.evaluate(()=>stageTrack.cover),await page.evaluate(()=>testCovers[1]),'late old track cannot repaint current cover');
 await page.waitForFunction(()=>$('folia-stage').querySelector('iframe')?.contentWindow.testDrawn?.includes(stageTrack.cover));
 await page.screenshot({path:path.join(out,platform+'-blue-folia.png')});
 await page.evaluate(()=>$('full').dispatchEvent(new Event('show-player-controls')));
 await page.locator('#style-settings').click();
 const studio=page.frameLocator('dialog[aria-label="歌词样式设置"] iframe');
 await studio.locator('[data-studio-split]').waitFor();await page.waitForTimeout(700);
 await page.screenshot({path:path.join(out,platform+'-studio.png')});
 await writeFile(path.join(out,platform+'-studio.html'),await studio.locator('.st-window').evaluate(e=>e.outerHTML));
 const layout=await studio.locator('[data-studio-split]').evaluate(e=>({width:e.clientWidth,height:e.clientHeight,overflow:e.scrollWidth>e.clientWidth,aside:e.querySelector('aside').getBoundingClientRect().toJSON()}));
 assert.equal(layout.overflow,false);
 assert(layout.aside.width>=330,'landscape settings column has room for labels');
 const sections=[];
 for(const tab of await studio.getByRole('tab').all()){
  await tab.click();await page.waitForTimeout(150);
  sections.push(await tab.textContent());
  assert.equal(await studio.locator('[data-studio-split]>aside>.st-scroll').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,'settings body horizontal overflow');
 }
 assert.equal(sections.length,5,'all settings tabs remain operable');
 await page.screenshot({path:path.join(out,platform+'-studio-global.png')});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
 // Rotation closes the editor; open the same editor explicitly to inspect portrait layout.
 await page.evaluate(()=>{LumeFolia.openSettings('classic',()=>{},{mobileLayout:true});LumeFolia.updateSettings(stageTrack,'classic',2,false);});
 await studio.locator('[data-studio-split]').waitFor();
 await page.screenshot({path:path.join(out,platform+'-studio-portrait.png')});
 assert(await studio.locator('[data-studio-split]>aside').evaluate(e=>e.clientHeight>350),'portrait settings get usable height');
 await page.evaluate(()=>LumeFolia.closeSettings());await page.waitForTimeout(400);
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(300);
 await swipe(250,500);
 await swipe(500,250);assert.equal(await page.evaluate(()=>moreLyrics),false,'left swipe returns');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
 await page.evaluate(()=>setLyrics(false));await page.waitForTimeout(350);
 await swipe(300,100,350);assert.equal(await page.evaluate(()=>showLyrics),false,'portrait left does not enter');
 await swipe(100,300,350);assert.equal(await page.evaluate(()=>showLyrics),true,'portrait right enters');
 await page.locator('#style-settings').click();assert(await page.locator('#plain-font-scale').isVisible());
 await page.mouse.click(15,160);assert.equal(await page.locator('#plain-lyric-settings').isVisible(),false);
 assert.deepEqual(errors,[]);
 results.push({platform,systemArtworkFallback:true,actualFoliaImageDecoded:true,rapidSwitchRace:true,settingsDirect:true,outsideDismiss:true,insideControls:true,rightSwipeLandscapeAndPortrait:true,translationNoDot:true,layout,sections,errors});
 await context.close();console.log('PASS',platform);
}
await writeFile(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));
}finally{await browser.close();server.close();}
