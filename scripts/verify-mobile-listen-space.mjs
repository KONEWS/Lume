import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url));const {chromium}=require('playwright');
const out=path.resolve('artifacts/listen-unified');await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=path.join(path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets'),new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const report=[];
try{for(const platform of ['Android','HarmonyOS']){
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.calls=[];window.LumeNative={dispatch:raw=>{const r=JSON.parse(raw);calls.push(r);if(r.type==='detailRead')setTimeout(()=>window.lumeReadResult?.(r.token,''),0);}};});
 await page.goto('http://127.0.0.1:'+server.address().port+'/player/index.html');await page.waitForFunction(()=>typeof lumeUpdate==='function');
 await page.evaluate(platform=>lumeUpdate({platform,model:platform==='Android'?'OnePlus PJZ110':'HUAWEI Pura 80 · LMR-AL00',songs:Array.from({length:7},(_,i)=>({id:'demo-'+i,title:['山海之间','月光奏鸣曲','沿着海岸线的一场漫长旅途','流动的森林'][i%4],artist:i%2?'LUME Studio':'澄音',album:'季节',folder:'Music',format:'flac',sampleRate:48000,bitDepth:24})),id:'demo-0',title:'山海之间',counts:{'demo-0':12,'demo-1':5},playing:true,pos:2,duration:120,searching:true,status:'正在搜索附近空间 · 30 秒后停止'}),platform);
 await page.waitForTimeout(200);assert.deepEqual(errors,[]);assert.equal(await page.locator('#home-categories button').count(),3);assert.equal(await page.locator('#home-recent .home-track').count(),4);
 const touch=await context.newCDPSession(page);
 async function swipe(x1,y1,x2,y2){
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1}]});
   for(let i=1;i<=8;i++){
     await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/8,y:y1+(y2-y1)*i/8}]});
   }
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 }
 const activeTab=()=>page.locator('#dock-tabs [aria-current=page]').getAttribute('aria-label');
 const route=async (x1,x2,label,y=340)=>{
   await swipe(x1,y,x2,y);
   assert.equal(await activeTab(),label);
   await page.waitForTimeout(230);
 };
 // Use both sides of the configured red line, including a swipe that crosses it.
 await route(285,105,'曲库');
 await route(210,335,'聆听');
 await route(210,335,'歌单');
 await route(288,106,'聆听');
 await route(108,37,'聆听');
 await route(46,230,'聆听');
 assert(await page.evaluate(()=>drawerOpen));
 assert.equal(await page.locator('#side-tools,#side-dismiss,#home-menu').count(),0);
 const navHit=await page.locator('#dock-tabs [data-tab=library]').evaluate(el=>{
   const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
 });
 assert(navHit,'dock receives touches above the open drawer');
 await page.locator('#dock-tabs [data-tab=library]').tap();
 assert.equal(await activeTab(),'曲库');assert.equal(await page.evaluate(()=>drawerOpen),false);
 async function setRange(value){
   await page.evaluate(value=>{
     openBrowse('settings','drawer-range');
     const input=$('drawer-range');input.value=String(value);input.dispatchEvent(new Event('input'));
   },value);
   assert(await page.locator('#phone-dock').isVisible());
   await page.locator('#dock-tabs [data-tab=home]').tap();await page.waitForFunction(()=>tab==='home');await page.waitForTimeout(350);
 }
 await setRange(80);
 await route(258,116,'聆听');
 await route(335,128,'曲库');
 await setRange(0);
 await route(64,209,'歌单');assert.equal(await page.evaluate(()=>drawerOpen),false);
 await setRange(100);
 await route(300,110,'聆听');
 await setRange(33);
 assert.equal(await page.locator('#home-picks .home-track').count(),3);
 assert.equal(await page.locator('#home-albums .home-track').count(),1);
 await swipe(190,170,190,320);
 assert.equal(await page.locator('#phone-dock').getAttribute('data-open'),'mini');
 await swipe(190,320,190,155);
 assert.equal(await page.locator('#phone-dock').getAttribute('data-open'),'nav');
 assert(await page.locator('#full').isHidden());
 assert(await page.locator('#scroll').evaluate(el=>el.scrollTop>0));
 const startBox=await page.locator('#mini-art').boundingBox();
 const finger={x:startBox.x+startBox.width/2,y:startBox.y+startBox.height/2};
 const coverPose=()=>page.evaluate(()=>{
   const album=$('album').getBoundingClientRect(), sheet=$('full').getBoundingClientRect();
   return {width:album.width,center:album.top+album.height/2,top:sheet.top};
 });
 await page.evaluate(()=>lumeUpdate({id:'demo-1',title:state.songs[1].title,playing:false}));
 let first;
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
 for(const offset of [15,60,120,75,30,8]){
   await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:finger.x,y:finger.y-offset}]});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const pose=await coverPose();
   if(offset===60){
     first=pose;
     assert(first.width>startBox.width,'art grows from the mini cover');
   }
   if(offset===120){
     assert(await page.evaluate(()=>!expanded && !!playerMotion),'player follows finger before release');
     assert(pose.width>first.width && pose.top<first.top,'cover grows while the sheet rises');
     assert(Math.abs(first.center-pose.center-60)<2,'cover follows finger in screen coordinates');
     assert.equal(await page.locator('.travelling-cover').count(),0,'drag keeps the real playing cover');
   }
   if(offset===30)assert(pose.width<first.width && pose.top>first.top,'dragging back reverses the morph');
 }
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(()=>!expanded && !playerMotion && $('full').hidden);
 if(platform==='HarmonyOS'){
   const result=await page.evaluate(()=>{
     const gesture=preparePlayerMotion(createPlayerDrag);
     gesture.seek(.38);
     player(true,.004);
     const nodes=[$('full'),$('album'),document.querySelector('.full-head'),document.querySelector('.full-playback')];
     const runs=nodes.map(node=>node.getAnimations().find(a=>a.effect.getKeyframes().length>=2 && a.effect.getTiming().fill==='both'));
     return {complete:runs.every(Boolean),clocks:runs.map(a=>a?.startTime)};
   });
   assert(result.complete && new Set(result.clocks).size===1,'Harmony release animates the live layers on one clock');
   await page.evaluate(()=>player(false));
   await page.waitForFunction(()=>!expanded && !playerMotion && $('full').hidden);
 }
 for(const side of ['nav','mini']){
   await page.evaluate(side=>showDockSide(side,false),side);
   const art=page.locator('#mini-art');
   const {x,y,width,height}=await art.boundingBox();
   await swipe(x+width/2,y+height/2,x+width/2,y-330);
   await page.waitForFunction(()=>expanded && !playerMotion);
   assert(await page.locator('#full').isVisible(),'up from home artwork opens the player in either dock state');
   await page.locator('#full [data-action=close]').tap();
   await page.waitForFunction(()=>!expanded && !playerMotion);
 }
 await page.evaluate(()=>{showDockSide('nav',false);lumeUpdate({id:'demo-0',title:state.songs[0].title,playing:true});});
 await page.locator('#scroll').evaluate(el=>el.scrollTop=0);
 await page.locator('#home-pages button').nth(1).click();
 assert.equal('预览 '+await page.locator('#home-title').innerText(),await page.locator('#home-pages button').nth(1).getAttribute('aria-label'));
 await page.locator('#home-pages button').first().click();
 await page.locator('#home-albums .home-track').first().click();
 assert(await page.locator('#library').isVisible());
 assert.equal(await page.locator('#query').inputValue(),'专辑：季节');
 assert.equal(await page.locator('#library-list .song').count(),7);
 await page.evaluate(()=>navigate('home'));
 const navigation=page.locator('#dock-tabs');
 assert.deepEqual(await navigation.getByRole('button').allTextContents(),['聆听','曲库','艺术家','播放空间','歌单']);
 for(const label of ['艺术家','播放空间','歌单','曲库','聆听']){
   await navigation.getByRole('button',{name:label,exact:true}).click();
   assert.equal(await navigation.locator('[aria-current="page"]').getAttribute('aria-label'),label);
   assert.equal(await page.locator('#page-heading').innerText(),label);
   assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundImage.includes('radial-gradient')),true);
 }
 // Distinct titles identify every draw. Predict both Fisher–Yates samples with
 // fixed entropy, including the last catalog entry and a hidden ineligible track.
 await page.evaluate(()=>{
   window.savedState={songs:state.songs,id:state.id,title:state.title};
   const nativeRandom=Math.random;
   try{
     Math.random=()=>0.999999;
     lumeUpdate({songs:Array.from({length:11},(_,i)=>({id:'trial'+i,title:'编号'+i,hidden:i===10})),id:'trial0'});
   }finally{Math.random=nativeRandom;}
 });
 assert.deepEqual(await page.locator('#home-picks strong').allTextContents(),['编号9','编号0','编号1']);
 assert.equal(await page.locator('#home-title').innerText(),'编号9');
 await page.evaluate(()=>lumeUpdate({id:'trial3',playing:false}));
 assert.equal(await page.locator('#home-title').innerText(),'编号9');
 await page.evaluate(()=>{
   const original=Math.random;
   try{Math.random=()=>0;$('home-refresh').click();}finally{Math.random=original;}
 });
 assert.deepEqual(await page.locator('#home-picks strong').allTextContents(),['编号0','编号1','编号2']);
 assert.equal(await page.locator('#home-title').innerText(),'编号9');
 await page.evaluate(()=>lumeUpdate({songs:[{id:'only',title:'仅有一首'}]}));
 assert.deepEqual(await page.locator('#home-picks strong').allTextContents(),['仅有一首']);
 await page.evaluate(()=>lumeUpdate({songs:[]}));
 assert.equal(await page.locator('#home-title').innerText(),'导入音乐');
 await page.evaluate(()=>lumeUpdate({...savedState,playing:true}));
 await page.screenshot({path:path.join(out,platform+'-home.png')});await page.locator('#home-played').click();assert.equal(await page.locator('#home-recent .home-track').count(),1);
 for(const width of [320,390,844]){await page.setViewportSize({width,height:width===844?390:844});assert(await page.evaluate(()=>document.getElementById('scroll').scrollWidth<=document.getElementById('scroll').clientWidth+1),'no home overflow '+width);}
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>navigate('space'));
 for(const selector of ['#manual-button','#refresh-spaces']){
   const offset=await page.locator(selector).evaluate(b=>{
     const box=b.getBoundingClientRect(),icon=b.querySelector('svg').getBoundingClientRect();
     return Math.max(Math.abs(icon.x+icon.width/2-box.x-box.width/2),Math.abs(icon.y+icon.height/2-box.y-box.height/2));
   });
   assert(offset<1,selector+' icon centered');
 }
 assert.equal(await page.locator('#space .glass-card').count(),0);const local=await page.locator('#local-device').evaluate(e=>{const r=e.getBoundingClientRect();return Array.from(e.children).map(n=>({y:n.getBoundingClientRect().y,height:n.getBoundingClientRect().height,container:r.height}));});assert(local.every(r=>Math.abs((r.y+r.height/2)-(local[0].y+local[0].height/2))<2),'model one line');
 await page.locator('#manual-button').click();assert(await page.locator('#pair').isVisible());assert.equal(await page.locator('#manual-button').getAttribute('aria-label'),'手动配对');
 await page.locator('#manual-button').click();await page.locator('#refresh-spaces').click();assert.equal(await page.evaluate(()=>calls.filter(r=>r.type==='search').length),1);
 await page.evaluate(()=>lumeUpdate({searching:false,status:'搜索已停止，选择空间后在主机上允许加入。',hosts:[{name:'客厅电脑 · Windows',url:'http://192.168.1.20:46321'},{name:'HUAWEI Pura 80 的播放空间',url:'http://192.168.1.21:46321'}]}));
 await page.screenshot({path:path.join(out,platform+'-space.png')});assert.equal(await page.locator('#hosts .space-device').count(),2);
 await page.evaluate(()=>lumeUpdate({joined:true,selfId:'self',outputs:[{id:'self',name:state.model,platform:state.platform,channel:'left',delayMs:0,volume:.6,enabled:true},{id:'peer',name:'客厅电脑',platform:'Windows',channel:'right',delayMs:20,volume:.8,enabled:true}]}));assert.equal(await page.locator('#outputs .output-device').count(),2);
 await page.locator('#outputs .output-device').nth(1).locator('select').selectOption('stereo');assert(await page.evaluate(()=>calls.some(r=>r.type==='output'&&r.id==='peer'&&r.patch.channel==='stereo')));
 await page.screenshot({path:path.join(out,platform+'-devices.png')});await page.evaluate(()=>openBrowse('settings'));await page.getByRole('checkbox',{name:'横屏播放时保持屏幕常亮'}).check();assert(await page.evaluate(()=>calls.some(r=>r.type==='landscapeAwake'&&r.enabled)));
 await page.evaluate(()=>{lumeUpdate({joined:false,outputs:[],hosts:[]});navigate('space');});const before=await page.evaluate(()=>calls.filter(r=>r.type==='search').length);await page.clock.install();await page.clock.fastForward(61000);assert.equal(await page.evaluate(()=>calls.filter(r=>r.type==='search').length),before,'no automatic search loop');
 assert.deepEqual(errors,[]);report.push({platform,checks:['home 320/390/844 responsive','native catalog and activity','down opens transport and up opens navigation while scrolling','featured song previews','album search in library','shared five-tab navigation','two-direction swipes with 0/33/80/100% drawer boundary','dock above open sidebar','pair and refresh icons centered','independent random draws and empty catalog','model single row','icon pairing','one refresh dispatch','individual device controls','awake setting dispatch','no auto searches for 61 seconds'],errors});await context.close();
}await writeFile(path.join(out,'ui-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}finally{await browser.close();server.close();}
