import { audioFacts } from './audio-facts.mjs';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFile } from './audio-facts.mjs';

import { MAX_AUDIO_BYTES } from '../shared/audio-size.mjs';
const invalid = message => Object.assign(new Error(message), {status:400});
const mediaExt = new Set(['mp3','m4a','mp4','wav','flac','ogg','opus','aac','webm']);

export async function phoneLibraries(app, {devices,broadcast,play,discard}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'lume-phone-'));
  const catalogs = new Map();
  const cached = new Map();
  let job = null;
  let notice = '';
  function cancel(message='') {
    const old=job;
    job=null;
    notice=message;
    if(old && !old.busy)void fs.rm(old.path,{force:true}).catch(()=>{});
  }
  function remove(id) {
    catalogs.delete(id);
    if(job?.deviceId===id)cancel('音源手机已离开，请重新加入后再选歌。');
  }
  function poll(device,owner,songs) {
    let list=catalogs.get(device.id);
    if(Array.isArray(songs)){
      if(songs.length>8000)throw invalid('手机共享目录过大');
      const byId=new Map();
      for(const s of songs){
        if(typeof s?.id!=='string'||!/^[\w-]{1,80}$/.test(s.id)||typeof s.title!=='string'||!s.title.trim())throw invalid('无效的手机歌曲');
        byId.set(s.id,{id:s.id,title:s.title.trim().slice(0,200)});
      }
      list={owner,byId,revision:songs.length};catalogs.set(device.id,list);broadcast();
    }
    const transfer=job?.deviceId===device.id?{songId:job.song.id,token:job.token}:undefined;
    return {sourceAck:list?.revision??-1,transfer};
  }
  function snapshot() {
    return {phoneLibraries:[...catalogs].flatMap(([id,c])=>{
      const d=devices.get(id);return d?[{id,name:d.name,platform:d.platform,songs:[...c.byId.values()]}]:[];
    }),sourceStatus:job?'正在从'+job.name+'读取《'+job.song.title+'》':notice};
  }
  function choose(deviceId,songId) {
    const device=devices.get(deviceId), list=catalogs.get(deviceId), song=list?.byId.get(songId);
    if(!device||!song)throw invalid('手机或歌曲已离线，请刷新曲库。');
    if(job?.deviceId===deviceId && job.song.id===songId)return;
    cancel();
    const key=deviceId+'/'+song.id;
    if(cached.has(key)){const track=cached.get(key);cached.delete(key);cached.set(key,track);play(track);return;}
    const token=randomUUID();
    job={deviceId,name:device.name,owner:list.owner,song,key,token,path:path.join(directory,token),size:0,touched:Date.now(),busy:false};
  }
  function owned(req){return job && job.token===req.params.token && job.owner===(req.headers.cookie||req.socket.remoteAddress);}
  app.post('/api/source-data/:token/fail',(req,res)=>{
    if(!owned(req))return res.sendStatus(404);
    cancel(req.query.reason==='size'?'单首音频上限为 500 MiB。':'手机无法读取这首歌，请检查文件后重试。');broadcast();res.json({ok:true});
  });
  app.put('/api/source-data/:token',(req,res,next)=>owned(req)?next():res.sendStatus(404),
    express.raw({type:'application/octet-stream',limit:'512kb'}),async(req,res)=>{
      if(!owned(req))return res.sendStatus(404);
      const task=job, bytes=req.body??Buffer.alloc(0), offset=Number(req.query.offset);
      if(task.busy||offset!==task.size)return res.status(409).json({offset:task.size});
      if(!Buffer.isBuffer(bytes)||task.size+bytes.length>MAX_AUDIO_BYTES){cancel('单首音频上限为 500 MiB。');broadcast();return res.sendStatus(413);}
      task.busy=true;task.touched=Date.now();
      let readyFile;
      try{
        if(bytes.length)await fs.appendFile(task.path,bytes);
        task.size+=bytes.length;
        if(job!==task)return res.sendStatus(409);
        if(req.query.end==='1'){
          const meta=await parseFile(task.path,{duration:true,skipCovers:true});
          if(!(meta.format.duration>0&&Number.isFinite(meta.format.duration)&&meta.format.sampleRate))throw invalid('无法识别音频');
          const ext=path.extname(task.song.title).slice(1).toLowerCase();
          const format=mediaExt.has(ext)?ext:({MPEG:'mp3',WAVE:'wav',FLAC:'flac',Ogg:'ogg'}[meta.format.container]??'m4a');
          const file=task.token+'.'+format;
          readyFile=path.join(directory,file);
          await fs.rename(task.path,readyFile);
          if(job!==task)return res.sendStatus(409);
          const track={...audioFacts(meta,task.size),playCount:0,id:'phone-'+task.token,file,title:task.song.title,artist:meta.common.artist||task.name,
            album:task.name+' · 手机曲库',sourceName:task.name,source:'phone',duration:meta.format.duration,format:format.toUpperCase(),
            artwork:'/covers/2.svg',favorite:false};
          job=null;cached.set(task.key,track);readyFile=null;play(track);
          if(cached.size>8){
            const [key,old]=cached.entries().next().value;cached.delete(key);discard(old);
            await fs.rm(path.join(directory,old.file),{force:true}).catch(()=>{});
          }
          broadcast();
        }
        res.json({offset:task.size});
      }catch{
        if(job===task){cancel('音源读取失败，请重新选择这首歌。');broadcast();}
        res.status(422).json({error:'音频文件不完整或无法解码'});
      }finally{
        task.busy=false;
        if(job!==task)await fs.rm(task.path,{force:true}).catch(()=>{});
        if(readyFile)await fs.rm(readyFile,{force:true}).catch(()=>{});
      }
    });
  const timer=setInterval(()=>{if(job && Date.now()-job.touched>45000){cancel('读取手机音乐超时，请重新选歌。');broadcast();}},2500);
  timer.unref();
  return {directory,poll,remove,snapshot,choose,cancel,async close(){clearInterval(timer);cancel();await fs.rm(directory,{recursive:true,force:true});}};
}

