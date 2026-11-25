import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {EventEmitter} from 'node:events';
import {receiveRoomInvites} from '../server/desktop-invitations.mjs';
import {JoinedRoom} from '../server/joined-room.mjs';

test('desktop room changes only on a fresh, confirmed invitation from the discovered endpoint',async t=>{
  const sent=[],choices=[],joins=[],errors=[];
  const socket=Object.assign(new EventEmitter(),{bind(){},close(){},send(data,port,address,done){
    sent.push(JSON.parse(data));done();
  }});
  t.mock.method(dgram,'createSocket',()=>socket);
  let time=1000;t.mock.method(Date,'now',()=>time);
  const id='1'.repeat(32),peer={address:'192.0.2.10',port:49111};
  const close=receiveRoomInvites({id,role:()=>'hosting',name:()=>'本机',
    confirm:()=>new Promise(resolve=>choices.push(resolve)),join:async(url,grant)=>joins.push({url,grant}),onError:e=>errors.push(e)});
  const receive=(packet,from=peer)=>socket.emit('message',Buffer.from(JSON.stringify(packet)),from);
  const query={service:'lume-find-phone/1',includeBusy:true,nonce:'a'.repeat(24)};
  const invite={service:'lume-invite/1',id,port:46321,inviteToken:'f'.repeat(32),name:'受邀空间'};
  const next=()=>new Promise(r=>setImmediate(r));
  try{
    receive({...query,senderId:id});assert.equal(sent.length,0);
    receive(invite);assert.equal(choices.length,0);
    for(const action of ['decline','expire','accept']){
      receive(query);const packet={...invite,inviteProof:sent.at(-1).inviteProof};
      receive(packet,{...peer,port:49112});assert.equal(choices.length,0);
      receive(packet);receive(packet);assert.equal(choices.length,1);assert.equal(sent.at(-1).status,'shown');
      if(action==='expire')time+=31000;
      choices.pop()(action!=='decline');await next();
      if(action!=='accept'){assert.equal(joins.length,0);assert.equal(sent.at(-1).status,action==='expire'?'expired':'declined');}
      receive(packet);assert.equal(choices.length,0);
    }
    assert.deepEqual(joins,[{url:'http://192.0.2.10:46321',grant:{inviteToken:invite.inviteToken,deviceId:id}}]);assert.deepEqual(errors,[]);
  }finally{close();}
});

test('desktop enters a confirmed room only after redeeming its grant and receiving an authenticated snapshot',async()=>{
  const calls=[],grant={inviteToken:'f'.repeat(32),deviceId:'b'.repeat(32)};
  let valid=false;
  const guest=new JoinedRoom({pollInterval:60000,fetchImpl:async(url,options)=>{
    const route=new URL(url).pathname;calls.push(route);
    if(route==='/api/info')return Response.json({service:'lume-room/1',roomName:'测试空间'});
    if(route==='/api/join/invite'){
      assert.deepEqual(JSON.parse(options.body),grant);
      return Response.json({},{status:valid?200:403,headers:valid?{'Set-Cookie':'lume_session=test; Path=/'}:{}});
    }
    assert.equal(route,'/api/receiver');assert.equal(options.headers.Cookie,'lume_session=test');
    return Response.json({trackId:'',outputs:[],catalog:[],libraryVersion:1});
  }});
  try{
    await assert.rejects(guest.join('http://192.0.2.10','测试空间',grant));assert.equal(guest.active(),false);
    valid=true;await guest.join('http://192.0.2.10','测试空间',grant);assert.equal(guest.active(),true);
    assert.equal(guest.info().status,'joined');assert.equal(calls.includes('/api/join/request'),false);
  }finally{await guest.leave();}
});
