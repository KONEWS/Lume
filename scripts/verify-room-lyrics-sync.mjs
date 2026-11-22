import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=path.resolve('.'),out=path.join(root,'artifacts/room-lyrics-sync-20261121');
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{
  const file=path.join(assets,new URL(req.url,'http://localhost').pathname);
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const results=[];
try{
for(const platform of ['Android','HarmonyOS']){
  const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);
  await page.waitForFunction(()=>typeof lumeUpdate==='function');
  await page.evaluate(platform=>{
    window.nativeCalls=[];window.LumeNative={dispatch:raw=>nativeCalls.push(JSON.parse(raw))};
    const lyrics=Array.from({length:60},(_,i)=>`[00:${String(i).padStart(2,'0')}.00]Line ${i}`).join('\n');
    lumeUpdate({platform,joined:true,host:'test-room',songs:[{id:'sync',title:'Clock test'}],id:'sync',title:'Clock test',duration:60,pos:10.2,playing:true,roomDetails:{id:'sync',lyrics,cover:''}});
    openPlayer();setLyrics(true);
    window.samples=[];
    const collect=()=>{samples.push({at:performance.now(),position:playbackPosition(),line:currentLine,progress:parseFloat($('mini-progress').style.width)});if(samples.length<400)requestAnimationFrame(collect);};
    requestAnimationFrame(collect);
  },platform);
  await page.waitForTimeout(1450);
  let samples=await page.evaluate(()=>samples);
  assert(samples.length>25,'ordinary lyrics and progress refresh between network packets');
  assert(samples.at(-1).position-samples[0].position>1.2,'mid-song join keeps advancing');
  assert(samples.at(-1).line>samples[0].line,'line changes without a new poll');
  assert(new Set(samples.map(s=>s.progress)).size>25,'progress is continuous');
  await page.evaluate(()=>{window.beforeMetadata=playbackPosition();lumeUpdate({status:'metadata only'});});
  assert(Math.abs(await page.evaluate(()=>playbackPosition()-beforeMetadata))<.15,'metadata must not replay stale position');
  await page.evaluate(()=>lumeUpdate({pos:15.4,playing:false}));
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(()=>playbackPosition()),15.4,'pause freezes');
  await page.evaluate(()=>lumeUpdate({playing:true}));
  await page.waitForTimeout(350);
  assert((await page.evaluate(()=>playbackPosition()))>15.7,'resume advances');
  await page.evaluate(()=>lumeUpdate({pos:32.2}));
  assert.equal(await page.evaluate(()=>currentLine),32,'forward seek follows');
  await page.evaluate(()=>lumeUpdate({pos:3.2}));
  assert.equal(await page.evaluate(()=>currentLine),3,'backward seek follows');
  await page.evaluate(()=>{
    lumeUpdate({pos:3.2,playing:false});
    renderLyrics('[00:03.00]<00:03.00>First <00:04.00>second\n[00:05.00]Next');
    lumeUpdate({playing:true});
    window.wordSamples=[];
    const collect=()=>{wordSamples.push(parseFloat($('lyrics-panel').querySelector('.plain-word').style.getPropertyValue('--word-progress')));if(wordSamples.length<40)requestAnimationFrame(collect);};requestAnimationFrame(collect);
  });
  await page.waitForTimeout(500);
  const words=await page.evaluate(()=>wordSamples);
  assert(words.length>10&&new Set(words).size>10,'word fill advances smoothly between packets');
  await page.evaluate(()=>lumeUpdate({pos:3.5,playing:false}));
  assert(Math.abs(await page.evaluate(()=>parseFloat($('lyrics-panel').querySelector('.plain-word').style.getPropertyValue('--word-progress')))-50)<.01,'word fill resets exactly on pause/seek');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>playbackPosition()),3.5);
  const corrected=await page.evaluate(()=>{
    let writes=0;const original=CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty=function(name,...args){if(name==='--word-progress')writes++;return original.call(this,name,...args);};
    const panel=$('lyrics-panel');
    lumePlain.progress(panel,timedLines,4.5,state.duration,false);writes=0;
    lumePlain.progress(panel,timedLines,4.49,state.duration,false);
    CSSStyleDeclaration.prototype.setProperty=original;
    return {writes,first:parseFloat(panel.querySelector('.plain-word').style.getPropertyValue('--word-progress'))};
  });
  assert.equal(corrected.first,100,'small backwards clock correction preserves completed words');
  assert(corrected.writes<=1,'clock jitter only repaints the active word');
  await page.evaluate(()=>followLyrics());
  await page.screenshot({path:path.join(out,platform+'-plain.png')});
  // Cold Folia loading must use current presentation time, not its old load-start sample.
  await page.route('**/folia/stage.js',async route=>{await new Promise(r=>setTimeout(r,1000));await route.continue();});
  await page.evaluate(()=>{
    styleSelect.value='classic';showMoreMode(true);lumeUpdate({pos:3.2,playing:true});syncLyricView();
    window.foliaSamples=[];
    const win=$('folia-stage').querySelector('iframe').contentWindow;
    let update;Object.defineProperty(win,'foliaUpdate',{configurable:true,get:()=>update,set:fn=>{update=(track,mode,pos,playing)=>{foliaSamples.push({pos,parent:playbackPosition(),playing});return fn(track,mode,pos,playing);};}});
  });
  await page.waitForFunction(()=>foliaSamples.length>0,{},{timeout:20000});
  let folia=await page.evaluate(()=>foliaSamples);
  assert(folia[0].pos>4.1,'slow renderer load catches up');
  assert(Math.abs(folia[0].pos-folia[0].parent)<.06,'Folia and ordinary lyrics share the clock');
  await page.evaluate(()=>lumeUpdate({pos:4.4,playing:false}));
  folia=await page.evaluate(()=>foliaSamples);assert.equal(folia.at(-1).pos,4.4);assert.equal(folia.at(-1).playing,false);
  await page.frameLocator('#folia-stage iframe').locator('[data-visualizer-style]').waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({path:path.join(out,platform+'-folia.png')});
  await page.evaluate(()=>lumeUpdate({pos:59.9,playing:true}));await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>playbackPosition()),60,'duration clamp');
  await page.evaluate(()=>lumeUpdate({joined:false,host:'',id:'other',playing:false}));
  assert.equal(await page.evaluate(()=>playbackPosition()),0,'source change clears the old clock');
  assert.deepEqual(errors,[]);
  results.push({platform,frames:samples.length,wordFrames:words.length,midSongJoin:true,normalPlayback:true,pauseResume:true,seekBothDirections:true,metadataDoesNotReset:true,coldFoliaDelay:folia[0].pos-3.2,errors});
  await context.close();console.log('PASS',platform);
}
await writeFile(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));
}finally{await browser.close();server.close();}
