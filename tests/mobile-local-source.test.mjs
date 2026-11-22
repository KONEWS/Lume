import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import ts from 'typescript';import {readFile} from 'node:fs/promises';
function load(source,globals){const js=ts.transpileModule(source.replace(/^import .*;\r?\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;const context={exports:{},...globals};vm.runInNewContext(js,context);return context.exports;}
const code=await readFile('mobile/harmony/entry/src/main/ets/engine/PcmOutput.ets','utf8');
const settle=()=>new Promise(r=>setTimeout(r,10));
for(const mode of ['local','missing','throw'])test('HarmonyOS production PCM loader independently chooses '+mode,async()=>{
 let remote=0;const puts=[],localCalls=[];const core={reset(){},sync(){return 0;},gaps(){return 0;},close(){},put(i,b){puts.push([i,b.byteLength]);},async localMedia(...args){localCalls.push(args);if(mode==='throw')throw Error('file revoked');return new ArrayBuffer(mode==='missing'?0:16);}};
 const http={HttpDataType:{ARRAY_BUFFER:1},createHttp:()=>({destroy(){},async request(){remote++;return {responseCode:200,result:new ArrayBuffer(16)};}})};
 const {PcmOutput}=load(code,{core,http}),output=new PcmOutput();output.update('http://host/api/pcm/song/stereo','cookie',true,9,20,25,.7,1000,'local.wav','stereo','sha256:expected');await settle();
 assert(puts.length>0);assert(localCalls.every(c=>c[3]==='sha256:expected'));assert.equal(remote===0,mode==='local');output.close();
});
test('HarmonyOS production PCM loader rejects in-flight previous-track data',async()=>{
 let resolve;const puts=[];const core={reset(){},sync(){return 0;},gaps(){return 0;},close(){},put(i,b){puts.push(i);},localMedia:()=>new Promise(r=>{resolve=r;})};const http={HttpDataType:{ARRAY_BUFFER:1},createHttp:()=>({destroy(){},request:()=>new Promise(()=>{})})};const {PcmOutput}=load(code,{core,http}),o=new PcmOutput();o.update('http://host/a','',true,0,1,0,1,1,'local-a','stereo','old');o.update('http://host/b','',true,0,1,0,1,1,'','stereo','');resolve(new ArrayBuffer(16));await settle();assert.deepEqual(puts,[]);o.close();
});
