// Browser geometry checks for the shared Android/HarmonyOS page. Native device
// checks remain necessary: Chromium cannot emulate the system compositor.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile, mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'mobile', 'verification', 'fullscreen-session');
await mkdir(output, {recursive:true});
const assets = path.join(root, 'mobile', 'player-assets');
const server = createServer(async (req, res) => {
  const file = path.resolve(assets, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(assets + path.sep)) {res.writeHead(403).end(); return;}
  try {
    const mime = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'};
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/player/index.html`;
const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-fullscreen-'));
const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9394',
  '--enable-unsafe-swiftshader', `--user-data-dir=${profile}`, 'about:blank'
], {windowsHide:true, stdio:'ignore'});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, nextId = 0;
const pending = new Map(), errors = [], results = [];
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {pending.set(id, {resolve,reject});socket.send(JSON.stringify({id,method,params}));});
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.result.description);
  return result.result.value;
}
async function geometry() {
  return evaluate(`(() => {
    const rect = sel => {const e=document.querySelector(sel), r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    return {width:innerWidth,height:innerHeight,body:rect('body'),header:rect('#open-menu'),dock:rect('#dock-tabs'),
      full:rect('#full'),close:rect('#full [data-action=close]'),playback:rect('#full .transport'),
      content:rect('#full .full-content'), safe:getComputedStyle(document.documentElement).getPropertyValue('--lume-safe-bottom'), calls:window.nativeCalls};
  })()`);
}
try {
  let target;
  for (let i=0; i<100; i++) {
    try {target=(await (await fetch('http://127.0.0.1:9394/json/list')).json()).find(t=>t.type==='page');if(target)break;} catch {}
    await pause(100);
  }
  assert(target, 'Chromium debugging endpoint available');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, {once:true}));
  socket.addEventListener('message', ({data}) => {
    const message=JSON.parse(data);
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(message.error):p.resolve(message.result);}
    else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
  });
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {source:`window.nativeCalls=[];window.LumeNative={dispatch:s=>nativeCalls.push(JSON.parse(s))};`});
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});

  const fullscreenCalls=()=>evaluate(`nativeCalls.filter(c=>c.type==='playerSession'||c.type==='styleFullscreen')`);
  const cover={type:'playerSession',enabled:true,lyrics:false};
  const lyrics={type:'playerSession',enabled:true,lyrics:true};
  const closed={type:'playerSession',enabled:false,lyrics:false};
  async function rotate(width,height){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await pause(220);
  }
  async function settled(){await pause(650);}
  for(const platform of ['Android','HarmonyOS']){
    await rotate(844,390);
    await send('Page.navigate',{url});
    for(let i=0;i<100;i++){if(await evaluate('typeof window.lumeUpdate === "function"'))break;await pause(50);}
    await evaluate(`lumeUpdate({platform:'${platform}',songs:[{id:'demo',title:'Fullscreen session',artist:'LUME'}],id:'demo',title:'Fullscreen session',duration:120,pos:8});
      renderLyrics('[00:00.00]Session start\\n[00:08.00]No bar transition\\n[00:18.00]Return to ordinary lyrics');`);
    await evaluate('openPlayer()');await settled();
    assert.deepEqual(await fullscreenCalls(),[cover],platform+' opens on the cover');
    await evaluate(`$('landscape-lyrics').click()`);await settled();
    assert.equal(await evaluate(`showLyrics&&!moreLyrics&&!$('album').hidden&&!$('lyrics-panel').hidden`),true);
    const initial=await geometry();
    await evaluate(`window.sessionFrames=[];window.sampleSession=true;
      function sample(){if(!sampleSession)return;const r=$('full').getBoundingClientRect();
        sessionFrames.push({t:performance.now(),w:innerWidth,h:innerHeight,x:r.x,y:r.y,more:moreLyrics,slide:document.documentElement.dataset.moreSlide||'',fullscreen:playerSessionActive});requestAnimationFrame(sample)};sample();`);
    await evaluate(`$('more-lyrics').click()`);await settled();
    assert.equal(await evaluate('moreLyrics'),true);
    await evaluate('backFromPlayer()');await settled();
    await evaluate('swipeLyricPage(-160)');await settled();
    assert.deepEqual(await fullscreenCalls(),[cover,lyrics],platform+' Folia taps/swipes/back never change window');
    // Opening/cancelling settings must also leave the session intact.
    await evaluate(`$('style-settings').click();lumeBack()`);await settled();
    await evaluate('swipeLyricPage(160)');await settled();
    await evaluate(`$('style-settings').click();lumeBack()`);await settled();
    assert.deepEqual(await fullscreenCalls(),[cover,lyrics]);
    await evaluate('window.sampleSession=false');
    const frames=await evaluate('sessionFrames');
    assert(frames.some(f=>f.slide==='enter')&&frames.some(f=>f.slide==='return'),'horizontal View Transition remains active');
    assert(frames.every(f=>f.fullscreen&&f.w===initial.width&&f.h===initial.height),'viewport remains stable for every sampled transition frame');
    await rotate(390,844);
    assert.deepEqual(await fullscreenCalls(),[cover,lyrics],'rotation retains the lyrics session');
    assert.equal(await evaluate('moreLyrics'),false);
    await evaluate('lumeBack()');await settled();
    assert.deepEqual((await fullscreenCalls()).at(-1),cover,'back to portrait cover restores bars');
    await evaluate(`$('album').click()`);await settled();
    assert.deepEqual((await fullscreenCalls()).at(-1),lyrics,'portrait lyrics request fullscreen');
    await evaluate('swipeLyricPage(160)');await settled();
    await evaluate('swipeLyricPage(-160)');await settled();
    assert.deepEqual((await fullscreenCalls()).slice(-2),[cover,lyrics],'portrait swipes update the window');
    await rotate(844,390);await settled();
    assert.equal(await evaluate(`showLyrics&&!moreLyrics&&!$('album').hidden`),true,'rotation starts with ordinary split view');
    await evaluate('player(false)');await settled();
    const expected=[cover,lyrics,cover,lyrics,cover,lyrics,closed];
    assert.deepEqual(await fullscreenCalls(),expected,'closing from lyrics ends the session');
    // A preview must not change native bars, even if it returns to the dock.
    await evaluate('preparePlayerMotion()');
    assert.deepEqual(await fullscreenCalls(),expected);
    await evaluate('player(false)');await settled();
    assert.deepEqual(await fullscreenCalls(),expected);
    // Rotate while Folia snapshots are still sliding: no stale completion re-hides bars.
    await evaluate('openPlayer()');await settled();
    await evaluate('setLyrics(true,true)');await rotate(390,844);await pause(2500);
    assert.deepEqual((await fullscreenCalls()).at(-1),lyrics);
    await writeFile(path.join(output,platform.toLowerCase()+'-browser-frames.json'),JSON.stringify(frames));
    results.push({platform,frames:frames.length,calls:await fullscreenCalls(),passed:true});
    console.log('PASS',platform,frames.length,'transition frames');
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  await writeFile(path.join(output,'browser-results.json'),JSON.stringify({results,errors},null,2));
} finally {
  if(socket?.readyState===1){await send('Browser.close').catch(()=>{});socket.close();}
  browser.kill();server.close();
}
