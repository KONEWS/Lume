import core from 'liblume.so';
import { util } from '@kit.ArkTS';
import { PhoneSource } from './PhoneSource';
import { Song } from './LocalLibrary';
interface Identity {audioIdentity?:string;audioBytes?:number}
export interface LocalMatch {path:string;identity:string;song:Song}
export class LocalAudio {
  private key:string='';private generation:number=0;
  match?:LocalMatch;
  select(track:string,identity:string,bytes:number,source?:PhoneSource):void {
    const key=track+'/'+identity;if(key===this.key)return;
    this.clear();this.key=key;
    if(!source||!/^sha256:[a-f0-9]{64}$/.test(identity)||bytes<=0)return;
    this.find(source,identity,bytes,this.generation).catch(()=>{});
  }
  private async find(source:PhoneSource,identity:string,bytes:number,gen:number):Promise<void>{
    const candidates=source.library.songs.filter((s:Song)=>!s.hidden&&(!s.bytes||s.bytes===bytes));
    for(const song of candidates){
      if(gen!==this.generation)return;
      try{
        const path=source.localPath(song);
        const buffer:ArrayBuffer=await core.localMedia(path,'stereo',-1);
        const found=JSON.parse(util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(buffer))) as Identity;
        if(found.audioIdentity!==identity||found.audioBytes!==bytes)continue;
        const probe:ArrayBuffer=await core.localMedia(path,'stereo',0,identity);
        if(probe.byteLength===0)continue;
        if(gen===this.generation)this.match={path:path,identity:identity,song:song};return;
      }catch(e){}
    }
  }
  clear():void{this.generation++;this.key='';this.match=undefined;}
}
