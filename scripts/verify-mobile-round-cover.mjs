// Shared WebView checks; these do not stand in for Android/HarmonyOS device tests.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile, mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=path.resolve(process.argv[2] || path.join(root,'mobile/player-assets'));
const output=path.join(root,'artifacts/round-cover/verification');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
  const file=path.resolve(assets,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(assets+path.sep)){res.writeHead(403).end();return;}
  try{
    res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/player/index.html`;
const profile=await mkdtemp(path.join(os.tmpdir(),'lume-round-cover-'));
const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=9397',
  '--enable-unsafe-swiftshader',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,nextId=0;
const pending=new Map(),errors=[],results=[];
function send(method,params={}){
  const id=++nextId;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
}
async function evaluate(expression){
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(result.result.description);
  return result.result.value;
}
async function load(platform){
  await send('Page.navigate',{url});
  for(let i=0;i<100;i++){
    if(await evaluate('typeof window.lumeUpdate === "function"'))break;
    await pause(50);
  }
  await evaluate(`lumeUpdate({platform:${JSON.stringify(platform)},songs:[{id:'demo',title:'封面测试',artist:'LUME'}],id:'demo',title:'封面测试',duration:180,playing:false});`);
}
const turn=()=>evaluate(`getComputedStyle($('album'),'::before').transform`);
async function open(){await evaluate('openPlayer()');await pause(450);}
async function close(){await evaluate('player(false)');await pause(450);}
async function setting(enabled){
  await evaluate(`openBrowse('settings');if($('round-playback-cover').checked!==${enabled})$('round-playback-cover').click()`);
  assert.equal(await evaluate(`$('round-playback-cover').checked`),enabled);
  await pause(220);
}
async function screenshot(name){
  const shot=await send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(output,name+'.png'),Buffer.from(shot.data,'base64'));
}
try{
  let target;
  for(let i=0;i<100;i++){
    try{target=(await(await fetch('http://127.0.0.1:9397/json/list')).json()).find(t=>t.type==='page');if(target)break;}catch{}
    await pause(100);
  }
  assert(target,'Headless Chromium is available');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  socket.addEventListener('message',({data})=>{
    const message=JSON.parse(data);
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(message.error):p.resolve(message.result);}
    else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
  });
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.LumeNative={dispatch:()=>{}};'});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  for(const platform of ['Android','HarmonyOS']){
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await load(platform);await evaluate('localStorage.removeItem("lume-phone-round-cover")');await load(platform);
    await setting(false);
    assert.equal(await evaluate(`document.querySelector('.cover-setting').textContent`),'圆形播放封面');
    assert.equal(await evaluate(`$('round-playback-cover').getAttribute('role')`),'switch');
    await screenshot(platform+'-setting-off');
    await open();
    const square=await evaluate(`({radius:getComputedStyle($('album')).borderRadius,image:getComputedStyle($('album')).backgroundImage,mini:getComputedStyle($('mini-art')).borderRadius})`);
    assert.notEqual(square.radius,'50%');
    await close();await setting(true);await screenshot(platform+'-setting-on');
    await load(platform);
    assert.equal(await evaluate(`document.documentElement.hasAttribute('data-round-cover')`),true,'enabled preference survives reload');
    await open();
    assert.equal(await evaluate(`getComputedStyle($('album')).borderRadius`),'50%');
    assert.equal(await evaluate(`getComputedStyle($('album'),'::before').backgroundImage`),square.image,'real cover is inherited');
    assert.equal(await evaluate(`getComputedStyle($('mini-art')).borderRadius`),square.mini,'mini artwork is unchanged');
    const paused=await turn();await pause(150);assert.equal(await turn(),paused);
    await evaluate('lumeUpdate({playing:true})');await pause(180);assert.notEqual(await turn(),paused);
    await evaluate('lumeUpdate({playing:false})');await pause(40);
    const stopped=await turn();await pause(180);assert.equal(await turn(),stopped,'pause holds the angle');
    const stoppedTime=await evaluate(`$('album').getAnimations({subtree:true})[0].currentTime`);
    await evaluate('lumeUpdate({playing:true})');await pause(130);assert.notEqual(await turn(),stopped,'resume advances from paused angle');
    assert((await evaluate(`$('album').getAnimations({subtree:true})[0].currentTime`))>stoppedTime,'resume does not restart rotation');
    await evaluate(`paintDetails($('album'),{cover:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="teal"/></svg>'),lyrics:''})`);
    assert.equal(await evaluate(`getComputedStyle($('album'),'::before').backgroundImage===getComputedStyle($('album')).backgroundImage`),true,'late loaded artwork updates without replacing the rotor');
    await evaluate(`bindArt($('album'),state.songs[0])`);
    // Verify both shapes in portrait, landscape and short/small screen layouts.
    for(const round of [false,true]){
      await close();await setting(round);
      for(const [width,height] of [[390,844],[844,390],[320,568],[740,360]]){
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await pause(100);
        await evaluate('navigate("home");preparePlayerMotion()');
        const frames=await evaluate(`(() => {
          const rows=[];
          for(const p of [0,.2,.5,.8,1]){
            playerMotion.seek(p);
            const r=document.querySelector('.travelling-cover').getBoundingClientRect();
            rows.push({p,width:r.width,height:r.height});
          }
          return rows;
        })()`);
        for(const f of frames)assert(Math.abs(f.width-f.height)<.1,'transition stays square at '+JSON.stringify(f));
        await open();
        const r=await evaluate(`(() => {const r=$('album').getBoundingClientRect();return {width:r.width,height:r.height,radius:getComputedStyle($('album')).borderRadius}})()`);
        assert(r.width>0 && Math.abs(r.width-r.height)<.1,platform+' album is square '+JSON.stringify(r));
        assert.equal(r.radius==='50%',round);
        if(width===390||width===844)await screenshot(`${platform}-${round?'round':'square'}-${width}`);
        results.push({platform,round,width,height,album:r,transitionFrames:frames});
        await close();
      }
    }
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(100);
    await open();
    const artCenter=await evaluate(`(() => {const r=$('album').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    async function touch(type,x,y){await send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});}
    await touch('touchStart',artCenter.x,artCenter.y);await touch('touchEnd',0,0);await pause(400);
    assert.equal(await evaluate('showLyrics'),true,'tapping round artwork still opens lyrics');
    await evaluate('setLyrics(false)');await pause(400);
    await touch('touchStart',artCenter.x+65,artCenter.y);
    for(const dx of [20,40,70,100,130]){await touch('touchMove',artCenter.x+65-dx,artCenter.y);await pause(20);}
    await touch('touchEnd',0,0);await pause(400);
    assert.equal(await evaluate('showLyrics'),true,'swiping round artwork still opens lyrics');
    await close();
    // Native keyboard semantics are kept by the labelled checkbox switch.
    await setting(true);await evaluate(`$('round-playback-cover').focus()`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    assert.equal(await evaluate(`$('round-playback-cover').checked`),false);
    await load(platform);assert.equal(await evaluate(`document.documentElement.hasAttribute('data-round-cover')`),false,'disabled preference survives reload');
    await setting(true);await open();
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate('lumeUpdate({playing:true})');assert.equal(await turn(),'none','reduced motion keeps a still round cover');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await close();
    console.log('PASS',platform,'preference, switch, artwork, pause/resume, shapes, transition, reduced motion');
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  await writeFile(path.join(output,'browser-results.json'),JSON.stringify({assets,results,errors,deviceTests:false},null,2));
}finally{
  if(socket?.readyState===1){await send('Browser.close').catch(()=>{});socket.close();}
  browser.kill();server.close();
}
