import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {writeFile} from 'node:fs/promises';
const adb=process.env.LOCALAPPDATA+'/Android/Sdk/platform-tools/adb.exe',out='artifacts/phone-invites-20261121';
execFileSync(adb,['push',out+'/room-protocol-test','/data/local/tmp/lume-invite-protocol-test']);
execFileSync(adb,['shell','chmod','700','/data/local/tmp/lume-invite-protocol-test']);
const proc=spawn(adb,['shell','/data/local/tmp/lume-invite-protocol-test'],{stdio:['pipe','pipe','pipe']});
const lines=createInterface({input:proc.stdout});let receive;
lines.on('line',line=>{try{receive?.(JSON.parse(line));}catch{}});
const command=body=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('native timeout')),8000);receive=v=>{clearTimeout(timeout);receive=null;resolve(v);};proc.stdin.write(JSON.stringify(body)+'\n');});
const udp=dgram.createSocket('udp4'),invitations=[];
udp.on('message',(raw,remote)=>{let b;try{b=JSON.parse(raw);}catch{return;}if(b.service==='lume-find-phone/1')for(const platform of ['Android','HarmonyOS'])udp.send(Buffer.from(JSON.stringify({service:'lume-phone/1',nonce:b.nonce,id:'protocol-'+platform,platform,model:'Protocol fixture '+platform})),remote.port,remote.address);else if(b.service==='lume-invite/1')invitations.push(b);});
await new Promise(r=>udp.bind(46324,'0.0.0.0',r));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const base='http://192.168.43.5:49321';const checks=[];
async function post(path,data,cookie=''){const res=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data),signal:AbortSignal.timeout(5000)});return {status:res.status,cookie:res.headers.get('set-cookie')?.split(';')[0],data:await res.text()};}
async function issue(platform){await command({type:'invitePhone',id:'protocol-'+platform});for(let i=0;i<30;i++){const found=invitations.find(v=>v.id==='protocol-'+platform);if(found){invitations.splice(invitations.indexOf(found),1);return {inviteToken:found.inviteToken,deviceId:found.id};}await sleep(100);}throw new Error('invitation not received');}
async function start(){const s=await command({type:'start',name:'Isolated protocol verification',songs:[]});assert(s.pin);await command({type:'searchPhones'});for(let i=0;i<30;i++){await sleep(200);const status=await command({type:'status'});if(status.nearbyPhones?.filter(p=>p.id.startsWith('protocol-')).length===2)return;}throw new Error('UDP discovery failed');}
try{
 await start();checks.push('real UDP discovery of Android and HarmonyOS device identities');
 const a=await issue('Android');assert.equal((await post('join/invite',{...a,deviceId:'wrong'})).status,403);assert.equal((await post('join/invite',{...a,inviteToken:'fake'})).status,403);
 const accepted=await post('join/invite',a);assert.equal(accepted.status,200);assert(accepted.cookie);assert.equal((await command({type:'status'})).pending.length,0);
 assert.equal((await post('receiver',{platform:'Android',model:'Protocol Android'},accepted.cookie)).status,200);assert.equal((await post('join/invite',a)).status,403);checks.push('explicit invite establishes authenticated receiver without pending approval; wrong recipient, forgery, replay rejected');
 const h=await issue('HarmonyOS');const acceptedH=await post('join/invite',h);assert.equal(acceptedH.status,200);assert.equal((await post('receiver',{platform:'HarmonyOS',model:'Protocol HarmonyOS'},acceptedH.cookie)).status,200);checks.push('HarmonyOS invitation establishes receiver session');
 const request=await post('join/request',{platform:'Android',model:'Uninvited'});const ticket=JSON.parse(request.data);assert.equal(JSON.parse((await post('join/status',ticket)).data).decision,'pending');assert.equal((await command({type:'status'})).pending.length,1);
 await command({type:'decide',id:ticket.id,enabled:true});const allow=await post('join/status',ticket);assert(allow.cookie);assert.equal(JSON.parse(allow.data).decision,'allow');checks.push('ordinary uninvited request remains pending until explicit host approval');
 const expiring=await issue('HarmonyOS');console.log('Protocol checks passed; waiting for the real 60-second invitation expiry.');await sleep(61000);assert.equal((await post('join/invite',expiring)).status,403);checks.push('60-second expired invitation rejected');
 await command({type:'searchPhones'});for(let i=0;i<12;i++){await sleep(200);await command({type:'status'});}const old=await issue('Android');await command({type:'stop'});await start();assert.equal((await post('join/invite',old)).status,403);checks.push('closing and recreating room invalidates old invitation');
 const report={platform:'Android arm64 native executable',note:'Actual shared room code, isolated test ports, empty catalog; no app UI interaction or audio playback',checks};await writeFile(out+'/protocol-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await command({type:'stop'}).catch(()=>{});proc.stdin.end();udp.close();proc.kill();}
