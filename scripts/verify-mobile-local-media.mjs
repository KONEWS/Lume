import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFile,writeFile} from 'node:fs/promises';import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url)),{chromium}=require('playwright');const out='artifacts/local-media-20261121';
const assets=path.resolve('mobile/player-assets'),server=createServer(async(req,res)=>{try{const f=path.join(assets,new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(f)]||'application/octet-stream');res.end(await readFile(f));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try{for(const platform of ['Android','HarmonyOS']){
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.LumeNative={dispatch:()=>{}};});
 await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);await page.waitForFunction(()=>typeof lumeUpdate==='function');
 await page.evaluate(platform=>{
  window.pendingLocal=[];window.lumeSongDetails.load=song=>new Promise(resolve=>pendingLocal.push({id:song.id,resolve}));
  lumeUpdate({platform,joined:true,hosting:false,host:'http://host:46321',id:'remote-a',title:'Shared song',songs:[{id:'remote-a',title:'Shared song'}],localSong:{id:'local-a',title:'Renamed local'},localTrackId:'remote-a',roomDetails:{id:'remote-a',cover:'',lyrics:'[00:01.00]HOST A',lyricsSource:'sidecar'}});
 },platform);
 await page.waitForFunction(()=>pendingLocal.length>0);await page.evaluate(()=>pendingLocal[0].resolve({cover:'',lyrics:'[00:01.00]LOCAL A',lyricsSource:'sidecar'}));await page.waitForFunction(()=>lyricText.includes('LOCAL A'));
 await page.evaluate(()=>lumeUpdate({roomDetails:{id:'remote-a',cover:'',lyrics:'[00:01.00]NEW HOST A',lyricsSource:'sidecar'}}));assert((await page.evaluate(()=>lyricText)).includes('LOCAL A'));
 await page.evaluate(()=>lumeUpdate({id:'remote-b',title:'B',songs:[{id:'remote-b',title:'B'}],localSong:{id:'local-b',title:'B'},localTrackId:'remote-b',roomDetails:{id:'remote-b',lyrics:'[00:02.00]HOST B',cover:''}}));
 await page.waitForFunction(()=>pendingLocal.some(p=>p.id==='local-b'));await page.evaluate(()=>pendingLocal.find(p=>p.id==='local-b').resolve({lyrics:'',cover:'',lyricsSource:'none'}));await page.waitForFunction(()=>lyricText.includes('HOST B'));
 await page.evaluate(()=>lumeUpdate({roomDetails:{id:'remote-b',lyrics:'[00:02.00]LATE HOST B',cover:''}}));assert((await page.evaluate(()=>lyricText)).includes('LATE HOST B'));
 await page.evaluate(()=>lumeUpdate({id:'remote-c',songs:[{id:'remote-c',title:'C'}],localSong:{id:'local-c'},localTrackId:'remote-c',roomDetails:{id:'remote-c',lyrics:'[00:00.00]HOST C',cover:''}}));await page.waitForFunction(()=>pendingLocal.some(p=>p.id==='local-c'));
 await page.evaluate(()=>{lumeUpdate({id:'remote-d',songs:[{id:'remote-d',title:'D'}],localSong:null,localTrackId:'',roomDetails:{id:'remote-d',lyrics:'[00:00.00]HOST D',cover:''}});pendingLocal.find(p=>p.id==='local-c').resolve({lyrics:'[00:00.00]STALE C',cover:''});});await page.waitForTimeout(100);assert((await page.evaluate(()=>lyricText)).includes('HOST D'));
 assert.deepEqual(errors,[]);results.push({platform,checks:['matching local lyrics override host','late host updates preserve local lyrics','missing local lyrics use host','late host lyrics update fallback','stale local read cannot cross next track'],errors});await page.close();
}await writeFile(out+'/lyrics-ui-verification.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();server.close();}
