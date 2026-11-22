import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {JoinedRoom} from '../server/joined-room.mjs';
import {sleep,until,phoneFixture,playerFixture,joined} from './helpers/joined-room-fixtures.mjs';

test('late cover and lyrics cannot cross a song change or a room change',async()=>{
  const room=new JoinedRoom(), requests=[];
  room.json=()=>new Promise(resolve=>requests.push(resolve));
  const select=id=>room.refreshDetails({trackId:id,detailToken:'a'.repeat(32)},room.generation);
  select('first');
  select('second');
  requests[1]({lyrics:'',cover:''});
  await until(()=>room.details);
  const second=room.details;
  requests[0]({lyrics:'old lyrics',cover:'data:image/png;base64,AQID'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(room.details,second);
  assert.equal(second.image,null);
  assert.equal(second.lyrics,'');
  room.connection={status:'joined',name:'Test room'};
  room.packet={trackId:'second',receivedAt:Date.now(),outputs:[]};
  room.catalog=[{id:'second',title:'Song without artwork or lyrics'}];
  const current=room.snapshot().tracks[0];
  assert.equal(current.artwork,'/covers/1.svg');
  assert.equal(current.hasLyrics,false);
  select('first');
  await room.leave();
  select('first');
  requests[2]({lyrics:'old room',cover:''});
  requests[3]({lyrics:'current room',cover:'data:image/png;base64,AQID'});
  await until(()=>room.details);
  assert.equal(room.details.lyrics,'current room');
  assert.deepEqual(room.details.image,Buffer.from([1,2,3]));
});

for(const platform of ['Android','HarmonyOS'])test(`main player joins ${platform} through approval/cookie and owns the session without a UI page`,async()=>{
  const player=await playerFixture(),phone=await phoneFixture(platform);
  try {
    const joining=player.service.joinRoom(phone.url);
    await until(async()=>((await player.state()).guestRoom?.status==='waiting'));
    let state=await player.state();assert.equal(state.tracks[0].id,'local-song');assert.equal(phone.receivers,0);
    phone.decision='allow';await joining;
    state=await player.state();assert.equal(state.guestRoom.status,'joined');assert.equal(state.room.name,platform+' 手机空间');
    assert.deepEqual(state.tracks.map(track=>track.id),['phone-a','phone-b']);assert.equal(state.playback.trackId,'phone-a');
    assert.ok(phone.requests.find(request=>request.path==='/api/receiver').cookie?.startsWith('lume_session='));
    const client=new WebSocket(player.service.url.replace('http:','ws:')+'/ws');await once(client,'open');client.close();await once(client,'close');
    const polls=phone.receivers;await until(()=>phone.receivers>=polls+2);
    state=await player.act({type:'pause'});assert.equal(state.playback.playing,false);
    state=await player.act({type:'play'});assert.equal(state.playback.playing,true);
    state=await player.act({type:'next'});assert.equal(state.playback.trackId,'phone-b');
    state=await player.act({type:'seek',position:38.4});assert.equal(state.playback.position,38.4);
    state=await player.act({type:'shuffle',value:true});assert.equal(state.playback.shuffle,true);
    state=await player.act({type:'shuffle',value:false});assert.equal(state.playback.shuffle,false);
    const commands=phone.requests.filter(request=>request.path==='/api/action').length;
    await player.act({type:'repeat',value:'off'});assert.equal(phone.requests.filter(request=>request.path==='/api/action').length,commands);
    assert.equal(await player.service.readLyrics('phone-b'),'');
    const left=await player.request('/api/room/leave',{});assert.equal(left.status,200);assert.equal(left.data.guestRoom,null);
    assert.deepEqual(left.data.tracks.map(track=>track.id),['local-song']);assert.equal(phone.leaves,1);
    const afterLeave=phone.receivers;await sleep(350);assert.equal(phone.receivers,afterLeave);
  }finally{await player.close();await phone.close();}
});

test('phone disconnect/reconnect preserves remote ownership and resumes the same authenticated session',async()=>{
  const player=await playerFixture(),phone=await phoneFixture();
  try {
    await joined(player,phone);phone.offline=true;
    let state=await until(async()=>{const state=await player.state();return state.guestRoom?.status==='disconnected'&&state;});
    assert.equal(state.playback.playing,false);assert.equal(state.tracks[0].source,'phone');
    const rejected=await player.request('/api/action',{type:'next'});assert.equal(rejected.status,503);
    phone.offline=false;
    state=await until(async()=>{const state=await player.state();return state.guestRoom?.status==='joined'&&state;});
    assert.equal(state.playback.playing,true);assert.equal(state.tracks.length,2);
    assert.equal(phone.requests.filter(request=>request.path==='/api/join/request').length,1);
    await player.act({type:'pause'});assert.equal(phone.playing,false);
  }finally{await player.close();await phone.close();}
});

test('leaving while waiting cancels approval polling and a later new join still works',async()=>{
  const player=await playerFixture(),phone=await phoneFixture();
  try {
    const joining=player.service.joinRoom(phone.url).then(()=>({joined:true}),cause=>({cause}));
    await until(async()=>(await player.state()).guestRoom?.status==='waiting');
    const left=await player.request('/api/room/leave',{});assert.equal(left.data.guestRoom,null);
    const result=await joining;assert.ok(result.cause);phone.decision='allow';
    await sleep(800);assert.equal(phone.receivers,0);assert.equal((await player.state()).guestRoom,null);
    await player.service.joinRoom(phone.url);assert.equal((await player.state()).guestRoom.status,'joined');
    await player.service.close();assert.equal(phone.leaves,1);
    const count=phone.receivers;await sleep(350);assert.equal(phone.receivers,count);
  }finally{await player.close();await phone.close();}
});

test('phone denial leaves the local library available and can be dismissed',async()=>{
  const player=await playerFixture(),phone=await phoneFixture();
  try {
    phone.decision='deny';await assert.rejects(player.service.joinRoom(phone.url),/拒绝/);
    const state=await player.state();assert.equal(state.guestRoom.status,'error');assert.equal(state.tracks[0].id,'local-song');
    assert.equal(phone.receivers,0);await player.request('/api/room/leave',{});assert.equal((await player.state()).guestRoom,null);
  }finally{await player.close();await phone.close();}
});

test('phone media keeps Range semantics and a stream remains readable beyond the five-second header timeout',{timeout:15000},async()=>{
  const player=await playerFixture(),phone=await phoneFixture();
  try {
    await joined(player,phone);
    phone.channel='left';const oldPolls=phone.receivers;await until(()=>phone.receivers>oldPolls);
    const ranged=await fetch(player.service.url+'/media/phone-a',{headers:{Range:'bytes=12-31'}});
    assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-range'),'bytes 12-31/128');assert.equal(ranged.headers.get('accept-ranges'),'bytes');
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),phone.bytes.subarray(12,32));
    assert.equal(phone.requests.findLast(request=>request.path.startsWith('/api/listen/')).range,'bytes=12-31');
    assert.equal(phone.requests.findLast(request=>request.path.startsWith('/api/listen/')).path,'/api/listen/phone-a/stereo');
    const stale=await fetch(player.service.url+'/media/phone-b');assert.equal(stale.status,404);
    phone.slowMedia=5400;const since=Date.now();
    const streamed=await fetch(player.service.url+'/media/phone-a');assert.equal(streamed.status,200);
    assert.deepEqual(Buffer.from(await streamed.arrayBuffer()),phone.bytes);assert.ok(Date.now()-since>=5000);
    assert.equal((await player.state()).guestRoom.status,'joined');
  }finally{await player.close();await phone.close();}
});

test('leaving promptly aborts an active phone media stream',async()=>{
  const player=await playerFixture(),phone=await phoneFixture();
  try {
    await joined(player,phone);phone.slowMedia=10000;
    const response=await fetch(player.service.url+'/media/phone-a');
    const body=response.arrayBuffer().then(()=>({complete:true}),cause=>({cause}));
    const since=Date.now();await player.request('/api/room/leave',{});
    const result=await body;assert.ok(result.cause);assert.ok(Date.now()-since<2000);assert.equal(phone.leaves,1);
  }finally{await player.close();await phone.close();}
});

test('a phone that sends JSON headers but stalls its body disconnects and later recovers',{timeout:16000},async()=>{
  const player=await playerFixture(),phone=await phoneFixture();
  // Also run with node --expose-gc --test to force the Response-lifetime regression.
  const collector=typeof global.gc==='function'?setInterval(()=>global.gc(),100):null;
  try {
    await joined(player,phone);phone.stallReceiver=true;
    const state=await until(async()=>{const state=await player.state();return state.guestRoom?.status==='disconnected'&&state;},9000);
    assert.equal(state.playback.playing,false);
    phone.stallReceiver=false;
    await until(async()=>(await player.state()).guestRoom?.status==='joined');
    assert.equal(phone.requests.filter(request=>request.path==='/api/join/request').length,1);
  }finally{clearInterval(collector);await player.close();await phone.close();}
});

test('joined output identity and gain are applied once while local sound permission remains local',()=>{
  const room=new JoinedRoom();room.connection={status:'joined',name:'手机空间'};
  const self={id:'phone-receiver-id',volume:.4,muted:true,channel:'left',delayMs:75,enabled:true};
  room.packet={receivedAt:Date.now(),outputs:[self],selfId:self.id,trackId:'',position:0,roomPlaying:true};
  const local={id:'local-web-audio-id',name:'这台电脑',volume:.8,muted:false,enabled:true,channel:'stereo',delayMs:0};
  let state=room.snapshot([local]);
  assert.equal(state.playback.volume,1);assert.equal(state.playback.muted,false);
  assert.deepEqual(state.devices.map(({id,volume,muted,channel,delayMs,enabled})=>({id,volume,muted,channel,delayMs,enabled})),[
    {id:local.id,volume:.4,muted:true,channel:'left',delayMs:75,enabled:true}
  ]);
  assert.equal(room.localOutputId(local.id,[local]),self.id);assert.equal(room.localOutputId('other-phone',[local]),'other-phone');
  state=room.snapshot([{...local,enabled:false}]);assert.equal(state.devices[0].enabled,false);
  self.enabled=false;state=room.snapshot([local]);assert.equal(state.devices[0].enabled,false);
});
