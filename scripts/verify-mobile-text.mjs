// Headless shared-player interaction checks; no desktop or connected phone input.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root=process.cwd(), assets=path.resolve(process.argv[2]||path.join(root,'mobile/player-assets'));
const output=path.resolve(process.argv[3]||path.join(root,'mobile/verification/text-interactions'));
const server=createServer(async(req,res)=>{
  const file=path.resolve(assets,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(assets+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(path.join(os.tmpdir(),'lume-text-'));
const browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=9407','--enable-unsafe-swiftshader',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,serial=0;const pending=new Map(),results=[],errors=[];
function send(method,params={}){const id=++serial;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.result.description);return r.result.value;}
async function until(expression) {for(let i=0;i<160;i++){if(await evaluate(expression))return;await pause(50);}throw Error('Timed out: '+expression);}
async function selectionPolicy(doc='document') {
  return evaluate(`(() => {const d=${doc};return [...d.querySelectorAll('*')].filter(e=>!e.matches('input[type="search"]')&&d.defaultView.getComputedStyle(e).userSelect!=='none').map(e=>e.tagName+'#'+e.id);})()`);
}
async function screenshot(name){const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,name+'.png'),Buffer.from(r.data,'base64'));}
const title='这是一首很长很长的歌曲名字，包含中文、English Words and aVeryLongUnbrokenSongTitle'.repeat(3);
try {
  await mkdir(output,{recursive:true});
  let target;for(let i=0;i<100;i++){try{target=(await(await fetch('http://127.0.0.1:9407/json/list')).json()).find(t=>t.type==='page');if(target)break;}catch{}await pause(100);}
  assert(target);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.nativeCalls=[];window.LumeNative={dispatch:s=>nativeCalls.push(JSON.parse(s))};`});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  for(const platform of ['Android','HarmonyOS']) {
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/player/index.html`});
    await until('typeof lumeUpdate==="function"');
    await evaluate(`lumeUpdate({platform:${JSON.stringify(platform)},songs:[{id:'demo',title:${JSON.stringify(title)},artist:'测试艺人',album:'测试专辑'},{id:'demo-moon',title:'短歌名',artist:'测试艺人'}],id:'demo',title:${JSON.stringify(title)},duration:120,pos:8});navigate('library');`);
    const sizes=[];
    for(const [width,height] of [[320,740],[390,844],[844,390]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await pause(250);
      const list=await evaluate(`(()=>{const rows=[...$('library-list').children];return rows.map(row=>{const e=row.querySelector('strong'),s=getComputedStyle(e),r=e.getBoundingClientRect(),small=row.querySelector('small').getBoundingClientRect(),box=row.getBoundingClientRect();return {height:r.height,lineHeight:parseFloat(s.lineHeight),clamp:s.webkitLineClamp,whiteSpace:s.whiteSpace,overflow:s.overflow,rowHeight:box.height,artistBottom:small.bottom,rowBottom:box.bottom,scrollHeight:e.scrollHeight,animation:row.getAnimations({subtree:true}).length,customTitles:row.querySelectorAll('lume-song-title').length};})})()`);
      assert.equal(list[0].clamp,'2');assert.equal(list[0].whiteSpace,'normal');assert.equal(list[0].overflow,'hidden');
      assert(Math.abs(list[0].height-2*list[0].lineHeight)<1);assert(list[0].scrollHeight>list[0].height);
      assert(Math.abs(list[1].height-list[1].lineHeight)<1);assert(list[0].rowHeight>list[1].rowHeight);
      assert(list.every(r=>r.customTitles===0&&r.animation===0&&r.artistBottom<r.rowBottom));
      assert.deepEqual(await selectionPolicy(),[]);sizes.push({width,height,list});await screenshot(platform+'-'+width+'-list');
    }
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(250);
    // Real touch long press must open the song menu without selecting or playing.
    const point=await evaluate(`(()=>{const r=$('library-list').querySelector('strong').getBoundingClientRect();return {x:r.x+20,y:r.y+10}})()`);
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await pause(650);
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(100);
    assert.equal(await evaluate(`$('song-actions').open`),true);assert.equal(await evaluate(`getSelection().toString()`),'');
    assert.equal(await evaluate(`nativeCalls.filter(c=>c.type==='select').length`),0);
    assert.deepEqual(await selectionPolicy(),[]);await screenshot(platform+'-long-press-menu');
    await evaluate(`$('song-actions').close()`);
    // Context menu cancellation must not swallow the row's app handler.
    assert.equal(await evaluate(`$('library-list').firstElementChild.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`),false);
    assert.equal(await evaluate(`$('song-actions').open`),true);await evaluate(`$('song-actions').close()`);
    // Search retains native selection/editing and its normal input filtering.
    await evaluate(`$('query').focus();$('query').value='测试搜索';$('query').setSelectionRange(0,2)`);await pause(100);
    assert.deepEqual(await evaluate(`[getComputedStyle($('query')).userSelect,$('query').selectionStart,$('query').selectionEnd,$('query').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))]`),['text',0,2,true]);
    await send('Input.insertText',{text:'短歌名'});
    assert.equal(await evaluate(`$('query').value`),'短歌名搜索');
    await evaluate(`$('query').value='短歌名';$('query').dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.equal(await evaluate(`$('library-list').children.length`),1);
    await evaluate(`$('query').value='';$('query').dispatchEvent(new Event('input',{bubbles:true}));$('query').blur();navigate('space');$('pair').hidden=false;$('host').focus();$('host').value='http://test';$('host').setSelectionRange(0,4)`);await pause(100);
    assert.equal(await evaluate(`$('host').selectionStart===$('host').selectionEnd`),true);
    await send('Input.insertText',{text:'X'});assert.equal(await evaluate(`$('host').value`),'httpX://test');
    // Current-playback titles alone keep their marquee, including after rotation.
    await evaluate(`$('host').blur();openPlayer()`);await pause(700);
    await until(`!!$('full').querySelector('lume-song-title[data-scrolling]')`);
    assert(await evaluate(`$('full').querySelector('lume-song-title').getAnimations({subtree:true}).length>0`));
    await evaluate(`renderLyrics('[00:00.00]不可选择的歌词\\n[00:08.00]第二行歌词');setLyrics(true)`);await pause(300);
    assert.deepEqual(await selectionPolicy(),[]);
    await evaluate(`const range=document.createRange();range.selectNodeContents($('lyrics-panel'));getSelection().addRange(range)`);await pause(100);
    assert.equal(await evaluate(`getSelection().toString()`),'');
    // Folia is a separate document; verify the actual rendered editor, not a stub.
    await evaluate(`LumeFolia.openSettings('classic',()=>{},{mobileLayout:true})`);
    await until(`Array.from(document.querySelectorAll('dialog iframe')).some(f=>f.contentDocument.querySelector('.st-window'))`);
    await pause(500);
    const iframe=`Array.from(document.querySelectorAll('dialog iframe')).find(f=>f.contentDocument.querySelector('.st-window')).contentDocument`;
    assert.deepEqual(await selectionPolicy(iframe),[]);
    await evaluate(`(${iframe}).querySelector('input[type="search"]').focus()`);await pause(100);
    await send('Input.insertText',{text:'歌词颜色'});await pause(100);
    await evaluate(`(${iframe}).querySelector('input[type="search"]').setSelectionRange(0,2)`);await pause(100);
    assert.deepEqual(await evaluate(`(()=>{const d=${iframe},input=d.querySelector('input[type="search"]');return [d.defaultView.getComputedStyle(input).userSelect,input.selectionStart,input.selectionEnd,input.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))]})()`),['text',0,2,true]);
    await evaluate(`(()=>{const d=${iframe},input=d.querySelector('input[type="search"]');input.setSelectionRange(0,0);input.blur();d.getSelection().removeAllRanges()})()`);
    assert.equal(await evaluate(`(${iframe}).body.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`),false);
    await evaluate(`(()=>{const d=${iframe};const range=d.createRange();range.selectNodeContents(d.body);d.getSelection().addRange(range)})()`);await pause(100);
    assert.equal(await evaluate(`(${iframe}).getSelection().toString()`),'');
    await screenshot(platform+'-folia-settings');await evaluate('LumeFolia.closeSettings();player(false);openBrowse("settings")');await pause(300);
    assert.deepEqual(await selectionPolicy(),[]);
    // Both queue and album-detail lists use the same two-line, non-animated rows.
    for(const page of ['queue','albums']) {
      await evaluate(`openBrowse('${page}'${page==='albums'?',"测试专辑"':''})`);
      assert.equal(await evaluate(`document.querySelectorAll('.song lume-song-title').length`),0);
    }
    results.push({platform,sizes,longPressMenu:true,searchSelectionAndEditing:true,nonSearchInputCaretEditing:true,foliaSettingsSelectionBlocked:true,playbackMarquee:true});
    console.log('PASS',platform,'two-line titles, touch menu, search exception, Folia policy');
  }
  assert.equal(errors.length,0,JSON.stringify(errors));await writeFile(path.join(output,'browser-results.json'),JSON.stringify({results,errors},null,2));
} finally {if(socket?.readyState===1){await send('Browser.close').catch(()=>{});socket.close();}browser.kill();server.close();}
