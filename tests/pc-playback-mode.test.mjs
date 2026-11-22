import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../server/index.mjs';

async function fixture() {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lume-pc-modes-'));
  const resourcesDir=path.join(directory,'resources'),demoDir=path.join(resourcesDir,'demo');
  const staticDir=path.join(directory,'dist'),dataDir=path.join(directory,'data');
  await fs.mkdir(demoDir,{recursive:true});await fs.mkdir(staticDir,{recursive:true});
  await fs.writeFile(path.join(staticDir,'index.html'),'<html>PC mode test</html>');
  const ids=['a','b','c'];
  const wav=Buffer.alloc(44+8000*6*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
  wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  for(const id of ids)await fs.writeFile(path.join(demoDir,id+'.wav'),wav);
  await fs.writeFile(path.join(demoDir,'manifest.json'),JSON.stringify(ids.map(id=>({
    id,title:id,artist:'LUME',album:'PC playback modes',duration:6,format:'WAV',file:id+'.wav',artwork:'/covers/1.svg'
  }))));
  const config={port:0,host:'127.0.0.1',resourcesDir,staticDir,dataDir};
  let server=await startServer(config);
  async function request(route,body) {
    const response=await fetch(server.url+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
    const state=await response.json();assert.equal(response.status,200,JSON.stringify(state));return state;
  }
  return {ids,act:input=>request('/api/action',input),state:()=>request('/api/state'),
    restart:async()=>{await server.close();server=await startServer(config);},
    close:async()=>{
      await server.close();
      const resolved=path.resolve(directory);
      assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith('lume-pc-modes-'));
      await fs.rm(resolved,{recursive:true,force:true});
    }
  };
}

async function until(f,predicate) {
  const deadline=Date.now()+2000;
  while(Date.now()<deadline){const state=await f.state();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,15));}
  throw Error('Playback mode transition timed out');
}

test('PC shuffle action keeps the queue intact, changes manual next, and switches back to sequence',async()=>{
  const f=await fixture();
  try {
    await f.act({type:'repeat',value:'one'});
    await f.act({type:'play',trackId:'b'});
    let state=await f.act({type:'shuffle',value:true});
    assert.equal(state.playback.shuffle,true);assert.equal(state.playback.trackId,'b');
    for(let index=0;index<5;index++){
      const previous=state.playback.trackId;
      state=await f.act({type:'next'});
      assert.notEqual(state.playback.trackId,previous,'manual next skips even when single-repeat is enabled');
      assert.ok(f.ids.includes(state.playback.trackId));
      assert.equal(state.playback.playing,true);
      assert.deepEqual(state.queue,f.ids,'shuffle is a playback mode, not a destructive queue reorder');
    }
    state=await f.act({type:'shuffle',value:false});assert.equal(state.playback.shuffle,false);
    await f.act({type:'play',trackId:'a'});
    state=await f.act({type:'next'});assert.equal(state.playback.trackId,'b');
    state=await f.act({type:'next'});assert.equal(state.playback.trackId,'c');
  } finally {await f.close();}
});

test('natural ends honor shuffle, while single-repeat takes precedence and sequence-off stops at the end',async()=>{
  const f=await fixture();
  try {
    await f.act({type:'shuffle',value:true});await f.act({type:'repeat',value:'off'});
    await f.act({type:'play',trackId:'c'});await f.act({type:'seek',position:5.98});
    let state=await until(f,state=>state.playback.trackId!=='c');
    assert.equal(state.playback.playing,true,'current shuffle mode continues even with repeat off');
    assert.deepEqual(state.queue,f.ids);
    await f.act({type:'repeat',value:'one'});await f.act({type:'play',trackId:'c'});
    await f.act({type:'seek',position:5.98});
    state=await until(f,state=>state.playback.position<1);
    assert.equal(state.playback.trackId,'c');assert.equal(state.playback.playing,true);
    await f.act({type:'shuffle',value:false});await f.act({type:'repeat',value:'off'});
    await f.act({type:'seek',position:5.98});
    state=await until(f,state=>!state.playback.playing);
    assert.equal(state.playback.trackId,'c');assert.equal(state.playback.position,6);
  } finally {await f.close();}
});

test('shuffle mode is restored after the local server restarts',async()=>{
  const f=await fixture();
  try {
    await f.act({type:'shuffle',value:true});await f.restart();
    let state=await f.state();assert.equal(state.playback.shuffle,true);
    await f.act({type:'shuffle',value:false});await f.restart();
    state=await f.state();assert.equal(state.playback.shuffle,false);
  } finally {await f.close();}
});
