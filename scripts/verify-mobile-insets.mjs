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
const output = path.join(root, 'mobile', 'verification', 'system-bars');
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
const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-insets-'));
const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9391',
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
    try {target=(await (await fetch('http://127.0.0.1:9391/json/list')).json()).find(t=>t.type==='page');if(target)break;} catch {}
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
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const cases = [
    {name:'harmony-portrait',platform:'HarmonyOS',width:390,height:844,insets:{top:38,right:0,bottom:24,left:0}},
    {name:'android-portrait',platform:'Android',width:390,height:804,insets:{top:0,right:0,bottom:24,left:0}},
    {name:'harmony-landscape',platform:'HarmonyOS',width:844,height:390,insets:{top:24,right:0,bottom:24,left:38}},
    {name:'android-landscape',platform:'Android',width:844,height:360,insets:{top:0,right:0,bottom:24,left:38}}
  ];
  for (const sample of cases) {
    const {width,height,insets}=sample;
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url});
    for(let i=0;i<100;i++){if(await evaluate('typeof window.lumeUpdate === "function"'))break;await pause(50);}
    await evaluate(`lumeUpdate({platform:${JSON.stringify(sample.platform)},songs:[{id:'demo',title:'边界验证',artist:'LUME'}],id:'demo',title:'边界验证',duration:120,pos:8});lumeInsets(${JSON.stringify(insets)});`);
    await pause(250);
    let state=await geometry();
    assert.equal(state.body.height,height, sample.name+' full background height');
    assert(state.header.y>=insets.top, sample.name+' header clears status bar');
    assert(state.header.x>=insets.left, sample.name+' header clears cutout');
    assert(state.dock.bottom<=height-insets.bottom+1,sample.name+' dock clears navigation');
    await evaluate('openPlayer()');await pause(200);
    state=await geometry();
    assert.equal(state.full.y,0);assert.equal(state.full.height,height);
    assert(state.close.y>=insets.top,sample.name+' player header clears status bar');
    if(width<height){
      assert(state.playback.bottom<=height-insets.bottom-16,sample.name+' player buttons leave space above gestures');
      assert(state.playback.bottom>=height-insets.bottom-50,sample.name+' player buttons sit toward the bottom');
    }
    await writeFile(path.join(output,sample.name+'-player.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate(`document.getElementById('play-order').click()`);
    assert.deepEqual((await geometry()).calls.at(-1),{type:'shuffle',value:true});
    assert.equal(await evaluate(`document.getElementById('play-order').getAttribute('aria-pressed')`),'false','mode waits for real native state');
    await evaluate('lumeUpdate({shuffle:true})');
    assert.equal(await evaluate(`document.getElementById('play-order').getAttribute('aria-pressed')`),'true');
    await evaluate(`document.getElementById('play-order').click()`);
    assert.deepEqual((await geometry()).calls.at(-1),{type:'shuffle',value:false});
    await evaluate('lumeUpdate({shuffle:false})');
    await evaluate('lumeUpdate({shuffleAvailable:false})');
    assert.equal(await evaluate(`document.getElementById('play-order').disabled`),true,'old host without mode state is not misrepresented');
    await evaluate('lumeUpdate({shuffleAvailable:true})');
    assert.equal(await evaluate(`document.getElementById('output').textContent.trim()`),'','output has no extra visible explanation');
    await evaluate(`renderLyrics('[00:00.00]此刻的光\\n[00:08.00]铺满整个屏幕\\n[00:18.00]让文字留在安全区域');showLyrics=true;syncLyricView();`);
    await pause(100);state=await geometry();
    assert(state.playback.bottom<=height-insets.bottom+1,sample.name+' lyrics controls clear navigation');
    assert(state.close.y>=insets.top,sample.name+' lyrics header clears status bar');
    await writeFile(path.join(output,sample.name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate('player(false)');await pause(150);
    await evaluate(`document.documentElement.dataset.phoneTheme='light'`);await pause(100);
    assert.equal((await geometry()).calls.filter(c=>c.type==='systemBarAppearance').at(-1)?.dark,true,'light theme uses dark system icons');
    await evaluate('lumeInsets({top:0,right:0,bottom:0,left:0})');
    state=await geometry();assert.equal(state.safe,'0px','cleared native insets do not persist');
    await evaluate(`navigate('space');lumeUpdate({creating:true,hosting:false,hostError:''})`);
    assert.equal(await evaluate(`document.getElementById('create-room').disabled`),true);
    assert.match(await evaluate(`document.getElementById('host-state').textContent`),/正在创建/);
    await evaluate(`lumeUpdate({creating:false,hosting:true,address:'192.168.0.2:46321',hostPin:'123456'})`);
    assert.match(await evaluate(`document.getElementById('host-state').textContent`),/空间已创建/);
    await evaluate(`lumeUpdate({status:'正在搜索…'})`);
    assert.match(await evaluate(`document.getElementById('host-state').textContent`),/空间已创建/,'host confirmation survives unrelated status updates');
    await evaluate(`lumeUpdate({hosting:false,hostError:'创建空间失败，请稍后重试'})`);
    assert.equal(await evaluate(`document.getElementById('host-state').hidden`),false);
    assert.match(await evaluate(`document.getElementById('host-state').textContent`),/创建空间失败/);
    results.push({case:sample.name,passed:true});
    console.log('PASS',sample.name);
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  await writeFile(path.join(output,'browser-results.json'),JSON.stringify({results,errors},null,2));
} finally {
  if(socket?.readyState===1){await send('Browser.close').catch(()=>{});socket.close();}
  browser.kill();server.close();
}
