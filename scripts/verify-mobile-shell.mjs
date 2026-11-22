import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url));
const {chromium}=require('playwright');
const baseline=process.argv.includes('--before');
const out=path.resolve('artifacts/shell-continuity-20261121',baseline?'before':'browser');
await mkdir(out,{recursive:true});
const assets=path.resolve(process.env.LUME_SHELL_ASSETS||'mobile/player-assets');
const server=createServer(async(req,res)=>{try{
  const file=path.join(assets,new URL(req.url,'http://localhost').pathname);
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[];
try{for(const platform of ['Android','HarmonyOS'])for(const theme of ['dark','light'])for(const landscape of [false,true]){
  const viewport=landscape?{width:844,height:390}:{width:390,height:844};
  const context=await browser.newContext({viewport,hasTouch:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.calls=[];window.LumeNative={dispatch:s=>calls.push(JSON.parse(s))};});
  await page.goto('http://127.0.0.1:'+server.address().port+'/player/index.html');
  await page.waitForFunction(()=>typeof lumeUpdate==='function');
  await page.evaluate(({platform,theme,landscape})=>{
    // Exercise the shared shell with a scrollable library behind the floating dock.
    navigate('library');
    document.documentElement.dataset.phoneTheme=theme;
    lumeUpdate({platform,songs:[{id:'shell-demo',title:'晚风中的旋律',artist:'澄音 · LUME'}],id:'shell-demo',title:'晚风中的旋律',duration:210,pos:64});
    lumeInsets({top:landscape?24:38,right:0,bottom:24,left:landscape?30:0});
  },{platform,theme,landscape});
  const name=platform+'-'+theme+'-'+(landscape?'landscape':'portrait');
  for(const dock of ['nav','mini']){
    await page.evaluate(dock=>showDockSide(dock),dock);
    for(const drawer of [false,true]){
      await page.evaluate(drawer=>setDrawer(drawer),drawer);await page.waitForTimeout(320);
      await page.screenshot({path:path.join(out,name+'-'+dock+'-'+(drawer?'open':'closed')+'.png')});
      const geometry=await page.evaluate(()=>{
        const box=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,bg:c.backgroundColor,border:c.borderTopWidth,radius:c.borderTopLeftRadius};};
        return {frame:box('#library-frame'),dock:box('#phone-dock'),mini:box('#mini'),nav:box('.dock-navigation'),sidebar:box('#sidebar'),menu:box('#open-menu'),mast:box('.side-mast'),body:box('body'),appearance:calls.filter(c=>c.type==='systemBarAppearance').at(-1)};
      });
      assert.equal(geometry.body.height,viewport.height);
      if(!baseline)assert(geometry.frame.bottom>=geometry.dock.bottom-1,'content extends behind floating dock');
      assert(geometry.mini.bottom<=viewport.height-24+1,'controls clear bottom gestures');
      assert((drawer?geometry.mast:geometry.menu).y>=(landscape?24:38),'header clears status');
      if(!baseline){
        assert.equal(geometry.mini.border,'1px');
        assert.equal(geometry.nav.border,'1px');
        assert(parseFloat(geometry.nav.radius)>=24);
        assert.equal(geometry.appearance.dark,theme==='light','readable system icon contrast');
      }
      results.push({name,dock,drawer,geometry});
    }
  }
  if(!baseline){
    await page.evaluate(()=>{setDrawer(false);showDockSide('mini');});
    await page.waitForTimeout(320);
    const cdp=await context.newCDPSession(page);
    async function swipe(x,y,dx,dy){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let i=1;i<=8;i++){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8}]});
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(450);
    }
    const scroll=await page.locator('#scroll').boundingBox();
    const drawerY=scroll.y+scroll.height*.72;
    await swipe(scroll.x+16,drawerY,205,0);
    assert(await page.evaluate(()=>drawerOpen),'drawer swipe opens');
    await swipe(230,drawerY,-205,0);
    assert.equal(await page.evaluate(()=>drawerOpen),false,'drawer swipe closes');
    let track=await page.locator('.mini-track').boundingBox();
    await swipe(track.x+track.width*.8,track.y+track.height/2,-85,0);
    assert.equal(await page.evaluate(()=>calls.at(-1).type),'next');
    track=await page.locator('.mini-track').boundingBox();
    await swipe(track.x+12,track.y+track.height/2,85,0);
    assert.equal(await page.evaluate(()=>calls.at(-1).type),'previous');
    await swipe(track.x+track.width/2,track.y+track.height/2,0,-viewport.height*.7);
    assert(await page.locator('#full').isVisible(),'upward swipe still expands player');
    const close=await page.locator('#full [data-action=close]').boundingBox();
    assert(close.y>=(landscape?24:38),'expanded player clears visible status bar');
    await page.evaluate(()=>{renderLyrics('[00:00.00]安全区中的歌词\n[00:10.00]下一行');swipeLyricPage(-100);});
    await page.waitForTimeout(400);
    const appearance=await page.evaluate(()=>calls.filter(c=>c.type==='systemBarAppearance').at(-1));
    assert.equal(appearance.dark,landscape&&theme==='light','system icons follow the actual lyric header');
    await page.evaluate(()=>swipeLyricPage(100));await page.waitForTimeout(350);
    await page.locator('#full [data-action=close]').tap();await page.waitForTimeout(500);
    assert.equal(await page.locator('#full').isVisible(),false);
    await context.close();
  }else await context.close();
  assert.deepEqual(errors,[]);
}
await writeFile(path.join(out,'geometry.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify({cases:results.length,baseline,errors:0}));
}finally{await browser.close();server.close();}
