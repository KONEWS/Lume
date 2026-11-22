import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'pc-lyrics/package.json'));
const {chromium}=require('playwright');
const output=path.join(root,'release',process.argv[2]||'PC-UI-Fix','verification');
await fs.mkdir(output,{recursive:true});
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'lume-pc-host-'));
const dataDir=path.join(temp,'data'),resourcesDir=path.join(temp,'resources');
await fs.mkdir(path.join(dataDir,'media'),{recursive:true});await fs.mkdir(resourcesDir,{recursive:true});
function wav(seconds=120){const rate=8000,count=rate*seconds,b=Buffer.alloc(44+count*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);for(let i=0;i<count;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*2500),44+i*2);return b;}
const tracks=['first','second','plain'].map((id,i)=>({id,title:i===0?'长歌名对齐验证 · A very long song title beside the complete Folia toolbar':i===1?'第二首测试歌曲':'无时间轴歌词',artist:'澄音 PC 验证',album:'本地测试',duration:120,format:'WAV',source:'import',file:id+'.wav',artwork:'/covers/'+(i+1)+'.svg',favorite:false,hasLyrics:true,detailsVersion:1}));
const lineLyrics=Array.from({length:16},(_,i)=>`[${String(Math.floor(i*7/60)).padStart(2,'0')}:${String(i*7%60).padStart(2,'0')}.00]${['让音乐自由流动','Everybody just move your body','灯光落在安静的房间','旋律继续向前'][i%4]}\n[${String(Math.floor(i*7/60)).padStart(2,'0')}:${String(i*7%60).padStart(2,'0')}.00]${['Music flows freely','跟随音乐轻轻摇摆','Light falls into the room','The melody carries on'][i%4]}`).join('\n');
for(const track of tracks){await fs.writeFile(path.join(dataDir,'media',track.file),wav());await fs.writeFile(path.join(dataDir,'media',track.id+'.lrc'),track.id==='plain'?'无时间轴的第一句\n无时间轴的第二句':lineLyrics);}
await fs.writeFile(path.join(dataDir,'library.json'),JSON.stringify({tracks,queue:tracks.map(t=>t.id),playback:{trackId:'first',position:24,repeat:'off',shuffle:false,volume:.3}}));
const server=await startServer({port:0,host:'127.0.0.1',dataDir,resourcesDir,staticDir:path.join(root,'dist')});
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
const errors=[],missing=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)missing.push({url:r.url(),status:r.status()});});
await page.addInitScript(()=>{
  if(window.top!==window)return;
  localStorage.setItem('folia.desktop.mode.v1','cappella');
  const listeners=new Set(),fullListeners=new Set(),topListeners=new Set();let current={fullscreen:false,maximized:false,alwaysOnTop:false};
  const emit=()=>{for(const fn of listeners)fn({...current});for(const fn of fullListeners)fn(current.fullscreen);for(const fn of topListeners)fn(current.alwaysOnTop);};
  window.__nativeCalls=[];
  window.lumeDesktop={platform:'Windows',readScanSettings:()=>null,saveScanSettings:()=>{},
    getWindowState:async()=>({...current}),onWindowStateChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    getFullscreen:async()=>current.fullscreen,setFullscreen:async value=>{current.fullscreen=value;window.__nativeCalls.push({type:'fullscreen',value});emit();},onFullscreenChange:fn=>{fullListeners.add(fn);return()=>fullListeners.delete(fn);},
    getAlwaysOnTop:async()=>current.alwaysOnTop,setAlwaysOnTop:async value=>{current.alwaysOnTop=value;emit();},onAlwaysOnTopChange:fn=>{topListeners.add(fn);return()=>topListeners.delete(fn);},
    getSystemFonts:async()=>['Arial','Segoe UI','Microsoft YaHei'],readLyrics:async id=>(await(await fetch('/api/lyrics/'+encodeURIComponent(id))).json()).lyrics,
    minimize:()=>window.__nativeCalls.push({type:'minimize'}),maximize:()=>{current.maximized=!current.maximized;emit();},close:()=>window.__nativeCalls.push({type:'close'}),openWeb:()=>{},joinRoom:async()=>{},
  };
});
const state=async()=>(await page.request.get(server.url+'/api/state')).json();
const waitState=async(predicate)=>{const until=Date.now()+6000;while(Date.now()<until){const data=await state();if(predicate(data))return data;await page.waitForTimeout(50);}throw Error('server state did not satisfy expected change');};
const snap=async name=>{await page.waitForTimeout(350);return page.screenshot({path:path.join(output,name+'.png')});};
try{
  await page.goto(server.url);
  await page.getByRole('button',{name:'打开当前曲目歌词',exact:true}).click();
  const frame=page.frameLocator('iframe[title="澄音 Folia 歌词页"]');
  await frame.getByRole('button',{name:'显示译文',exact:true}).waitFor();
  await frame.locator('.desktop-stage').waitFor();
  await page.waitForTimeout(1300);
  await snap('lyrics-windowed-1440');
  checks.push('main application opens Folia iframe with real server lyrics');
  await page.waitForTimeout(5500);
  assert.equal(await frame.locator('main').evaluate(el=>el.classList.contains('immersive')),false);checks.push('windowed controls remain visible after 5 seconds');
  await frame.getByRole('button',{name:'继续播放音乐',exact:true}).click();await waitState(s=>s.playback.playing);checks.push('iframe play command reaches real server');
  await frame.getByRole('button',{name:'暂停音乐',exact:true}).click();await waitState(s=>!s.playback.playing);checks.push('iframe pause command reaches real server');
  await frame.getByRole('button',{name:'下一首',exact:true}).click();await waitState(s=>s.playback.trackId==='second');checks.push('iframe next command changes real track');
  await frame.getByRole('button',{name:'上一首',exact:true}).click();await waitState(s=>s.playback.trackId==='first');checks.push('iframe previous command changes real track');
  await page.request.post(server.url+'/api/action',{data:{type:'repeat',value:'one'}});await frame.getByRole('button',{name:'单曲循环，切换为随机播放',exact:true}).click();await waitState(s=>s.playback.shuffle&&s.playback.repeat==='off');
  await frame.getByRole('button',{name:'随机播放，切换为顺序播放',exact:true}).click();await waitState(s=>!s.playback.shuffle&&s.playback.repeat==='off');checks.push('shuffle and sequential mode reach real server');
  await frame.locator('main').dispatchEvent('wheel',{deltaY:-100,deltaX:0,deltaMode:0});await waitState(s=>Math.abs(s.playback.volume-.32)<.001);checks.push('lyrics volume gesture changes playback volume from its current value');
  const progress=frame.locator('.audio-progress');await progress.click({position:{x:700,y:10}});await waitState(s=>s.playback.position>50);checks.push('spectrum progress seeks actual server');
  await frame.getByRole('button',{name:'播放列表',exact:true}).click();
  const queue=page.locator('dialog.drawer').filter({has:page.getByRole('heading',{name:'接下来播放',exact:true})});await queue.waitFor();assert.equal(await page.locator('iframe[title="澄音 Folia 歌词页"]').count(),1);await snap('lyrics-queue');
  await queue.getByRole('button',{name:'关闭',exact:true}).click();await frame.getByRole('button',{name:'显示译文',exact:true}).waitFor();checks.push('queue opens and closes while lyrics iframe stays mounted');
  await frame.getByRole('combobox',{name:'歌词样式',exact:true}).click();await snap('lyrics-style-menu');await page.keyboard.press('Escape');
  await frame.getByRole('button',{name:'快捷参数',exact:true}).click();await frame.getByRole('dialog',{name:'快捷参数',exact:true}).waitFor();await snap('lyrics-quick-controls');await page.keyboard.press('Escape');
  await frame.getByRole('button',{name:'场景设置',exact:true}).click();await frame.getByRole('dialog',{name:'场景设置',exact:true}).waitFor();await snap('lyrics-scene-controls');await page.keyboard.press('Escape');
  await frame.getByRole('button',{name:'背景设置',exact:true}).click();await frame.locator('.st-window[role="dialog"]').waitFor();await snap('lyrics-background-settings');await page.keyboard.press('Escape');checks.push('style, quick controls, scenes and backgrounds open original Folia UI');
  await frame.getByRole('button',{name:'切换全屏',exact:true}).click();await frame.locator('main.native-fullscreen').waitFor();await page.mouse.move(720,480);await page.waitForTimeout(5500);assert.equal(await frame.locator('main').evaluate(el=>el.classList.contains('immersive')),true);await snap('lyrics-fullscreen-idle');
  await page.mouse.move(721,481);await frame.getByRole('button',{name:'显示译文',exact:true}).waitFor();await page.keyboard.press('Escape');await page.waitForTimeout(150);assert.equal(await frame.locator('main').evaluate(el=>el.classList.contains('native-fullscreen')),false);checks.push('native-state mock fullscreen idle/wake/Escape stays in lyrics');
  await page.setViewportSize({width:880,height:640});await page.waitForTimeout(300);await snap('lyrics-windowed-880');
  const geometry=await frame.locator('.desktop-topbar').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert(geometry.scroll<=geometry.width+1);checks.push('880px native minimum width has no toolbar overflow');
  await page.request.post(server.url+'/api/action',{data:{type:'play',trackId:'plain'}});await frame.getByLabel('普通歌词',{exact:true}).waitFor();await snap('lyrics-plain-fallback');checks.push('plain lyrics use real server fallback');
  for(const button of [3,4]){
    for(const type of ['mousedown','mouseup','auxclick'])await frame.locator('main').dispatchEvent(type,{button});
  }
  await page.waitForTimeout(200);
  assert.equal((await state()).playback.trackId,'plain');
  await frame.getByRole('button',{name:'切换全屏',exact:true}).click();
  await frame.locator('main.native-fullscreen').waitFor();
  await frame.getByRole('button',{name:'返回澄音',exact:true}).click();
  await page.locator('iframe').waitFor({state:'detached'});
  assert.equal((await state()).playback.trackId,'plain');
  assert.equal((await state()).playback.playing,true);
  checks.push('side-button events send no song commands; fullscreen return closes the local lyrics page and preserves playback');
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(missing.length,0,JSON.stringify(missing));
  const report={checks,errors,missing,output,notes:['Native fullscreen is mocked; no physical desktop was opened or captured.','All media commands exercised the actual LUME server and its isolated temporary library.']};
  await fs.writeFile(path.join(output,'host-integration.json'),JSON.stringify(report,null,2));
  await fs.rm(path.join(output,'host-integration-failure.json'),{force:true});await fs.rm(path.join(output,'failure.png'),{force:true});
  console.log(JSON.stringify(report,null,2));
}catch(error){await snap('failure');await fs.writeFile(path.join(output,'host-integration-failure.json'),JSON.stringify({checks,errors,missing,error:String(error)},null,2));throw error;}
finally{await browser.close();await server.close();const resolved=path.resolve(temp);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('lume-pc-host-'));await fs.rm(resolved,{recursive:true,force:true});}
