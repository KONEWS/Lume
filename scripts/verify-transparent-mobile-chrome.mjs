import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
await mkdir('artifacts/transparent-mobile-chrome',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  for(const platform of ['Android','HarmonyOS']) {
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://player.test/**',async route=>{
      const file=path.join('mobile/player-assets/player',new URL(route.request().url()).pathname);
      try {await route.fulfill({path:file});} catch {await route.fulfill({status:404,body:''});}
    });
    await page.addInitScript(()=>{window.LumeNative={dispatch:()=>{}};});
    await page.goto('http://player.test/index.html');
    await page.waitForFunction(()=>typeof lumeUpdate==='function');
    assert.equal(await page.locator('link[href="transparent-chrome.css"]').count(),1);
    await page.evaluate(platform=>{
      lumeUpdate({platform,songs:Array.from({length:40},(_,i)=>({id:String(i),title:`曲目 ${i+1}`,artist:'澄音'}))});
      lumeInsets({top:38,right:0,bottom:24,left:0});
    },platform);
    for(const theme of ['light','dark']) {
      await page.evaluate(theme=>{document.documentElement.dataset.phoneTheme=theme;},theme);
      for(const tab of ['home','library','space']) {
        await page.evaluate(tab=>{navigate(tab);document.querySelector('#scroll').scrollTop=160;},tab);
        const result=await page.evaluate(()=>{
          const header=document.querySelector('#library-frame>header');
          const dock=document.querySelector('#phone-dock .dock-navigation');
          const scroll=document.querySelector('#scroll');
          const h=getComputedStyle(header),d=getComputedStyle(dock),s=getComputedStyle(scroll);
          const menu=document.querySelector('#open-menu'),rect=menu.getBoundingClientRect();
          const menuHit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('button')?.id;
          return {headerPosition:h.position,headerBackground:h.backgroundColor,headerBlur:h.backdropFilter||h.webkitBackdropFilter,headerChildren:[...header.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.id),headerTop:header.getBoundingClientRect().top,menuTop:rect.top,menuHit,scrollTop:scroll.getBoundingClientRect().top,scrollPadding:s.paddingTop,dockBackground:d.backgroundColor,dockBorder:d.borderTopWidth,dockBottom:dock.getBoundingClientRect().bottom,buttonBackground:getComputedStyle(menu).backgroundColor};
        });
        assert.equal(result.headerPosition,'absolute');
        assert.equal(result.headerBackground,'rgba(0, 0, 0, 0)');
        assert.equal(result.headerBlur,'none');
        assert.deepEqual(result.headerChildren,['open-menu','page-heading','home-search']);
        assert.equal(result.buttonBackground,'rgba(0, 0, 0, 0)');
        assert.equal(result.scrollTop,0);
        assert(result.menuTop>=38,'title controls clear the status area');
        assert.equal(result.menuHit,'open-menu','title control remains tappable above scrolling content');
        assert(result.dockBottom<=820,'dock clears the bottom gesture area');
        assert.equal(result.dockBorder,'0px');
        assert.deepEqual(errors,[]);
        if(tab==='library')await page.screenshot({path:`artifacts/transparent-mobile-chrome/${platform}-${theme}.png`});
        console.log(platform,theme,tab,result.headerBackground,result.headerBlur,result.headerChildren);
      }
    }
    await page.evaluate(()=>openBrowse('albums'));
    assert.equal(await page.locator('#album-options').evaluate(el=>el.parentElement.id),'browse');
    assert(await page.locator('#album-options').isVisible());
    assert(await page.locator('#home-search').isVisible());
    await page.evaluate(()=>openBrowse('stats'));
    assert.equal(await page.locator('#stats-source-slot').evaluate(el=>el.parentElement.id),'browse');
    assert(await page.locator('#stats-source-slot select').isVisible());
    await page.evaluate(()=>{
      const root=document.documentElement;
      root.dataset.phoneTheme='dark';root.dataset.customSkin='cover';
      root.style.setProperty('--skin-background','#172936');
      root.style.setProperty('--skin-surface','#365363');
      root.style.setProperty('--skin-ink','#f5f8fa');
    });
    const coverHeader=await page.locator('#library-frame > header').evaluate(el=>getComputedStyle(el).backgroundColor);
    assert.equal(coverHeader,'rgba(0, 0, 0, 0)');
    await page.evaluate(()=>{document.documentElement.dataset.glass='reduced';});
    const reducedHeader=await page.locator('#library-frame > header').evaluate(el=>getComputedStyle(el).backgroundColor);
    assert.equal(reducedHeader,'rgba(0, 0, 0, 0)');
    await page.close();
  }
} finally {await browser.close();}
