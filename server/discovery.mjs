import dgram from 'node:dgram';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

export function deviceName(platform, model) {
  const name = typeof model === 'string' ? model.trim() : '';
  return name || (platform === 'Android' ? '安卓手机' : '鸿蒙手机');
}

function broadcastAddresses() {
  const targets = new Set(['255.255.255.255']);
  for (const net of Object.values(os.networkInterfaces()).flat()) {
    if (!net || net.internal || net.family !== 'IPv4') continue;
    const mask = net.netmask.split('.').map(Number);
    targets.add(net.address.split('.').map((v, i) => Number(v) | (255 - mask[i])).join('.'));
  }
  return targets;
}

// The desktop probes only while its connection window is polling.
export function nearbyPhones(port, roomName, selfId='') {
  const socket = dgram.createSocket('udp4');
  const nonce = randomBytes(12).toString('hex');
  const peers = new Map();
  const grants=new Map(),feedback=new Map();
  let lastProbe = 0;
  socket.on('message', (bytes, peer) => {
    if(bytes.length>9216)return;
    let data;
    try { data = JSON.parse(bytes); } catch { return; }
    if(data?.service==='lume-invite-status/1'&&peer.port===46324){
      const grant=grants.get(data.inviteToken);
      if(!grant||grant.until<=Date.now()||grant.id!==data.id||grant.address!==peer.address)return;
      const text={shown:'对方已看到邀请',declined:'对方已忽略邀请',expired:'邀请已超时'}[data.status];
      if(text)feedback.set(grant.id,text);
      if(data.status==='declined'||data.status==='expired')grants.delete(data.inviteToken);
      return;
    }
    if(Date.now()-lastProbe>5000)return;
    if (data?.service==='lume-room/1' && data.guest===true && peer.port===46322 && Number.isInteger(data.port) && data.port>0 && data.port<=65535) {
      if (data.port===port && Object.values(os.networkInterfaces()).flat().some(n=>n?.address===peer.address)) return;
      const id='room-'+(/^[a-f0-9]{32}$/.test(data.roomId||'')?data.roomId:peer.address+'-'+data.port);
      if(peers.size<128 || peers.has(id))peers.set(id,{id, platform:'播放空间',name:String(data.name||'播放空间'),
        address:peer.address,roomPort:data.port,seen:Date.now()});
      return;
    }
    if (peer.port!==46324 || data?.service !== 'lume-phone/1' || data.nonce !== nonce ||
        !['Android','HarmonyOS','Windows'].includes(data.platform) || data.id===selfId || typeof data.id !== 'string' ||
        !/^[a-f0-9]{32}$/.test(data.id) || (!peers.has(data.id) && peers.size >= 128)) return;
    peers.set(data.id, { id:data.id, platform:data.platform, name:deviceName(data.platform, data.model),
      address:peer.address, seen:Date.now(),availability:data.availability||'available',proof:data.inviteProof||'' });
  });
  socket.on('error', () => {});
  const ready = new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, () => {
      socket.off('error', reject);
      try { socket.setBroadcast(true); resolve(); } catch (error) { reject(error); }
    });
  });
  ready.catch(() => {});
  function send(packet, address) {
    return new Promise((resolve, reject) => socket.send(JSON.stringify(packet), 46324, address,
      error => error ? reject(error) : resolve()));
  }
  function prune() {
    for(const [key,g] of grants)if(g.until<=Date.now()){grants.delete(key);feedback.set(g.id,'邀请已超时');}
    for (const [id, p] of peers) if (Date.now() - p.seen > 7500) peers.delete(id);
  }
  return {
    async search() {
      await ready;
      prune();
      if (Date.now() - lastProbe >= 1000) {
        lastProbe = Date.now();
        for (const address of broadcastAddresses()) socket.send('LUME_DISCOVER_1',46322,address,()=>{});
        await Promise.any([...broadcastAddresses()].map(address => send({service:'lume-find-phone/1', nonce,includeBusy:true,senderId:selfId}, address)));
      }
      return [...peers.values()].map(({id,platform,name,address,roomPort,availability,proof})=>({id,platform,name,address,availability,
        hostInvitable:!!proof,inviteStatus:feedback.get(id),...(roomPort?{roomPort}:{})}));
    },
    roomUrl(id) {
      prune();const r=peers.get(id);
      return r?.roomPort?'http://'+r.address+':'+r.roomPort:null;
    },
    async invite(id) {
      prune();
      const peer = peers.get(id);
      if (!peer || peer.roomPort || !(peer.availability==='available'||peer.availability==='hosting'&&peer.proof)) return false;
      const secret=randomBytes(16).toString('hex');
      if(grants.size>=128)return false;
      grants.set(secret,{id,address:peer.address,until:Date.now()+60000});feedback.set(id,'已发出邀请，等待回应');
      try{await send({service:'lume-invite/1', id, name:roomName(), port,inviteToken:secret,inviteProof:peer.proof}, peer.address);}
      catch(err){grants.delete(secret);feedback.delete(id);throw err;}
      return true;
    },
    redeem(secret,id,address){
      prune();const grant=grants.get(secret);
      if(!grant||grant.id!==id||grant.address!==address)return false;
      grants.delete(secret);feedback.set(id,'对方已接受邀请');return true;
    },
    resetGrants(){grants.clear();feedback.clear();},
    close() { socket.close(); }
  };
}

export function advertise(port, roomName, roomId,hosting=()=>true) {
  const socket = dgram.createSocket({ type:'udp4', reuseAddr:true });
  const reply = () => Buffer.from(JSON.stringify({ service:'lume-room/1', port, guest:true, roomId, name:roomName() }));
  socket.on('error', () => {}); // Networks can prohibit broadcast. Manual pairing still works.
  socket.on('message', (data, peer) => {
    if (hosting()&&data.toString() === 'LUME_DISCOVER_1') socket.send(reply(), peer.port, peer.address);
  });
  let timer;
  socket.bind(46322, () => {
    socket.setBroadcast(true);
    timer=setInterval(() => {
      if(!hosting())return;
      for (const address of broadcastAddresses()) socket.send(reply(),46323,address);
    },2000);
    timer.unref();
  });
  return () => { clearInterval(timer);socket.close(); };
}

export function joinRequests(app, broadcast, issueSession) {
  const requests = new Map();
  function prune() {
    for (const [id,r] of requests) if (r.until<Date.now()) requests.delete(id);
  }
  app.post('/api/join/request',(req,res)=>{
    prune();
    if(!['Android','HarmonyOS'].includes(req.body?.platform)) return res.sendStatus(400);
    const ip=req.socket.remoteAddress;
    if(requests.size>=32 || [...requests.values()].filter(r=>r.ip===ip).length>=4) return res.sendStatus(429);
    const id=randomBytes(8).toString('hex'), secret=randomBytes(24).toString('hex');
    requests.set(id,{id,secret,ip,platform:req.body.platform,name:deviceName(req.body.platform,req.body.model),until:Date.now()+60000,decision:'pending'});
    broadcast();res.set('Cache-Control','no-store').json({id,secret});
  });
  app.post('/api/join/status',(req,res)=>{
    prune();
    const r=requests.get(req.body?.id);
    if(!r || r.secret!==req.body?.secret) return res.sendStatus(404);
    if(r.decision!=='pending') {
      requests.delete(r.id);
      if(r.decision==='allow')issueSession(res);
    }
    res.set('Cache-Control','no-store').json({decision:r.decision});
  });
  return {
    clear(){requests.clear();},
    pending(){prune();return [...requests.values()].filter(r=>r.decision==='pending').map(({id,platform,name,until})=>({id,platform,name,until}));},
    decide(id,decision){prune();const r=requests.get(id);if(r && ['allow','deny'].includes(decision))r.decision=decision;}
  };
}
