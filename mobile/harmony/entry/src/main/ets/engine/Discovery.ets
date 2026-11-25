import { socket, http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';

interface Beacon {service:string;port:number;name:string;roomName?:string;roomId?:string;urls?:string[]}
function wireId(id?:string):string {return id&&/^[a-f0-9]{32}$/.test(id)?id:'';}
function identity(info:Beacon,url:string):string {
  const id=wireId(info.roomId);if(id)return id;
  if(!Array.isArray(info.urls)||info.urls.length>64)return '';
  const urls=Array.from(new Set<string>(info.urls.filter((u:string)=>/^http:\/\/[0-9.]{7,15}:[0-9]{1,5}$/.test(u)))).sort();
  return urls.length>1&&urls.includes(url)?'legacy:'+JSON.stringify(urls)+':'+(info.roomName??''):'';
}
export interface Space {name:string;url:string;roomId?:string;live?:boolean}
// One cancellable search owns the socket and saved-address request. It never
// touches the separate native nearby responder or an established room.
export class DiscoverySession {
  readonly done:Promise<void>;
  private stopped:boolean=false;
  private timeout:number=-1;
  private interval:number=-1;
  private clients:Set<http.HttpRequest>=new Set<http.HttpRequest>();
  private metadata:Map<string,Promise<Beacon|undefined>>=new Map<string,Promise<Beacon|undefined>>();
  private wake:()=>void=()=>{};
  constructor(saved:string,onFound:(space:Space)=>void){
    this.timeout=setTimeout(()=>this.stop(),30000);
    this.done=this.run(saved,onFound);
  }
  stop():void {
    this.stopped=true;clearTimeout(this.timeout);clearInterval(this.interval);
    this.clients.forEach((client:http.HttpRequest)=>client.destroy());this.clients.clear();this.wake();
  }
  private info(url:string):Promise<Beacon|undefined> {
    const cached=this.metadata.get(url);if(cached)return cached;
    if(this.metadata.size>=64||this.clients.size>=8)return Promise.resolve(undefined);
    const client=http.createHttp();this.clients.add(client);
    const response=client.request(url+'/api/info',{connectTimeout:700,readTimeout:700,usingCache:false,maxLimit:65536}).then((reply:http.HttpResponse)=>{
      const data=JSON.parse(String(reply.result)) as Beacon;
      return data.service==='lume-room/1'?data:undefined;
    }).catch(()=>undefined).finally(()=>{if(this.clients.delete(client))client.destroy();});
    this.metadata.set(url,response);return response;
  }
  private async run(saved:string,onFound:(space:Space)=>void):Promise<void>{
    const udp=socket.constructUDPSocketInstance();
    const ended=new Promise<void>(resolve=>{this.wake=resolve;});
    try {
      if(saved && /^http:\/\/[\w.-]+(:\d+)?$/.test(saved)){
        this.info(saved).then((info?:Beacon)=>{
          if(!this.stopped&&info)onFound({name:info.roomName??'播放空间',url:saved,roomId:identity(info,saved),live:false});
        });
      }
      const confirmed:Set<string>=new Set<string>();
      const observed:Set<string>=new Set<string>();
      udp.on('message',(event:socket.SocketMessageInfo)=>{
        if(this.stopped)return;
        try {
          const beacon=JSON.parse(util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(event.message))) as Beacon;
          if(beacon.service==='lume-room/1'&&Number.isInteger(beacon.port)&&beacon.port>0&&beacon.port<=65535){
            // Give the room our return address even when the hotspot filters broadcasts.
            const ip=event.remoteInfo.address;
            if(event.remoteInfo.port===46322&&!confirmed.has(ip)&&confirmed.size<64){
              confirmed.add(ip);udp.send({data:'LUME_DISCOVER_1',address:{address:ip,port:46322,family:1}}).catch(()=>{});
            }
            const url='http://'+ip+':'+beacon.port,id=wireId(beacon.roomId);
            if(id){onFound({name:beacon.name,url:url,roomId:id,live:true});return;}
            if(observed.has(url)||observed.size>=64)return;
            observed.add(url);
            this.info(url).then((info?:Beacon)=>{
              if(!this.stopped)onFound({name:beacon.name,url:url,roomId:info?identity(info,url):'',live:true});
            });
          }
        }catch(e){}
      });
      await udp.bind({address:'0.0.0.0',port:46323,family:1});
      if(this.stopped)return;
      await udp.setExtraOptions({broadcast:true});
      if(this.stopped)return;
      const query=():void=>{if(!this.stopped)udp.send({data:'LUME_DISCOVER_1',address:{address:'255.255.255.255',port:46322,family:1}}).catch(()=>{});};
      query();this.interval=setInterval(query,850);
      await ended;
    }finally{
      this.stop();udp.off('message');await udp.close().catch(()=>{});
    }
  }
}
