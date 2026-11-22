import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const contentTypes = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.otf':'font/otf','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const harness = `<!doctype html><html><body style="margin:0"><script>
window.commands=[];let fullscreen=false,shuffle=false;
window.reply=(type,data)=>document.querySelector('iframe').contentWindow.postMessage({channel:'lume-pc-lyrics',message:{type,data}},location.origin);
window.session={key:'test-song',sessionId:'lume-test',title:'很长的测试歌曲标题 / A long song title that must not overlap controls',artist:'测试歌手',cover:'',source:'澄音',sources:[],position:12,duration:120,rate:1,playing:false,hasTimeline:true,received:0,controls:{play:true,pause:true,toggle:true,previous:true,next:true}};
addEventListener('message',event=>{if(event.origin!==location.origin||event.data?.channel!=='lume-pc-lyrics')return;const {type,value}=event.data;commands.push({type,value});
if(type==='ready'){reply('preferences',{topmost:false,audioReactive:true,coverTheme:true,onlineEnabled:false,musicApps:[],autoDiscoverMusicApps:false,showMusicAppAddButton:false});reply('appearance',{acrylic:false,solid:false,highContrast:false,transparent:false});reply('windowState',{maximized:false,fullscreen});reply('playbackMode',{shuffle,repeat:'off'});reply('session',session);reply('lyrics',{key:session.key,title:session.title,artist:session.artist,content:'[00:00.00]第一句歌词\\n[00:10.00]第二句歌词\\n[00:20.00]第三句歌词',source:'澄音',cover:'',embedded:true,format:'lrc'});}
if(type==='fullscreen'||type==='exitFullscreen'){fullscreen=type==='exitFullscreen'?false:!fullscreen;reply('windowState',{maximized:false,fullscreen});}
if(type==='shuffle'){shuffle=value;reply('playbackMode',{shuffle,repeat:'off'});}
if(type==='querySystemFonts')reply('systemFonts',{requestId:value.requestId,families:['Arial','Microsoft YaHei','Segoe UI']});
if(type==='mediaControl')reply('transport',{requestId:value.requestId,success:true,message:''});
});</script><iframe title="LUME" src="/pc-lyrics/desktop.html" style="border:0;width:100vw;height:100vh"></iframe></body></html>`;
const server = createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(harness);return;}
  const name=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!name.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{const data=await readFile(name);res.setHeader('Content-Type',contentTypes[path.extname(name)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const failures=[];page.on('pageerror',e=>failures.push(e.message));
const missing=[];page.on('response',r=>{if(r.status()>=400)missing.push(r.url());});
try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  const frame=page.frameLocator('iframe');
  await frame.getByRole('button',{name:'显示译文',exact:true}).waitFor();
  await frame.getByRole('button',{name:'继续播放音乐',exact:true}).waitFor({state:'visible'});
  const bounds=await frame.locator('.track-caption,.topbar-mode-picker,.topbar-actions').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  assert(bounds[0].right<=bounds[1].left && bounds[1].right<=bounds[2].left,'toolbar columns overlap');
  await page.waitForTimeout(5500);
  assert.equal(await frame.locator('main').evaluate(el=>el.classList.contains('immersive')),false,'windowed controls hid');
  const translationBefore=await frame.getByRole('button',{name:'显示译文',exact:true}).getAttribute('aria-pressed');
  await frame.getByRole('button',{name:'显示译文',exact:true}).click();
  const translation=await frame.getByRole('button',{name:'显示译文',exact:true}).getAttribute('aria-pressed');
  assert.notEqual(translation,translationBefore);
  await frame.getByRole('button',{name:'顺序播放，切换为随机播放',exact:true}).click();
  await frame.getByRole('button',{name:'随机播放，切换为顺序播放',exact:true}).waitFor();
  await frame.locator('.audio-progress').click({position:{x:300,y:10}});
  assert(await page.evaluate(()=>commands.some(c=>c.type==='seek'&&c.value.position>0)),'seek not sent');
  await frame.getByRole('button',{name:'切换全屏',exact:true}).click();
  await page.mouse.move(720,480);
  await page.waitForTimeout(5500);
  assert.equal(await frame.locator('main').evaluate(el=>el.classList.contains('immersive')),true,'fullscreen idle did not hide');
  await page.mouse.move(721,481);
  await frame.getByRole('button',{name:'显示译文',exact:true}).waitFor({state:'visible'});
  await frame.getByRole('combobox',{name:'歌词样式',exact:true}).click();
  await page.waitForTimeout(5500);
  assert.equal(await frame.locator('main').evaluate(el=>el.classList.contains('immersive')),false,'open style menu hid');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  assert.equal(await frame.locator('main').evaluate(el=>el.classList.contains('native-fullscreen')),false,'Escape did not exit fullscreen');
  await page.waitForTimeout(5200);
  assert.equal(await frame.locator('main').evaluate(el=>el.classList.contains('immersive')),false,'controls hid after leaving fullscreen');
  await page.evaluate(()=>{session={...session,key:'plain-song'};reply('session',session);reply('lyrics',{key:session.key,title:session.title,artist:session.artist,content:'没有时间轴的第一句\n没有时间轴的第二句',source:'澄音',cover:'',embedded:true,format:'lrc'});});
  await frame.getByLabel('普通歌词',{exact:true}).waitFor();
  assert((await frame.getByLabel('普通歌词',{exact:true}).innerText()).includes('没有时间轴的第二句'));
  await page.setViewportSize({width:880,height:640});
  const small=await frame.locator('.desktop-topbar').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));
  assert(small.scroll<=small.width+1,'minimum window toolbar overflows');
  assert.equal(failures.length,0,'renderer errors: '+failures.join('; '));
  assert.equal(missing.length,0,'missing assets: '+missing.join('; '));
  console.log(JSON.stringify({passed:['toolbar geometry at 1440 and 880','windowed controls persistent','translation selected','shuffle command','seek command','fullscreen idle','pointer wake','menu stays visible','Escape restores windowed mode','plain lyrics fallback'],failures,missing},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
