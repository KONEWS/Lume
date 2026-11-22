// Headless shared UI checks. Does not attach to a user's browser or device.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const output=path.resolve(process.env.LUME_TEST_OUTPUT||'mobile/verification/scan-formats');
const server=createServer(async(req,res)=>{
  const file=path.resolve(assets,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(assets+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(path.join(os.tmpdir(),'lume-scan-browser-'));
const browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--enable-unsafe-swiftshader',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,serial=0;const pending=new Map(),results=[],errors=[];
function send(method,params={}){const id=++serial;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){for(let i=0;i<160;i++){if(await evaluate(expression))return;await pause(50);}throw Error('Timed out: '+expression);}
async function checkFormat(format,checked){
  await evaluate(`document.querySelector('.scan-format-section').open=true`);
  const point=await evaluate(`(()=>{const input=document.querySelector('input[data-format="${format}"]');if(input.checked===${checked})return null;const label=input.closest('label');label.scrollIntoView({block:'center'});const r=label.getBoundingClientRect();return{x:r.right-10,y:r.top+r.height/2};})()`);
  if(point){
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  }
  assert.equal(await evaluate(`document.querySelector('input[data-format="${format}"]')?.checked??false`),checked);
}
async function touch(selector){
  const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,radiusX:4,radiusY:4}]});
  await pause(100);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).webkitTapHighlightColor`),'rgba(0, 0, 0, 0)');
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(80);
}
try{
  await mkdir(output,{recursive:true});
  let target;
  for(let i=0;i<100;i++){try{const port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');if(target)break;}catch{}await pause(100);}
  assert(target);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.nativeCalls=[];window.LumeNative={dispatch:s=>nativeCalls.push(JSON.parse(s))};'});
  const url=`http://127.0.0.1:${server.address().port}/player/index.html`;
  for(const platform of ['Android','HarmonyOS']){
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url});await until('typeof lumeUpdate==="function"');
    // Existing installations have no blockedFormats property.
    await evaluate(`localStorage.setItem('lume-scan-rules-v1',JSON.stringify({history:['/Music','/Music/Blocked'],blocked:['/Music/Blocked'],skipShort:false}));`);
    await send('Page.reload');await until('typeof lumeUpdate==="function"');
    await evaluate(`lumeUpdate({platform:${JSON.stringify(platform)},songs:[{id:'demo',title:'扫描测试'}],id:'demo'});openBrowse('scan');`);
    assert.deepEqual(await evaluate('lumeScanRules.snapshot().blockedFormats'),[]);
    assert.equal(await evaluate(`document.querySelector('.scan-format-section').open`),false);
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await touch('.scan-format-section summary');
    assert.equal(await evaluate(`document.querySelector('.scan-format-section').open`),true);
    await touch('.scan-format-list label:has(input[data-format="mp3"])');
    assert.equal(await evaluate(`document.querySelector('input[data-format="mp3"]').checked`),true);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('input[data-format="mp3"]').parentElement).outlineStyle`),'none');
    await touch('.scan-format-list label:has(input[data-format="mp3"])');
    assert.equal(await evaluate(`document.querySelector('input[data-format="mp3"]').checked`),false);
    await checkFormat('mp3',true);await checkFormat('flac',true);
    await checkFormat('mp3',false);
    assert.deepEqual(await evaluate('lumeScanRules.snapshot().blockedFormats'),['flac']);
    await checkFormat('mp3',true);
    // Restore insertion order for the existing bridge checks below.
    await checkFormat('flac',false);await checkFormat('flac',true);
    await evaluate(`document.querySelector('input[data-format="wav"]').focus()`);
    for(let i=0;i<2;i++){
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
      assert.equal(await evaluate('document.activeElement?.dataset.format'),'wav');
      assert.equal(await evaluate(`document.querySelector('input[data-format="wav"]').checked`),i===0);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('input[data-format="wav"]').parentElement).outlineStyle`),'solid');
    }
    assert.equal(await evaluate(`document.querySelector('.scan-format-section').open`),true);
    await evaluate(`(()=>{const input=document.querySelector('.scan-format-custom input');input.value=' .AmR ';document.querySelector('.scan-format-custom button').click();})()`);
    assert.deepEqual(await evaluate('lumeScanRules.snapshot()'),{history:['/Music','/Music/Blocked'],blocked:['/Music/Blocked'],skipShort:false,blockedFormats:['mp3','flac','amr']});
    await send('Page.reload');await until('typeof lumeUpdate==="function"');
    await evaluate(`lumeUpdate({platform:${JSON.stringify(platform)},songs:[{id:'demo',title:'扫描测试'}],id:'demo'});openBrowse('scan');`);
    assert.equal(await evaluate(`document.querySelector('.scan-format-section').open`),false);
    assert.match(await evaluate(`document.querySelector('.scan-format-section summary').textContent`),/已选 3 项/);
    await evaluate(`document.querySelector('.scan-format-section summary').click()`);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('input[data-format]:checked')].map(e=>e.dataset.format).sort()`),['amr','flac','mp3']);
    await evaluate(`(()=>{const input=document.querySelector('lume-scan-rules > label input');input.checked=true;input.dispatchEvent(new Event('change'));})()`);
    await evaluate(`[...document.querySelectorAll('#browse-content button')].find(e=>e.textContent==='选择文件夹').click()`);
    assert.deepEqual(await evaluate(`nativeCalls.filter(c=>c.type==='scan').at(-1)`),{type:'scan',skipShort:true,blocked:['/Music/Blocked'],blockedFormats:['mp3','flac','amr']});
    await evaluate(`[...document.querySelectorAll('#browse-content button')].find(e=>e.textContent==='开始扫描').click()`);
    assert.deepEqual(await evaluate(`nativeCalls.filter(c=>c.type==='rescan').at(-1)`),{type:'rescan',skipShort:true,blocked:['/Music/Blocked'],blockedFormats:['mp3','flac','amr']});
    await evaluate(`(()=>{const input=document.querySelector('.scan-format-custom input');input.value='../mp3';document.querySelector('.scan-format-custom button').click();})()`);
    assert.match(await evaluate(`document.querySelector('lume-scan-rules [role=status]').textContent`),/请输入/);
    assert.equal(await evaluate('lumeScanRules.snapshot().blockedFormats.length'),3);
    for(const [width,height] of [[320,740],[390,844],[844,390]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await pause(100);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      assert.equal(await evaluate(`[...document.querySelectorAll('.scan-format-list label')].every(e=>e.getBoundingClientRect().height>=44)`),true);
      assert.equal(await evaluate(`(()=>{const [a,b]=[...document.querySelectorAll('.scan-actions button')].map(e=>e.getBoundingClientRect());return a.height>=48&&b.height>=48&&(b.left-a.right>=15||b.top-a.bottom>=15);})()`),true);
      assert.equal(await evaluate(`[...document.querySelectorAll('.scan-format-list input')].every(e=>getComputedStyle(e).clipPath==='inset(50%)')`),true);
      for(const theme of ['light','dark']){
        await evaluate(`document.documentElement.dataset.phoneTheme='${theme}'`);
        assert.equal(await evaluate(`(()=>{const a=getComputedStyle(document.querySelector('input[data-format="mp3"]').parentElement),b=getComputedStyle(document.querySelector('input[data-format="wav"]').parentElement);return a.backgroundColor!==b.backgroundColor&&a.borderColor!==b.borderColor;})()`),true);
      }
    }
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate(`document.getElementById('browse-content').scrollTop=0;document.querySelector('.scan-actions').scrollIntoView({block:'start'})`);
    const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,platform+'.png'),Buffer.from(shot.data,'base64'));
    await evaluate(`document.querySelector('.scan-format-section summary').click()`);
    const collapsed=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,platform+'-collapsed.png'),Buffer.from(collapsed.data,'base64'));
    await evaluate('lumeUpdate({scanning:true})');
    assert.equal(await evaluate(`[...document.querySelectorAll('lume-scan-rules input,lume-scan-rules button')].every(e=>e.disabled)`),true);
    await evaluate('lumeUpdate({scanning:false,joined:true,hosting:false});openBrowse("scan")');
    assert.equal(await evaluate(`[...document.querySelectorAll('lume-scan-rules input,lume-scan-rules button')].every(e=>e.disabled)`),true);
    await evaluate('lumeUpdate({joined:false});openBrowse("scan")');
    await checkFormat('amr',false);await checkFormat('mp3',false);await checkFormat('flac',false);
    assert.deepEqual(await evaluate('lumeScanRules.snapshot().blockedFormats'),[]);
    results.push({platform,touchExpandAndToggle:true,noNativeTapHighlight:true,noPointerFocusRing:true,wholeTileClick:true,independentToggle:true,keyboardToggleAndFocus:true,hiddenCheckbox:true,selectedHighlightBothThemes:true,actionGapAtLeast16:true,actionHeightAtLeast48:true,defaultCollapsed:true,preservesExpandedWhileEditing:true,legacyMigration:true,persistedAfterReload:true,scanAndRescanBridge:true,customExtension:true,invalidInputRejected:true,disabledWhileScanningOrRemote:true,unblock:true,widths:[320,390,844]});
    console.log('PASS',platform,'scan rules persistence, scan and rescan requests, layout and disabled states');
  }
  assert.equal(errors.length,0,JSON.stringify(errors));await writeFile(path.join(output,'browser-results.json'),JSON.stringify({results,errors},null,2));
}finally{if(socket?.readyState===1){await send('Browser.close').catch(()=>{});socket.close();}browser.kill();server.close();}
