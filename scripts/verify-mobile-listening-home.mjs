import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';

const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  for(const platform of ['Android','HarmonyOS']){
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://player.test/**',async route=>{
      const file=path.join('mobile/player-assets/player',new URL(route.request().url()).pathname);
      try{await route.fulfill({path:file});}catch{await route.fulfill({status:404,body:''});}
    });
    await page.addInitScript(()=>{window.calls=[];window.LumeNative={dispatch:s=>calls.push(JSON.parse(s))};});
    await page.goto('http://player.test/index.html');
    const songs=Array.from({length:8},(_,i)=>({id:'t'+i,title:'Song '+i,artist:'Artist '+i,
      quality:['hires','lossless','lossy','unknown'][i%4],format:'mp3'}));
    const picks=()=>page.locator('#home-picks strong').allTextContents();
    await page.evaluate(({songs,platform})=>{
      Math.random=()=>0;
      const canvas=document.createElement('canvas');canvas.width=canvas.height=4;
      window.covers=songs.map((_,i)=>{
        const c=canvas.getContext('2d');c.fillStyle='hsl('+i*40+' 70% 50%)';c.fillRect(0,0,4,4);return canvas.toDataURL();
      });
      window.release={};
      window.lumeSongDetails.load=(s,listOnly)=>listOnly?Promise.resolve(covers[0]):new Promise(resolve=>{
        release[s.id]=()=>resolve({cover:s.id==='t3'?'':covers[+s.id.slice(1)],lyrics:''});
      });
      lumeUpdate({platform,songs,id:'t0',title:songs[0].title});
    },{songs,platform});
    const hero=page.locator('#home-feature'),title=page.locator('#home-title');
    assert.equal(await title.innerText(),'');
    assert.ok(await hero.isDisabled());
    await page.evaluate(()=>release.t0());
    await page.waitForFunction(()=>$('home-title').textContent==='Song 0');
    await page.getByRole('button',{name:'预览 Song 1',exact:true}).click();
    assert.equal(await title.innerText(),'Song 0');
    assert.equal(await page.locator('#home-artist').innerText(),'Artist 0');
    await hero.click();
    assert.equal(await page.evaluate(()=>calls.at(-1).type),'toggle');
    // A superseded read cannot attach its caption to a newer cover.
    await page.getByRole('button',{name:'预览 Song 2',exact:true}).click();
    await page.evaluate(()=>{
      const decode=Image.prototype.decode;
      Image.prototype.decode=function(){
        return this.src===covers[2]?new Promise(resolve=>{window.decodeTwo=()=>resolve(decode.call(this));}):decode.call(this);
      };
      release.t2();release.t1();
    });
    await page.waitForFunction(()=>!!window.decodeTwo);
    assert.equal(await title.innerText(),'Song 0');
    await page.evaluate(()=>decodeTwo());
    await page.waitForFunction(()=>$('home-title').textContent==='Song 2' && document.querySelector('.hero-cover').style.backgroundImage.includes(covers[2]));
    await hero.click();assert.equal(await page.evaluate(()=>calls.at(-1).id),'t2');
    await page.getByRole('button',{name:'预览 Song 3',exact:true}).click();
    await page.evaluate(()=>release.t3());
    await page.waitForFunction(()=>$('home-title').textContent==='Song 3' && document.querySelector('.hero-cover').style.backgroundImage.includes('gradient'));

    const initial=await picks();
    const cdp=await page.context().newCDPSession(page);
    const swipe=async direction=>{
      const box=await hero.boundingBox(),y=Math.round(box.y+box.height*.45);
      const touch=(type,x)=>cdp.send('Input.dispatchTouchEvent',{type,
        touchPoints:type==='touchEnd'?[]:[{x:Math.round(box.x+box.width*x),y}]});
      await touch('touchStart',.5+direction*.25);
      await touch('touchMove',.5);await touch('touchMove',.5-direction*.25);await touch('touchEnd');
    };
    const playbackCalls=()=>page.evaluate(()=>calls.filter(c=>['toggle','select','import'].includes(c.type)).length);
    const before=await playbackCalls();
    await swipe(-1);
    await page.waitForFunction(()=>$('home-title').textContent==='Song 2');
    assert.equal(await page.locator('.listen-disc').count(),1);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await swipe(1);
    await page.waitForFunction(()=>$('home-title').textContent==='Song 3' && document.querySelectorAll('.listen-disc').length===2);
    await page.waitForFunction(()=>document.querySelectorAll('.listen-disc').length===1);
    assert.equal(await page.evaluate(()=>tab==='home' && !drawerOpen),true);
    assert.equal(await playbackCalls(),before);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#home-picks').scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>[...$('home-picks').querySelectorAll('.thumb')].every(n=>n.style.backgroundImage.includes('data:image')));
    await page.evaluate(()=>{
      window.pickNodes=[...$('home-picks').querySelectorAll('.thumb')];
      window.pickImages=pickNodes.map(n=>n.style.backgroundImage);
      Math.random=()=>.99;navigate('library');
    });
    // Give the visibility observers time to process the hidden page.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(()=>pickNodes.every((n,i)=>n.style.backgroundImage===pickImages[i])),true);
    await page.evaluate(()=>navigate('home'));
    assert.equal(await page.evaluate(()=>[...$('home-picks').querySelectorAll('.thumb')].every((n,i)=>n===pickNodes[i] && n.style.backgroundImage===pickImages[i])),true);
    assert.deepEqual(await picks(),initial);
    await page.evaluate(({songs})=>{
      lumeUpdate({songs:[...songs,{id:'new',title:'New'}],counts:{t2:1}});
      lumeUpdate({joined:true,host:'room',songs:[{id:'room1',title:'Room song'}]});
      lumeUpdate({joined:false,host:'',songs});
    },{songs});
    assert.deepEqual(await picks(),initial);
    await page.evaluate(()=>lumeUpdate({songs:state.songs.filter(s=>s.id!=='t0')}));
    assert.deepEqual((await picks()).slice(0,2),initial.slice(1));
    await page.evaluate(()=>navigate('library'));
    assert.deepEqual((await page.locator('#library-list .song-quality').allTextContents()).slice(0,2),['SQ','MP3']);
    assert.equal(await page.locator('[data-artist] .song-quality').count(),0);
    await page.reload();
    await page.evaluate(({songs,platform})=>{
      Math.random=()=>.99;window.lumeSongDetails.load=async(s,list)=>list?'':{lyrics:'',cover:''};
      lumeUpdate({songs,platform,id:'t0',title:'Song 0'});
    },{songs,platform});
    assert.notDeepEqual(await picks(),initial);
    assert.equal(await page.locator('#library-list .song-quality').first().textContent(),'HR');
    assert.equal(await page.locator('[data-artist] .song-quality').count(),0);
    assert.deepEqual(errors,[]);
    console.log(platform+' listening home passed');await page.close();
  }
}finally{await browser.close();}
