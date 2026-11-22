// Exercise the shipped byte-range reader and metadata loader, not renderLyrics fixtures.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
const root=path.resolve('.'),out=path.join(root,'artifacts/harmony-word-chain-20261121');
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const records=JSON.parse(await readFile(path.join(out,'harmony-library.json'),'utf8'));
const current=records.find(s=>s.id==='021c731f-a569-4786-a2c5-2d6b429b6c5a');
const word=records.find(s=>s.id==='039f2b3e-dbb4-4944-8036-23a1e05efce2');
const files=new Map([[current.id,await readFile(path.join(out,'harmony-current-song.flac'))],[word.id,await readFile(path.join(out,'harmony-word-song.flac'))]]);
const server=createServer(async(req,res)=>{try{const file=path.join(assets,new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const reports=[];
try{for(const platform of ['Android','HarmonyOS']){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),reads=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('nativeRangeRead',request=>{reads.push({id:request.id,kind:request.kind,offset:request.offset,length:request.length});return request.kind==='audio'?files.get(request.id)?.subarray(request.offset,request.offset+request.length).toString('base64')||'':'';});
 await page.addInitScript(()=>{window.LumeNative={dispatch:raw=>{const r=JSON.parse(raw);if(r.type==='detailRead')window.nativeRangeRead(r).then(bytes=>window.lumeReadResult(r.token,bytes));}};});
 await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);await page.waitForFunction(()=>typeof lumeUpdate==='function');
 const inspect=()=>page.evaluate(()=>({id:state.id,rows:timedLines.length,wordRows:timedLines.filter(r=>r.words?.length).length,words:timedLines.reduce((n,r)=>n+(r.words?.length||0),0),renderedWords:$('lyrics-panel').querySelectorAll('.plain-word').length,source:$('plain-lyrics-source').textContent}));
 await page.evaluate(({platform,current,word})=>{lumeUpdate({platform,songs:[current,word],id:current.id,title:current.title,duration:239.762354,pos:28,playing:false});openPlayer();setLyrics(true);},{platform,current,word});
 await page.waitForFunction(()=>timedLines.length===50,{},{timeout:25000});const lineOnly=await inspect();assert.equal(lineOnly.words,0);assert.equal(lineOnly.renderedWords,0);
 await page.evaluate(word=>lumeUpdate({id:word.id,title:word.title,duration:211.973333,pos:30,playing:false}),word);
 await page.waitForFunction(()=>timedLines.length===90&&$('lyrics-panel').querySelectorAll('.plain-word').length===595,{},{timeout:25000});
 const local=await inspect();assert.equal(local.words,595);
 const details=await page.evaluate(()=>({id:'remote-word',cover:'',lyrics:lyricText,lyricsSource:'embedded'}));
 await page.evaluate(details=>lumeUpdate({joined:true,host:'test-room',id:'remote-word',songs:[{id:'remote-word',title:'Remote word song'}],roomDetails:JSON.parse(JSON.stringify(details)),pos:30}),details);
 await page.waitForFunction(()=>state.joined&&timedLines.length===90);const remote=await inspect();assert.equal(remote.words,595);assert.equal(remote.renderedWords,595);
 await page.evaluate(word=>lumeUpdate({localTrackId:'remote-word',localSong:word}),word);
 await page.waitForTimeout(500);const localMatch=await inspect();assert.equal(localMatch.words,595);
 assert(reads.some(r=>r.kind==='audio'&&r.offset>0),'metadata exercises nonzero native offsets');assert.deepEqual(errors,[]);
 reports.push({platform,lineOnly,local,remote,localMatch,rangeReadCount:reads.length,nonzeroOffsets:reads.filter(r=>r.kind==='audio'&&r.offset>0).length,errors});
 await context.close();console.log('PASS',platform,'persisted FLAC -> range reads -> metadata -> ordinary word spans; remote and local-match routes');
}
await writeFile(path.join(out,'byte-chain-results.json'),JSON.stringify({scope:'Production bundled JS with actual persisted phone files; range-read bridge simulated. Separate live Harmony screenshots prove actual device rendering.',reports},null,2));
}finally{await browser.close();server.close();}
