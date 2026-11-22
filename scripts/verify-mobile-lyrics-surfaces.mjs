import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url));
const {chromium}=require('playwright');
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const out=path.resolve(process.env.LUME_TEST_OUTPUT||'artifacts/lyrics-surfaces-20261121/browser');
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{
  const file=path.join(assets,new URL(req.url,'http://localhost').pathname);
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
 for(const platform of ['Android','HarmonyOS']){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.LumeNative={dispatch:raw=>{const r=JSON.parse(raw);if(r.type==='detailRead')setTimeout(()=>window.lumeReadResult?.(r.token,r.kind==='lyrics'?btoa('[00:00.00]Original line\n[00:00.00]Translation line\n[00:10.00]Second line\n[00:10.00]Second translation'):''),0);}};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);
  await page.waitForFunction(()=>typeof lumeUpdate==='function');
  await page.evaluate(platform=>{lumeUpdate({platform,songs:[{id:'surface-test',title:'Theme surface',artist:'LUME',hasSideLyrics:true}],id:'surface-test',title:'Theme surface',duration:120,pos:2,playing:false});lumeInsets({top:28,right:0,bottom:24,left:0});},platform);
  await page.locator('.hero').click();
  await page.locator('#album').click();
  await page.waitForFunction(()=>document.querySelector('#full').classList.contains('lyrics-screen')&&!document.getElementById('translation-choice').hidden);
  for(const theme of ['dark','light','custom']){
   await page.evaluate(theme=>{
    const root=document.documentElement;root.dataset.phoneTheme=theme==='light'?'light':'dark';
    delete root.dataset.customSkin;
    for(const key of ['background','surface','ink','accent'])root.style.removeProperty('--skin-'+key);
    if(theme==='custom'){root.dataset.customSkin='test';for(const [key,value] of Object.entries({background:'#ece5d8',surface:'#fff8eb',ink:'#352a20',accent:'#79502d'}))root.style.setProperty('--skin-'+key,value);}
   },theme);
   for(const hidden of [false,true]){
    await page.locator('#style-settings').click();
    await page.locator('#plain-hide-controls').setChecked(hidden);
    await page.keyboard.press('Escape');await page.locator('#plain-lyric-settings').waitFor({state:'hidden'});
    assert.equal(await page.locator('#full .transport').isVisible(),!hidden);
    const surfaces=await page.evaluate(()=>{
     const selectors=['.full-head','.full-content','.full-playback','.translation-tools','.full-options','.transport'];
     return selectors.map(selector=>{const e=document.querySelector('#full '+selector),s=getComputedStyle(e);return {selector,background:s.backgroundColor,image:s.backgroundImage,before:getComputedStyle(e,'::before').backgroundImage,after:getComputedStyle(e,'::after').backgroundImage,color:s.color};});
    });
    for(const s of surfaces){assert.equal(s.background,'rgba(0, 0, 0, 0)',JSON.stringify(s));assert.equal(s.image,'none');assert.equal(s.before,'none');assert.equal(s.after,'none');}
    const before=await page.locator('#translation-choice').getAttribute('aria-pressed');
    await page.locator('#translation-choice').click();
    assert.notEqual(await page.locator('#translation-choice').getAttribute('aria-pressed'),before);
    assert.equal(await page.locator('#translation-choice').evaluate(e=>getComputedStyle(e).color===getComputedStyle(document.querySelector('#full')).backgroundColor),false);
    await page.screenshot({path:path.join(out,`${platform}-${theme}-${hidden?'translation-only':'controls'}.png`)});
    results.push({platform,theme,controlsHidden:hidden,realEntry:'home hero → album → lyrics settings checkbox',surfaces,translationClickable:true});
   }
  }
  await page.setViewportSize({width:844,height:390});
  await page.waitForFunction(()=>document.getElementById('full').classList.contains('split-player'));
  assert.equal(await page.locator('#full .translation-tools').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  await page.screenshot({path:path.join(out,`${platform}-landscape.png`)});
  assert.deepEqual(errors,[]);await context.close();
 }
 await writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log('PASS: both platforms, both controls states, three themes, landscape, real settings controls and translation toggle');
}finally{await browser.close();server.close();}
