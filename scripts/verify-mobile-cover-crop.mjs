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
const output=path.resolve(process.argv[3] || path.join(root,'artifacts/round-cover-crop-20261121/visual'));
const platforms=process.argv[4]?[process.argv[4]]:['Android','HarmonyOS'];
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
  '--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=9498',
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
    try{target=(await(await fetch('http://127.0.0.1:9498/json/list')).json()).find(t=>t.type==='page');if(target)break;}catch{}
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
  for(const platform of platforms){
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await load(platform); await setting(true); await open();
    const fixtures=[
      {name:'square',w:400,h:400,pad:0},
      {name:'wide',w:800,h:400,pad:0},
      {name:'tall',w:400,h:800,pad:0},
      {name:'white-frame',w:500,h:500,pad:75,bg:'white'},
      {name:'transparent-frame',w:500,h:500,pad:75,bg:'none'},
      {name:'wide-frame',w:800,h:400,pad:50,bg:'white'},
      {name:'tall-frame',w:400,h:800,pad:50,bg:'white'},
    ];
    for(const [width,height] of [[390,844],[844,390]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true}); await pause(200);
      for(const fixture of fixtures){
        const {name,w,h,pad,bg='none'}=fixture;
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/><rect x="${pad}" y="${pad}" width="${w-pad*2}" height="${h-pad*2}" fill="#00e050"/><circle cx="${w/2}" cy="${h/2}" r="25" fill="#2040ee"/></svg>`;
        const uri='data:image/svg+xml,'+encodeURIComponent(svg);
        await evaluate(`paintDetails($('album'),{cover:${JSON.stringify(uri)},lyrics:''});$('mini-art').style.backgroundImage=$('album').style.backgroundImage`);
        await pause(160);
        const data=await evaluate(`(()=>{const a=$('album'),r=a.getBoundingClientRect(),c=getComputedStyle(a),p=getComputedStyle(a,'::before');return {x:r.x,y:r.y,width:r.width,height:r.height,radius:c.borderRadius,clip:c.clipPath,size:p.backgroundSize,position:p.backgroundPosition,image:c.backgroundImage,crop:a.style.getPropertyValue('--round-cover-size')}})()`);
        assert.equal(data.radius,'50%'); assert.match(data.clip,/circle/);
        assert(Math.abs(data.width-data.height)<.1,'square layout bounds');
        assert.equal(!!data.crop,pad>0,'only the padded fixture needs a content crop');
        // Freeze the real CSS rotor at multiple angles, including diagonal edges.
        for(const angle of [0,45,123]){
          await evaluate(`$('album').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=${angle/360*24000}})`);
          const file=`${platform}-${width}-${name}-${angle}`;
          await screenshot(file);
          results.push({platform,width,height,fixture:name,angle,file:file+'.png',album:data});
        }
        // The same raw asset remains available to rectangular playback mode.
        await evaluate(`document.documentElement.removeAttribute('data-round-cover')`);
        const normal=await evaluate(`({radius:getComputedStyle($('album')).borderRadius,clip:getComputedStyle($('album')).clipPath,size:getComputedStyle($('album')).backgroundSize,image:getComputedStyle($('album')).backgroundImage})`);
        assert.notEqual(normal.radius,'50%'); assert.equal(normal.clip,'none');
        assert.equal(normal.size,'cover'); assert.equal(normal.image,data.image);
        if(name==='white-frame')await screenshot(`${platform}-${width}-rectangular-frame`);
        await evaluate(`document.documentElement.setAttribute('data-round-cover','')`);
      }
    }
    // A song replacement must discard the previous song's framing immediately.
    await evaluate(`bindArt($('album'),state.songs[0])`); await pause(150);
    assert.equal(await evaluate(`$('album').style.getPropertyValue('--round-cover-size')`),'');
    await evaluate('lumeUpdate({playing:true})'); const first=await turn(); await pause(100);
    assert.notEqual(await turn(),first);
    await evaluate('lumeUpdate({playing:false})'); await pause(30); const stopped=await turn(); await pause(100);
    assert.equal(await turn(),stopped);
    await close();
    await evaluate('navigate("home");preparePlayerMotion()');
    const transition=await evaluate(`(()=>{const out=[];for(const p of [0,.5,1]){playerMotion.seek(p);const e=document.querySelector('.travelling-cover'),c=getComputedStyle(e);out.push({p,clip:c.clipPath,radius:c.borderRadius});}return out})()`);
    assert.match(transition[2].clip,/50%/);
    await open();
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await turn(),'none');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await close(); console.log('PASS',platform,'all ratios, white/transparent frames, rotation, rectangular mode, transition');
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  await writeFile(path.join(output,'browser-results.json'),JSON.stringify({assets,results,errors,deviceTests:false},null,2));
}finally{
  if(socket?.readyState===1){await send('Browser.close').catch(()=>{});socket.close();}
  browser.kill();server.close();
}
