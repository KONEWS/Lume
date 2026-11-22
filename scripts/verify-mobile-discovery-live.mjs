import dgram from 'node:dgram';import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const adb=process.env.LOCALAPPDATA+'/Android/Sdk/platform-tools/adb.exe',hdc='D:/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe';const out='artifacts/listen-space-20261121';
const udp=dgram.createSocket({type:'udp4',reuseAddr:true}),events=[];const start=Date.now();
udp.on('message',(buf,r)=>{if(buf.toString()==='LUME_DISCOVER_1'){events.push({ms:Date.now()-start,address:r.address,port:r.port});udp.send(Buffer.from(JSON.stringify({service:'lume-room/1',name:'搜索生命周期验证',port:46321})),r.port,r.address);}});
await new Promise(r=>udp.bind(46322,'0.0.0.0',r));
execFileSync(adb,['shell','input','tap','1130','490']);execFileSync(hdc,['shell','uitest','uiInput','click','2400','410']);
console.log('Refresh both phones; collecting real UDP discovery packets for 39 seconds.');
setTimeout(()=>{fs.writeFileSync(out+'/real-discovery.json',JSON.stringify(events,null,2));console.log([...new Set(events.map(e=>e.address))].map(ip=>{const a=events.filter(e=>e.address===ip);return {ip,count:a.length,first:a[0].ms,last:a.at(-1).ms,after32s:a.filter(e=>e.ms>32000).length};}));udp.close();},39000);
