import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
const root=path.resolve('.'),out=path.join(root,'artifacts/lyric-line-transition-20261121');
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const song=path.join(root,'artifacts/room-lyrics-sync-20261121/real-audio');
const lyrics=await readFile(path.join(song,'song.lrc'),'utf8');await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{
 const name=new URL(req.url,'http://localhost').pathname,file=name==='/song.flac'?path.join(song,'song.flac'):path.join(assets,name);
 res.setHeader('Content-Type',({'.flac':'audio/flac','.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader']});
const reports=[];
try{
for(const variant of (process.env.LUME_FIXED_ONLY?['fixed']:['baseline','fixed']))for(const platform of ['Android','HarmonyOS'])for(const joined of (variant==='baseline'?[false]:[false,true])){
 const context=await browser.newContext({viewport:{width:390,height:844},bypassCSP:true}),page=await context.newPage();
 if(variant==='baseline')for(const name of ['player.js','plain-lyrics.js','plain-lyrics.css'])await page.route('**/player/'+name,route=>route.fulfill({path:path.join(out,'baseline',name),contentType:name.endsWith('.css')?'text/css':'text/javascript'}));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);await page.waitForFunction(()=>typeof lumeUpdate==='function');
 await page.evaluate(({platform,joined,lyrics})=>{
  window.LumeNative={dispatch:()=>{}};
  lumeUpdate({platform,joined,host:joined?'line-test-room':'',songs:[{id:'demo',title:'Line continuity'}],id:'demo',duration:211.973333,pos:0,playing:false});
  openPlayer();setLyrics(true);renderLyrics(lyrics);
 },{platform,joined,lyrics});
 await page.waitForTimeout(650);
 await page.evaluate(async()=>{
  window.events=[];window.frames=[];window.moves=[];
  const panel=$('lyrics-panel'),originalScroll=panel.scrollTo.bind(panel);
  panel.scrollTo=options=>{
   const row=panel.querySelector('[aria-current]');
   if(row)moves.push({index:currentLine,targetError:options.top-(row.offsetTop+(row.offsetHeight-panel.clientHeight)/2)});
   return originalScroll(options);
  };
  const originalFollow=followLyrics;
  window.followLyrics=()=>{
   const prior=currentLine,next=timedLines.findIndex(line=>line.time>playbackPosition());
   const index=next<0?timedLines.length-1:next-1,row=panel.children[index];
   const before=index!==prior&&row?new DOMMatrixReadOnly(getComputedStyle(row).transform).m42:0;
   const start=performance.now();originalFollow();
   if(currentLine!==prior&&row){
    const word=timedLines[index].words?.[0],span=row.querySelector('.plain-word');
    const expected=word?Math.max(0,Math.min(1,(playbackPosition()-word.startTime)/Math.max(.01,word.endTime-word.startTime)))*100:0;
    events.push({index,at:performance.now(),position:playbackPosition(),cost:performance.now()-start,
      transformJump:new DOMMatrixReadOnly(getComputedStyle(row).transform).m42-before,
      firstWordError:span?Math.abs((parseFloat(span.style.getPropertyValue('--word-progress'))||0)-expected):0,
      gap:index?timedLines[index].time-timedLines[index-1].words.at(-1).endTime:0});
   }
  };
  window.audio=new Audio('/song.flac');audio.volume=0;await audio.play();
  const publish=()=>lumeUpdate({pos:audio.currentTime,playing:!audio.paused});publish();
  window.poll=setInterval(publish,state.joined?180:350);
  const begin=performance.now();
  const collect=()=>{
   const row=panel.children[currentLine],at=performance.now();
   frames.push({at,index:currentLine,scroll:panel.scrollTop,
     centerError:row?panel.scrollTop-(row.offsetTop+(row.offsetHeight-panel.clientHeight)/2):0});
   if(at-begin<21000)requestAnimationFrame(collect);else{clearInterval(poll);audio.pause();window.done=true;}
  };requestAnimationFrame(collect);
 });
 await page.waitForFunction(()=>window.done,{},{timeout:30000});
 const data=await page.evaluate(()=>({events,frames,moves,decodedSeconds:audio.currentTime}));
 const events=data.events.filter(e=>e.index>=2);
 assert(events.length>=9,'continuous playback crosses multiple actual lines');assert(events.some(e=>e.gap>2),'covers an instrumental gap');
 const stable=data.frames.filter(f=>{const event=data.events.findLast(e=>e.at<=f.at);return event&&f.at-event.at>900;});
 const boundaryFrameGaps=data.frames.slice(1).map((f,i)=>({at:f.at,ms:f.at-data.frames[i].at})).filter(f=>events.some(e=>Math.abs(e.at-f.at)<100));
 const report={variant,platform,joined,decodedSeconds:data.decodedSeconds,lineChanges:events.length,
  maxTransformJump:Math.max(...events.map(e=>Math.abs(e.transformJump))),
  maxStableCenterError:Math.max(...stable.map(f=>Math.abs(f.centerError))),
  maxFirstWordFillError:Math.max(...events.map(e=>e.firstWordError)),
  maxBoundaryFrameGapMs:Math.max(...boundaryFrameGaps.map(f=>f.ms)),
  scrollTargetErrors:data.moves.map(m=>m.targetError),events,errors};
 if(variant==='fixed'){
  assert(report.maxTransformJump<1,'no row snap at handoff');
  assert(report.maxStableCenterError<2,'row settles on its untransformed center');
  assert(report.maxFirstWordFillError<8,'next first word starts on the same frame');
 }else assert(report.maxTransformJump>=10,'reproduces existing row jump');
 assert.deepEqual(errors,[]);
 reports.push(report);await writeFile(path.join(out,'transitions-'+variant+'-'+platform+'-'+(joined?'invited':'local')+'.json'),JSON.stringify(data));
 console.log(JSON.stringify({...report,events:undefined,scrollTargetErrors:report.scrollTargetErrors.slice(0,4)}));
 await context.close();
}
await writeFile(path.join(out,process.env.LUME_FIXED_ONLY?'packaged-transitions.json':'transitions-comparison.json'),JSON.stringify({scope:'Real FLAC and original embedded word lyrics in Chromium; simulated native update cadence. Not phone GPU timing.',reports},null,2));
}finally{await browser.close();server.close();}
