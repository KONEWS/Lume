import '../mobile/player-assets/player/listening.js';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const number=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const error=(message,status=400)=>Object.assign(new Error(message),{status});

/** Keeps the phone authoritative while the local player remains on its own origin. */
export class JoinedRoom {
  constructor({deviceName=()=>"澄音 Windows",changed=()=>{},fetchImpl=fetch,pollInterval=250,resolveLocal=async()=>null}={}) {
    this.deviceName=deviceName;this.resolveLocal=resolveLocal;this.localTrack=null;this.localKey='';
    this.changed=changed;this.fetch=fetchImpl;this.pollInterval=pollInterval;
    this.connection=null;this.packet=null;this.catalog=[];this.generation=0;this.revision=0;
    this.id='native-'+randomUUID();this.cookie='';this.timer=null;this.polling=null;
  }
  active(){return !!this.packet && !!this.connection;}
  info(){return this.connection?{...this.connection}:null;}
  async request(route,body,{signal=this.controller?.signal,headers={}}={}) {
    const deadline=new AbortController();
    const relayAbort=()=>deadline.abort(signal.reason);
    if(signal?.aborted)relayAbort();else signal?.addEventListener('abort',relayAbort,{once:true});
    const cleanup=()=>signal?.removeEventListener('abort',relayAbort);
    const timer=setTimeout(()=>deadline.abort(error('手机空间响应超时，请检查连接',504)),5000);timer.unref?.();
    let response;
    try {response=await this.fetch(this.origin+route,{method:body===undefined?'GET':'POST',
      headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(this.cookie?{Cookie:this.cookie}:{}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',
      signal:deadline.signal});}
    catch(cause){cleanup();throw cause;}
    finally{clearTimeout(timer);}
    if(!response.ok){
      cleanup();await response.body?.cancel().catch(()=>{});
      throw error(response.status===401?'手机空间授权已失效，请重新加入':response.status===404?'手机空间已结束或当前歌曲已切换':'手机空间暂时无法响应',response.status);
    }
    const cookies=response.headers.getSetCookie?.()||[response.headers.get('set-cookie')].filter(Boolean);
    if(cookies.length)this.cookie=cookies.map(cookie=>cookie.split(';',1)[0]).join('; ');
    if(!response.body){cleanup();return response;}
    // Cancel the reader directly: its lifetime can outlast the fetch Response
    // that undici's automatic abort handling refers to.
    const reader=response.body.getReader();
    let finished=false,bodyController;
    const finish=()=>{
      if(finished)return false;
      finished=true;cleanup();deadline.signal.removeEventListener('abort',abortBody);return true;
    };
    const abortBody=()=>{
      if(!finish())return;
      bodyController.error(deadline.signal.reason);
      void reader.cancel(deadline.signal.reason).catch(()=>{});
    };
    const stream=new ReadableStream({
      start(controller){bodyController=controller;deadline.signal.addEventListener('abort',abortBody,{once:true});if(deadline.signal.aborted)abortBody();},
      async pull(controller){
        try{const {done,value}=await reader.read();if(finished)return;if(done){finish();controller.close();}else controller.enqueue(value);}
        catch(cause){if(finish())controller.error(cause);}
      },
      cancel(reason){finish();return reader.cancel(reason);}
    });
    return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
  }
  async json(route,body){
    const deadline=new AbortController();
    const timer=setTimeout(()=>deadline.abort(error('手机空间响应超时，请检查连接',504)),5000);timer.unref?.();
    const session=this.controller?.signal;
    const relayAbort=()=>deadline.abort(session.reason);
    if(session?.aborted)relayAbort();else session?.addEventListener('abort',relayAbort,{once:true});
    try{return await (await this.request(route,body,{signal:deadline.signal})).json();}
    finally{clearTimeout(timer);session?.removeEventListener('abort',relayAbort);}
  }
  async join(origin,name='手机播放空间',invitation=null) {
    const url=new URL(origin);
    if(url.protocol!=='http:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw error('无效的播放空间地址');
    await this.leave();
    const generation=++this.generation;
    this.clockSample=null;this.origin=url.origin;this.cookie='';this.controller=new AbortController();this.packet=null;this.catalog=[];
    this.connection={status:'joining',name,url:url.origin,error:''};this.changed();
    try {
      const info=await this.json('/api/info');
      if(info.service!=='lume-room/1')throw error('此地址不是澄音播放空间');
      this.connection.name=info.roomName||name;
      if(invitation){
        await this.json('/api/join/invite',invitation);
        if(!this.cookie)throw error('邀请未返回有效会话');
      }else{
        const ticket=await this.json('/api/join/request',{platform:'Windows',model:this.deviceName()});
        if(typeof ticket.id!=='string'||typeof ticket.secret!=='string')throw error('手机未返回有效的加入请求');
        this.connection.status='waiting';this.changed();
        const until=Date.now()+60000;
        for(;;){
          await delay(700,undefined,{signal:this.controller.signal});
          if(generation!==this.generation)throw error('加入已取消');
          const result=await this.json('/api/join/status',ticket);
          if(result.decision==='allow')break;
          if(result.decision==='deny')throw error('手机拒绝了加入请求');
          if(Date.now()>=until)throw error('等待手机确认超时，请重新加入');
        }
      }
      await this.poll(generation);
      if(generation!==this.generation||!this.packet)throw error('手机未返回播放状态');
      this.schedule(generation);
      return this.info();
    } catch(cause) {
      if(generation===this.generation){this.connection={...this.connection,status:'error',error:cause.message};this.changed();}
      throw cause;
    }
  }
  schedule(generation) {
    clearTimeout(this.timer);
    if(generation!==this.generation||!this.connection)return;
    this.timer=setTimeout(async()=>{
      try{await this.poll(generation);}
      catch(cause){if(generation===this.generation){this.connection={...this.connection,status:'disconnected',error:cause.message};this.changed();}}
      this.schedule(generation);
    },this.pollInterval);
    this.timer.unref?.();
  }
  async poll(generation=this.generation) {
    if(this.polling){await this.polling;return;}
    const revision=this.revision;
    const task=(async()=>{
      const sent=Date.now();
      const data=await this.json('/api/receiver',{id:this.id,platform:'Windows',model:this.deviceName(),savedChannel:'stereo',libraryVersion:this.packet?.libraryVersion??-1});
      if(generation!==this.generation||revision!==this.revision)return;
      if(!Array.isArray(data.outputs)||typeof data.trackId!=='string')throw error('手机返回的播放状态不完整');
      if(Array.isArray(data.catalog))this.catalog=data.catalog.filter(track=>typeof track.id==='string'&&typeof track.title==='string');
      const receivedAt=Date.now(),rtt=receivedAt-sent;
      let sampledAt=(sent+receivedAt)/2;
      if(Number.isFinite(data.serverTime)){
        if(!this.clockSample||receivedAt-this.clockSample.since>10000||rtt<=this.clockSample.rtt)
          this.clockSample={offset:data.serverTime-sampledAt,rtt,since:receivedAt};
        sampledAt=data.serverTime-this.clockSample.offset;
      }
      this.packet={...data,receivedAt,sampledAt};
      this.refreshLocal(data,generation);
      this.refreshDetails(data,generation);
      this.connection={...this.connection,status:'joined',hostAddress:data.hostAddress,error:data.roomError||''};this.changed();
    })();
    this.polling=task;
    try{await task;}finally{if(this.polling===task)this.polling=null;}
  }
  refreshDetails(packet,generation) {
    const {trackId,detailToken}=packet;
    const key=typeof detailToken==='string' && /^[a-f0-9]{32}$/.test(detailToken) ? generation+'/'+trackId+'/'+detailToken : '';
    if(this.detailKey!==key){this.detailKey=key;this.details=null;this.loadingDetails=null;}
    if(!key || this.details || this.loadingDetails===key)return;
    this.loadingDetails=key;
    void this.json('/api/track-details/'+encodeURIComponent(trackId)+'/'+detailToken).then(data=>{
      if(this.detailKey!==key || this.generation!==generation)return;
      const match=typeof data.cover==='string' && data.cover.length<=3000000 && /^data:image\/(webp|png|jpeg|gif|bmp);base64,([A-Za-z0-9+/=]+)$/.exec(data.cover);
      this.details={trackId,key:randomUUID(),lyrics:typeof data.lyrics==='string'?data.lyrics:'',image:match?Buffer.from(match[2],'base64'):null,mime:match?'image/'+match[1]:''};
      this.changed();
    }).catch(()=>{}).finally(()=>{if(this.loadingDetails===key)this.loadingDetails=null;});
  }
  refreshLocal(packet,generation){
    const key=generation+'/'+packet.trackId+'/'+(packet.audioIdentity||'');
    if(this.localKey===key)return;
    this.localKey=key;this.localTrack=null;
    if(!packet.audioIdentity)return;
    void this.resolveLocal(packet.audioIdentity,packet.audioBytes).then(track=>{
      if(generation!==this.generation||this.localKey!==key)return;
      this.localTrack=track;this.changed();
    }).catch(()=>{});
  }
  async action(input) {
    if(!this.active()||this.connection.status!=='joined')throw error('手机空间尚未连接，请等待或重新加入',503);
    if(!input||typeof input!=='object')throw error('无效的播放操作');
    let command=input;
    const supported=['play','pause','previous','next','seek','shuffle','output','join-allow','join-deny'];
    if(input.type==='repeat'&&input.value==='off')return;
    if(input.type==='volume'||input.type==='muted')command={type:'output',id:this.packet.selfId,patch:{[input.type]:input.value}};
    else if(input.type==='queue-set'&&Array.isArray(input.trackIds)&&input.trackIds.length)command={type:'play',trackId:input.trackIds[0]};
    else if(!supported.includes(input.type))throw error('此操作需在手机房主端完成');
    if(command.type==='play'&&command.trackId&&!this.catalog.some(track=>track.id===command.trackId))throw error('歌曲已不在手机曲库中');
    if(command.type==='seek'&&!Number.isFinite(command.position))throw error('无效的播放位置');
    if(command.type==='shuffle'&&typeof command.value!=='boolean')throw error('无效的播放模式');
    const generation=this.generation;
    ++this.revision;
    if(command.type==='output'){
      // Keep at most one outstanding request and one latest patch per device.
      // A slow wireless link must not replay every intermediate slider position.
      let batch=this.outputBatch;
      if(!batch || batch.generation!==generation){
        batch={generation,pending:new Map(),done:null};
        this.outputBatch=batch;
      }
      batch.pending.set(command.id,{...batch.pending.get(command.id),...command.patch});
      if(!batch.done){
        const flush=async()=>{
          while(batch.pending.size && generation===this.generation){
            const [id,patch]=batch.pending.entries().next().value;
            batch.pending.delete(id);
            await this.json('/api/action',{type:'output',id,patch});
          }
          if(generation!==this.generation)return;
          if(this.polling)await this.polling.catch(()=>{});
          if(generation===this.generation)await this.poll(generation);
        };
        const drain=async()=>{
          try{
            do{await flush();}while(batch.pending.size && generation===this.generation);
          }finally{if(this.outputBatch===batch)this.outputBatch=null;}
        };
        batch.done=drain();
      }
      await batch.done;
      return;
    }else await this.json('/api/action',command);
    if(this.polling)await this.polling.catch(()=>{});
    await this.poll();
  }
  localOutputId(id,localDevices=[]) {
    return localDevices.some(device=>device.id===id)?this.packet?.selfId||id:id;
  }
  snapshot(localDevices=[]) {
    if(!this.active())return null;
    const packet=this.packet,now=packet.receivedAt;
    const tracks=this.catalog.map(track=>({...track,artist:track.artist||'手机音乐',album:track.album||'',
      duration:track.id===packet.trackId?number(packet.duration):number(track.duration),format:track.format||'音频',
      artwork:/^[a-f0-9]{32}$/.test(track.coverRevision)?'/api/room/thumbnail/'+this.generation+'/'+track.coverRevision+'/'+encodeURIComponent(track.id):'/covers/1.svg',source:'phone',favorite:false}));
    if(packet.trackId&&!tracks.some(track=>track.id===packet.trackId))tracks.push({id:packet.trackId,title:packet.roomTrack||'手机音乐',artist:'',album:'',duration:number(packet.duration),format:'音频',artwork:'/covers/1.svg',source:'phone',favorite:false});
    const selected=tracks.find(track=>track.id===packet.trackId);
    if(selected && this.details?.trackId===selected.id){
      selected.detailKey=this.details.key;
      selected.hasLyrics=!!this.details.lyrics;
      if(this.details.image)selected.artwork='/api/room/cover/'+this.details.key;
    }
    if(selected&&this.localTrack){
      selected.localAudioKey=this.localTrack.id;
      selected.detailKey=(selected.detailKey||'')+'/local/'+this.localTrack.id;
      selected.hasLyrics=!!this.localTrack.hasLyrics||!!selected.hasLyrics;
      if(selected.artwork==='/covers/1.svg'&&this.localTrack.artwork)selected.artwork=this.localTrack.artwork;
    }
    const outputs=(packet.outputs||[]).map(output=>({...output,lastSeen:now}));
    const self=outputs.find(output=>output.id===packet.selfId);
    const peers=outputs.filter(output=>output.id!==packet.selfId);
    const locals=localDevices.map(({socket,...device})=>({...device,...(self?{channel:self.channel,delayMs:self.delayMs,
      volume:number(self.volume,1),muted:!!self.muted,enabled:!!device.enabled&&!!self.enabled}:{}),lastSeen:now}));
    const position=number(packet.position);
    return {tracks,queue:tracks.map(track=>track.id),playlists:[],phoneLibraries:[],listeningDays:packet.listeningDays||globalThis.lumeListening.days(packet.playRecords||[]),playRecords:packet.playRecords,
      playback:{trackId:packet.trackId||null,playing:this.connection.status==='joined'&&!!packet.roomPlaying,
        position:Math.max(0,position),updatedAt:(packet.sampledAt??now)+Math.max(0,-position)*1000,
        volume:1,muted:false,shuffle:!!packet.shuffle,repeat:'off'},
      devices:[...peers,...locals],room:{name:this.connection.name},pending:[],calibrating:false,
      guestRoom:this.info(),serverTime:Date.now()};
  }
  async thumbnail(generation,revision,id){
    const valid=()=>this.active()&&generation===this.generation&&this.catalog.some(song=>song.id===id&&song.coverRevision===revision);
    if(!/^[a-f0-9]{32}$/.test(revision)||!/^[A-Za-z0-9_-]+$/.test(id)||!valid())throw error('空间封面已变更',404);
    const signal=this.controller.signal,until=Date.now()+30000;
    while(valid()&&Date.now()<until){
      const data=await this.json('/api/catalog-cover/'+revision+'/'+id);
      if(!valid())break;
      if(data.cover==='')return null;
      if(typeof data.cover==='string'&&data.cover.length<=1500000){
        const match=/^data:image\/(webp|png|jpeg|gif|bmp);base64,([A-Za-z0-9+/=]+)$/.exec(data.cover);
        if(match)return {mime:'image/'+match[1],image:Buffer.from(match[2],'base64')};
      }
      if(!data.pending)break;
      await delay(400,undefined,{signal});
    }
    throw error('无法读取空间封面',503);
  }
  async media(id,range) {
    if(!this.active()||id!==this.packet.trackId)throw error('手机已切换歌曲',404);
    if(!/^[A-Za-z0-9_-]+$/.test(id))throw error('无效的播放音轨');
    // The local Web Audio graph applies the phone's channel assignment. Keeping
    // the source stereo also lets a channel change take effect without reloading it.
    return this.request('/api/listen/'+encodeURIComponent(id)+'/stereo',undefined,{headers:range?{Range:range}:{}});
  }
  async leave() {
    this.localKey='';this.localTrack=null;
    this.details=null;this.detailKey=null;this.loadingDetails=null;
    ++this.generation;++this.revision;clearTimeout(this.timer);this.timer=null;
    const origin=this.origin,cookie=this.cookie,connected=!!this.packet;
    this.controller?.abort();this.controller=null;this.packet=null;this.catalog=[];this.cookie='';this.polling=null;this.connection=null;this.changed();
    if(connected&&cookie)await this.fetch(origin+'/api/receiver',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},
      body:JSON.stringify({id:this.id,platform:'Windows',leave:true}),redirect:'error',signal:AbortSignal.timeout(1800)}).catch(()=>{});
  }
}
