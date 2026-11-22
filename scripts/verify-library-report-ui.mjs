import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url));
const {chromium}=require('playwright');
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const out=path.resolve(process.env.LUME_REPORT_OUTPUT||'artifacts/library-report-20261121/ui');await mkdir(out,{recursive:true});
const samples=JSON.parse(await readFile('artifacts/library-report-20261121/facts-results.json','utf8'));
const songs=samples.map((s,i)=>({id:'sample-'+i,title:s.file,...s.facts}));songs[0].hidden=true;
const server=createServer(async(req,res)=>{try{const file=path.join(assets,new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try{
 for(const platform of ['Android','HarmonyOS']){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.calls=[];window.LumeNative={dispatch:raw=>{const c=JSON.parse(raw);calls.push(c);if(c.type==='detailRead')setTimeout(()=>lumeReadResult?.(c.token,''),0);}};});
  await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);await page.waitForFunction(()=>typeof lumeUpdate==='function');
  await page.evaluate(({platform,songs})=>{lumeUpdate({platform,songs,joined:false});openBrowse('sources');},{platform,songs});
  const legends=await page.locator('.library-chart').evaluateAll(charts=>charts.map(c=>({title:c.querySelector('h3').textContent,rows:[...c.querySelectorAll('li')].map(e=>e.textContent)})));
  assert.equal(legends[0].title,'歌词覆盖率');assert.equal(legends[1].title,'音质分布');
  const lyricCounts=[true,false,undefined].map(value=>songs.filter(s=>s.hasLyrics===value).length);
  const qualityCounts=['hires','lossless','lossy','unknown'].map(q=>songs.filter(s=>s.quality===q).length);
  for(const [i,counts] of [lyricCounts,qualityCounts].entries())counts.forEach((n,j)=>assert(legends[i].rows[j].includes(n+' 首'),JSON.stringify(legends)));
  for(const width of [320,390,844]){
   await page.setViewportSize({width,height:width===844?390:844});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const restore=page.getByRole('button',{name:'恢复隐藏歌曲（1 首）'});await restore.scrollIntoViewIfNeeded();
   assert(await restore.evaluate(e=>e===document.getElementById('browse-content').lastElementChild&&e.getBoundingClientRect().height>=44));
   for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.phoneTheme=theme,theme);await restore.focus();
    assert(await restore.evaluate(e=>document.activeElement===e));
   }
  }
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'恢复隐藏歌曲（1 首）'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,platform+'.png')});
  await page.getByRole('button',{name:'恢复隐藏歌曲（1 首）'}).press('Enter');
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.type==='songRestore').length),1);
  // Native migration/rescan sends a revised catalog while the report stays open.
  await page.evaluate(()=>lumeUpdate({songs:state.songs.map(s=>({...s,hidden:false,hasLyrics:true,quality:'lossless'}))}));
  assert.equal(await page.locator('.library-restore').count(),0);
  assert.match(await page.locator('.library-chart').nth(0).locator('li').first().innerText(),/12 首 · 100%/);
  assert.match(await page.locator('.library-chart').nth(1).locator('li').nth(1).innerText(),/12 首 · 100%/);
  await page.evaluate(()=>lumeUpdate({songs:[]}));assert(!(await page.locator('lume-library-report').innerText()).includes('NaN'));
  assert.deepEqual(errors,[]);results.push({platform,legends,liveRefresh:true,emptyLibrary:true,restoreLast:true,restoreKeyboard:true,widths:[320,390,844]});await context.close();
 }
 await writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log('PASS both platform profiles: real audio facts charts, refresh, restore order/keyboard, mobile/landscape layouts');
}finally{await browser.close();server.close();}
