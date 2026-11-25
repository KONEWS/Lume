import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {promises as fs,readFileSync} from 'node:fs';

export function startPersonalDevices({bindAddress,resourcesDir,dataDir,getTracks,trackPath,playRecords,importBatch,tempDir,changed}) {
  const directory=path.join(resourcesDir,'personal-device');
  const name=readFileSync(path.join(directory,'current.txt'),'utf8').trim();
  if(!/^host-[a-f0-9]{16}\.exe$/.test(name))throw Error('个人设备程序文件无效');
  const child=spawn(path.join(directory,name),[],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  const exited=new Promise(resolve=>child.once('close',resolve));
  const queue=[];
  let stopped=false,failed=false,error='',lastCount=0,revision=-1,merged=[],tick;
  const lines=createInterface({input:child.stdout});
  function unavailable(){
    failed=true;
    for(const item of queue.splice(0))item.reject(Error('个人设备服务已关闭'));
  }
  child.on('error',unavailable);child.on('exit',unavailable);child.stdin.on('error',unavailable);
  lines.on('line',line=>{
    const pending=queue.shift();if(!pending)return;
    try{const value=JSON.parse(line);if(value.error)throw Error(value.error);pending.resolve(value);}
    catch(e){pending.reject(e);}
  });
  function call(input){
    if(failed)return Promise.reject(Error('个人设备服务无法启动'));
    return new Promise((resolve,reject)=>{queue.push({resolve,reject});child.stdin.write(JSON.stringify(input)+'\n');});
  }
  const initialized=call({op:'init',bind:bindAddress,dir:dataDir,name:os.hostname()+' · Windows'});
  initialized.catch(e=>{error=e.message;});
  let guestRows=new Map();
  function observe(packet){
    if(!packet?.currentSession)return;
    for(const row of packet.playRecords||[]){
      if(row.session===packet.currentSession&&packet.roomPlaying||guestRows.has(row.session)){
        guestRows.set(row.session,{...row,playModeSource:'room'});
      }
    }
  }
  async function update(){
    await initialized;
    const count=playRecords.length;
    const rows=playRecords.slice(Math.max(0,lastCount-1));
    const observed=guestRows;
    guestRows=new Map(observed.size?[[...observed].at(-1)]:[]);
    for(const row of observed.values())rows.push(row);
    try{await call({op:'feed',rows,flush:true});lastCount=count;}
    catch(e){guestRows=new Map([...observed,...guestRows]);throw e;}
    const state=await call({op:'status'});
    if((state.revision+'-'+state.nameRevision)!==revision){
      const snapshot=await call({op:'records'});merged=snapshot.records;revision=snapshot.revision+'-'+snapshot.nameRevision;changed();
    }
    for(const item of state.files){
      if(!/^[a-f0-9]{96}\.[a-z0-9]{2,5}$/.test(item.file))throw Error('接收文件无效');
      const source=path.join(dataDir,'received',item.file);
      const file={source,originalname:item.title+'.'+item.ext,path:path.join(tempDir,randomUUID())};
      const result=await importBatch([file],[],{folders:JSON.stringify(['局域网接收'])});
      if(result.rejected.length)throw Error(result.rejected[0].reason);
      await call({op:'imported',key:item.key});await fs.unlink(source).catch(()=>{});
    }
    error='';
  }
  function poll(){if(!tick&&!stopped)tick=update().catch(e=>{error=e.message;}).finally(()=>{tick=null;});}
  const timer=setInterval(poll,1800);timer.unref();poll();
  return {
    identity:initialized,
    observe,
    async offerFile(peer,file){
      await initialized;
      const ext=path.extname(file).slice(1).toLowerCase();
      return call({op:'offer',peer,path:file,title:path.basename(file,path.extname(file)),ext});
    },
    records(){
      const rows=new Map(merged.map(r=>[r.session,r]));
      for(const row of [...playRecords,...guestRows.values()]){
        const old=rows.get(row.session);
        if(!old||row.listenedMs>=old.listenedMs)rows.set(row.session,{...row,
          originDeviceId:old?.originDeviceId||row.originDeviceId,originDeviceName:old?.originDeviceName||row.originDeviceName,
          completed:row.completed||old?.completed||false,playModeSource:old?.playModeSource==='room'?'room':row.playModeSource});
      }
      return [...rows.values()].sort((a,b)=>a.startedAt-b.startedAt);
    },
    async action(body){
      await initialized;
      if(body.op==='library')return {songs:getTracks().filter(t=>t.source!=='phone').map(({id,title,artist})=>({id,title,artist}))};
      if(body.op==='offer'){
        const song=getTracks().find(t=>t.id===body.id&&t.source!=='phone');if(!song)throw Error('请选择本机歌曲');
        return call({op:'offer',peer:body.peer,title:song.title,ext:path.extname(song.file).slice(1).toLowerCase(),path:trackPath(song)});
      }
      if(!['status','rename','checkName','trust','approvePair','rejectPair','forget','accept','decline','find'].includes(body.op))throw Error('设备操作无效');
      const result=await call({op:body.op,displayName:body.displayName,key:body.key,peer:body.peer,address:body.address});
      if(error)result.message=error;return result;
    },
    async close(){stopped=true;clearInterval(timer);await tick;try{await initialized;await call({op:'feed',rows:[...playRecords.slice(Math.max(0,lastCount-1)),...guestRows.values()],flush:true});}catch{}child.stdin.end();await exited;}
  };
}
