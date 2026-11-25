import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets'),out=path.resolve('artifacts/metadata-20261121');
const server=createServer(async(req,res)=>{
  const file=path.resolve(assets,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(assets+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage();
const cdp=await page.context().newCDPSession(page);
const send=(method,params)=>cdp.send(method,params);
const evaluate=expression=>page.evaluate(expression);
const errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.LumeNative={dispatch:()=>{}};`});
  const facts=JSON.parse(await readFile(path.join(out,'native-desktop-results.json'),'utf8'));
  const songs=[{id:'tagged',...facts.find(s=>s.file==='hires.flac').facts},{id:'missing',title:'真实无标签音频',...facts.find(s=>s.file==='untagged.wav').facts}];
  for(const platform of ['Android','HarmonyOS']){
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);await page.waitForFunction(()=>typeof lumeUpdate==='function');
    await evaluate(`window.lumeSongDetails.load=async()=>({cover:'',lyrics:''});lumeUpdate({platform:${JSON.stringify(platform)},songs:${JSON.stringify(songs)},id:'tagged',title:'标签测试曲',duration:120,pos:0});navigate('library');`);
    const credits=await evaluate(`[...document.querySelectorAll('[data-artist]')].map(el=>({text:el.textContent,badge:el.querySelector('.song-quality')?.textContent}))`);
    assert(credits.length>=2);for(const c of credits){assert(c.text.includes('测试艺术家'));assert(c.text.includes('测试专辑'));assert.equal(c.badge,undefined);assert(!/本[机地]音乐/.test(c.text));}
    assert.deepEqual(await evaluate(`Array.from($('library-list').querySelectorAll('.song-quality'),b=>b.textContent)`),['HR','SQ']);
    await evaluate(`openBrowse('artists');`);assert((await evaluate(`$('browse-content').textContent`)).includes('测试艺术家'));
    await evaluate(`openBrowse('albums');`);assert((await evaluate(`$('browse-content').textContent`)).includes('测试专辑'));
    for(const [width,height] of [[320,740],[390,844],[844,390]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate(`navigate('library');openPlayer();`);await page.waitForTimeout(100);
      const overflow=await evaluate(`[...document.querySelectorAll('.song-info')].filter(e=>e.getBoundingClientRect().width>0).some(e=>e.getBoundingClientRect().right>innerWidth+1)`);assert.equal(overflow,false);
    }
    await evaluate(`lumeUpdate({id:'missing',title:'真实无标签音频'});`);
    const missing=await evaluate(`[...document.querySelectorAll('[data-artist]')].map(e=>e.textContent)`);for(const text of missing){assert(!/本[机地]音乐|空间音乐|测试艺术家|测试专辑|无损|SQ/.test(text));}
    await evaluate(`lumeUpdate({songs:state.songs.map(s=>s.id==='missing'?{...s,artist:'补读艺术家',album:'补读专辑'}:s)});`);
    assert((await evaluate(`document.querySelector('[data-artist]').textContent`)).includes('补读艺术家'));
    results.push({platform,credits,missing,metadataRefresh:true,widths:[320,390,844],passed:true});
    await writeFile(path.join(out,platform+'-metadata-ui.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  assert.deepEqual(errors,[]);await writeFile(path.join(out,'ui-results.json'),JSON.stringify(results,null,2));console.log('Passed metadata display, grouping, refresh and quality checks for both platform profiles.');
}finally{await browser.close();server.close();}
