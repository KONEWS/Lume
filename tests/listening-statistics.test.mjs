import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../server/index.mjs';
import '../mobile/player-assets/player/listening.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('calendar periods use session start for completions, split actual time, empty and local year/month/week edges',()=>{
  const {days,period,key}=globalThis.lumeListening;
  const start=new Date(2026,11,31,23,59,59).getTime(),end=new Date(2027,0,1,0,0,1);
  const records=[{startedAt:start,completed:true,days:{'2026-12-31':1000,'2027-01-01':1000}},{startedAt:+end,completed:false,days:{'2027-01-01':500}}];
  const totals=days(records);assert.deepEqual(totals,{'2026-12-31':{starts:1,ms:1000},'2027-01-01':{starts:0,ms:1500}});
  for(const kind of ['year','month']){assert.equal(period(totals,kind,0,end).starts,0);assert.equal(period(totals,kind,-1,end).starts,1);assert.equal(period(totals,kind,0,end).ms,1500);}
  assert.equal(period(totals,'week',0,end).starts,1);assert.equal(key(period(totals,'week',0,end).start),'2026-12-28');
  assert.equal(period({},'month',0,new Date(2028,1,29)).starts,0);assert.equal(key(period({},'month',0,new Date(2028,1,29)).end),'2028-03-01');
  assert.equal(period(totals,'week',0,new Date(2027,0,4)).starts,0);
});
test('real desktop playback: start timestamp, pause/resume, partial listening, seek rejection, natural completion and loops persist',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'lume-statistics-')),media=path.join(root,'data/media');await mkdir(media,{recursive:true});await mkdir(path.join(root,'dist'));
  const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
  await writeFile(path.join(media,'one.wav'),wav);await writeFile(path.join(root,'data/library.json'),JSON.stringify({tracks:[{source:'import',id:'one',file:'one.wav',title:'统计验证',duration:1}]}));
  const config={port:0,host:'127.0.0.1',dataDir:path.join(root,'data'),resourcesDir:path.join(root,'resources'),staticDir:path.join(root,'dist')};let server=await startServer(config);
  const act=async body=>(await fetch(server.url+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();const state=async()=>(await fetch(server.url+'/api/state')).json();
  try{
    await act({type:'repeat',value:'off'});let s=await act({type:'play',trackId:'one'});assert.equal(s.tracks[0].playCount,0);assert.equal(s.playRecords.length,1);const first=s.playRecords[0];assert(Math.abs(first.startedAt-Date.now())<1000);
    await wait(230);s=await act({type:'pause'});const ms=s.playRecords[0].listenedMs;assert(ms>=180&&ms<600);await wait(250);s=await state();assert.equal(s.playRecords[0].listenedMs,ms);
    s=await act({type:'play'});assert.equal(s.playRecords.length,1);assert.equal(s.playRecords[0].session,first.session);await wait(850);s=await state();assert.equal(s.tracks[0].playCount,1);assert.equal(s.playRecords[0].completed,true);assert(s.playRecords[0].listenedMs>=990&&s.playRecords[0].listenedMs<=1001);
    await wait(100);assert.equal((await state()).tracks[0].playCount,1);
    await act({type:'play',trackId:'one'});await wait(150);await act({type:'seek',position:.99});await wait(80);s=await state();assert.equal(s.tracks[0].playCount,1);assert.equal(s.playRecords[1].completed,false);assert(s.playRecords[1].listenedMs<400);
    await act({type:'play',trackId:'one'});await wait(120);await act({type:'next'});s=await act({type:'pause'});assert.equal(s.playRecords[2].completed,false);assert(s.playRecords[2].listenedMs>=80);
    await act({type:'repeat',value:'one'});await act({type:'play',trackId:'one'});await wait(2150);s=await act({type:'pause'});assert.equal(s.tracks[0].playCount,3);assert.equal(s.playRecords.filter(r=>r.completed).length,3);
    await server.close();const disk=JSON.parse(await readFile(path.join(root,'data/library.json'),'utf8'));assert.equal(disk.playRecords.filter(r=>r.completed).length,3);server=await startServer(config);s=await state();assert.equal(s.tracks[0].playCount,3);assert.deepEqual(s.playRecords,disk.playRecords);
  }finally{await server.close();}
});
