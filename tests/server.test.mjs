import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { WebSocket } from 'ws';
import { startServer } from '../server/index.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

function wav(seconds = 2) {
  const rate = 8000;
  const samples = Math.floor(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / rate) * 5000), 44 + i * 2);
  return buffer;
}

async function fixture(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lume-tests-'));
  const resourcesDir = path.join(directory, 'resources');
  const demoDir = path.join(resourcesDir, 'demo');
  const staticDir = path.join(directory, 'dist');
  const dataDir = path.join(directory, 'data');
  await fs.mkdir(demoDir, { recursive: true });
  await fs.mkdir(staticDir, { recursive: true });
  await fs.writeFile(path.join(staticDir, 'index.html'), '<html>LUME test</html>');
  await fs.writeFile(path.join(demoDir, 'first.wav'), wav());
  await fs.writeFile(path.join(demoDir, 'second.wav'), wav());
  await fs.writeFile(path.join(demoDir, 'manifest.json'), JSON.stringify([
    { id: 'first', title: '测试一', artist: 'LUME', album: '测试', duration: 2, format: 'WAV', file: 'first.wav', artwork: '/covers/1.svg' },
    { id: 'second', title: '测试二', artist: 'LUME', album: '测试', duration: 2, format: 'WAV', file: 'second.wav', artwork: '/covers/2.svg' },
  ]));
  const config = { port: 0, host: '127.0.0.1', resourcesDir, staticDir, dataDir, ...options };
  let instance = await startServer(config);
  return {
    get server() { return instance; },
    get url() { return instance.url; },
    directory,
    async restart() { await instance.close(); instance = await startServer(config); },
    async dispose() {
      await instance.close();
      const resolved = path.resolve(directory);
      const parent = path.resolve(os.tmpdir());
      assert.equal(path.dirname(resolved), parent);
      assert.ok(path.basename(resolved).startsWith('lume-tests-'));
      await fs.rm(resolved, { recursive: true, force: true });
    },
  };
}

async function request(f, route, body, headers = {}) {
  const response = await fetch(`${f.url}${route}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text() };
}
async function act(f, body) {
  const { response, data } = await request(f, '/api/action', body);
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
async function waitFor(check, timeout = 2000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 20)); }
  throw new Error('等待状态更新超时');
}

test('discovered spaces require approval and keep each phone’s calibration after reconnect', async () => {
  const f=await fixture({localAutoAuth:false});
  let socket;
  try {
    const {response}=await request(f,'/api/pair',{code:f.server.pairCode});
    const desktop={Cookie:response.headers.get('set-cookie').split(';')[0]};
    const act=(type,value)=>request(f,'/api/action',{type,value},desktop);
    const ticket=(await request(f,'/api/join/request',{platform:'Android',model:'OnePlus Test'})).data;
    assert.equal((await request(f,'/api/state',undefined,desktop)).data.pending[0].name,'OnePlus Test');
    assert.equal((await request(f,'/api/join/status',ticket)).data.decision,'pending');
    assert.equal((await request(f,'/api/join/status',{...ticket,secret:'wrong'})).response.status,404);
    assert.equal((await request(f,'/api/action',{type:'join-allow',value:ticket.id})).response.status,401);
    await act('join-allow',ticket.id);
    const delivery=await request(f,'/api/join/status',ticket);
    assert.equal(delivery.data.decision,'allow');
    const phone={Cookie:delivery.response.headers.get('set-cookie').split(';')[0]};
    assert.equal((await request(f,'/api/join/status',ticket)).response.status,404);
    const profile='1'.repeat(32);
    const body={id:'native-first-phone',platform:'Android',model:'OnePlus Test',profile};
    const poll=async(data=body)=>(await request(f,'/api/receiver',data,phone)).data;
    assert.equal((await poll()).delayMs,0);
    const change={channel:'mono',delayMs:31,volume:0.35,enabled:false,muted:true};
    assert.equal((await request(f,'/api/action',{type:'output',id:body.id,patch:change},phone)).response.status,200);
    const adjusted=await poll();
    assert.equal(adjusted.selfId,body.id);
    for(const [key,value] of Object.entries(change))assert.equal(adjusted.outputs[0][key],value);
    assert.equal(adjusted.volume,0);
    assert.equal((await request(f,'/api/action',{type:'output',id:body.id,patch:{channel:'left',delayMs:2000}},phone)).response.status,400);
    assert.equal((await poll()).channel,'mono');
    await request(f,'/api/action',{type:'output',id:body.id,patch:{enabled:true,muted:false}},phone);
    assert.equal((await request(f,'/api/state',undefined,desktop)).data.devices[0].name,'OnePlus Test');
    socket=new WebSocket(f.url.replace('http:','ws:')+'/ws',{headers:desktop});await once(socket,'open');
    socket.send(JSON.stringify({type:'device',id:body.id,patch:{delayMs:-17}}));
    await waitFor(async()=>(await poll()).delayMs===-17);
    await act('play');await act('calibration',true);
    assert.equal((await poll()).trackId,'lume-calibration');
    assert.equal((await poll()).roomPlaying,true);
    await act('calibration',false);
    assert.equal((await poll()).trackId,'first');
    assert.equal((await poll()).roomPlaying,true);
    await poll({...body,leave:true});
    assert.equal((await poll({...body,id:'native-second-session'})).delayMs,-17);
    const closed=once(socket,'close');socket.close();await closed;
    await f.restart();
    const fresh=await request(f,'/api/pair',{code:f.server.pairCode});
    const newPhone={Cookie:fresh.response.headers.get('set-cookie').split(';')[0]};
    assert.equal((await request(f,'/api/receiver',body,newPhone)).data.delayMs,-17);
    const blocked=(await request(f,'/api/join/request',{platform:'HarmonyOS'})).data;
    await request(f,'/api/action',{type:'join-deny',value:blocked.id},newPhone);
    const denied=await request(f,'/api/join/status',blocked);
    assert.equal(denied.data.decision,'deny');assert.equal(denied.response.headers.get('set-cookie'),null);
  }finally{socket?.terminate();await f.dispose();}
});

test('selects a phone library track on the computer, receives only requested bytes, and renders opposite channels',async()=>{
  const f=await fixture({localAutoAuth:false});
  try{
    const pair=async()=>({Cookie:(await request(f,'/api/pair',{code:f.server.pairCode})).response.headers.get('set-cookie').split(';')[0]});
    const pc=await pair(),hu=await pair(),one=await pair();
    const huawei={id:'native-huawei-source',platform:'HarmonyOS',model:'Mate Test'},android={id:'native-android-source',platform:'Android'};
    const poll=async(device,headers,more={})=>(await request(f,'/api/receiver',{...device,...more},headers)).data;
    await poll(huawei,hu,{sourceSongs:[{id:'field-recording',title:'同名现场.wav'}]});
    await poll(android,one,{sourceSongs:[{id:'field-recording',title:'同名现场.wav'}]});
    const libraries=(await request(f,'/api/state',undefined,pc)).data.phoneLibraries;
    assert.equal(libraries.find(source=>source.id===huawei.id).name,'Mate Test');
    assert.equal(libraries.find(source=>source.id===android.id).name,'安卓手机');
    const choose=async device=>request(f,'/api/action',{type:'source-play',deviceId:device.id,trackId:'field-recording'},pc);
    const state=async()=>(await request(f,'/api/state',undefined,pc)).data;
    assert.equal((await state()).phoneLibraries.length,2);
    await choose(android);
    const stale=(await poll(android,one)).transfer;
    await choose(huawei);
    const ticket=(await poll(huawei,hu)).transfer;
    assert.equal((await poll(android,one)).transfer,undefined);
    const bytes=await fs.readFile(new URL('./fixtures/channel-check.wav',import.meta.url));
    const upload=(token,off,end,chunk,auth)=>fetch(f.url+'/api/source-data/'+token+'?offset='+off+'&end='+end,{
      method:'PUT',headers:{...auth,'Content-Type':'application/octet-stream'},body:chunk});
    assert.equal((await upload(stale.token,0,1,bytes,one)).status,404);
    assert.equal((await upload(ticket.token,0,1,bytes,one)).status,404);
    assert.equal((await upload(ticket.token,0,0,bytes.subarray(0,65536),hu)).status,200);
    assert.equal((await upload(ticket.token,0,1,bytes,hu)).status,409);
    assert.equal((await state()).tracks.some(t=>t.source==='phone'),false);
    assert.equal((await upload(ticket.token,65536,1,bytes.subarray(65536),hu)).status,200);
    const ready=await state(),track=ready.tracks.find(t=>t.id===ready.playback.trackId);
    assert.equal(track.title,'同名现场.wav');assert.equal(track.source,'phone');assert.equal(track.sourceName,'Mate Test');assert.ok(ready.playback.playing);
    assert.deepEqual(Buffer.from(await(await fetch(f.url+'/media/'+track.id,{headers:pc})).arrayBuffer()),bytes);
    for(const [device,auth,side,tone] of [[huawei,hu,'left',.5],[android,one,'right',2.5]]){
      const r=await poll(device,auth);assert.equal(r.trackId,track.id);assert.equal(r.channel,side);
      const pcm=Buffer.from(await(await fetch(f.url+'/api/pcm/'+track.id+'/'+side+'/0',{headers:auth})).arrayBuffer());
      const peak=t=>{let n=0;for(let i=t*48000;i<t*48000+512;i++)n=Math.max(n,Math.abs(pcm.readInt16LE(i*4)));return n;};
      assert.ok(peak(tone)>1000);assert.ok(peak(tone===.5?2.5:.5)<10);
    }
    await poll(huawei,hu,{leave:true});assert.equal((await state()).phoneLibraries.length,1);
    await choose(android);const interrupted=(await poll(android,one)).transfer;
    await request(f,'/api/action',{type:'pause'},pc);
    assert.equal((await upload(interrupted.token,0,1,bytes,one)).status,404);
    await f.restart();
    const again=await pair();const fresh=(await request(f,'/api/state',undefined,again)).data;
    assert.equal(fresh.tracks.some(t=>t.source==='phone'),false);assert.deepEqual(fresh.phoneLibraries,[]);
  }finally{await f.dispose();}
});

test('PCM blocks cover a complete song including the short tail without dropping frames',async()=>{
  const f=await fixture();
  try{
    const form=new FormData();
    form.append('files',new Blob([wav(9.25)]),'continuous.wav');
    const result=await(await fetch(f.url+'/api/upload',{method:'POST',body:form})).json();
    const track=result.state.tracks.find(x=>x.title==='continuous');
    await act(f,{type:'play',trackId:track.id});
    const url=f.url+'/api/pcm/'+track.id+'/left/';
    const blocks=await Promise.all([0,1,2].map(async i=>{
      const r=await fetch(url+i);assert.equal(r.status,200);return Buffer.from(await r.arrayBuffer());
    }));
    assert.deepEqual(blocks.map(b=>b.length),[4,4,1.25].map(s=>s*48000*4));
    for(let i=1;i<blocks.length;i++){
      const last=blocks[i-1],next=blocks[i];
      let energy=0;for(let k=0;k<240;k++)energy+=Math.abs(last.readInt16LE(last.length-4*(k+1)))+Math.abs(next.readInt16LE(k*4));
      assert.ok(energy/480>1000,'no silent interval around a block boundary');
    }
    assert.equal((await fetch(url+'3')).status,404);
  }finally{await f.dispose();}
});

test('native receivers share the host shuffle state and playback mode changes', async () => {
  const f = await fixture();
  try {
    const poll = async platform => (await request(f, '/api/receiver', {id:'native-shuffle-'+platform,platform})).data;
    for (const platform of ['Android','HarmonyOS']) assert.equal((await poll(platform)).shuffle,false);
    await act(f,{type:'play',trackId:'first'});
    await act(f,{type:'shuffle',value:true});
    for (const platform of ['Android','HarmonyOS']) assert.equal((await poll(platform)).shuffle,true);
    const next=await act(f,{type:'next'});
    assert.equal(next.playback.trackId,'second');
    await act(f,{type:'pause'});
    assert.equal((await request(f,'/api/action',{type:'shuffle',value:'true'})).response.status,400);
    assert.equal((await poll('Android')).shuffle,true);
    await act(f,{type:'shuffle',value:false});
    for (const platform of ['Android','HarmonyOS']) assert.equal((await poll(platform)).shuffle,false);
    const ordered=await act(f,{type:'next'});
    assert.equal(ordered.playback.trackId,'first');
  } finally { await f.dispose(); }
});

test('paired native receivers get independent audio, synchronized controls and room colors', async () => {
  const f = await fixture({ localAutoAuth: false });
  let socket;
  try {
    const pair = async () => {
      const { response } = await request(f, '/api/pair', { code: f.server.pairCode });
      assert.equal(response.status, 200);
      return { Cookie: response.headers.get('set-cookie').split(';')[0] };
    };
    const desktop = await pair();
    const actAsDesktop = async body => {
      const { response, data } = await request(f, '/api/action', body, desktop);
      assert.equal(response.status, 200);
      return data;
    };
    const form = new FormData();
    const sample = await fs.readFile(new URL('./fixtures/channel-check.wav', import.meta.url));
    form.append('files', new Blob([sample]), 'channel-check.wav');
    const upload = await fetch(f.url+'/api/upload', { method: 'POST', headers: desktop, body: form });
    const track = (await upload.json()).state.tracks.find(item => item.source === 'import');
    await actAsDesktop({ type:'play', trackId:track.id });
    await actAsDesktop({ type:'pause' });
    await actAsDesktop({ type:'seek', position:1.25 });
    const skin = {name:'测试',background:'#102030',surface:'#304050',ink:'#FFFFFF',accent:'#ABCDEF'};
    await actAsDesktop({ type:'room-skin', value:JSON.stringify(skin) });
    const phones = [];
    for (const [platform,channel] of [['HarmonyOS','left'],['Android','right']]) {
      const headers = await pair();
      const body = { id:'native-test-'+platform, platform };
      const poll = async () => (await request(f,'/api/receiver',body,headers)).data;
      const snap = await poll();
      assert.equal(snap.channel,channel);
      assert.equal(snap.position,1.25);
      assert.equal(snap.playing,false);
      assert.deepEqual(snap.skin,skin);
      assert.equal((await fetch(f.url+snap.media)).status,401);
      const media = await fetch(f.url+snap.media,{headers});
      assert.equal(media.status,200);
      const filename = path.join(f.directory,channel+'.m4a');
      await fs.writeFile(filename,Buffer.from(await media.arrayBuffer()));
      const { stdout } = await promisify(execFile)('ffmpeg',['-v','error','-i',filename,'-ar','8000','-ac','1','-f','s16le','pipe:1'],{ encoding:'buffer',windowsHide:true });
      const rms = seconds => {
        let sum = 0;
        for (let i = seconds * 8000; i < (seconds + 0.5) * 8000; i++) sum += stdout.readInt16LE(i*2)**2;
        return Math.sqrt(sum/4000);
      };
      assert.ok(rms(channel==='left'?0.5:2.5)>1000);
      assert.ok(rms(channel==='left'?2.5:0.5)<10);
      const url=f.url+snap.media.replace('/api/receiver-media/','/api/pcm/')+'/0';
      assert.equal((await fetch(url)).status,401);
      const block=Buffer.from(await (await fetch(url,{headers})).arrayBuffer());
      assert.equal(block.length,4*48000*4);
      const power=at=>{
        let energy=0;
        for(let i=at*48000;i<(at+.25)*48000;i++)energy+=block.readInt16LE(i*4)**2;
        return Math.sqrt(energy/12000);
      };
      assert.ok(power(channel==='left'?.5:2.5)>1000);
      assert.ok(power(channel==='left'?2.5:.5)<10);
      phones.push({ body,poll,headers });
    }
    socket = new WebSocket(f.url.replace('http:','ws:')+'/ws',{headers:desktop});
    await once(socket,'open');
    socket.send(JSON.stringify({type:'device',id:phones[0].body.id,patch:{channel:'right',muted:true}}));
    await waitFor(async () => (await phones[0].poll()).channel === 'right');
    assert.equal((await phones[0].poll()).volume,0);
    assert.ok((await phones[1].poll()).volume>0);
    await actAsDesktop({type:'play'});
    assert.equal((await phones[1].poll()).playing,true);
    await actAsDesktop({type:'muted',value:true});
    assert.equal((await phones[1].poll()).volume,0);
    for (const phone of phones) await request(f,'/api/receiver',{...phone.body,leave:true},phone.headers);
    assert.equal((await request(f,'/api/state',undefined,desktop)).data.devices.length,0);
  } finally {
    socket?.terminate();
    await f.dispose();
  }
});

test('serves demo tracks, byte ranges, safe API errors and rejects foreign origins/hosts', async () => {
  const f = await fixture();
  try {
    const { response, data } = await request(f, '/api/state');
    assert.equal(response.status, 200);
    assert.equal(data.tracks.length, 2);
    assert.equal(data.playback.playing, false);
    assert.equal(data.tracks[0].file, undefined, 'private filesystem paths must not be exposed');
    const range = await fetch(`${f.url}/media/first`, { headers: { Range: 'bytes=0-43' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 0-43/${wav().length}`);
    assert.equal((await range.arrayBuffer()).byteLength, 44);
    assert.equal((await request(f, '/api/missing')).response.status, 404);
    assert.equal((await request(f, '/api/action', { type: 'play' }, { Origin: 'https://attacker.example' })).response.status, 403);
    const rebindingStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(`${f.url}/api/state`, { headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(rebindingStatus, 403);
    assert.equal((await request(f, '/api/action', { type: 'seek', position: 'bad' })).response.status, 400);
    assert.equal((await request(f, '/api/action', { type: 'play', trackId: '../../outside' })).response.status, 404);
  } finally { await f.dispose(); }
});

test('shared playback timeline supports pause, seek, natural next, loop and queue removal', async () => {
  const f = await fixture();
  try {
    await act(f, { type: 'repeat', value: 'off' });
    let state = await act(f, { type: 'play', trackId: 'first' });
    assert.equal(state.playback.playing, true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    state = await act(f, { type: 'pause' });
    assert.ok(state.playback.position >= 0.05);
    assert.equal(state.playback.playing, false);
    state = await act(f, { type: 'seek', position: 1.92 });
    assert.equal(state.playback.position, 1.92);
    await act(f, { type: 'play' });
    state = await waitFor(async () => { const { data } = await request(f, '/api/state'); return data.playback.trackId === 'second' ? data : false; });
    assert.equal(state.playback.playing, true);
    await act(f, { type: 'seek', position: 1.95 });
    state = await waitFor(async () => { const { data } = await request(f, '/api/state'); return !data.playback.playing ? data : false; });
    assert.equal(state.playback.position, 2);
    await act(f, { type: 'repeat', value: 'one' });
    await act(f, { type: 'play' });
    await act(f, { type: 'seek', position: 1.95 });
    await new Promise((resolve) => setTimeout(resolve, 130));
    state = (await request(f, '/api/state')).data;
    assert.equal(state.playback.trackId, 'second');
    assert.equal(state.playback.playing, true);
    assert.ok(state.playback.position < 1);
    state = await act(f, { type: 'queue-remove', trackId: 'second' });
    assert.equal(state.playback.trackId, 'first');
    state = await act(f, { type: 'queue-set', trackIds: [] });
    assert.equal(state.playback.trackId, null);
    assert.equal(state.playback.playing, false);
  } finally { await f.dispose(); }
});

test('imports real audio, rejects disguised data, and persists preferences and imported tracks', async () => {
  const f = await fixture();
  try {
    await act(f, { type: 'queue-set', trackIds: [] });
    const form = new FormData();
    form.append('files', new Blob([wav(1)], { type: 'audio/wav' }), 'My track.wav');
    form.append('files', new Blob(['not an audio file'], { type: 'audio/mpeg' }), 'invalid.mp3');
    const response = await fetch(`${f.url}/api/upload`, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.imported, 1);
    assert.equal(result.rejected.length, 1);
    const track = result.state.tracks.find((item) => item.source === 'import');
    assert.equal(track.title, 'My track');
    assert.equal(track.duration, 1);
    assert.deepEqual(result.state.queue, [track.id]);
    assert.equal(result.state.playback.trackId, track.id, 'import into empty queue selects first valid import');
    assert.equal(result.state.playback.playing, false, 'import never starts audio without a play action');
    await act(f, { type: 'favorite', trackId: track.id });
    await act(f, { type: 'volume', value: 0.42 });
    await act(f, { type: 'muted', value: true });
    await act(f, { type: 'room-name', value: '客厅' });
    await act(f, { type: 'play', trackId: track.id });
    await f.restart();
    const { data } = await request(f, '/api/state');
    assert.equal(data.tracks.find((item) => item.id === track.id).favorite, true);
    assert.equal(data.room.name, '客厅');
    assert.equal(data.playback.volume, 0.42);
    assert.equal(data.playback.muted, true);
    assert.equal(data.playback.playing, false, 'restart must never automatically emit sound');
    assert.equal(data.playback.trackId, track.id);
    assert.equal((await fetch(`${f.url}/media/${track.id}`)).status, 200);
    const invalid = new FormData();
    invalid.append('files', new Blob(['secret']), 'file.txt');
    assert.equal((await fetch(`${f.url}/api/upload`, { method: 'POST', body: invalid })).status, 400);
  } finally { await f.dispose(); }
});

test('folder scans skip repeat audio and playlists survive a restart', async () => {
  const f = await fixture();
  try {
    async function scan() {
      const form = new FormData();
      form.append('folders', JSON.stringify(['音乐/晨间']));
      form.append('files', new Blob([wav(1)], { type: 'audio/wav' }), '第一首.wav');
      const response = await fetch(f.url + '/api/upload', { method: 'POST', body: form });
      assert.equal(response.status, 200);
      return response.json();
    }
    const results = await Promise.all([scan(), scan()]);
    assert.equal(results[0].imported + results[1].imported, 1);
    assert.equal(results[0].skipped + results[1].skipped, 1);
    const track = results.find(r => r.imported).state.tracks.find(t => t.source === 'import');
    assert.equal(track.folder, '音乐/晨间');
    const state = await act(f, { type: 'playlist-save', value: '晨间', trackIds: [track.id, 'first'] });
    const id = state.playlists[0].id;
    await act(f, { type: 'playlist-save', playlistId: id, value: '通勤', trackIds: [track.id] });
    await f.restart();
    assert.deepEqual((await request(f, '/api/state')).data.playlists, [{ id, name: '通勤', trackIds: [track.id] }]);
    assert.equal((await scan()).skipped, 1);
  } finally { await f.dispose(); }
});

test('library charts use measured audio facts and playback counts only complete passes', async () => {
  const f = await fixture();
  try {
    const content=wav(1), form=new FormData();
    form.append('files',new Blob([content]),'晨光.wav');
    form.append('folders',JSON.stringify(['曲库']));
    form.append('lyrics','1');
    const result=await (await fetch(f.url+'/api/upload',{method:'POST',body:form})).json();
    const track=result.state.tracks.find(t=>t.source==='import');
    assert.equal(track.hasLyrics,true);assert.equal(track.bytes,content.length);assert.equal(track.quality,'lossless');
    assert.equal(result.state.tracks.find(t=>t.id==='first').hasLyrics,false);
    await act(f,{type:'queue-set',trackIds:[track.id,'first'],value:true});
    await act(f,{type:'pause'});await act(f,{type:'play'});await act(f,{type:'seek',position:0.1});
    let state=await act(f,{type:'next'});
    assert.equal(state.tracks.find(t=>t.id===track.id).playCount,0);
    assert.equal(state.tracks.find(t=>t.id==='first').playCount,0);
    await act(f,{type:'play',trackId:track.id});await new Promise(resolve=>setTimeout(resolve,1100));await act(f,{type:'pause'});
    await f.restart();
    state=(await request(f,'/api/state')).data;
    assert.equal(state.tracks.find(t=>t.id===track.id).playCount,1);
    assert.equal(state.tracks.find(t=>t.id==='first').playCount,0);
  } finally { await f.dispose(); }
});

test('websocket device registration, shared controls, duplicate identity and disconnect lifecycle', async () => {
  const f = await fixture();
  const sockets = [];
  try {
    const socket = new WebSocket(f.url.replace('http:', 'ws:') + '/ws', { origin: f.url });
    sockets.push(socket);
    const messages = [];
    socket.on('message', (raw) => messages.push(JSON.parse(raw)));
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'register', device: { id: 'browser-one', name: '浏览器', platform: 'Web', channel: 'stereo' } }));
    await waitFor(() => messages.find((message) => message.state?.devices.length === 1));
    socket.send(JSON.stringify({ type: 'device', id: 'browser-one', patch: { channel: 'left', enabled: true, volume: 0.6 } }));
    await waitFor(() => messages.find((message) => message.state?.devices[0]?.channel === 'left'));
    let { data } = await request(f, '/api/state');
    assert.equal(data.devices[0].enabled, true);
    assert.equal(data.devices[0].volume, 0.6);
    assert.equal(data.devices[0].socket, undefined);
    socket.send('not JSON');
    await waitFor(() => messages.find((message) => message.type === 'error'));
    const replacement = new WebSocket(f.url.replace('http:', 'ws:') + '/ws', { origin: f.url });
    sockets.push(replacement);
    await once(replacement, 'open');
    const oldClosed = once(socket, 'close');
    replacement.send(JSON.stringify({ type: 'register', device: { id: 'browser-one', name: '重新连接', platform: 'Web', channel: 'left', volume: 0.35, muted: true, enabled: true } }));
    await oldClosed;
    data = (await request(f, '/api/state')).data;
    assert.equal(data.devices.length, 1);
    assert.equal(data.devices[0].name, '重新连接');
    assert.equal(data.devices[0].channel, 'left');
    assert.equal(data.devices[0].volume, 0.35);
    assert.equal(data.devices[0].muted, true);
    assert.equal(data.devices[0].enabled, true);
    const replacementClosed = once(replacement, 'close');
    replacement.close(); await replacementClosed;
    await waitFor(async () => (await request(f, '/api/state')).data.devices.length === 0);
  } finally { sockets.forEach((socket) => socket.terminate()); await f.dispose(); }
});

test('pairing protects API, media and websocket; authenticated cookie grants access', async () => {
  const f = await fixture({ localAutoAuth: false });
  try {
    assert.equal((await request(f, '/api/state')).response.status, 401);
    assert.equal((await fetch(`${f.url}/media/first`)).status, 401);
    assert.equal((await request(f, '/api/info')).data.paired, false);
    assert.equal((await request(f, '/api/pair', { code: '坏坏坏坏坏坏' })).response.status, 401);
    const pairing = await request(f, '/api/pair', { code: f.server.pairCode });
    assert.equal(pairing.response.status, 200);
    const setCookie = pairing.response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const cookie = setCookie.split(';')[0];
    assert.equal((await request(f, '/api/state', undefined, { Cookie: cookie })).response.status, 200);
    assert.equal((await fetch(`${f.url}/media/first`, { headers: { Cookie: cookie } })).status, 200);
    const refused = new WebSocket(f.url.replace('http:', 'ws:') + '/ws', { origin: f.url });
    const error = await new Promise((resolve) => refused.once('error', resolve));
    assert.match(error.message, /401/);
    const accepted = new WebSocket(f.url.replace('http:', 'ws:') + '/ws', { origin: f.url, headers: { Cookie: cookie } });
    await once(accepted, 'open');
    const closed = once(accepted, 'close'); accepted.close(); await closed;
  } finally { await f.dispose(); }
});

test('local batch imports preserve order, cover and LRC across playback actions and rescans', async () => {
  const f = await fixture();
  try {
    const paths = ['第一首.wav','第二首.wav'].map(name => path.join(f.directory,name));
    await Promise.all(paths.map((file,i)=>fs.writeFile(file,wav(i+1))));
    const image = await fs.readFile(new URL('../resources/lume.png',import.meta.url));
    const cover = path.join(f.directory,'cover.png');
    const words = path.join(f.directory,'第二首.lrc');
    const lyrics = '[00:01.00]晨光';
    await fs.writeFile(cover,image);
    await fs.writeFile(words,Buffer.concat([Buffer.from([255,254]),Buffer.from(lyrics,'utf16le')]));
    const options = {folders:JSON.stringify(['曲库','曲库']),links:JSON.stringify([{cover:0},{cover:0,lyrics:1}])};
    const work = f.server.importLocal(paths,[cover,words],options);
    await act(f,{type:'play',trackId:'first'});
    await act(f,{type:'pause'});
    assert.equal((await work).imported,2);
    const repeat = await f.server.importLocal(paths,[cover,words],options);
    assert.equal(repeat.skipped,2);
    assert.deepEqual(repeat.rejected,[]);
    await f.restart();
    const state=(await request(f,'/api/state')).data;
    assert.equal(state.playback.trackId,'first');
    assert.equal(state.playback.playing,false);
    const songs=state.tracks.filter(t=>t.source==='import');
    assert.deepEqual(songs.map(t=>t.title),['第一首','第二首']);
    assert.deepEqual(songs.map(t=>t.hasLyrics),[false,true]);
    assert.equal((await request(f,'/api/lyrics/'+songs[1].id)).data.lyrics,lyrics);
    for(const song of songs){
      const picture=await fetch(f.url+song.artwork);
      assert.equal(picture.headers.get('content-type'),'image/png');
      assert.deepEqual(Buffer.from(await picture.arrayBuffer()),image);
    }
    assert.deepEqual(await fs.readdir(path.join(f.directory,'data','uploads')),[]);
    assert.deepEqual(await fs.readFile(paths[0]),wav(1));
  }finally{await f.dispose();}
});

test('folder scans can skip short audio while accepting exactly 60 seconds and manual imports', async () => {
  const f=await fixture();
  try{
    const scan=async(seconds,filter,folder)=>{
      const form=new FormData();
      form.append('files',new Blob([wav(seconds)]),'时长.wav');
      if(folder)form.append('folders',JSON.stringify(['时长测试']));
      form.append('skipShort',filter?'1':'0');
      const response=await fetch(f.url+'/api/upload',{method:'POST',body:form});
      assert.equal(response.status,200);
      return response.json();
    };
    const short=await scan(59.999,true,true);
    assert.equal(short.imported,0);assert.equal(short.skipped,1);
    assert.equal((await scan(60,true,true)).imported,1);
    assert.equal((await scan(60.01,true,true)).imported,1);
    assert.equal((await scan(59.999,false,true)).imported,1);
    assert.equal((await scan(1,true,false)).imported,1);
    assert.deepEqual(await fs.readdir(path.join(f.directory,'data','uploads')),[]);
  }finally{await f.dispose();}
});

test('desktop listening calendar survives restart and excludes paused seeks', async () => {
  const f = await fixture();
  try {
    await act(f, {type:'play', trackId:'first'});
    await new Promise(resolve => setTimeout(resolve, 40));
    const paused = await act(f, {type:'pause'});
    const [day] = Object.keys(paused.listeningDays);
    assert.ok(paused.listeningDays[day].ms > 0);
    const afterSeek = await act(f, {type:'seek', position:1.8});
    assert.deepEqual(afterSeek.listeningDays, paused.listeningDays);
    await act(f, {type:'play'});
    await act(f, {type:'pause'});
    await f.restart();
    const {data} = await request(f, '/api/state');
    assert.equal(data.listeningDays[day].starts, 0);
    assert.equal(data.playRecords.length,1);
    assert.ok(data.playRecords[0].startedAt > 0);
    assert.equal(data.playRecords[0].completed,false);
  } finally { await f.dispose(); }
});
