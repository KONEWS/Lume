import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';

const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  for(const platform of ['Android','HarmonyOS'])for(const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://player.test/**',async route=>{
      const file=path.join('mobile/player-assets/player',new URL(route.request().url()).pathname);
      try {await route.fulfill({path:file});}catch{await route.fulfill({status:404,body:''});}
    });
    await page.addInitScript(()=>{window.LumeNative={dispatch:()=>{}};});
    await page.goto('http://player.test/index.html');
    await page.waitForFunction(()=>typeof lumeUpdate==='function');
    await page.evaluate(({platform,theme})=>{
      document.documentElement.dataset.phoneTheme=theme;
      lumeUpdate({platform,songs:[{id:'ring',title:'圆环进度',artist:'澄音'}],id:'ring',title:'圆环进度',duration:200,pos:50,playing:false});
      showDockSide('nav',false);
    },{platform,theme});
    const result=await page.evaluate(()=>{
      const circle=document.querySelector('#mini-circle-progress');
      const fill=circle.querySelector('.circle-fill');
      return {
        circleDisplay:getComputedStyle(circle).display,
        circleVisible:getComputedStyle(circle).visibility,
        dash:fill.style.strokeDasharray,
        fillColor:getComputedStyle(fill).stroke,
        quarterPoints:[0,.0625,.125,.25].map(fraction=>{
          const p=fill.getPointAtLength(fill.getTotalLength()*fraction).matrixTransform(fill.getScreenCTM());
          const box=circle.getBoundingClientRect();
          return {x:(p.x-box.left)/box.width,y:(p.y-box.top)/box.height};
        }),
        coverBorder:getComputedStyle(document.querySelector('#mini-art')).borderTopWidth,
        dockDisplay:getComputedStyle(document.querySelector('#dock-progress')).display,
      };
    });
    assert.equal(result.circleDisplay,'block');
    assert.equal(result.circleVisible,'visible');
    assert.equal(result.dash,'25, 100');
    assert.notEqual(result.fillColor,'none');
    const [start,left,eighth,quarter]=result.quarterPoints;
    const near=(point,x,y)=>Math.hypot(point.x-x,point.y-y)<.02;
    assert(near(start,.074,.323),'start at the 9:45 hour-hand position');
    assert(near(left,.038,.500),'pass nine o’clock at 6.25%');
    assert(near(eighth,.074,.677),'advance down the left side');
    assert(near(quarter,.323,.926),'reach the 6:45 hour-hand position at 25%');
    assert(['0px','2px'].includes(result.coverBorder));
    assert.equal(result.dockDisplay,'none');
    if(platform==='Android'&&theme==='dark')await page.locator('#phone-dock').screenshot({path:'artifacts/mini-circle-progress.png'});
    await page.evaluate(()=>lumeUpdate({pos:0}));
    assert.equal(await page.locator('#mini-circle-progress .circle-fill').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    assert.equal(await page.locator('#mini-circle-progress .circle-track').evaluate(el=>getComputedStyle(el).visibility),'visible');
    await page.evaluate(()=>lumeUpdate({pos:100}));
    assert.equal(await page.locator('#mini-circle-progress .circle-fill').evaluate(el=>el.style.strokeDasharray),'50, 100');
    await page.evaluate(()=>showDockSide('mini',false));
    assert.equal(await page.locator('#mini-circle-progress').evaluate(el=>getComputedStyle(el).display),'none');
    assert.notEqual(await page.locator('#dock-progress').evaluate(el=>getComputedStyle(el).display),'none');
    assert.equal(await page.locator('#mini-art').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
    await page.evaluate(()=>{showDockSide('nav',false);lumeUpdate({id:'',duration:0,pos:0});});
    assert.equal(await page.locator('#mini-circle-progress').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    assert.deepEqual(errors,[]);
    console.log(`${platform} ${theme}: circle follows 25% → 50%; hidden without duration; expanded dock unchanged`);
    await page.close();
  }
} finally { await browser.close(); }
