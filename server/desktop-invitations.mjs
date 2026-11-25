import dgram from 'node:dgram';
import {randomBytes} from 'node:crypto';

// Only the desktop shell can present and confirm a room switch.
export function receiveRoomInvites({id,role,name,confirm,join,onError}){
  const socket=dgram.createSocket('udp4'),challenges=new Map();
  let pending=null,closed=false;
  const send=(message,peer)=>socket.send(JSON.stringify(message),peer.port,peer.address,()=>{});
  socket.on('error',()=>{});
  socket.on('message',async(bytes,peer)=>{
    if(closed||bytes.length>9216)return;
    let b;try{b=JSON.parse(bytes);}catch{return;}
    const endpoint=peer.address+':'+peer.port,now=Date.now();
    for(const [key,c] of challenges)if(c.until<=now)challenges.delete(key);
    if(b?.service==='lume-find-phone/1'&&b.includeBusy&&b.senderId!==id&&/^[a-f0-9]{24}$/.test(b.nonce)){
      if(!challenges.has(endpoint)&&challenges.size>=128)return;
      const old=challenges.get(endpoint),proof=old?.nonce===b.nonce?old.proof:randomBytes(16).toString('hex');
      challenges.set(endpoint,{nonce:b.nonce,proof,until:now+60000});
      send({service:'lume-phone/1',nonce:b.nonce,id,inviteProof:proof,platform:'Windows',model:name(),availability:role()},peer);
      return;
    }
    const c=challenges.get(endpoint);
    if(b?.service!=='lume-invite/1'||b.id!==id||pending||role()!=='hosting'||!c||c.proof!==b.inviteProof||
       !/^[a-f0-9]{32}$/.test(b.inviteToken)||!Number.isInteger(b.port)||b.port<1||b.port>65535)return;
    challenges.delete(endpoint);
    const controller=new AbortController();pending=controller;
    const timer=setTimeout(()=>controller.abort(),30000);timer.unref();
    const ack=status=>{if(!closed)send({service:'lume-invite-status/1',id,inviteToken:b.inviteToken,status},peer);};
    try{
      const choice=confirm(String(b.name||'播放空间'),controller.signal);
      ack('shown');
      const accepted=await choice;
      if(closed)return;
      if(controller.signal.aborted||Date.now()>=now+30000){ack('expired');return;}
      if(!accepted||role()!=='hosting'){ack('declined');return;}
      clearTimeout(timer);
      await join('http://'+peer.address+':'+b.port,{inviteToken:b.inviteToken,deviceId:id});
    }catch(err){if(!closed&&!controller.signal.aborted)onError(err);}
    finally{clearTimeout(timer);pending=null;}
  });
  socket.bind(46324);
  return ()=>{closed=true;pending?.abort();socket.close();};
}
