import assert from 'node:assert/strict';
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
const output=path.join(root,'release/PC-UI-Fix/verification');await mkdir(output,{recursive:true});
const reportPath=path.join(output,'real-phone-'+label+'.json');
const controlPath=path.join(output,'real-phone-'+label+'.control.json');
const runId=randomUUID();
const report={runId,phoneOrigin:parsed.origin,label,approvalMethod:argument('--approval-method')||'phone owner confirmation',phase:'preparing',started:new Date().toISOString(),checks:[],errors:[],controlPath};
async function phase(next,extra={}){Object.assign(report,extra,{phase:next,updated:new Date().toISOString()});await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({runId,phase:next,reportPath,controlPath,...extra}));}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
async function gate(action){
  const deadline=Date.now()+15*60*1000;
  while(Date.now()<deadline){
    if(stopped)throw Error('Verification interrupted');
    try{const control=JSON.parse(await readFile(controlPath,'utf8'));if(control.runId===runId){if(control.action==='abort')throw Error('Verification cancelled by coordinator');if(control.action===action)return;}}
    catch(cause){if(cause.code!=='ENOENT'&&!(cause instanceof SyntaxError))throw cause;}
    await pause(500);
  }
  throw Error('Coordinator gate timed out: '+action);
}
async function until(check,timeout=10000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(stopped)throw Error('Verification interrupted');const value=await check();if(value)return value;await pause(100);}throw Error('Expected real-phone state did not arrive');}
const require=createRequire(path.join(root,'pc-lyrics/package.json'));
const {_electron}=require('playwright');
const electronPath=path.join(root,'node_modules/electron/dist/electron.exe');
const temporary=await mkdtemp(path.join(os.tmpdir(),'lume-real-phone-'));
const dataDir=path.join(temporary,'data'),userData=path.join(temporary,'user-data');await mkdir(dataDir,{recursive:true});await mkdir(userData,{recursive:true});
await writeFile(path.join(dataDir,'library.json'),JSON.stringify({room:{name:'澄音 PC 隐藏联调'}}));
const configPath=path.join(temporary,'host.json');await writeFile(configPath,JSON.stringify({phoneOrigin:parsed.origin,dataDir,userData}));
const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
let electron,page,baseUrl,initial,restored=false,left=false;
const state=async()=>{const response=await page.request.get(baseUrl+'/api/state');assert.equal(response.status(),200);return response.json();};
const phoneState=()=>electron.evaluate(()=>globalThis.__lumeRealPhoneHost.phoneState());
async function act(action){const response=await page.request.post(baseUrl+'/api/action',{data:action});assert.equal(response.status(),200,await response.text());return response.json();}
async function invisible(){const snapshot=await electron.evaluate(()=>globalThis.__lumeRealPhoneHost.inspect());assert.equal(snapshot.visible,false);assert.equal(snapshot.focused,false);assert.equal(snapshot.focusable,false);assert.equal(snapshot.fullscreen,false);assert.equal(snapshot.offscreen,true);assert.equal(snapshot.windows,1);assert.deepEqual(snapshot.violations,[]);return snapshot;}
async function screenshot(name){await invisible();await page.screenshot({path:path.join(output,'real-phone-'+label+'-'+name+'.png')});}
async function restore(){
  if(!initial||restored||left)return;
  await act({type:'pause'});
  await act({type:'shuffle',value:initial.shuffle});
  await act({type:'play',trackId:initial.trackId});
  if(!initial.playing)await act({type:'pause'});
  await act({type:'seek',position:initial.position});
  const remote=await until(async()=>{const current=await phoneState();return current.trackId===initial.trackId&&current.playing===initial.playing&&Math.abs(current.position-initial.position)<(initial.playing?3:.25)&&current;});
  const current=await state();assert.equal(current.playback.shuffle,initial.shuffle);restored=true;report.restoredPhone=remote;
}
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
  await row.getByRole('button',{name:'加入空间',exact:true}).click();
  await page.locator('.room-connection-status[data-status="waiting"]').waitFor();
  await phase('awaiting-phone-approval',{target});
  await page.locator('.room-connection-status[data-status="joined"]').waitFor({timeout:65000});
  const joined=await state();const direct=await phoneState();
  initial={trackId:joined.playback.trackId,position:direct.position,playing:direct.playing,shuffle:joined.playback.shuffle,
    title:joined.tracks.find(track=>track.id===joined.playback.trackId)?.title};
  assert.ok(initial.trackId);assert.equal(joined.playback.trackId,direct.trackId);
  report.initial=initial;report.checks.push('real LAN discovery and actual preload join IPC obtained phone approval; same main window owns the authenticated session');
  await screenshot('joined');await phase('joined-awaiting-controls',{initial,requiredControl:'run-controls'});
  await gate('run-controls');
  await page.getByRole('button',{name:'打开偏好设置',exact:true}).click();
  await page.getByRole('button',{name:'连接指引',exact:true}).click();
  const modal=page.locator('dialog.modal').filter({has:page.getByRole('heading',{name:'连接你的声音伙伴',exact:true})});
  await modal.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('navigation',{name:'首页',exact:true}).getByRole('button',{name:'首页',exact:true}).click();
  if((await state()).playback.playing){await footer.getByRole('button',{name:'暂停',exact:true}).click();await until(async()=>!(await phoneState()).playing);}
  await footer.getByRole('button',{name:'播放',exact:true}).click();
  await until(async()=>(await phoneState()).playing);report.checks.push('main play after closing connection modal resumed the physical phone');
  await footer.getByRole('button',{name:'暂停',exact:true}).click();await until(async()=>!(await phoneState()).playing);
  report.checks.push('main pause was confirmed by the physical phone outputs API');
  const beforeNext=(await phoneState()).trackId;
  await footer.getByRole('button',{name:'下一首',exact:true}).click();
  const next=await until(async()=>{const remote=await phoneState();return remote.trackId!==beforeNext&&remote;});report.afterNext=next;
  await footer.getByRole('button',{name:'暂停',exact:true}).click();await until(async()=>!(await phoneState()).playing);
  await footer.getByRole('button',{name:'打开当前曲目歌词',exact:true}).click();
  const frame=page.frameLocator('iframe[title="澄音 Folia 歌词页"]');
  await frame.getByRole('button',{name:'返回澄音',exact:true}).first().click();
  await page.locator('iframe[title="澄音 Folia 歌词页"]').waitFor({state:'detached'});
  assert.equal((await state()).guestRoom.status,'joined');assert.equal((await phoneState()).trackId,next.trackId);
  report.checks.push('main next changed the physical phone track; opening and returning from lyrics kept the same session');
  report.host=await invisible();assert.deepEqual(report.errors,[]);await screenshot('controls');
  await phase('controls-verified-awaiting-restore',{requiredControl:'restore'});await gate('restore');
  await restore();await screenshot('restored');await phase('restored-awaiting-leave',{requiredControl:'leave'});await gate('leave');
  await page.getByRole('button',{name:'离开空间',exact:true}).click();await until(async()=>(await state()).guestRoom===null);left=true;
  await screenshot('left');report.checks.push('initial phone track, pause/play state, position and shuffle restored before leaving');
  report.host=await invisible();await phase('passed',{completed:new Date().toISOString()});
}catch(cause){
  report.error=String(cause);if(page)try{await screenshot('failure');}catch{}
  if(initial&&!restored)try{await restore();}catch(restoreError){report.restoreError=String(restoreError);}
  await phase(report.phase==='real-discovery-unavailable'?report.phase:'failed');throw cause;
}finally{
  if(electron)await electron.close().catch(()=>{});
  const resolved=path.resolve(temporary);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('lume-real-phone-'));
  await rm(resolved,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
