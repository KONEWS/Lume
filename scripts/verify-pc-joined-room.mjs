import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {phoneFixture,playerFixture,until,sleep} from '../tests/helpers/joined-room-fixtures.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'pc-lyrics/package.json'));
const {chromium}=require('playwright');
const output=path.join(root,'release/PC-UI-Fix/verification');await mkdir(output,{recursive:true});
const player=await playerFixture(),phone=await phoneFixture('HarmonyOS');
await build({root,configFile:false,plugins:[react()],build:{outDir:player.staticDir,emptyOutDir:false}});
const browser=await chromium.launch({headless:true,channel:'msedge'});
const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});
let pagesCreated=0;context.on('page',()=>pagesCreated++);
const page=await context.newPage();page.setDefaultTimeout(12000);
const checks=[],errors=[],failedResponses=[];
page.on('pageerror',cause=>errors.push(cause.message));
page.on('response',response=>{if(response.status()>=400)failedResponses.push({url:response.url(),status:response.status()});});
await page.route(/\/api\/nearby$/,route=>route.fulfill({json:[{
  id:'verified-phone',name:'HarmonyOS 测试手机',platform:'HarmonyOS',address:'127.0.0.1',roomPort:Number(new URL(phone.url).port)
}]}));
await page.exposeFunction('__joinVerifiedPhone',async id=>{assert.equal(id,'verified-phone');return player.service.joinRoom(phone.url);});
await page.addInitScript(()=>{
  if(window.top!==window)return;
  const state={fullscreen:false,maximized:false,alwaysOnTop:false};
  window.lumeDesktop={platform:'Windows',readScanSettings:()=>null,saveScanSettings:()=>{},
    joinRoom:id=>window.__joinVerifiedPhone(id),readLyrics:async id=>(await(await fetch('/api/lyrics/'+encodeURIComponent(id))).json()).lyrics,
    getWindowState:async()=>({...state}),onWindowStateChange:()=>()=>{},
    getFullscreen:async()=>false,setFullscreen:async()=>{},onFullscreenChange:()=>()=>{},
    getAlwaysOnTop:async()=>false,setAlwaysOnTop:async()=>{},onAlwaysOnTopChange:()=>()=>{},
    getSystemFonts:async()=>['Segoe UI'],minimize:()=>{},maximize:()=>{},close:()=>{},openWeb:()=>{}
  };
});
const footer=page.getByRole('contentinfo',{name:'播放器'});
const home=()=>page.getByRole('navigation',{name:'首页',exact:true}).getByRole('button',{name:'首页',exact:true}).click();
const space=()=>page.locator('.rail-utilities').getByRole('button',{name:'播放空间',exact:true}).click();
async function shot(name){await page.screenshot({path:path.join(output,name)});}
try {
  await page.goto(player.service.url);
  await footer.getByText('本机歌曲',{exact:true}).waitFor();
  await until(async()=>(await player.state()).devices.length===1);
  checks.push('main React app connected to the real local HTTP/WebSocket service');
  await space();await page.getByRole('heading',{name:'播放空间',exact:true}).waitFor();
  await page.getByRole('button',{name:'加入空间',exact:true}).click();
  await page.locator('.room-connection-status[data-status="waiting"]').waitFor();
  assert.equal(phone.receivers,0);assert.equal(pagesCreated,1);
  phone.decision='allow';
  await page.locator('.room-connection-status[data-status="joined"]').waitFor();
  await page.locator('.dashboard-track h1').filter({hasText:'手机第一首'}).waitFor();
  assert.equal(context.pages().length,1);assert.equal(pagesCreated,1);
  checks.push('Join button used phone ticket approval and authentication cookie, returning to the same main home page');
  await space();await page.getByText('已加入手机空间 · 手机为房主',{exact:true}).waitFor();
  const localOutput=page.locator('.device-card.this-device');
  await localOutput.getByRole('combobox').selectOption('left');await until(()=>phone.channel==='left');
  const volume=localOutput.getByRole('slider',{name:/音量$/});await volume.evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));
  const volumeBounds=await volume.boundingBox();assert.ok(volumeBounds);
  await page.mouse.click(volumeBounds.x+4+(volumeBounds.width-8)*.35,volumeBounds.y+volumeBounds.height/2);
  const chosenVolume=await volume.evaluate(element=>element.valueAsNumber);
  await until(()=>phone.volume===chosenVolume);assert.ok(chosenVolume>0&&chosenVolume<.8);
  const outputCommands=phone.requests.filter(request=>request.path==='/api/action'&&request.body?.type==='output');
  assert.ok(outputCommands.some(request=>request.body.patch.channel==='left'));
  assert.ok(outputCommands.some(request=>typeof request.body.patch.volume==='number'));
  assert.ok(outputCommands.every(request=>request.body.id==='windows-output'));
  const updated=await player.state();assert.equal(updated.playback.volume,1);assert.equal(updated.devices[0].channel,'left');assert.equal(updated.devices[0].volume,phone.volume);
  checks.push('main device channel and volume controls used real WebSocket messages mapped to the phone receiver id, with gain applied once');
  await home();
  await footer.getByRole('button',{name:'打开当前曲目歌词',exact:true}).click();
  const lyrics=page.frameLocator('iframe[title="澄音 Folia 歌词页"]');
  await lyrics.getByRole('button',{name:'返回澄音',exact:true}).first().waitFor();
  await lyrics.getByRole('button',{name:'返回澄音',exact:true}).first().click();
  await page.locator('iframe[title="澄音 Folia 歌词页"]').waitFor({state:'detached'});
  assert.equal((await player.state()).guestRoom.status,'joined');
  checks.push('switching devices/home and entering/leaving the Folia lyric page preserved the phone session');
  await page.getByRole('button',{name:'打开偏好设置',exact:true}).click();
  await page.getByRole('button',{name:'连接指引',exact:true}).click();
  const modal=page.locator('dialog.modal').filter({has:page.getByRole('heading',{name:'连接你的声音伙伴',exact:true})});
  await modal.waitFor();await modal.getByRole('button',{name:'关闭',exact:true}).click();await home();
  const pollCount=phone.receivers;await until(()=>phone.receivers>pollCount);
  await footer.getByRole('button',{name:'暂停',exact:true}).click();await until(()=>!phone.playing);
  await footer.getByRole('button',{name:'下一首',exact:true}).click();await until(()=>phone.trackId==='phone-b');
  await footer.getByText('手机第二首',{exact:true}).waitFor();
  await footer.getByRole('button',{name:'顺序播放 · 切换随机播放',exact:true}).click();await until(()=>phone.shuffle);
  checks.push('after closing the connection modal, main pause/next/shuffle still changed the real phone HTTP service');
  assert.equal(context.pages().length,1);assert.equal(pagesCreated,1);
  await shot('main-joined-phone.png');
  await page.getByRole('button',{name:'离开空间',exact:true}).click();
  await footer.getByText('本机歌曲',{exact:true}).waitFor();await page.locator('.room-connection-status').waitFor({state:'detached'});
  assert.equal((await player.state()).guestRoom,null);assert.equal(phone.leaves,1);
  const afterLeave=phone.receivers;await sleep(350);assert.equal(phone.receivers,afterLeave);
  await shot('main-left-phone.png');checks.push('Leave restored the local library and stopped the phone receiver session');
  assert.deepEqual(errors,[]);assert.deepEqual(failedResponses,[]);
  const report={checks,pagesCreated,finalPages:context.pages().length,errors,failedResponses,
    phoneActions:phone.requests.filter(request=>request.path==='/api/action').map(request=>request.body),
    authenticatedReceivers:phone.requests.filter(request=>request.path==='/api/receiver'&&request.cookie).length,
    notes:['Headless browser only; no desktop window was opened or captured.','Only nearby discovery and the native bridge were mocked. Join approval, cookies, local HTTP/WebSocket, phone transport and leave used actual servers.']};
  await writeFile(path.join(output,'joined-room-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(cause){await shot('joined-room-ui-failure.png');await writeFile(path.join(output,'joined-room-ui-failure.json'),JSON.stringify({checks,errors,failedResponses,error:String(cause)},null,2));throw cause;}
finally{await browser.close();await player.close();await phone.close();}
