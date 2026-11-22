import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
const root=path.resolve('.'),out=path.join(root,'artifacts/room-lyrics-sync-20261121/continuous');
const real=process.argv.includes('--real');
await mkdir(out,{recursive:true});
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const baseline=path.join(root,'artifacts/phone-invites-20261121/snapshot/mobile/player-assets/player');
const syntheticLyrics=Array.from({length:400},(_,i)=>{
  const stamp=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`;
  return `[${stamp(i*8)}]`+['清风','经过','林间','月光'].map((w,j)=>`<${stamp(i*8+j*2)}>${w}`).join('');
}).join('\n');
const lyrics=real?await readFile(path.join(root,'artifacts/room-lyrics-sync-20261121/real-audio/song.lrc'),'utf8'):syntheticLyrics;
await writeFile(path.join(out,'continuous.lrc'),lyrics);
const server=createServer(async(req,res)=>{try{
 const name=new URL(req.url,'http://localhost').pathname;
 const file=name==='/audio.wav'?path.join(root,real?'artifacts/room-lyrics-sync-20261121/real-audio/song.flac':'resources/demo/tide.wav'):path.join(assets,name);
 res.setHeader('Content-Type',({'.flac':'audio/flac','.wav':'audio/wav','.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader']});
const reports=[];
try{
for(const variant of ['baseline','fixed'])for(const platform of ['Android','HarmonyOS'])for(const joined of [false,true]){
 // Production audio is native; allow the test-only HTMLAudio fixture in this browser context.
 const context=await browser.newContext({viewport:{width:844,height:390},bypassCSP:true}),page=await context.newPage();
 if(variant==='baseline')for(const name of ['player.js','plain-lyrics.js'])await page.route('**/player/'+name,route=>route.fulfill({path:path.join(baseline,name),contentType:'text/javascript'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);await page.waitForFunction(()=>typeof lumeUpdate==='function');
 await page.evaluate(async({platform,joined,lyrics,real})=>{
  window.LumeNative={dispatch:()=>{}};
  lumeUpdate({platform,joined,host:joined?'audio-clock-room':'',songs:[{id:'demo',title:'Continuous words'}],id:'demo',title:'Continuous words',duration:real?211.973333:60,pos:0,playing:false});
  openPlayer();setLyrics(true);renderLyrics(lyrics);
  window.audio=new Audio('/audio.wav');audio.volume=0;await audio.play();
  window.rowsAtStart=timedLines;window.firstAtStart=$('lyrics-panel').firstElementChild;
  window.nativePolls=0;
  const publish=()=>{nativePolls++;lumeUpdate({pos:audio.currentTime,playing:!audio.paused});};publish();
  window.poll=setInterval(publish,joined?180:350);
  window.measures=[];window.writes=0;
  const set=CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty=function(name,...rest){if(name==='--word-progress')writes++;return set.call(this,name,...rest);};
  const start=performance.now();
  const collect=()=>{
   const at=performance.now(),pos=audio.currentTime;
   let row=timedLines.findIndex(line=>line.time>pos)-1;if(row<0)row=0;
   let j=timedLines[row].words.findIndex(word=>word.startTime>pos)-1;if(j<0)j=timedLines[row].words.length-1;
   const word=$('lyrics-panel').children[row].querySelectorAll('.plain-word')[j];
   measures.push({at,pos,fill:parseFloat(word.style.getPropertyValue('--word-progress'))||0});
   if(at-start<6200)requestAnimationFrame(collect);else{clearInterval(poll);audio.pause();window.done=true;}
  };requestAnimationFrame(collect);
 },{platform,joined,lyrics,real});
 await page.waitForFunction(()=>window.done,{},{timeout:15000});
 const data=await page.evaluate(()=>({samples:measures,writes,nativePolls,rowsRetained:rowsAtStart===timedLines&&firstAtStart===$('lyrics-panel').firstElementChild,ready:audio.readyState,decodedSeconds:audio.currentTime}));
 const gaps=[];let last=data.samples[0],lastChange=last.at;
 for(const sample of data.samples.slice(1)){
  if(sample.fill!==last.fill){gaps.push(sample.at-lastChange);lastChange=sample.at;}last=sample;
 }
 const sorted=[...gaps].sort((a,b)=>a-b),p95=sorted[Math.floor(sorted.length*.95)]||0;
 const report={variant,platform,source:joined?'invited bridge cadence':'local bridge cadence',decodedSeconds:data.decodedSeconds,nativePolls:data.nativePolls,renderedWordChanges:gaps.length,wordChangeP95ms:p95,maxWordGapMs:Math.max(...gaps),wordStyleWrites:data.writes,rowsRetained:data.rowsRetained};
 assert(data.ready>=2&&data.decodedSeconds>6,'real WAV decoding and media clock keep running');assert(data.rowsRetained,'lyrics must not be rebuilt on polls');
 if(variant==='fixed'){assert(gaps.length>150,JSON.stringify(report));assert(p95<60,JSON.stringify(report));assert(data.writes<10000,'steady frames must not rewrite all 1600 words');}
 else assert(p95>100,'baseline reproduces stepped word updates');
 reports.push(report);console.log(JSON.stringify(report));
 await context.close();
}
await writeFile(path.join(out,real?'real-song-results.json':'results.json'),JSON.stringify({audio:real?'Idol - YOASOBI.flac (read-only copy from connected Android music folder)':'resources/demo/tide.wav',lyrics:real?'Original embedded lyrics: 90 lines, 595 timed words':'continuous.lrc (1600 enhanced-LRC words)',scope:'Real Chromium audio decoding and DOM fill measurements; native bridge cadence simulated. Not a physical phone/GPU measurement or audible dual-device listening test.',reports},null,2));
}finally{await browser.close();server.close();}
