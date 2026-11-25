import core from 'liblume.so';
import { http } from '@kit.NetworkKit';

const BLOCK_BYTES:number=192000*4;
export class PcmOutput {
  private closed:boolean=false;
  private buffers:Set<number>=new Set();
  private fetching:Set<number>=new Set();
  private url:string='';
  private generation:number=0;
  private localPath:string='';private localIdentity:string='';private channel:string='stereo';private localFailed:boolean=false;
  ahead:number=0;
  gaps:number=0;
  underflows:number=0;
  error:string='';
  update(url:string,auth:string,playing:boolean,pos:number,duration:number,delay:number,volume:number,at:number,localPath:string='',channel:string='stereo',identity:string=''){
    if(url!==this.url){
      this.generation++;this.url=url;this.buffers.clear();this.fetching.clear();core.reset();this.localFailed=false;
    }
    this.localPath=localPath;this.channel=channel;this.localIdentity=identity;
    const first=Math.max(0,Math.floor((pos-delay/1000-.16)/4));
    this.buffers.forEach((k:number)=>{if(k<first-1||k>first+4)this.buffers.delete(k);});
    let end=first;
    while(this.buffers.has(end))end++;
    this.ahead=Math.max(0,Math.round((Math.min(duration,end*4)-Math.max(0,pos))*1000));
    for(let n=first;n<=first+3&&n*4<duration;n++){
      if(this.fetching.size>=2)break;
      if(!this.buffers.has(n)&&!this.fetching.has(n))this.load(n,auth,this.generation);
    }
    this.underflows=core.sync(playing,at-pos*1000,duration,volume,delay);
    this.error=this.underflows<0?'音频输出启动失败':'';
    this.gaps=core.gaps();
  }
  private async load(index:number,auth:string,gen:number):Promise<void>{
    this.fetching.add(index);const req=http.createHttp();
    try{
      if(this.localPath&&!this.localFailed){
        try{
        const data:ArrayBuffer=await core.localMedia(this.localPath,this.channel,index,this.localIdentity);
        if(this.closed||gen!==this.generation)return;
        if(data.byteLength>0&&data.byteLength<=BLOCK_BYTES&&data.byteLength%4===0){core.put(index,data);this.buffers.add(index);return;}
        }catch(e){}
        if(this.closed||gen!==this.generation)return;
        this.localFailed=true;
      }
      const headers:Record<string,string>={'Cookie':auth};
      const result=await req.request(this.url+'/'+index,{header:headers,connectTimeout:1800,readTimeout:4000,maxLimit:1000000,expectDataType:http.HttpDataType.ARRAY_BUFFER,usingCache:false});
      if(!this.closed&&gen===this.generation&&result.responseCode===200){
        const data=result.result as ArrayBuffer;
        if(data.byteLength>0&&data.byteLength<=BLOCK_BYTES&&data.byteLength%4===0){
          core.put(index,data);this.buffers.add(index);
        }
      }
    }catch(e){}finally{req.destroy();if(gen===this.generation)this.fetching.delete(index);}
  }
  close(){this.closed=true;this.generation++;this.buffers.clear();core.close();}
}
