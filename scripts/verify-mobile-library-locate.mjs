import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url));
const {chromium}=require('playwright');
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const out=path.resolve(process.env.LUME_TEST_OUTPUT||'mobile/verification/library-locate-floating');
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  try{
    const file=path.join(assets,new URL(req.url,'http://localhost').pathname);
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
  for(const platform of ['Android','HarmonyOS']){
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.calls=[];
      window.LumeNative={dispatch:raw=>{
        const call=JSON.parse(raw);calls.push(call);
        if(call.type==='detailRead')setTimeout(()=>window.lumeReadResult?.(call.token,''),0);
      }};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);
    await page.waitForFunction(()=>typeof lumeUpdate==='function');
    await page.evaluate(platform=>{
      window.fixture=Array.from({length:1500},(_,index)=>({id:`demo-${index}`,title:index===1200||index===1201?'同名歌曲':`歌曲 ${index}`,artist:'验证艺人'}));
      fixture[1201].id='content://music/12?x="quoted"#[]';
      lumeUpdate({platform,songs:fixture,id:fixture[1201].id,title:'同名歌曲',duration:240,pos:63,playing:true});
      navigate('library');calls.length=0;
    },platform);
    const button=page.locator('#locate-current');
    assert.equal(await button.innerText(),'');
    assert.equal(await button.getAttribute('aria-label'),'定位当前曲目');
    async function locate(){
      await button.click();
      await page.waitForFunction(()=>!!document.querySelector('#library-list .located-current'));
      const result=await page.evaluate(()=>{
        const row=document.querySelector('#library-list .located-current'),list=document.getElementById('library-list');
        const rect=row.getBoundingClientRect(),viewport=document.getElementById('scroll').getBoundingClientRect();
        return {id:list.songItems[Array.from(list.children).indexOf(row)].id,current:row.classList.contains('current'),top:rect.top,bottom:rect.bottom,viewTop:viewport.top,viewBottom:viewport.bottom,headingBottom:document.querySelector('.library-heading').getBoundingClientRect().bottom};
      });
      assert.equal(result.id,await page.evaluate(()=>state.id));
      assert(result.current);
      const rowStyle=await page.locator('#library-list .located-current').evaluate(row=>{
        const style=getComputedStyle(row);return {background:style.backgroundColor,shadow:style.boxShadow,outline:style.outlineStyle,weight:getComputedStyle(row.querySelector('.meta strong')).fontWeight};
      });
      assert.deepEqual(rowStyle,{background:'rgba(0, 0, 0, 0)',shadow:'none',outline:'none',weight:'700'});
      assert(result.top>=result.viewTop-1&&result.bottom<=result.viewBottom+1,JSON.stringify(result));
      assert(result.bottom<=(await button.boundingBox()).y-7,JSON.stringify(result));
      return result;
    }
    const longList=await locate();
    assert.equal(await page.locator('#library-list .located-current').count(),1);
    assert.equal(await page.evaluate(()=>document.querySelector('#library-list').children[1200].classList.contains('located-current')),false);
    // Keep the locator reachable while deep in the list, at narrow and wide sizes.
    for(const width of [320,390,844]){
      await page.setViewportSize({width,height:width===844?390:844});
      await locate();
      const bounds=await button.boundingBox();
      assert(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.height>=44);
      assert(bounds.y+bounds.height<=(await page.locator('#phone-dock').boundingBox()).y-15);
      await page.evaluate(()=>document.getElementById('scroll').scrollTop=1e9);
      assert.deepEqual(await button.boundingBox(),bounds);
      const last=await page.locator('#library-list .song').last().boundingBox();
      assert(last.y+last.height<=bounds.y-7);
      await locate();
      await page.screenshot({path:path.join(out,`${platform}-${width}.png`)});
    }
    await page.setViewportSize({width:390,height:844});
    for(const theme of ['dark','light','custom']){
      await page.evaluate(theme=>{
        const root=document.documentElement;root.dataset.phoneTheme=theme==='light'?'light':'dark';
        if(theme==='custom'){root.dataset.customSkin='test';root.style.setProperty('--skin-background','#e9eee6');root.style.setProperty('--skin-surface','#fafcf8');root.style.setProperty('--skin-ink','#24352a');root.style.setProperty('--skin-accent','#285f44');}
        else{delete root.dataset.customSkin;for(const key of ['background','surface','ink','accent'])root.style.removeProperty('--skin-'+key);}
        lumeInsets({top:32,right:12,bottom:34,left:12});
        document.getElementById('scroll').scrollTop=0;
      },theme);
      const colors=await page.evaluate(()=>['.library-heading','#library-list','#library-list .song:not(.current)','#library-list .song-play','#library-list .end'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor));
      assert(colors.every(c=>c==='rgba(0, 0, 0, 0)'),JSON.stringify(colors));
      await page.screenshot({path:path.join(out,`${platform}-${theme}.png`)});
      await locate();
    }
    for(const destination of ['home','space','browse']){
      await page.evaluate(next=>navigate(next),destination);assert.equal(await button.isVisible(),false);
    }
    await page.evaluate(()=>navigate('library'));
    await page.evaluate(()=>setDrawer(true));assert.equal(await button.isVisible(),false);
    await page.evaluate(()=>setDrawer(false));assert.equal(await button.isVisible(),true);
    await page.evaluate(()=>{document.getElementById('query').value='不存在的关键词';onlyLiked=true;library();});
    await locate();
    assert.deepEqual(await page.evaluate(()=>({query:document.getElementById('query').value,liked:onlyLiked})),{query:'',liked:false});
    assert.match(await page.locator('#notice').innerText(),/已清除搜索和收藏筛选/);
    // Matching filters must survive locating, even for duplicate display names.
    await page.evaluate(()=>{liked.add(favKey(state.id));onlyLiked=true;document.getElementById('query').value='同名';library();});
    await locate();
    assert.deepEqual(await page.evaluate(()=>({query:document.getElementById('query').value,liked:onlyLiked})),{query:'同名',liked:true});
    // Unavailable states must not clear the user's filters or select a fallback.
    for(const [id,message] of [['','尚未选择'],['missing-local','不在本机'],['hidden-song','已隐藏']]){
      await page.evaluate(id=>lumeUpdate({songs:[...fixture,{id:'hidden-song',title:'隐藏歌曲',hidden:true}],id}),id);
      await button.click();
      assert.match(await page.locator('#notice').innerText(),new RegExp(message));
      assert.equal(await page.locator('#library-list .located-current').count(),0);
      assert.deepEqual(await page.evaluate(()=>({query:document.getElementById('query').value,liked:onlyLiked})),{query:'同名',liked:true});
    }
    await page.evaluate(()=>{onlyLiked=false;document.getElementById('query').value='';lumeUpdate({songs:[],id:''});});
    await button.click();
    assert.match(await page.locator('#notice').innerText(),/尚未选择/);
    // First/last rows clamp into view, and re-sorting still resolves by actual ID.
    await page.evaluate(()=>lumeUpdate({songs:[...fixture].reverse(),id:fixture[1499].id}));
    await locate();
    await page.evaluate(()=>lumeUpdate({id:fixture[0].id}));
    await locate();
    // A next-track update or source swap between click and layout cancels stale work.
    await page.evaluate(()=>{document.getElementById('locate-current').click();lumeUpdate({id:fixture[3].id});});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await page.locator('#library-list .located-current').count(),0);
    await page.evaluate(()=>{document.getElementById('locate-current').click();lumeUpdate({joined:true,host:'other-host',songs:[{id:fixture[3].id,title:'空间曲目'}]});});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await page.locator('#library-list .located-current').count(),0);
    await locate();
    assert.match(await page.locator('#notice').innerText(),/空间曲目/);
    await page.evaluate(()=>lumeUpdate({id:'missing-room'}));
    await button.click();
    assert.match(await page.locator('#notice').innerText(),/不在此空间/);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>lumeUpdate({joined:false,host:'',songs:fixture,id:fixture[1201].id,playing:false}));
    await button.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
    assert.equal(await button.evaluate(b=>b===document.activeElement),true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>!!document.querySelector('#library-list .located-current'));
    assert.equal(await page.evaluate(()=>state.playing),false);
    await page.waitForFunction(()=>!document.querySelector('#library-list .located-current'),{},{timeout:5000});
    assert.equal(await page.locator('#library-list .current').evaluate(row=>getComputedStyle(row).backgroundColor),'rgba(0, 0, 0, 0)');
    assert.equal(await button.evaluate(b=>getComputedStyle(b).outlineStyle),'solid');
    assert.equal(await page.locator('#library-list .current').count(),1);
    assert.deepEqual(await page.evaluate(()=>calls.filter(c=>['select','toggle','seek','next','previous','playMode'].includes(c.type))),[]);
    assert.equal(await page.evaluate(()=>state.pos),63);
    assert.deepEqual(errors,[]);
    results.push({platform,environment:'Desktop Chromium with native bridge stub; not device validation',longList,checks:['1500 rows','duplicate titles and special-character IDs','floating icon at 320/390/844px','dock and final row clearance','dark/light/custom transparent rows and heading','safe insets','hidden outside library and in drawer','clear only excluding filters','preserve matching filters','missing/hidden/empty states','first/last/reordered rows','cancel stale track and source updates','room source','keyboard and reduced motion','temporary title weight only; no row fill or outline','keyboard focus outline','no playback commands or position changes'],errors});
    await context.close();
  }
  await writeFile(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
}finally{await browser.close();server.close();}
