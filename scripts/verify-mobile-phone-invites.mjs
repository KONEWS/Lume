import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url)),{chromium}=require('playwright');
const out='artifacts/phone-invites-20261121';
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const server=createServer(async(req,res)=>{try{const f=path.join(assets,new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(f)]||'application/octet-stream');res.end(await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try{for(const platform of ['Android','HarmonyOS']){
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.calls=[];window.LumeNative={dispatch:raw=>calls.push(JSON.parse(raw))};});
 await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);
 await page.waitForFunction(()=>typeof lumeUpdate==='function');
 await page.evaluate(platform=>{lumeUpdate({platform,hosting:true,joined:true,model:'测试房主',address:'192.168.1.10:46321',hostPin:'123456'});navigate('space');},platform);
 await page.locator('#search-phones').click();assert.equal(await page.evaluate(()=>calls.at(-1).type),'searchPhones');
 await page.evaluate(()=>lumeUpdate({phoneSearching:true,nearbyPhones:[{id:'peer123',model:'测试受邀设备',platform:'HarmonyOS',address:'192.168.1.11'}]}));
 await page.getByRole('button',{name:'邀请加入',exact:true}).click();assert.deepEqual(await page.evaluate(()=>calls.at(-1)),{type:'invitePhone',id:'peer123'});
 await page.screenshot({path:`${out}/${platform}-host.png`});
 await page.evaluate(()=>lumeUpdate({phoneSearching:false}));assert(await page.getByRole('button',{name:'邀请加入',exact:true}).isDisabled());
 await page.evaluate(()=>{lumeUpdate({hosting:false,joined:false});lumeInvite({url:'http://192.168.1.10:46321',name:'发出邀请的空间',inviteToken:'secret',deviceId:'peer123'});});
 assert.equal(await page.locator('#accept-invite').innerText(),'加入');
 await page.screenshot({path:`${out}/${platform}-invite.png`});await page.locator('#accept-invite').click();await page.locator('#room-invite').waitFor({state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c.type==='join').at(-1)),{type:'join',url:'http://192.168.1.10:46321',pin:'',inviteToken:'secret',deviceId:'peer123'});
 await page.evaluate(()=>lumeInvite({url:'http://192.168.1.10:46321',name:'测试',inviteToken:'ignore',deviceId:'peer123'}));
 const n=await page.evaluate(()=>calls.filter(c=>c.type==='join').length);await page.locator('#decline-invite').click();await page.locator('#room-invite').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>calls.filter(c=>c.type==='join').length),n);
 await page.evaluate(()=>{lumeUpdate({hosts:[{url:'http://192.168.1.12:46321',name:'普通空间'}]});});await page.locator('#hosts button').click();assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c.type==='join').at(-1)),{type:'join',url:'http://192.168.1.12:46321',pin:''});
 await page.clock.install();await page.evaluate(()=>lumeInvite({url:'http://192.168.1.10:46321',name:'超时空间',inviteToken:'expired',deviceId:'peer123'}));await page.clock.runFor(31500);assert.equal(await page.locator('#room-invite').evaluate(e=>e.open),false);
 assert.deepEqual(errors,[]);results.push({platform,checks:['host scan dispatch','targeted invitation','search completion disables stale peers','accept carries exact host and token','ignore does not join','ordinary join unchanged','dialog expires after 30 seconds'],errors});await page.close();
}await writeFile(out+'/ui-verification.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();server.close();}





