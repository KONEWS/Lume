import { socket, http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';

interface Beacon {service:string;port:number;name:string;roomName?:string}
export interface Space {name:string;url:string}
// One cancellable search owns the socket and saved-address request. It never
// touches the separate native nearby responder or an established room.
export class DiscoverySession {
  readonly done:Promise<void>;
  private stopped:boolean=false;
  private timeout:number=-1;
  private interval:number=-1;
  private client?:http.HttpRequest;
  private wake:()=>void=()=>{};
  constructor(saved:string,onFound:(space:Space)=>void){
    this.timeout=setTimeout(()=>this.stop(),30000);
    this.done=this.run(saved,onFound);
  }
  stop():void {
    this.stopped=true;clearTimeout(this.timeout);clearInterval(this.interval);
    this.client?.destroy();this.client=undefined;this.wake();
  }
  private async run(saved:string,onFound:(space:Space)=>void):Promise<void>{
    const udp=socket.constructUDPSocketInstance();
    const ended=new Promise<void>(resolve=>{this.wake=resolve;});
    try {
      if(saved && /^http:\/\/[\w.-]+(:\d+)?$/.test(saved)){
        const client=http.createHttp();this.client=client;
        client.request(saved+'/api/info',{connectTimeout:700,readTimeout:700,usingCache:false}).then(reply=>{
          const info=JSON.parse(String(reply.result)) as Beacon;
          if(!this.stopped&&info.service==='lume-room/1')onFound({name:info.roomName??'播放空间',url:saved});
        }).catch(()=>{}).finally(()=>{if(this.client===client){client.destroy();this.client=undefined;}});
      }
      udp.on('message',(event:socket.SocketMessageInfo)=>{
        if(this.stopped)return;
        try {
          const beacon=JSON.parse(util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(event.message))) as Beacon;
          if(beacon.service==='lume-room/1'&&Number.isInteger(beacon.port)&&beacon.port>0&&beacon.port<=65535)
            onFound({name:beacon.name,url:'http://'+event.remoteInfo.address+':'+beacon.port});
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
