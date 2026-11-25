// Explicit opt-in integration test. All media and both libraries are temporary.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createReadStream,openAsBlob} from 'node:fs';
import {mkdtemp,open,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startServer} from '../server/index.mjs';
import registerTransferFiles from '../electron/transfer-files.cjs';

const MiB=1024**2;
const root=await mkdtemp(path.join(os.tmpdir(),'lume-large-'));
const servers=[];
async function wav(file,bytes){
  const handle=await open(file,'wx');
  try{
    const header=Buffer.alloc(44);
    header.write('RIFF');header.writeUInt32LE(bytes-8,4);header.write('WAVEfmt ',8);
    header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);
    header.writeUInt32LE(44100,24);header.writeUInt32LE(176400,28);
    header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(bytes-44,40);
    await handle.write(header);
    const block=randomBytes(MiB);
    for(let offset=44;offset<bytes;){
      block.writeUInt32LE(offset,0);
      const count=Math.min(bytes-offset,block.length);
      const {bytesWritten}=await handle.write(block,0,count,offset);
      assert.equal(bytesWritten,count);offset+=bytesWritten;
    }
  }finally{await handle.close();}
}
async function digest(stream){
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of stream){bytes+=chunk.length;hash.update(chunk);}
  return {bytes,sha256:hash.digest('hex')};
}
async function api(host,route,body){
  const response=await fetch(host.url+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  if(!response.ok)throw Error(await response.text());
  return response.json();
}
const device=(host,op,fields={})=>api(host,'/api/personal',{op,...fields});
async function until(check){
  const end=Date.now()+600000;
  while(Date.now()<end){
    const value=await check();if(value)return value;
    await delay(300);
  }
  throw Error('Timed out waiting for LAN transfer');
}
async function upload(host,file){
  const form=new FormData();form.append('files',await openAsBlob(file),path.basename(file));
  return fetch(host.url+'/api/upload',{method:'POST',body:form});
}
try{
  for(const [dir,address] of [['sender','127.0.0.71'],['receiver','127.0.0.72']]){
    servers.push(await startServer({port:0,host:'127.0.0.1',personalAddress:address,dataDir:path.join(root,dir)}));
  }
  const [sender,receiver]=servers;
  const a=(await device(sender,'status')).id,b=(await device(receiver,'status')).id;
  await device(sender,'find',{address:'127.0.0.72'});
  await device(sender,'trust',{peer:b});const req=await until(async()=>(await device(receiver,'status')).pairRequests.find(p=>p.peer===a));
  await device(receiver,'approvePair',{peer:a,key:req.key});
  await until(async()=>(await device(sender,'status')).peers.find(p=>p.id===b&&p.synced));
  const handlers=new Map();let selected;
  registerTransferFiles({ipcMain:{handle:(id,fn)=>handlers.set(id,fn)},dialog:{async showOpenDialog(){return {filePaths:[selected]};}},
    mainWindow:{},checkWindowSender(){},service:sender});
  async function sendSelected(){
    const {token}=await handlers.get('lume:pick-transfer-file')({});
    return handlers.get('lume:send-transfer-file')({},token,b);
  }
  for(const size of [264,500]){
    const title='transfer-'+size,bytes=size*MiB;
    selected=path.join(root,title+'.wav');
    await wav(selected,bytes);
    if(size===264){await sendSelected();}
    else{
      const response=await upload(sender,selected);
      assert.equal(response.status,200);
      const result=await response.json();assert.equal(result.imported,1);
      const song=result.state.tracks.find(t=>t.title===title);assert(song);
      await device(sender,'offer',{peer:b,id:song.id});
    }
    const offer=await until(async()=>(await device(receiver,'status')).offers.find(o=>o.title===title));
    assert.equal(offer.bytes,bytes);
    await device(receiver,'accept',{key:offer.key});
    const song=await until(async()=>(await api(receiver,'/api/state')).tracks.find(t=>t.title===title&&t.folder==='局域网接收'));
    const media=await fetch(receiver.url+'/media/'+song.id);assert.equal(media.status,200);
    const actual=await digest(media.body);
    assert.equal(actual.bytes,bytes);assert.deepEqual(actual,await digest(createReadStream(selected)));
    console.log(size+' MiB saved to the receiving library and streamed back: '+actual.sha256);
  }
  const handle=await open(selected,'a');try{await handle.write(Buffer.from([1]));}finally{await handle.close();}
  await assert.rejects(sendSelected,/500 MiB/);
  const rejected=await upload(sender,selected);assert.equal(rejected.status,413);assert.match(await rejected.text(),/500 MiB/);
  assert.deepEqual(await readdir(path.join(root,'sender','uploads')),[]);
  assert(!(await device(receiver,'status')).offers.length);
  console.log('500 MiB + 1 byte rejected by both the native sender and multipart importer; no pending offer or temporary upload.');

  selected=path.join(root,'changed-after-offer.wav');
  await wav(selected,MiB);await sendSelected();
  const pending=await until(async()=>(await device(receiver,'status')).offers.find(o=>o.title==='changed-after-offer'));
  const changed=await open(selected,'r+');
  try{await changed.truncate(500*MiB+1);}finally{await changed.close();}
  await device(receiver,'accept',{key:pending.key});
  await until(async()=>!(await device(receiver,'status')).offers.some(o=>o.key===pending.key));
  assert(!(await api(receiver,'/api/state')).tracks.some(t=>t.title==='changed-after-offer'));
  assert(!(await readdir(path.join(root,'receiver','received'))).some(f=>f.endsWith('.part')));
  console.log('Source grew past the limit after offering: transfer cancelled and partial file removed.');
}finally{
  try{await Promise.all(servers.map(server=>server.close()));}finally{await rm(root,{recursive:true,force:true});}
}
