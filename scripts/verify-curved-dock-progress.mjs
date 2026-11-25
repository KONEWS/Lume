import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
await mkdir('artifacts/curved-dock-progress',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  for(const platform of ['Android','HarmonyOS'])for(const theme of ['light','dark'])for(const width of [320,390,480]) {
    const page=await browser.newPage({viewport:{width,height:844},deviceScaleFactor:3,hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://player.test/**',async route=>{
      const file=path.join('mobile/player-assets/player',new URL(route.request().url()).pathname);
      try {await route.fulfill({path:file});}catch{await route.fulfill({status:404,body:''});}
    });
    await page.addInitScript(()=>{window.nativeCalls=[];window.LumeNative={dispatch:value=>nativeCalls.push(JSON.parse(value))};});
    await page.goto('http://player.test/index.html');
    await page.waitForFunction(()=>typeof lumeUpdate==='function');
    await page.evaluate(({platform,theme})=>{
      document.documentElement.dataset.phoneTheme=theme;
      lumeUpdate({platform,songs:[{id:'curve',title:'弯曲进度',artist:'澄音'}],id:'curve',title:'弯曲进度',duration:200,pos:50,playing:false});
      showDockSide('mini',false);
    },{platform,theme});
    await page.waitForFunction(()=>document.querySelector('#mini').getBoundingClientRect().width>180);
    await page.waitForTimeout(350); // Wait for the dock's width transition before measuring its outline.
    const geometry=await page.evaluate(()=>{
      const mini=document.querySelector('#mini').getBoundingClientRect();
      const art=document.querySelector('#mini-art').getBoundingClientRect();
      const path=document.querySelector('#dock-progress .curve-hit');
      const svg=document.querySelector('#dock-progress'),box=svg.getBoundingClientRect();
      const total=path.getTotalLength(),start=path.getPointAtLength(0),middle=path.getPointAtLength(total*.5),end=path.getPointAtLength(total);
      const stops=[...document.querySelectorAll('#dock-progress stop')].map(stop=>getComputedStyle(stop).stopColor);
      const artStyle=getComputedStyle(document.querySelector('#mini-art'));
      const relative=p=>({x:p.x+box.left-mini.left,y:p.y+box.top-mini.top});
      return {mini:{width:mini.width,height:mini.height},art:{left:art.left-mini.left,bottom:art.bottom-mini.top},artBorder:artStyle.borderTopWidth,artBackground:artStyle.backgroundImage,artColor:artStyle.backgroundColor,start:relative(start),middle:relative(middle),end:relative(end),svgParent:svg.parentElement.id,total,value:svg.getAttribute('aria-valuenow'),dash:document.querySelector('#dock-progress .curve-fill').style.strokeDasharray,fillWidth:getComputedStyle(document.querySelector('#dock-progress .curve-fill')).strokeWidth,hitStroke:getComputedStyle(path).stroke,stops};
    });
    assert.equal(geometry.svgParent,'phone-dock','progress lives outside the mini player');
    const radius=geometry.mini.height/2;
    const angle=Math.atan2(geometry.start.x-radius,radius-geometry.start.y);
    assert(Math.abs(angle*180/Math.PI+120)<.2,'track begins at eight o’clock');
    assert(Math.abs(Math.hypot(geometry.start.x-radius,geometry.start.y-radius)-radius)<.05,'start stays on the outer edge');
    assert(Math.abs(geometry.middle.y-geometry.mini.height)<.05,'track follows the bottom outer edge');
    assert(Math.abs(geometry.end.x-geometry.mini.width)<.05,'track ends on the right outer edge');
    assert(Math.abs(geometry.end.y-geometry.mini.height/2)<.05,'track ends at the right midpoint');
    assert.equal(geometry.value,'25');
    assert.equal(geometry.fillWidth,'0.9px');
    assert.equal(geometry.hitStroke,'rgba(0, 0, 0, 0)');
    assert.equal(await page.locator('#dock-progress .curve-track').count(),0);
    assert.equal(geometry.artBorder,'0px');
    assert.doesNotMatch(geometry.artBackground,/radial-gradient/,'mini cover has no decorative green ring');
    assert.notEqual(geometry.artColor,'rgb(36, 75, 67)','mini cover no longer shows the green base rim');
    assert.notEqual(geometry.stops[0],geometry.stops[1],'progress colour changes along the curve');
    await page.evaluate(()=>lumeDockProgress.set(0));
    assert.equal(await page.locator('#dock-progress .curve-fill').evaluate(el=>getComputedStyle(el).visibility),'hidden','zero progress draws no visible line');
    await page.locator('#phone-dock').screenshot({path:`artifacts/curved-dock-progress/${platform}-${theme}-${width}-zero-dock-3x.png`});
    await page.evaluate(()=>lumeDockProgress.set(.25));
    await page.locator('#phone-dock').screenshot({path:`artifacts/curved-dock-progress/${platform}-${theme}-${width}-partial-dock-3x.png`});
    const point=await page.locator('#dock-progress .curve-hit').evaluate(el=>{
      const p=el.getPointAtLength(el.getTotalLength()*.75),box=el.ownerSVGElement.getBoundingClientRect();
      return {x:box.left+p.x,y:box.top+p.y};
    });
    await page.mouse.click(point.x,point.y);
    const seek=await page.evaluate(()=>nativeCalls.filter(call=>call.type==='seek').at(-1));
    assert(seek,'curve click dispatches seek');
    assert(Math.abs(seek.seconds-150)<8,JSON.stringify(seek));
    const clicksBefore=await page.evaluate(()=>nativeCalls.filter(call=>call.type==='seek').length);
    await page.touchscreen.tap(point.x,point.y);
    const clicksAfter=await page.evaluate(()=>nativeCalls.filter(call=>call.type==='seek').length);
    assert.equal(clicksAfter,clicksBefore+1,'touch tap dispatches seek');
    const endpoints=await page.locator('#dock-progress .curve-hit').evaluate(el=>{
      const box=el.ownerSVGElement.getBoundingClientRect(),total=el.getTotalLength();
      return [.35,.9].map(f=>{const p=el.getPointAtLength(total*f);return {x:box.left+p.x,y:box.top+p.y};});
    });
    await page.mouse.move(endpoints[0].x,endpoints[0].y);
    await page.mouse.down();
    await page.mouse.move(endpoints[1].x,endpoints[1].y,{steps:8});
    await page.mouse.up();
    const dragged=await page.evaluate(()=>nativeCalls.filter(call=>call.type==='seek').at(-1));
    assert(Math.abs(dragged.seconds-180)<8,JSON.stringify(dragged));
    await page.locator('#dock-progress').focus();
    await page.keyboard.press('ArrowLeft');
    const keyed=await page.evaluate(()=>nativeCalls.filter(call=>call.type==='seek').at(-1));
    assert(keyed.seconds<dragged.seconds,'keyboard adjustment remains available');
    if(platform==='Android'&&theme==='dark'&&width===390){
      const before=geometry.stops[0];
      await page.evaluate(()=>{
        document.documentElement.dataset.customSkin='cover';
        document.documentElement.style.setProperty('--skin-accent','#d47244');
      });
      const changed=await page.locator('#dock-progress .curve-start').evaluate(el=>getComputedStyle(el).stopColor);
      assert.notEqual(changed,before,'curve follows the active cover theme');
      await page.setViewportSize({width:844,height:390});
      await page.waitForTimeout(120);
      const landscape=await page.locator('#dock-progress .curve-hit').evaluate(el=>({
        end:el.getPointAtLength(el.getTotalLength()).x,
        width:el.ownerSVGElement.getBoundingClientRect().width
      }));
      assert(landscape.end>landscape.width-2,'curve recalculates for landscape');
    }
    assert.deepEqual(errors,[]);
    console.log(platform,theme,width,geometry.mini,geometry.start,geometry.middle,geometry.end,seek.seconds);
    await page.close();
  }
}finally{await browser.close();}
