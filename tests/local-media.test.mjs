import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {MediaIdentities,findLocalTrack} from '../server/local-media.mjs';
import {JoinedRoom} from '../server/joined-room.mjs';
import {playerFixture,phoneFixture,joined,until} from './helpers/joined-room-fixtures.mjs';
const identity=b=>({audioIdentity:'sha256:'+createHash('sha256').update(b).digest('hex'),audioBytes:b.length});
test('content match rejects identical titles and equal byte sizes, accepts renamed copies, invalidates modified files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lume-local-match-'));
 try{
  const cache=new MediaIdentities(),a=Buffer.from('same-size-original'),b=Buffer.from('same-size-other!!!');assert.equal(a.length,b.length);
  await fs.writeFile(path.join(dir,'a'),a);await fs.writeFile(path.join(dir,'b'),b);
  const tracks=[{id:'bad',title:'Same title',file:'b',bytes:b.length},{id:'good',title:'Renamed copy',file:'a',bytes:a.length}],where=t=>path.join(dir,t.file);
  const expected=identity(a);assert.equal((await findLocalTrack(tracks,where,cache,expected.audioIdentity,expected.audioBytes)).id,'good');
  await fs.writeFile(path.join(dir,'a'),b);assert.equal(cache.peek(path.join(dir,'a')).audioIdentity,undefined);
  assert.equal(await findLocalTrack(tracks,where,cache,expected.audioIdentity,expected.audioBytes),null);
  assert.equal(await findLocalTrack(tracks,where,cache,'Same title',a.length),null);
 }finally{assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});}
});
test('late local match cannot cross a song or room generation',async()=>{
 const pending=[],room=new JoinedRoom({resolveLocal:()=>new Promise(r=>pending.push(r))});
 const data=id=>({trackId:id,...identity(Buffer.from(id))});room.refreshLocal(data('a'),room.generation);room.refreshLocal(data('b'),room.generation);
 pending[0]({id:'local-a'});await new Promise(r=>setImmediate(r));assert.equal(room.localTrack,null);
 pending[1]({id:'local-b'});await until(()=>room.localTrack);assert.equal(room.localTrack.id,'local-b');
 room.refreshLocal(data('c'),room.generation);await room.leave();pending[2]({id:'local-c'});await new Promise(r=>setImmediate(r));assert.equal(room.localTrack,null);
});
for(const platform of ['Android','HarmonyOS'])test(`desktop independently prefers local audio and lyrics in ${platform} room, with fallback and same controls`,async()=>{
 const player=await playerFixture(),phone=await phoneFixture(platform);
 try{
  const bytes=await fs.readFile(new URL('./fixtures/channel-check.wav',import.meta.url)),audio=path.join(player.directory,'Renamed.wav'),words=path.join(player.directory,'Renamed.lrc');
  await fs.writeFile(audio,bytes);await fs.writeFile(words,'[00:01.00]LOCAL WORDS');
  const imported=await player.service.importLocal([audio],[words],{links:JSON.stringify([{lyrics:0}])});assert.equal(imported.imported,1);
  const local=(await player.state()).tracks.find(t=>t.title==='Renamed');phone.identity=identity(bytes);phone.details={cover:'',lyrics:'[00:01.00]HOST WORDS'};
  await joined(player,phone);await until(async()=>(await player.state()).tracks.find(t=>t.id==='phone-a')?.localAudioKey===local.id);
  const read=await fetch(player.service.url+'/media/phone-a',{headers:{Range:'bytes=0-43'}});assert.equal(read.status,206);assert.deepEqual(Buffer.from(await read.arrayBuffer()),bytes.subarray(0,44));
  assert.equal(phone.requests.filter(r=>r.path.startsWith('/api/listen/')).length,0);
  assert.equal(await player.service.readLyrics('phone-a'),'[00:01.00]LOCAL WORDS');
  await fs.unlink(path.join(player.directory,'data/media',local.id+'.lrc'));
  await until(async()=>(await player.service.readLyrics('phone-a')).includes('HOST WORDS'));
  await player.act({type:'pause'});assert.equal(phone.playing,false);await player.act({type:'seek',position:38});assert.equal(phone.position,38);await player.act({type:'play'});assert.equal(phone.playing,true);
  const forced=await fetch(player.service.url+'/media/phone-a?remote=1');assert.deepEqual(Buffer.from(await forced.arrayBuffer()),phone.bytes);
  const files=await fs.readdir(path.join(player.directory,'data/media'));const file=files.find(f=>f.startsWith(local.id)&&!f.endsWith('.lrc'));assert(file);await fs.unlink(path.join(player.directory,'data/media',file));
  const missing=await fetch(player.service.url+'/media/phone-a');assert.deepEqual(Buffer.from(await missing.arrayBuffer()),phone.bytes);
  phone.identity=identity(Buffer.from('missing next song'));await player.act({type:'next'});assert.equal((await player.state()).tracks.find(t=>t.id==='phone-b').localAudioKey,undefined);
  const next=await fetch(player.service.url+'/media/phone-b');assert.deepEqual(Buffer.from(await next.arrayBuffer()),phone.bytes);
 }finally{await player.close();await phone.close();}
});

test('desktop host serves the same identity and timeline to local-capable and missing-song native receivers',async()=>{
 const player=await playerFixture();
 try{
  const bytes=await fs.readFile(new URL('./fixtures/channel-check.wav',import.meta.url)),file=path.join(player.directory,'host.wav');await fs.writeFile(file,bytes);await player.service.importLocal([file],[],{});
  const song=(await player.state()).tracks.find(t=>t.title==='host');await player.act({type:'play',trackId:song.id});
  const clients=[{id:'native-android-local-123456',platform:'Android',model:'Local candidate'},{id:'native-harmony-missing-123456',platform:'HarmonyOS',model:'No song'}];
  const poll=c=>player.request('/api/receiver',c).then(r=>{assert.equal(r.status,200);return r.data;});
  const first=await until(async()=>{const s=await poll(clients[0]);return s.audioIdentity&&s;});const second=await poll(clients[1]);
  assert.equal(first.audioIdentity,identity(bytes).audioIdentity);assert.equal(second.audioIdentity,first.audioIdentity);assert(first.media&&second.media);assert.equal(first.trackId,second.trackId);
  await player.act({type:'pause'});await player.act({type:'seek',position:.25});
  for(const c of clients){const s=await poll(c);assert.equal(s.roomPlaying,false);assert.equal(s.position,.25);assert.equal(s.trackId,song.id);}
  await player.act({type:'play'});assert.equal((await poll(clients[1])).roomPlaying,true);
 }finally{await player.close();}
});
