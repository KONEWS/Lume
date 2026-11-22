import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../../server/index.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout=2500){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await sleep(20);}throw Error('Joined-room transition timed out');}

async function phoneFixture(platform='HarmonyOS') {
  const requests=[],sessions=new Set(),tickets=new Map(),timers=new Set();
  const phone={platform,requests,decision:'pending',offline:false,slowMedia:0,receivers:0,leaves:0,position:12,playing:true,shuffle:false,trackId:'phone-a',version:7,channel:'stereo',volume:1,muted:false,enabled:true,delayMs:0};
  const catalog=[{id:'phone-a',title:'手机第一首',artist:'Phone artist',duration:120},{id:'phone-b',title:'手机第二首',artist:'Phone artist',duration:90}];
  const bytes=Buffer.from(Array.from({length:128},(_,i)=>i));
  const server=createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
      requests.push({path:req.url,method:req.method,body,cookie:req.headers.cookie,range:req.headers.range});
      const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
      if(phone.offline){json({error:'phone disconnected'},503);return;}
      if(req.url==='/api/info'){json({service:'lume-room/1',roomName:platform+' 手机空间'});return;}
      if(req.url==='/api/join/request'){
        assert.equal(body.platform,'Windows');assert.equal(body.model,'澄音 Windows');
        const id='ticket-'+(tickets.size+1),secret='secret-'+requests.length;tickets.set(id,secret);json({id,secret});return;
      }
      if(req.url==='/api/join/status'){
        if(tickets.get(body.id)!==body.secret){json({},404);return;}
        if(phone.decision==='allow'){
          const cookie='lume_session=session-'+requests.length;sessions.add(cookie);
          res.setHeader('Set-Cookie',cookie+'; Path=/; HttpOnly; SameSite=Strict');tickets.delete(body.id);
        }else if(phone.decision==='deny')tickets.delete(body.id);
        json({decision:phone.decision});return;
      }
      if(!sessions.has(req.headers.cookie)){json({error:'authorization required'},401);return;}
      if(req.url==='/api/receiver'){
        assert.equal(body.platform,'Windows');
        if(body.leave){phone.leaves++;sessions.delete(req.headers.cookie);json({});return;}
        if(phone.stallReceiver){res.writeHead(200,{'Content-Type':'application/json'});res.write('{');return;}
        assert.equal(body.savedChannel,'stereo');phone.receivers++;
        const output={id:'windows-output',platform:'Windows',name:'澄音 Windows',channel:phone.channel,delayMs:phone.delayMs,volume:phone.volume,muted:phone.muted,enabled:phone.enabled};
        json({...phone.identity,...(phone.details?{detailToken:'a'.repeat(32)}:{}),serverTime:Date.now(),position:phone.position,duration:catalog.find(track=>track.id===phone.trackId).duration,
          roomPlaying:phone.playing,playing:phone.playing&&phone.enabled,shuffle:phone.shuffle,volume:phone.muted?0:phone.volume,enabled:phone.enabled,channel:phone.channel,delayMs:phone.delayMs,
          selfId:output.id,outputs:[output],pending:[],trackId:phone.trackId,roomTrack:catalog.find(track=>track.id===phone.trackId).title,
          libraryVersion:phone.version,media:'/api/receiver-media/'+phone.trackId+'/stereo',roomError:'',
          ...(body.libraryVersion!==phone.version?{catalog}:{} )});return;
      }
      if(req.url==='/api/action'){
        if(body.type==='pause')phone.playing=false;
        if(body.type==='play'){phone.playing=true;if(body.trackId)phone.trackId=body.trackId;}
        if(body.type==='next'||body.type==='previous'){phone.trackId=phone.trackId==='phone-a'?'phone-b':'phone-a';phone.position=0;phone.playing=true;}
        if(body.type==='seek')phone.position=body.position;
        if(body.type==='shuffle')phone.shuffle=body.value;
        if(body.type==='output'){assert.equal(body.id,'windows-output');Object.assign(phone,body.patch);}
        json({});return;
      }
      if(req.url.startsWith('/api/track-details/')&&phone.details){json(phone.details);return;}
      if(req.url==='/api/listen/'+phone.trackId+'/stereo'){
        let from=0,to=bytes.length-1,status=200;
        const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
        if(range){from=Number(range[1]);to=range[2]?Math.min(Number(range[2]),to):to;status=206;res.setHeader('Content-Range',`bytes ${from}-${to}/${bytes.length}`);}
        const content=bytes.subarray(from,to+1);
        res.writeHead(status,{'Content-Type':'audio/wav','Content-Length':content.length,'Accept-Ranges':'bytes'});
        if(!phone.slowMedia){res.end(content);return;}
        res.write(content.subarray(0,1));
        const timer=setTimeout(()=>{timers.delete(timer);res.end(content.subarray(1));},phone.slowMedia);timers.add(timer);
        res.on('close',()=>{clearTimeout(timer);timers.delete(timer);});return;
      }
      json({},404);
    }catch(cause){if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:cause.message}));}else res.destroy(cause);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return Object.assign(phone,{url:`http://127.0.0.1:${server.address().port}`,bytes,
    close:async()=>{for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  });
}

async function playerFixture() {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lume-joined-room-'));
  const resourcesDir=path.join(directory,'resources'),demoDir=path.join(resourcesDir,'demo'),staticDir=path.join(directory,'dist');
  await fs.mkdir(demoDir,{recursive:true});await fs.mkdir(staticDir,{recursive:true});
  await fs.writeFile(path.join(staticDir,'index.html'),'<html>Local player</html>');
  await fs.writeFile(path.join(demoDir,'local.wav'),Buffer.alloc(44));
  await fs.writeFile(path.join(demoDir,'manifest.json'),JSON.stringify([{id:'local-song',title:'本机歌曲',file:'local.wav',duration:60}]));
  const service=await startServer({port:0,host:'127.0.0.1',dataDir:path.join(directory,'data'),resourcesDir,staticDir});
  async function request(route,body){const response=await fetch(service.url+route,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
  return {service,request,directory,staticDir,state:async()=>(await request('/api/state')).data,
    act:async input=>{const result=await request('/api/action',input);assert.equal(result.status,200,JSON.stringify(result.data));return result.data;},
    close:async()=>{await service.close();const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('lume-joined-room-'));await fs.rm(resolved,{recursive:true,force:true});}
  };
}

async function joined(player,phone){phone.decision='allow';await player.service.joinRoom(phone.url);return player.state();}

export {sleep,until,phoneFixture,playerFixture,joined};
