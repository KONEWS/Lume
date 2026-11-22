import { http } from '@kit.NetworkKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { LocalLibrary, Song } from './LocalLibrary';

export interface Transfer {token:string;songId:string}
const blockSize:number=256*1024;
export class PhoneSource {
  private lastToken:string='';
  library:LocalLibrary;
  private context:common.UIAbilityContext;
  constructor(library:LocalLibrary,context:common.UIAbilityContext){this.library=library;this.context=context;}
  localPath(song:Song):string {return this.context.filesDir+'/'+song.id;}
  async send(task:Transfer,host:string,cookie:string):Promise<void>{
    if(task.token===this.lastToken || !/^[a-f0-9-]{36}$/.test(task.token))return;
    this.lastToken=task.token;
    const url=host+'/api/source-data/'+task.token;
    let file:fs.File|undefined=undefined;
    try{
      const song=this.library.songs.find(s=>s.id===task.songId);
      if(!song||song.hidden)throw new Error('未共享的歌曲');
      if(!/^[a-fA-F0-9-]{36}$/.test(song.id))throw new Error('无效文件');
      file=fs.openSync(this.context.filesDir+'/'+song.id,fs.OpenMode.READ_ONLY);
      const size=fs.statSync(file.fd).size;
      if(size<=0 || size>200*1024*1024)throw new Error('文件大小不支持');
      for(let offset=0;offset<size;){
        const len=Math.min(blockSize,size-offset);
        let buf=new ArrayBuffer(len);
        const n=await fs.read(file.fd,buf);
        if(n<=0)throw new Error('文件读取中断');
        if(n<len)buf=buf.slice(0,n);
        const end=offset+buf.byteLength===size;
        const client=http.createHttp();
        try{
          const headers:Record<string,string>={'Cookie':cookie,'Content-Type':'application/octet-stream'};
          const r=await client.request(url+'?offset='+offset+'&end='+(end?'1':'0'),{
            method:http.RequestMethod.PUT,header:headers,extraData:buf,connectTimeout:3500,readTimeout:12000,usingCache:false});
          if(r.responseCode===404||r.responseCode===409)return;
          if(r.responseCode!==200)throw new Error('传送失败');
        }finally{client.destroy();}
        offset+=buf.byteLength;
      }
    }catch(e){
      const client=http.createHttp();
      try{const headers:Record<string,string>={'Cookie':cookie};
        await client.request(url+'/fail',{method:http.RequestMethod.POST,header:headers,connectTimeout:2000,readTimeout:2500});
      }catch(ignored){}finally{client.destroy();}
    }finally{if(file)fs.closeSync(file);}
  }
}

