import { deviceName } from './discovery.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {MediaIdentities} from './local-media.mjs';
import {coverMime} from '../shared/song-details.mjs';

const execute = promisify(execFile);
const filters = { left: 'c0', right: 'c1', mono: '0.5*c0+0.5*c1' };
export function splitFilter(channel) {
  return channel === 'stereo' ? 'aformat=channel_layouts=stereo' :
    'aformat=channel_layouts=stereo,pan=mono|c0='+filters[channel];
}

// The receiver gets a seekable native media URL. Cache only trusted, server-selected files.
export async function mountReceivers(app, { devices, broadcast, current, sourcePath, trims, sources, pending, coverRevision, coverPath }) {
  const identities=new MediaIdentities();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lume-channels-'));
  const entries = new Map();
  const owners = new Map();
  const chunks=new Map();
  let decoding=0;
  const channels = ['left','right','mono','stereo'];
  async function render(track, channel) {
    const key = track.id+'-'+channel;
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= 8) {
        const oldest = [...entries].filter(([,v])=>v.ready).sort((a,b)=>a[1].at-b[1].at)[0];
        if (!oldest) throw new Error('转码繁忙');
        entries.delete(oldest[0]); await fs.rm(oldest[1].file,{force:true}).catch(()=>{});
      }
      // Include a unique suffix so a subsequent regeneration cannot overwrite an active stream.
      const file = path.join(dir,key+'-'+Date.now()+'.m4a');
      entry = {file,at:Date.now(),ready:false};
      entries.set(key,entry);
      entry.promise = execute('ffmpeg',['-nostdin','-loglevel','error','-protocol_whitelist','file,pipe','-i',sourcePath(track),
        '-map','0:a:0','-vn','-sn','-dn','-map_metadata','-1','-af',splitFilter(channel),'-ar','48000','-c:a','aac','-b:a','192k','-movflags','+faststart',file],
        {windowsHide:true,timeout:180000}).then(()=>{entry.ready=true;return file;}).catch(async error=>{
          entries.delete(key); await fs.rm(file,{force:true}).catch(()=>{}); throw error;
        });
    }
    entry.at=Date.now();
    return entry.promise;
  }
  const lastSession=new WeakMap();
  const thumbs=new Map();
  let renderingThumbs=0;
  app.get('/api/catalog-cover/:revision/:id',async(req,res)=>{
    const track=current().catalog.find(song=>song.id===req.params.id);
    if(!track||coverRevision(track)!==req.params.revision)return res.sendStatus(404);
    const key=req.params.revision;
    res.set('Cache-Control','no-store');
    if(!thumbs.has(key)){
      if(renderingThumbs>=2)return res.json({pending:true});
      renderingThumbs++;
      const load=(async()=>{
        const file=await coverPath(track);
        if(!file)return '';
        if((await fs.stat(file)).size<=64*1024){
          const bytes=await fs.readFile(file),mime=coverMime(bytes);
          if(mime)return 'data:'+mime+';base64,'+bytes.toString('base64');
        }
        const {stdout}=await execute('ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',file,'-frames:v','1',
          '-vf',"scale='min(128,iw)':'min(128,ih)':force_original_aspect_ratio=decrease",'-c:v','png','-f','image2pipe','pipe:1'],
          {encoding:'buffer',maxBuffer:256*1024,timeout:8000,windowsHide:true});
        return 'data:image/png;base64,'+stdout.toString('base64');
      })().finally(()=>renderingThumbs--);
      if(thumbs.size>=128)thumbs.delete(thumbs.keys().next().value);
      thumbs.set(key,load);
    }
    try{res.json({cover:await thumbs.get(key)});}catch{thumbs.delete(key);res.sendStatus(503);}
  });
  app.post('/api/receiver', (req,res)=>{
    const {id,platform}=req.body ?? {};
    if (!/^native-[a-zA-Z0-9-]{8,64}$/.test(id)||!['Android','HarmonyOS','Windows'].includes(platform)) return res.status(400).json({error:'无效的设备'});
    const owner=req.headers.cookie || req.socket.remoteAddress;
    if (owners.has(id) && owners.get(id)!==owner) return res.status(403).json({error:'设备会话已变更'});
    let device=devices.get(id);
    if (device && !owners.has(id)) return res.sendStatus(409);
    if (!device) {
      const profile=/^[a-fA-F0-9-]{32,36}$/.test(req.body.profile ?? '')?platform+'-'+req.body.profile:null;
      const saved=req.body.savedDelayMs;
      device={id,profile,delayMs:trims.get(profile)??(Number.isInteger(saved)&&Math.abs(saved)<=1000?saved:0),name:deviceName(platform,req.body.model),platform,channel:platform==='Android'?'right':'left',enabled:true,volume:1,muted:false,lastSeen:Date.now()};
      devices.set(id,device);owners.set(id,owner);broadcast();
    }
    if(req.body.model&&device.name!==deviceName(platform,req.body.model)){device.name=deviceName(platform,req.body.model);broadcast();}
    if(req.body.leave===true){sources.remove(id);devices.delete(id);owners.delete(id);broadcast();return res.json({left:true});}
    device.hostAddress=req.socket.localAddress?.replace(/^::ffff:/,"");
    device.lastSeen=Date.now();
    for(const metric of ['bufferMs','gaps','underflows'])if(Number.isInteger(req.body[metric])&&req.body[metric]>=0)device[metric]=req.body[metric];
    const {track,playback,position,skin,catalog,libraryVersion,currentSession,playRecords,listeningDays}=current();
    const previous=lastSession.get(device);lastSession.set(device,currentSession);
    const roomRecords=playRecords.filter(r=>r.session===currentSession||r.session===previous);
    res.set('Cache-Control','no-store').json({...sources.poll(device,owner,req.body.sourceSongs),
      ...(track?identities.peek(sourcePath(track)):{}),
      hostAddress:device.hostAddress,selfId:id,outputs:[...devices.values()].map(({id,name,platform,channel,enabled,muted,volume,delayMs=0})=>({id,name,platform,channel,enabled,muted,volume,delayMs})),
      pending:pending(),skin,currentSession,playRecords:roomRecords,delayMs:device.delayMs,trackId:track?.id??'',duration:track?.duration??0,roomPlaying:playback.playing,shuffle:playback.shuffle,libraryVersion,
      ...(req.body.libraryVersion!==libraryVersion?{catalog:catalog.map(song=>{
        const {id,title,artist,album,folder,quality,bytes,hasLyrics,playCount}=song;
        return {id,title,artist,album,folder,quality,bytes,hasLyrics,playCount,coverRevision:coverRevision(song)};
      })}:{}),roomTrack:track?.title??'',playing:playback.playing&&device.enabled,
      position,volume:device.muted||playback.muted?0:device.volume*playback.volume,channel:device.channel,
      enabled:device.enabled,media:track?'/api/receiver-media/'+track.id+'/'+device.channel:'',serverTime:Date.now()});
  });
  // Four-second PCM blocks let native renderers buffer ahead and address individual samples.
  app.get('/api/pcm/:id/:channel/:block',async(req,res)=>{
    const {track}=current(), {id,channel,block}=req.params;
    if(!track || id!==track.id || !channels.includes(channel) || !/^\d{1,7}$/.test(block) || Number(block)*4>=track.duration) return res.sendStatus(404);
    const key=[id,channel,block].join('/');
    let job=chunks.get(key);
    if(!job){
      if(decoding>=6)return res.sendStatus(503);
      decoding++;
      job=execute('ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-ss',String(Number(block)*4),'-i',sourcePath(track),
        '-t','4','-map','0:a:0','-vn','-sn','-dn','-af',splitFilter(channel),'-ac','2','-ar','48000','-f','s16le','pipe:1'],
        {encoding:'buffer',maxBuffer:1500000,windowsHide:true,timeout:20000}).then(r=>r.stdout)
        .catch(e=>{chunks.delete(key);throw e;}).finally(()=>{decoding--;});
      chunks.set(key,job);
      if(chunks.size>42)chunks.delete(chunks.keys().next().value);
    }
    try{res.set('Cache-Control','private, max-age=120').type('application/octet-stream').send(await job);}
    catch{res.sendStatus(503);}
  });
  app.get('/api/receiver-media/:id/:channel',async(req,res)=>{
    const {track}=current();
    if(!track || req.params.id!==track.id || !channels.includes(req.params.channel)) return res.sendStatus(404);
    try { const file=await render(track,req.params.channel); res.sendFile(file); }
    catch { if(!res.headersSent)res.status(503).json({error:'音轨生成失败，请检查电脑上的 FFmpeg 与音源'}); }
  });
  const timer=setInterval(()=>{
    let changed=false;
    for(const id of owners.keys()) if((devices.get(id)?.lastSeen??0)<Date.now()-6000){sources.remove(id);owners.delete(id);devices.delete(id);changed=true;}
    if(changed)broadcast();
  },1000);timer.unref();
  return async()=>{clearInterval(timer);await Promise.allSettled([...entries.values()].map(e=>e.promise));await fs.rm(dir,{recursive:true,force:true});};
}
