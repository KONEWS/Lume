// Both servers, both libraries and every destructive UI action use temporary data.
import {startServer} from '../server/index.mjs';
import registerTransferFiles from '../electron/transfer-files.cjs';
import {chromium} from '../pc-lyrics/node_modules/playwright/index.mjs';
import {mkdtemp,copyFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const root=await mkdtemp(path.join(os.tmpdir(),'lume-pc-transfer-'));
const first=await startServer({port:0,host:'127.0.0.1',personalAddress:'127.0.0.21',dataDir:path.join(root,'a')});
const second=await startServer({port:0,host:'127.0.0.1',personalAddress:'127.0.0.22',dataDir:path.join(root,'b')});
const browser=await chromium.launch({channel:'chrome',headless:true});
const api=async(host,route,body)=>{
  const r=await fetch(host.url+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const json=await r.json();assert(r.ok,JSON.stringify(json));return json;
};
const devices=(host,op,args={})=>api(host,'/api/personal',{op,...args});
async function until(fn){for(let i=0;i<160;i++){const r=await fn();if(r)return r;await delay(200);}throw Error('Timed out waiting for test state');}
try{
  const file=path.join(root,'尚未入库.wav');await copyFile('tests/fixtures/channel-check.wav',file);
  const before=(await api(first,'/api/state')).tracks;
  const one=(await devices(first,'status')).id,two=(await devices(second,'status')).id;
  await devices(first,'find',{address:'127.0.0.22'});
  const receiverPage=await browser.newPage();
  await receiverPage.goto(second.url);
  await devices(first,'trust',{peer:two});
  const prompt=receiverPage.getByRole('dialog',{name:'设备授权请求'});
  await prompt.waitFor();assert(!(await devices(first,'status')).peers.find(p=>p.id===two).trusted);
  await prompt.getByRole('button',{name:'同意授权'}).click();
  await until(async()=>(await devices(first,'status')).peers.some(p=>p.id===two&&p.synced));
  const handlers=new Map();let picks=0;
  registerTransferFiles({ipcMain:{handle:(id,fn)=>handlers.set(id,fn)},dialog:{async showOpenDialog(_,opts){
    assert.deepEqual(opts.properties,['openFile']);assert(opts.filters[0].extensions.includes('wav'));
    return ++picks===1?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[file]};
  }},mainWindow:{},checkWindowSender(){},service:first});
  const p=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
  p.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});p.setDefaultTimeout(10000);
  await p.exposeFunction('pickTransfer',()=>handlers.get('lume:pick-transfer-file')({}));
  await p.exposeFunction('sendTransfer',(token,peer)=>handlers.get('lume:send-transfer-file')({},token,peer));
  await p.addInitScript(()=>{window.lumeDesktop={platform:'Windows',pickTransferFile:window.pickTransfer,sendTransferFile:window.sendTransfer,
    getFullscreen:async()=>false,getWindowState:async()=>({}),onWindowStateChange:()=>()=>{},onFullscreenChange:()=>()=>{},
    readScanSettings:()=>({}),readLyrics:async()=>'',getAlwaysOnTop:async()=>false,onAlwaysOnTopChange:()=>()=>{},getSystemFonts:async()=>[]};});
  await p.goto(first.url);
  await p.getByRole('button',{name:'播放设备',exact:true}).first().click();
  const manage=p.locator('details.personal-manage').first();
  assert.equal(await manage.getAttribute('open'),null);await manage.locator('summary').first().click();await delay(1200);assert.notEqual(await manage.getAttribute('open'),null);
  const edit=manage.getByRole('button',{name:/本机.*编辑名称/});

  assert(!(await edit.innerText()).includes('编辑名称'));
  assert(await edit.evaluate(el=>getComputedStyle(el,'::after').maskImage!=='none'));
  const nameDialog=p.getByRole('dialog',{name:'编辑本机名称'}),nameField=nameDialog.getByRole('textbox');
  await edit.click();await nameField.waitFor();await until(async()=>await nameField.inputValue());
  const previous=await nameField.inputValue();
  await nameField.fill('暂不保存');await nameDialog.getByRole('button',{name:'取消'}).click();
  assert.equal((await devices(first,'status')).name,previous);
  await edit.click();await until(async()=>await nameField.isEnabled());
  await nameField.fill('字'.repeat(33));await nameDialog.getByText('设备名称最多 32 个字，当前 33 个字。').waitFor();
  assert(await nameDialog.getByRole('button',{name:'保存'}).isDisabled());
  const customName='华为Mate 70 Pro Max';
  await nameField.fill(customName);await nameDialog.getByRole('button',{name:'保存'}).click();
  await until(async()=>(await devices(second,'status')).peers.find(peer=>peer.id===one&&peer.name===customName));
  assert.equal((await devices(first,'status')).id,one);
  await p.getByRole('button',{name:'歌曲传送',exact:true}).first().click();
  const panel=p.locator('lume-personal-devices[transfer]');
  await panel.getByRole('button',{name:'选择歌曲传送'}).click();
  assert(await panel.locator('.personal-transfer').isHidden());
  await panel.getByRole('button',{name:'选择歌曲传送'}).click();
  assert.equal(await panel.locator('output').textContent(),'尚未入库.wav');
  assert.equal(await panel.locator('select[aria-label="选择本机歌曲"]').count(),0);
  await panel.getByLabel('选择目标设备').selectOption(two);
  await panel.getByRole('button',{name:'发送歌曲',exact:true}).click();
  const receive=async(title)=>{
    const offer=await until(async()=>(await devices(second,'status')).offers.find(o=>o.title===title));
    await devices(second,'accept',{key:offer.key});
    return until(async()=>(await api(second,'/api/state')).tracks.find(t=>t.folder==='局域网接收'&&t.title===title));
  };
  const received=await receive('尚未入库');
  const bytes=Buffer.from(await (await fetch(second.url+'/media/'+received.id)).arrayBuffer());
  assert(bytes.equals(await readFile(file)));
  assert.equal((await api(first,'/api/state')).tracks.length,before.length);
  await api(first,'/api/action',{type:'playlist-save',value:'测试歌单',trackIds:[]});
  await p.getByRole('button',{name:'音乐库',exact:true}).click();
  await p.getByRole('button',{name:/主机曲库/}).click();
  const song=before[1],row=p.locator('.track-row').filter({has:p.locator('.track-main strong',{hasText:song.title})});
  const menu=p.getByRole('menu',{name:song.title+'的操作',exact:true});
  const open=()=>row.click({button:'right'});
  await open();await menu.getByRole('menuitem',{name:'下一首播放'}).click();
  await api(first,'/api/action',{type:'shuffle',value:true});
  let state=await api(first,'/api/action',{type:'next'});assert.equal(state.playback.trackId,song.id);
  await api(first,'/api/action',{type:'pause'});await open();await menu.getByRole('menuitem',{name:'喜欢',exact:true}).click();
  await open();await menu.getByRole('menuitem',{name:'取消喜欢',exact:true}).click();
  await open();await menu.getByRole('menuitem',{name:'加入歌单',exact:true}).click();
  await menu.getByRole('menuitem',{name:'测试歌单'}).click();
  assert((await api(first,'/api/state')).playlists[0].trackIds.includes(song.id));
  await open();await menu.getByRole('menuitem',{name:'发送到设备',exact:true}).click();
  await menu.locator('[aria-label="发送到设备"] button:enabled').click();
  await receive(song.title);assert.equal(picks,2);
  await open();p.once('dialog',d=>d.accept());await menu.getByRole('menuitem',{name:'从音乐库中移除'}).click();
  state=await until(async()=>{const s=await api(first,'/api/state');return !s.tracks.some(t=>t.id===song.id)&&s;});
  assert(!state.queue.includes(song.id));assert(!state.playlists[0].trackIds.includes(song.id));assert(state.playRecords.some(r=>r.id===song.id));
  assert.deepEqual(errors,[]);
  console.log('PASS: native picker handler cancellation/selection, unindexed WAV → target library/media bytes, right-click target → all five actions and both submenus.');
}finally{await browser.close();await Promise.all([first.close(),second.close()]);await rm(root,{recursive:true,force:true});}
