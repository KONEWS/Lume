// Production shared UI + song-details parser, with a deterministic native read bridge.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url));
const {chromium}=require('playwright');
const out=path.resolve('artifacts/cover-handoff-20261121');await mkdir(out,{recursive:true});
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const files={};for(const id of ['a','b','none'])files[id]=await readFile(path.join(out,'fixtures',id+'.mp3'));
const covers={};for(const id of ['a','b','c'])covers[id]='data:image/png;base64,'+(await readFile(path.join(out,'fixtures',id+'.png'))).toString('base64');
const server=createServer(async(req,res)=>{try{
  const file=path.join(assets,new URL(req.url,'http://localhost').pathname);
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report=[];
try{for(const platform of ['Android','HarmonyOS']){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('fixtureRead',r=>r.kind==='audio'?files[r.id]?.subarray(r.offset,r.offset+r.length).toString('base64')||'':'');
  await page.addInitScript(()=>{
    localStorage.setItem('lume-phone-round-cover','true');
    // Keep the home preview on the first fixture so the delayed next cover is cold.
    Math.random=()=>0;
    window.readDelays={};window.calls=[];
    window.LumeNative={dispatch:raw=>{
      const r=JSON.parse(raw);calls.push(r);
      if(r.type==='detailRead')fixtureRead(r).then(data=>setTimeout(()=>lumeReadResult(r.token,data),readDelays[r.id]||0));
      if(r.type==='select'||r.type==='next'){
        const index=state.songs.findIndex(s=>s.id===state.id);
        const song=r.type==='select'?state.songs.find(s=>s.id===r.id):state.songs[(index+1)%state.songs.length];
        lumeUpdate({id:song.id,title:song.title,playing:true,pos:0});
      }
    }};
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/player/index.html');
  await page.waitForFunction(()=>typeof lumeUpdate==='function');
  await page.evaluate(({platform,sizes})=>{
    lumeUpdate({platform,songs:Object.entries(sizes).map(([id,bytes])=>({id,title:id,bytes})),id:'a',title:'a',duration:1});
    window.artNodes=()=>[$('album'),$('mini-art')];
    window.artValues=()=>artNodes().map(n=>n.style.backgroundImage);
  },{platform,sizes:Object.fromEntries(Object.entries(files).map(([id,data])=>[id,data.length]))});
  await page.waitForFunction(()=>artValues().every(v=>v.includes('data:image')));
  const first=await page.evaluate(()=>artValues());
  await page.evaluate(()=>lumeUpdate({playing:true}));
  const rotation=()=>page.evaluate(()=>getComputedStyle($('mini-art'),'::before').transform);
  const startAngle=await rotation();
  await page.waitForFunction(angle=>getComputedStyle($('mini-art'),'::before').transform!==angle,startAngle);
  await page.locator('#phone-dock .mini-track').click();await page.waitForTimeout(450);
  await page.locator('#phone-dock .mini-track').click();await page.waitForTimeout(450);
  await page.evaluate(()=>lumeUpdate({playing:false}));
  const pausedAngle=await rotation();
  assert.equal(await page.evaluate(()=>getComputedStyle($('album'),'::before').transform),pausedAngle);
  await page.evaluate(()=>player(false));await page.waitForTimeout(350);
  assert.equal(await rotation(),pausedAngle,'closing while paused retains the angle');
  await page.evaluate(()=>openPlayer());await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>getComputedStyle($('album'),'::before').transform),pausedAngle);
  await page.evaluate(()=>{
    readDelays.b=250;
    window.frames=[];window.record=true;
    function sample(){if(!record)return;frames.push(artValues());requestAnimationFrame(sample);}sample();
  });
  await page.locator('#full [data-action="next"]').click();
  assert.deepEqual(await page.evaluate(()=>artValues()),first,'retain all displayed covers during native reads');
  await page.waitForFunction(first=>artValues().every((v,i)=>v.includes('data:image')&&v!==first[i]),first);
  await page.evaluate(()=>record=false);
  assert((await page.evaluate(()=>frames)).flat().every(v=>v.includes('data:image')),'no placeholder in rendered frames');
  const second=await page.evaluate(()=>artValues());
  await page.evaluate(()=>lumeUpdate({songs:state.songs.map(s=>({...s})),title:'refreshed title'}));
  assert.deepEqual(await page.evaluate(()=>artValues()),second,'metadata refresh keeps decoded cover');
  await page.locator('#full [data-action="next"]').click();
  await page.waitForFunction(()=>artValues().every(v=>v.includes('gradient')));
  // Exercise decoder ordering independently from read ordering.
  await page.evaluate(covers=>{
    window.testCovers=covers;window.loads=new Map();
    lumeSongDetails.load=(s,listOnly)=>listOnly?Promise.resolve(''):new Promise(resolve=>loads.set(s.id,resolve));
    lumeUpdate({scanning:true});lumeUpdate({scanning:false,songs:[{id:'slow',title:'slow'},{id:'fast',title:'fast'},{id:'empty',title:'empty'}],id:'slow',title:'slow'});
  },covers);
  await page.waitForFunction(()=>loads.has('slow'));
  await page.locator('#full [data-action="next"]').click();
  await page.waitForFunction(()=>loads.has('fast'));
  await page.evaluate(()=>loads.get('fast')({cover:testCovers.b,lyrics:''}));
  await page.waitForFunction(()=>artValues().every(v=>v.includes(testCovers.b)));
  await page.evaluate(()=>loads.get('slow')({cover:testCovers.a,lyrics:''}));
  await page.waitForTimeout(100);
  assert(await page.evaluate(()=>artValues().every(v=>v.includes(testCovers.b))),'stale native detail read cannot paint');
  // Late decode after changing songs, including a new result for the same song.
  await page.evaluate(()=>{
    window.originalDecode=Image.prototype.decode;window.releaseDecode=null;
    Image.prototype.decode=function(){if(this.src===testCovers.c)return new Promise(resolve=>releaseDecode=()=>originalDecode.call(this).then(resolve));return originalDecode.call(this);};
    lumeUpdate({joined:true,hosting:false,host:'room-one',id:'remote',songs:[{id:'remote',title:'remote'}],roomDetails:{id:'remote',cover:testCovers.c,lyrics:''}});
  });
  await page.waitForFunction(()=>!!releaseDecode);
  await page.evaluate(()=>lumeUpdate({roomDetails:{id:'remote',cover:testCovers.a,lyrics:''}}));
  await page.waitForFunction(()=>artValues().every(v=>v.includes(testCovers.a)));
  await page.evaluate(()=>releaseDecode());await page.waitForTimeout(100);
  assert(await page.evaluate(()=>artValues().every(v=>v.includes(testCovers.a))),'stale image decode cannot replace newer cover');
  await page.evaluate(()=>{
    Image.prototype.decode=originalDecode;
    lumeUpdate({id:'remote-next',songs:[{id:'remote-next',title:'next'}]});
    lumeUpdate({roomDetails:{id:'remote',cover:'',lyrics:'stale'}});
  });
  assert(await page.evaluate(()=>artValues().every(v=>v.includes('gradient'))),'a pending remote song must not show the previous song artwork');
  await page.evaluate(()=>lumeUpdate({roomDetails:{id:'remote-next',cover:'',lyrics:''}}));
  assert(await page.evaluate(()=>artValues().every(v=>v.includes('gradient'))),'confirmed absent room cover clears old art');
  // Same ID from another source and rescans must invalidate in-flight reads.
  await page.evaluate(()=>lumeUpdate({joined:false,host:'',id:'reused',songs:[{id:'reused',title:'old'}]}));
  await page.waitForFunction(()=>loads.has('reused'));
  await page.evaluate(()=>{window.oldRead=loads.get('reused');loads.delete('reused');lumeUpdate({scanning:true});lumeUpdate({scanning:false});});
  await page.waitForFunction(()=>loads.has('reused'));
  await page.evaluate(()=>loads.get('reused')({cover:testCovers.b,lyrics:''}));
  await page.waitForFunction(()=>artValues().every(v=>v.includes(testCovers.b)));
  await page.evaluate(()=>oldRead({cover:testCovers.a,lyrics:''}));await page.waitForTimeout(100);
  assert(await page.evaluate(()=>artValues().every(v=>v.includes(testCovers.b))),'rescan rejects old reads with same ID');
  await page.evaluate(()=>lumeUpdate({joined:true,host:'broken',id:'bad',songs:[{id:'bad',title:'bad'}],roomDetails:{id:'bad',cover:'data:image/png;base64,AAAA',lyrics:''}}));
  await page.waitForFunction(()=>artValues().every(v=>v.includes('gradient')));
  assert.deepEqual(errors,[]);
  report.push({platform,checks:['production MP3 embedded-cover parser and next button','no placeholder across rendered frames','same-song refresh','genuinely coverless MP3','rapid next with delayed reads','late decode and replacement packet','room ID match','rescan ID reuse','invalid image fallback'],errors});
  await context.close();
}
await writeFile(path.join(out,'ui-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();server.close();}
