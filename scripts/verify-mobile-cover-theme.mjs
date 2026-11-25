import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';

const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  for(const platform of ['Android','HarmonyOS']){
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://player.test/**',async route=>{
      const file=path.join('mobile/player-assets/player',new URL(route.request().url()).pathname);
      try{await route.fulfill({path:file});}catch{await route.fulfill({status:404,body:''});}
    });
    await page.addInitScript(()=>{window.LumeNative={dispatch:()=>{}};});
    await page.goto('http://player.test/index.html');
    await page.evaluate(platform=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=16;
      const context=canvas.getContext('2d');
      window.covers={};
      for(const [id,color] of [['a','#da342c'],['b','#1f6cc9'],['d','#55a044']]){
        context.fillStyle=color;context.fillRect(0,0,16,16);covers[id]=canvas.toDataURL();
      }
      window.pending={};
      window.lumeSongDetails.load=(song,listOnly)=>listOnly?Promise.resolve(covers[song.id]):new Promise(resolve=>{
        (pending[song.id]||=[]).push(()=>resolve({cover:covers[song.id],lyrics:''}));
      });
      lumeUpdate({platform,songs:[{id:'a',title:'A'},{id:'b',title:'B'},{id:'c',title:'C'},{id:'d',title:'D'}],id:'a',title:'A'});
    },platform);
    await page.waitForFunction(()=>!!pending.a);
    await page.evaluate(()=>openBrowse('settings'));
    const toggle=page.getByRole('switch',{name:'主题色随歌曲封面变化'});
    assert(await toggle.isVisible());assert.equal(await toggle.isChecked(),false);
    await toggle.check();
    assert.equal(await page.evaluate(()=>localStorage.getItem('lume-phone-cover-theme')),'true');
    await page.evaluate(()=>pending.a.splice(0).forEach(release=>release()));
    await page.waitForFunction(()=>document.documentElement.hasAttribute('data-custom-skin'));
    const red=await page.evaluate(()=>document.documentElement.style.getPropertyValue('--skin-background'));
    await page.evaluate(()=>lumeUpdate({id:'b',title:'B'}));
    await page.waitForFunction(()=>!!pending.b);
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--skin-background')),red);
    await page.evaluate(()=>pending.b.splice(0).forEach(release=>release()));
    await page.waitForFunction(previous=>document.documentElement.style.getPropertyValue('--skin-background')!==previous,red);
    const blue=await page.evaluate(()=>document.documentElement.style.getPropertyValue('--skin-background'));
    assert.notEqual(red,blue);
    await page.evaluate(()=>lumeUpdate({id:'c',title:'C'}));
    await page.waitForFunction(()=>!!pending.c);
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--skin-background')),blue);
    await page.evaluate(()=>lumeUpdate({id:'d',title:'D'}));
    await page.waitForFunction(()=>!!pending.d);
    await page.evaluate(()=>pending.c.splice(0).forEach(release=>release()));
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--skin-background')),blue);
    await page.evaluate(()=>pending.d.splice(0).forEach(release=>release()));
    await page.waitForFunction(previous=>document.documentElement.style.getPropertyValue('--skin-background')!==previous,blue);
    const green=await page.evaluate(()=>document.documentElement.style.getPropertyValue('--skin-background'));
    await page.evaluate(()=>lumeUpdate({id:'c',title:'C'}));
    await page.waitForFunction(()=>!!pending.c);
    await page.evaluate(()=>pending.c.splice(0).forEach(release=>release()));
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--skin-background')),green);
    const decorativeBorders=async()=>page.evaluate(()=>[
      '#phone-dock .dock-navigation','#phone-dock #mini',
      '#scroll .space-device','#space > lume-personal-devices'
    ].map(selector=>{
      const node=document.querySelector(selector);
      return node?[selector,getComputedStyle(node).borderTopWidth]:[selector,'missing'];
    }));
    assert((await decorativeBorders()).every(([,width])=>width==='0px'));
    await page.evaluate(()=>navigate('space'));
    const spaceBorders=async()=>page.evaluate(()=>['#local-device','#create-room','#space-tools .icon','#space > lume-personal-devices'].map(selector=>{
      const style=getComputedStyle(document.querySelector(selector));
      return [style.borderTopWidth,style.boxShadow];
    }));
    assert((await spaceBorders()).every(([border,shadow])=>border==='0px'&&shadow==='none'));
    await page.evaluate(()=>toggleTheme());
    const dark=await page.evaluate(()=>({
      page:getComputedStyle(document.documentElement).getPropertyValue('--studio-bg').trim(),
      listening:getComputedStyle(document.querySelector('#home')).getPropertyValue('--listen-paper').trim(),
      ink:getComputedStyle(document.documentElement).getPropertyValue('--studio-ink').trim()
    }));
    assert.equal(dark.page,dark.listening);
    assert((await spaceBorders()).every(([border,shadow])=>border==='0px'&&shadow==='none'));
    assert((await decorativeBorders()).every(([,width])=>width==='0px'));
    await page.evaluate(()=>openBrowse('settings'));
    await toggle.uncheck();
    assert.equal(await page.evaluate(()=>localStorage.getItem('lume-phone-cover-theme')),'false');
    assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute('data-custom-skin')),false);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--studio-bg').trim()),'#10121e');
    await page.evaluate(()=>{
      lumeUpdate({joined:true,host:'test-room',skin:{background:'#243242',surface:'#334455',ink:'#f3f6fa',accent:'#a6dcff'}});
    });
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--skin-background')),'#243242');
    await page.evaluate(()=>{lumeUpdate({joined:false,host:'',skin:null});toggleTheme();navigate('space');});
    assert((await spaceBorders()).every(([border,shadow])=>border==='0px'&&shadow==='none'));
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#home')).getPropertyValue('--listen-paper').trim()),
      await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--studio-bg').trim()));
    assert.deepEqual(errors,[]);
    await page.close();
    console.log(`${platform}: setting, persistence, cover change, light/dark surfaces passed`);
  }
}finally{await browser.close();}
