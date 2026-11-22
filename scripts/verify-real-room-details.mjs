import assert from 'node:assert/strict';
import {parseSongLyrics} from '../shared/song-details.mjs';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const argument=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
const phoneOrigin=argument('--phone-origin');
if(!phoneOrigin)throw Error('Pass the explicitly authorized --phone-origin before launching the hidden test host.');
const parsed=new URL(phoneOrigin);assert.equal(parsed.protocol,'http:');assert.equal(parsed.pathname,'/');
const label=argument('--label')||'oneplus';assert.match(label,/^[a-z0-9-]+$/);
const output=path.join(root,'release/RoomDetails/verification');await mkdir(output,{recursive:true});
const reportPath=path.join(output,'details-'+label+'.json');
const controlPath=path.join(output,'details-'+label+'.control.json');
const runId=randomUUID();
const report={runId,phoneOrigin:parsed.origin,label,approvalMethod:argument('--approval-method')||'phone owner confirmation',phase:'preparing',started:new Date().toISOString(),checks:[],errors:[],controlPath};
async function phase(next,extra={}){Object.assign(report,extra,{phase:next,updated:new Date().toISOString()});await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({runId,phase:next,reportPath,controlPath,...extra}));}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
async function until(check,timeout=10000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(stopped)throw Error('Verification interrupted');const value=await check();if(value)return value;await pause(100);}throw Error('Expected real-phone state did not arrive');}
const require=createRequire(path.join(root,'pc-lyrics/package.json'));
const {_electron}=require('playwright');
const electronPath=path.join(root,'node_modules/electron/dist/electron.exe');
const temporary=await mkdtemp(path.join(os.tmpdir(),'lume-real-phone-'));
const dataDir=path.join(temporary,'data'),userData=path.join(temporary,'user-data');await mkdir(dataDir,{recursive:true});await mkdir(userData,{recursive:true});
await writeFile(path.join(dataDir,'library.json'),JSON.stringify({room:{name:'澄音 PC 隐藏联调'}}));
const configPath=path.join(temporary,'host.json');await writeFile(configPath,JSON.stringify({phoneOrigin:parsed.origin,dataDir,userData}));
const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
let electron,page,baseUrl;
const state=async()=>{const response=await page.request.get(baseUrl+'/api/state');assert.equal(response.status(),200);return response.json();};
async function act(action){const response=await page.request.post(baseUrl+'/api/action',{data:action});assert.equal(response.status(),200,await response.text());return response.json();}
async function invisible(){const snapshot=await electron.evaluate(()=>globalThis.__lumeRealPhoneHost.inspect());assert.equal(snapshot.visible,false);assert.equal(snapshot.focused,false);assert.equal(snapshot.focusable,false);assert.equal(snapshot.fullscreen,false);assert.equal(snapshot.offscreen,true);assert.equal(snapshot.windows,1);assert.deepEqual(snapshot.violations,[]);return snapshot;}
async function screenshot(name){await invisible();await page.screenshot({path:path.join(output,'details-'+label+'-'+name+'.png')});}
try {
  await phase('launching-hidden-host');
  electron=await _electron.launch({executablePath:electronPath,args:[path.join(root,'scripts/pc-real-phone-host.cjs'),'--lume-real-phone-config='+configPath],env:environment,timeout:30000});
  page=await electron.firstWindow();page.setDefaultTimeout(15000);
  page.on('pageerror',cause=>report.errors.push(cause.message));
  await page.waitForFunction(()=>!!window.lumeDesktop&&!!document.querySelector('.player-bar'));
  baseUrl=await electron.evaluate(()=>globalThis.__lumeRealPhoneHost.url);
  report.host=await invisible();report.checks.push('actual dist, original preload, real local HTTP/WebSocket service, isolated hidden offscreen Electron');
  const footer=page.getByRole('contentinfo',{name:'播放器'});
  await page.locator('.rail-utilities').getByRole('button',{name:'播放空间',exact:true}).click();
  let target;
  try{target=await until(async()=>{const response=await page.request.get(baseUrl+'/api/nearby');if(!response.ok())return false;const peers=await response.json();report.discovered=peers;return peers.find(peer=>peer.roomPort&&'http://'+peer.address+':'+peer.roomPort===parsed.origin);},15000);}
  catch(cause){await phase('real-discovery-unavailable',{detail:cause.message});throw cause;}
  const row=page.locator('.nearby-row').filter({hasText:target.name}).filter({hasText:target.address}).filter({has:page.getByRole('button',{name:'加入空间',exact:true})});
  // The coordinator uses the pairing code read from this phone's room screen.
  const pin=(await readFile(path.join(os.tmpdir(),label+'-lume-current-pin'),'utf8')).trim();
  const request=(route,body,cookie)=>fetch(parsed.origin+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});
  const pair=await request('/api/pair',{code:pin});assert.equal(pair.status,200);
  const cookie=pair.headers.getSetCookie()[0].split(';')[0];
  const receiver={id:'details-observer',platform:'Windows',model:'元数据验证',libraryVersion:-1};
  const packet=async()=>{const res=await request('/api/receiver',receiver,cookie);assert.equal(res.status,200);return res.json();};
  try {
    await row.getByRole('button',{name:'加入空间',exact:true}).click();
    const ticket=await until(async()=>(await packet()).pending.find(p=>p.name==='澄音 Windows'));
    assert.equal((await request('/api/action',{type:'join-allow',value:ticket.id},cookie)).status,200);
    await until(async()=>(await state()).guestRoom?.status==='joined');
    const catalog=(await packet()).catalog;
    if(label==='android')report.androidFilename=catalog.find(song=>song.title.startsWith('Welcome to THE WORLD'))?.title;
    const preferred=catalog.filter(t=>/^(Avid|Anytime Anywhere|告别Performance|2way nice guy|初夏|A\/Z)/i.test(t.title));
    const trials=[...new Map([...preferred,...catalog.filter(t=>t.hasLyrics),...catalog].map(t=>[t.id,t])).values()];
    let loaded;
    report.trials=[];
    for(const song of trials.slice(0,12)){
      await act({type:'play',trackId:song.id});
      const track=await until(async()=>{const t=(await state()).tracks.find(t=>t.id===song.id);return t?.detailKey&&t;},20000);
      const lyrics=await page.evaluate(id=>window.lumeDesktop.readLyrics(id),track.id);
      report.trials.push({title:track.title,cover:track.artwork.startsWith('/api/room/cover'),lyrics:lyrics.length});
      if(!lyrics || !track.artwork.startsWith('/api/room/cover'))continue;
      const remote=await packet();
      const resource='/api/track-details/'+remote.trackId+'/'+remote.detailToken;
      const raw=await (await fetch(parsed.origin+resource,{headers:{Cookie:cookie}})).json();
      assert.equal((await fetch(parsed.origin+resource)).status,401);
      assert.equal(raw.lyrics,lyrics);
      assert((await (await page.request.get(baseUrl+track.artwork)).body()).equals(Buffer.from(raw.cover.split(',')[1],'base64')));
      const artwork=page.locator('.dashboard-art img').filter({visible:true});
      await page.waitForFunction(path=>new URL(document.querySelector('.dashboard-art img')?.src||location.href).pathname===path,track.artwork);
      await artwork.scrollIntoViewIfNeeded();
      await artwork.evaluate(async img=>{await img.decode();if(!img.naturalWidth)throw Error('missing UI image')});
      await screenshot('cover');
      await page.context().addInitScript(()=>{localStorage.setItem('folia.desktop.mode.v1','cappella');window.testPackets=[];window.addEventListener('message',e=>{const m=e.data?.message;if(['session','lyrics'].includes(m?.type))window.testPackets.push([m.type,m.data.key,m.data.content?.length]);});});
      await footer.getByRole('button',{name:'打开当前曲目歌词'}).click();
      const frame=page.frameLocator('iframe[title="澄音 Folia 歌词页"]');
      const recorder=await page.locator('iframe').elementHandle();
      const child=await recorder.contentFrame();
      await child.evaluate(()=>{window.testClocks=[];window.addEventListener('message',e=>{const m=e.data?.message;if(m?.type==='clock')window.testClocks.push(m.data.position);});});
      await act({type:'seek',position:45});
      await pause(2000);
      report.debug=await child.evaluate(()=>({packets:window.testPackets?.slice(0,15),scene:document.querySelector('.desktop-stage')?.innerText?.slice(0,90)}));
      console.log(JSON.stringify(report.debug));
      await child.waitForFunction(()=>document.querySelector('.desktop-stage')&&!document.querySelector('.waiting-screen,.desktop-waiting,.waiting-actions'),{},{timeout:15000});
      await screenshot('lyrics');
      const samples=await child.evaluate(()=>window.testClocks);
      assert(samples.length>1 && samples.at(-1)>samples[0]);
      const translation=frame.getByRole('button',{name:'显示译文',exact:true});
      const before=await translation.getAttribute('aria-pressed');await translation.click();assert.notEqual(await translation.getAttribute('aria-pressed'),before);
      const rows=parseSongLyrics(lyrics).rows.filter(row=>row.translation && row.time>=15 && row.text.length>3);
      report.translation={bilingualLines:rows.length};
      if(rows.length){
        const cue=rows.find(row=>row.time>=40)||rows[0];
        await act({type:'pause'});
        await act({type:'seek',position:cue.time+0.3});
        if(await translation.getAttribute('aria-pressed')!=='true')await translation.click();
        const visible=()=>child.evaluate(t=>document.querySelector('.desktop-stage')?.innerText.includes(t),cue.translation);
        try{await until(visible,5000);report.translation.shown=true;await screenshot('translation');}
        catch{report.translation.shown=false;report.translation.diagnostic=await child.evaluate(()=>({subtitle:document.querySelector('[data-font-debug-target="visualizer-translation"]')?.innerText,scene:document.querySelector('.desktop-stage')?.innerText?.slice(-420)}));}

        await translation.click();
        report.translation.hidden=await until(async()=>!await visible(),3500);
        report.translation.scene=await child.locator('.desktop-stage').innerText().then(t=>t.slice(0,80));
        if(before==='true')await translation.click();
      }

      assert(report.translation.shown && report.translation.hidden,JSON.stringify(report.translation));
      await child.locator('body').press('Escape');await page.locator('iframe').waitFor({state:'detached'});
      await electron.evaluate(()=>globalThis.__lumeRealPhoneHost.navigate('browser-forward'));
      const returnButton=frame.locator('.lume-return');
      await returnButton.waitFor();
      await electron.evaluate(()=>globalThis.__lumeRealPhoneHost.navigate('browser-backward'));
      await page.locator('iframe').waitFor({state:'detached'});
      assert.equal((await state()).playback.trackId,song.id);
      await footer.getByRole('button',{name:'打开当前曲目歌词'}).click();
      await returnButton.click();
      await page.locator('iframe').waitFor({state:'detached'});
      assert.equal((await state()).guestRoom.status,'joined');
      loaded={id:song.id,artwork:track.artwork,title:song.title,lyricCharacters:lyrics.length,coverBytes:Buffer.from(raw.cover.split(',')[1],'base64').length,clocks:samples};
      break;
    }
    assert(loaded,JSON.stringify(report.trials));report.matched=loaded;
    await act({type:'next'});await act({type:'next'});
    const now=await packet();assert.equal((await state()).playback.trackId,now.trackId);
    assert.equal((await page.request.get(baseUrl+loaded.artwork)).status(),404);
    const emptyCandidate=catalog.find(t=>label==='android'&&t.title.startsWith('Welcome to THE WORLD'))||catalog.find(t=>!t.hasLyrics&&!t.hasSideLyrics);
    if(emptyCandidate){
      await act({type:'play',trackId:emptyCandidate.id});
      const present=await until(async()=>{const t=(await state()).tracks.find(t=>t.id===emptyCandidate.id);return t?.detailKey&&t;},20000);
      const phone=await packet(), url='/api/track-details/'+phone.trackId+'/'+phone.detailToken;
      const original=await(await fetch(parsed.origin+url,{headers:{Cookie:cookie}})).json();
      const content=await page.evaluate(id=>window.lumeDesktop.readLyrics(id),present.id);
      assert.equal(content,original.lyrics);
      assert.equal(present.artwork.startsWith('/api/room/cover/'),!!original.cover);
      report.emptyCandidate={title:present.title,lyrics:content.length,hasCover:!!original.cover};
      if(!content){
        await footer.getByRole('button',{name:'打开当前曲目歌词'}).click();
        const empty=page.frameLocator('iframe[title="澄音 Folia 歌词页"]');
        await empty.locator('.waiting-screen').waitFor();
        await empty.getByText(present.title,{exact:true}).first().waitFor();
        await screenshot('empty-lyrics');
        await empty.getByRole('heading',{name:'暂无歌词',exact:true}).waitFor();
        await empty.locator('.waiting-actions').getByRole('button',{name:'返回澄音',exact:true}).click();
        await page.locator('iframe').waitFor({state:'detached'});
      }
    }
    await act({type:'pause'});
    await page.getByRole('button',{name:'离开空间',exact:true}).click();await until(async()=>(await state()).guestRoom===null);
    assert.equal((await page.request.get(baseUrl+loaded.artwork)).status(),404);
    const local=await state();assert(!local.tracks.some(t=>t.id===loaded.id));
    // Rejoin using the same local application session and a new phone approval.
    await page.locator('.rail-utilities').getByRole('button',{name:'播放空间',exact:true}).click();
    await row.getByRole('button',{name:'加入空间',exact:true}).click();
    const secondTicket=await until(async()=>(await packet()).pending.find(p=>p.name==='澄音 Windows'));
    await request('/api/action',{type:'join-allow',value:secondTicket.id},cookie);
    await until(async()=>(await state()).guestRoom?.status==='joined');
    await act({type:'play',trackId:loaded.id});await act({type:'seek',position:45});await act({type:'pause'});
    const returned=await until(async()=>{const t=(await state()).tracks.find(t=>t.id===loaded.id);return t?.detailKey&&t;},15000);
    assert.notEqual(returned.artwork,loaded.artwork);
    assert.equal((await page.evaluate(id=>window.lumeDesktop.readLyrics(id),loaded.id)).length,loaded.lyricCharacters);
    await page.getByRole('button',{name:'离开空间',exact:true}).click();await until(async()=>(await state()).guestRoom===null);
    report.checks.push('history back and forward preserve the current song, the return button preserves the room, retired cover is unavailable, rejoin reloads correct resources');
    report.host=await invisible();report.checks.push('matched physical host cover bytes and raw lyrics, decoded main-page artwork, progressing Folia clock, translation toggle, Escape return, rapid next and leave');
    await phase('passed');
  }finally{await request('/api/receiver',{...receiver,leave:true},cookie);}
}catch(cause){
  report.error=String(cause);if(page)try{await screenshot('failure');}catch{}
  await phase(report.phase==='real-discovery-unavailable'?report.phase:'failed');throw cause;
}finally{
  if(electron)await electron.close().catch(()=>{});
  const resolved=path.resolve(temporary);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('lume-real-phone-'));
  await rm(resolved,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
