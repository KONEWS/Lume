import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';import {createInterface} from 'node:readline';import {createHash} from 'node:crypto';import {writeFile} from 'node:fs/promises';
const out='artifacts/local-media-20261121',adb=process.env.LOCALAPPDATA+'/Android/Sdk/platform-tools/adb.exe',remote='/data/local/tmp/lume-local-media-test';
const hash=b=>createHash('sha256').update(b).digest('hex');
function wav(freq){const rate=48000,frames=rate*20,b=Buffer.alloc(44+frames*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*4,40);for(let i=0;i<frames;i++){b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*freq/rate)*6000),44+i*4);b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*(freq+100)/rate)*9000),46+i*4);}return b;}
const first=wav(220),second=wav(330);await writeFile(out+'/first.wav',first);await writeFile(out+'/second.wav',second);
execFileSync(adb,['shell','mkdir','-p',remote]);for(const [name,target] of [['local-media-protocol-test','run'],['first.wav','host.wav'],['first.wav','copy.wav'],['second.wav','second.wav']])execFileSync(adb,['push',out+'/'+name,remote+'/'+target]);execFileSync(adb,['shell','chmod','700',remote+'/run']);
execFileSync(adb,['forward','tcp:49321','tcp:49321']);
const proc=spawn(adb,['shell',remote+'/run'],{stdio:['pipe','pipe','pipe']}),lines=createInterface({input:proc.stdout});let receive;
lines.on('line',s=>{try{receive?.(JSON.parse(s));}catch{}});const command=b=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('native test timeout')),20000);receive=v=>{clearTimeout(t);receive=null;resolve(v);};proc.stdin.write(JSON.stringify(b)+'\n');});
const post=async(route,body,cookie='')=>{const r=await fetch('http://127.0.0.1:49321/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});assert.equal(r.status,200);return {data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};const checks=[];
try{
 for(const text of ['', 'abc', 'x'.repeat(1000000)])assert.equal((await command({type:'media-test',text})).sha256,hash(Buffer.from(text)));checks.push('SHA-256 vectors empty/abc/million bytes agree with Node crypto');
 const info=await command({type:'start',name:'Isolated mixed-source protocol',songs:[{id:'first',title:'Same title',path:remote+'/host.wav'},{id:'second',title:'Same title',path:remote+'/second.wav'}]});assert(info.pin);
 const auth=(await post('pair',{code:info.pin})).cookie;
 await post('action',{type:'play',trackId:'first'},auth);
 let state;for(let i=0;i<50;i++){state=(await post('receiver',{platform:'Android',model:'Local device'},auth)).data;if(state.audioIdentity)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(state.audioIdentity,'sha256:'+hash(first));assert.equal(state.audioBytes,first.length);
 const local=await command({type:'media-test',path:remote+'/copy.wav'});assert.equal(local.audioIdentity,state.audioIdentity);
 const wrong=await command({type:'media-test',path:remote+'/second.wav'});assert.notEqual(wrong.audioIdentity,state.audioIdentity);checks.push('complete-file identity matches renamed copy and rejects same-title equal-size different audio');
 const streamCookie=(await post('pair',{code:info.pin})).cookie;const streamState=(await post('receiver',{platform:'HarmonyOS',model:'Missing-song device'},streamCookie)).data;assert.equal(streamState.trackId,'first');assert.equal(streamState.roomPlaying,state.roomPlaying);
 for(const channel of ['stereo','left','right','mono'])for(const block of [0,2,4]){
  const local=await command({type:'media-test',path:remote+'/copy.wav',channel,block});const r=await fetch(`http://127.0.0.1:49321/api/pcm/first/${channel}/${block}`,{headers:{Cookie:streamCookie}});assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(hash(bytes),local.sha256);assert.equal(bytes.length,local.size);
 }checks.push('local and streamed PCM identical for stereo/left/right/mono at beginning, middle, end');
 const expectedPcm=await command({type:'media-test',path:remote+'/copy.wav',channel:'stereo',block:0,identity:local.audioIdentity});
 for(const fallback of [false,true]){
  const result=execFileSync(adb,['shell','app_process','-Djava.class.path='+remote+'/classes.dex','-Djava.library.path='+remote,'/system/bin','local.lume.receiver.PcmSourceHarness',remote+'/copy.wav',fallback?'sha256:'+'0'.repeat(64):local.audioIdentity,fallback?'http://127.0.0.1:49321/api/pcm/first/stereo':'http://127.0.0.1:1/unused',auth],{encoding:'utf8',timeout:20000});
  const checked=JSON.parse(result.split('\n').find(line=>line.startsWith('{')));assert.equal(checked.sha256,expectedPcm.sha256);assert.equal(checked.localFailed,fallback);
 }
 checks.push('production Android Java/JNI PCM loader succeeds with host unavailable when local matches, and falls back to host when local identity fails; renderer disabled');

 await post('action',{type:'pause'},auth);await post('action',{type:'seek',position:11.25},auth);
 for(const [platform,cookie] of [['Android',auth],['HarmonyOS',streamCookie]]){const s=(await post('receiver',{platform},cookie)).data;assert.equal(s.roomPlaying,false);assert.equal(s.position,11.25);}
 const lateCookie=(await post('pair',{code:info.pin})).cookie;assert.equal((await post('receiver',{platform:'Windows'},lateCookie)).data.position,11.25);
 await post('action',{type:'play'},auth);for(const [platform,cookie] of [['Android',auth],['HarmonyOS',streamCookie],['Windows',lateCookie]])assert.equal((await post('receiver',{platform},cookie)).data.roomPlaying,true);checks.push('mixed local/missing clients and late Windows join share pause/seek/play timeline');
 execFileSync(adb,['shell','rm',remote+'/copy.wav']);assert.equal((await command({type:'media-test',path:remote+'/copy.wav',block:2})).size,0);assert.equal((await fetch('http://127.0.0.1:49321/api/pcm/first/stereo/2',{headers:{Cookie:auth}})).status,200);checks.push('deleted local file returns no PCM and host block remains available for fallback');
 await post('action',{type:'next'},auth);for(const [platform,cookie] of [['Android',auth],['HarmonyOS',streamCookie],['Windows',lateCookie]])assert.equal((await post('receiver',{platform},cookie)).data.trackId,'second');checks.push('all mixed clients follow track change');
 const report={runtime:'Android arm64 isolated native test process; shared production Room/Decoder/local-media code, test-only ports',checks,limitations:'No app UI interaction, speaker playback, or physical cross-device clock measurement'};await writeFile(out+'/native-mixed-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await command({type:'stop'}).catch(()=>{});proc.stdin.end();proc.kill();execFileSync(adb,['forward','--remove','tcp:49321']);}
