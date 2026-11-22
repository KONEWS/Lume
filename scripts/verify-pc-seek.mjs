import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'release','PC-UI-Fix','verification');
await mkdir(output,{recursive:true});
const harness=`import React from 'react';import{createRoot}from'react-dom/client';
import{PlaybackProgress}from'/src/PlaybackSeek.tsx';
import'/src/styles.css';import'/src/appearance/liquid-desktop.css';import'/src/appearance/playback-home.css';
let position=12;const listeners=new Set();window.commits=[];window.seekDelay=450;
window.setClock=value=>{position=value;listeners.forEach(listener=>listener());};
window.startClock=()=>{clearInterval(window.clockTimer);let n=0;window.clockTimer=setInterval(()=>window.setClock(12+(n++%20)/100),8);};
const clock={getSnapshot:()=>position,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
const format=value=>value.toFixed(1)+' s';
createRoot(document.getElementById('root')).render(React.createElement(PlaybackProgress,{clock,duration:120,format,
seek:value=>{window.commits.push(value);setTimeout(()=>{clearInterval(window.clockTimer);window.setClock(value);},window.seekDelay);}}));`;
const server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0,open:false},plugins:[{
  name:'pc-seek-verification',
  resolveId(id){if(id==='/__pc-seek-harness.js')return '\0pc-seek-harness.js';},
  load(id){if(id==='\0pc-seek-harness.js')return harness;},
  configureServer(vite){vite.middlewares.use('/__pc-seek-check',(_req,res)=>{
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="UTF-8"><style>body{margin:0;background:#202330!important;--accent:#fa725f;--studio-line:#596078;--studio-surface:#fff}#root{width:800px;padding:120px 50px}.playback-progress{height:40px!important}</style></head><body><div id="root" class="wide-player"></div><script type="module" src="/__pc-seek-harness.js"></script></body></html>');
  });}
}]});
await server.listen();
const profile=await mkdtemp(path.join(os.tmpdir(),'lume-pc-seek-'));
const browser=spawn(process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
  '--window-size=1000,400',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,nextId=0;
const pending=new Map(),errors=[];
function send(method,params={}){const id=++nextId;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.result.description);return result.result.value;}
const snapshot=`(()=>{const input=document.querySelector('input'),rail=input.closest('label'),thumb=rail.querySelector('i');const bounds=input.getBoundingClientRect(),point=thumb.getBoundingClientRect();const style=getComputedStyle(rail);return {value:input.valueAsNumber,progress:style.getPropertyValue('--progress'),offset:style.getPropertyValue('--thumb-offset'),thumb:point.x+point.width/2-bounds.x,expected:7+(bounds.width-14)*input.valueAsNumber/120,preview:document.querySelector('.playback-progress>span').textContent,tracking:input.hasAttribute('data-tracking'),pending:input.hasAttribute('data-pending-seek'),commits:[...window.commits],transition:getComputedStyle(thumb).transitionProperty};})()`;
function aligned(state){assert.ok(Math.abs(state.thumb-state.expected)<.05,JSON.stringify(state));assert.equal(state.preview,state.value.toFixed(1)+' s');assert.equal(state.transition.includes('left'),false);}
try {
  let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await pause(50);}
  assert.ok(port,'Headless Chromium started');
  const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  socket.addEventListener('message',({data})=>{const message=JSON.parse(data);if(message.id){const task=pending.get(message.id);pending.delete(message.id);message.error?task.reject(message.error):task.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);});
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/__pc-seek-check`});
  for(let i=0;i<100;i++){if(await evaluate('!!document.querySelector("input")'))break;await pause(50);}
  assert.ok(await evaluate('!!document.querySelector("input")'),'React seek harness loaded');
  const bounds=await evaluate('(()=>{const r=document.querySelector("input").getBoundingClientRect();return{x:r.x,y:r.y+r.height/2,width:r.width};})()');
  const x=fraction=>bounds.x+7+(bounds.width-14)*fraction;
  await evaluate('window.startClock()');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x(.2),y:bounds.y,button:'left',buttons:1,clickCount:1});
  const rapid=await evaluate(`(()=>{const input=document.querySelector('input');return [.95,.05,.86,.12,.77,.23,.98,.02,.66].map(fraction=>{input.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,isPrimary:true,clientX:${bounds.x}+7+(${bounds.width}-14)*fraction,clientY:${bounds.y},buttons:1}));return ${snapshot};});})()`);
  rapid.forEach(aligned);
  const actual=[];
  for(const fraction of [.9,.1,.8,.2,.7,.3,.64]){
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x(fraction),y:bounds.y,button:'left',buttons:1});
    const state=await evaluate(snapshot);aligned(state);actual.push(state);
  }
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x(.64),y:bounds.y,button:'left',buttons:0,clickCount:1});
  const released=await evaluate(snapshot);aligned(released);assert.deepEqual(released.commits,[76.8]);assert.equal(released.tracking,false);assert.equal(released.pending,true);
  await pause(120);const awaitingAck=await evaluate(snapshot);aligned(awaitingAck);assert.equal(awaitingAck.value,76.8);
  await pause(420);const acknowledged=await evaluate(snapshot);aligned(acknowledged);assert.equal(acknowledged.value,76.8);assert.equal(acknowledged.pending,false);
  const screenshot=await send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(output,'pc-seek-headless.png'),Buffer.from(screenshot.data,'base64'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});
  const keyboard=await evaluate(snapshot);aligned(keyboard);assert.equal(keyboard.value,120);assert.deepEqual(keyboard.commits,[76.8,120]);
  await pause(500);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x(.15),y:bounds.y,button:'left',buttons:1,clickCount:1});
  await evaluate('document.querySelector("input").dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:1,isPrimary:true}))');
  const cancelled=await evaluate(snapshot);aligned(cancelled);assert.equal(cancelled.value,120);assert.equal(cancelled.commits.length,2);
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x(.15),y:bounds.y,button:'left',buttons:0});
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'pc-seek-verification.json'),JSON.stringify({rapid,actual,released,awaitingAck,acknowledged,keyboard,cancelled,errors},null,2));
  console.log(JSON.stringify({passed:true,rapidMoves:rapid.length,realMoves:actual.length,releaseTarget:released.value,output}));
} finally {
  socket?.close();browser.kill();await server.close();
  assert.equal(path.dirname(path.resolve(profile)),path.resolve(os.tmpdir()));assert.ok(path.basename(profile).startsWith('lume-pc-seek-'));
  await pause(300);await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
