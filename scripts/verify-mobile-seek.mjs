// Headless shared-player interaction checks; no desktop or connected phone input.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root=process.cwd(), assets=path.join(root,'mobile/player-assets');
const output=path.join(root,'mobile/verification/system-bars');
const server=createServer(async(req,res)=>{
  const file=path.resolve(assets,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(assets+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(path.join(os.tmpdir(),'lume-seek-'));
const browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=9393','--enable-unsafe-swiftshader',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,serial=0;const pending=new Map(),results=[],errors=[];
function send(method,params={}){const id=++serial;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.result.description);return r.result.value;}
async function geometry(){return evaluate(`(()=>{const input=$('seek'),rail=input.parentElement,r=rail.getBoundingClientRect(),knob=$('seek-lens').getBoundingClientRect(),css=getComputedStyle(rail);return {left:r.left,right:r.right,y:r.top+r.height/2,height:r.height,value:+input.value,knob:(knob.left+knob.right)/2,progress:parseFloat(css.getPropertyValue('--seek-progress')),transition:getComputedStyle($('seek-lens')).transitionDuration,tracking:input.hasAttribute('data-tracking'),calls:nativeCalls.filter(c=>c.type==='seek')}})()`);}
function aligned(g){const expected=g.left+7+(g.right-g.left-14)*g.value/1000;assert(Math.abs(g.knob-expected)<.1,`thumb ${g.knob} follows ${expected}`);assert(Math.abs(g.progress-g.value/10)<.001,'fill and thumb share one fraction');assert.equal(g.transition,'0s','no delayed thumb position');assert(g.height>=44,'touch target retained');}
try{
  let target;for(let i=0;i<100;i++){try{target=(await(await fetch('http://127.0.0.1:9393/json/list')).json()).find(t=>t.type==='page');if(target)break;}catch{}await pause(100);}
  assert(target);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.nativeCalls=[];window.LumeNative={dispatch:s=>nativeCalls.push(JSON.parse(s))};`});
  for(const platform of ['Android','HarmonyOS']){
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/player/index.html`});
    for(let i=0;i<100;i++){if(await evaluate('typeof window.lumeUpdate==="function"'))break;await pause(50);}
    await evaluate(`lumeUpdate({platform:${JSON.stringify(platform)},songs:[{id:'demo',title:'Seek test'}],id:'demo',title:'Seek test',duration:120,pos:30});lumeInsets({top:${platform==='Android'?0:38},left:0,right:0,bottom:24});openPlayer();`);
    await pause(650);
    let g=await geometry();aligned(g);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:g.left+7,y:g.y,button:'left',clickCount:1});
    for(const fraction of [.05,.94,.18,1,0,.73]){
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:g.left+7+(g.right-g.left-14)*fraction,y:g.y,button:'left',buttons:1});
      const now=await geometry();aligned(now);assert(Math.abs(now.value-fraction*1000)<=1);
    }
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:g.left+7+(g.right-g.left-14)*.73,y:g.y,button:'left',clickCount:1});
    g=await geometry();aligned(g);assert.equal(g.calls.length,1,'release commits once');assert(Math.abs(g.calls[0].seconds-87.6)<.01);
    await evaluate('lumeUpdate({pos:30})');g=await geometry();assert.equal(g.value,730,'stale native poll does not pull seek back');
    await evaluate('lumeUpdate({pos:87.6})');g=await geometry();assert.equal(g.value,730,'native acknowledgement retains target');
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:g.left+7,y:g.y}]});
    await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:g.right-7,y:g.y}]});
    aligned(await geometry());
    await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    g=await geometry();assert.equal(g.calls.length,1,'touch cancellation sends no seek');assert.equal(g.tracking,false);assert.equal(g.value,730);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:g.left+7,y:g.y}]});
    await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:g.left+(g.right-g.left)*.5,y:g.y}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    g=await geometry();aligned(g);assert.equal(g.calls.length,2,'touch release commits once');assert(Math.abs(g.calls[1].seconds-60)<.2);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:g.right-7,y:g.y}]});
    await evaluate(`lumeUpdate({songs:[{id:'demo-2',title:'Other song'}],id:'demo-2',title:'Other song',duration:90,pos:0})`);
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    g=await geometry();assert.equal(g.calls.length,2,'changing songs cancels old-song seek');assert.equal(g.value,0);
    results.push({platform,rapidDrag:true,touch:true,cancel:true,nativeAck:true,trackChange:true});console.log('PASS',platform,'seek drag/touch/cancel/ack/track change');
  }
  assert.equal(errors.length,0,JSON.stringify(errors));await mkdir(output,{recursive:true});await writeFile(path.join(output,'seek-results.json'),JSON.stringify({results,errors},null,2));
}finally{if(socket?.readyState===1){await send('Browser.close').catch(()=>{});socket.close();}browser.kill();server.close();}
