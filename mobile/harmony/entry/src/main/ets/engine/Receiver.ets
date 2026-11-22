import { http } from '@kit.NetworkKit';
import { PhoneSource, Transfer } from './PhoneSource';
import { PcmOutput } from './PcmOutput';
import { LocalAudio } from './LocalAudio';
import { Song } from './LocalLibrary';
import { deviceInfo, systemDateTime } from '@kit.BasicServicesKit';

import { util } from '@kit.ArkTS';

const market = deviceInfo.marketName.trim();
const model = deviceInfo.productModel.trim();
export const phoneModel = [market,model].filter((s:string)=>s.length>0 && s.toLowerCase()!=='unknown')
  .filter((s:string,i:number,items:string[])=>items.indexOf(s)===i).join(' · ') || '鸿蒙手机';

export interface Skin {name:string; background:string; surface:string; ink:string; accent:string;}
export interface Ticket {id:string;platform:string;name?:string}
export interface Peer {id:string;platform:string;name:string;channel:string;delayMs:number;volume:number;muted:boolean;enabled:boolean}
export interface OutputPatch {channel?:string;delayMs?:number;volume?:number;muted?:boolean;enabled?:boolean}
export interface TrackDetails {id:string;cover:string;lyrics:string;lyricsSource?:string}
export interface Completion {eventId?:string;id?:string;duration?:number;at?:number}
export interface PlayRecord {session:string;id:string;title:string;startedAt:number;completed:boolean;completedAt?:number}
export interface Snapshot {
  audioIdentity?:string;audioBytes?:number;localSong?:Song|null;localTrackId?:string;
  detailToken?:string;roomDetails?:TrackDetails;completion?:Completion;playRecords?:PlayRecord[];
  playMode?:string;shuffle?:boolean;
  selfId?:string;outputs?:Peer[];pending?:Ticket[];
  roomError?:string;sourceAck?:number;transfer?:Transfer;
  catalog?:Song[]; libraryVersion:number; serverTime:number; delayMs:number; trackId:string; duration:number; roomPlaying:boolean;
  skin?: Skin;
  roomTrack: string; channel: string; enabled: boolean; media: string;
  position: number; volume: number; playing: boolean;
}
interface Decision {decision:string}
export type Status = (status: string, title: string, channel: string) => void;

export class Receiver {
  private localAudio:LocalAudio=new LocalAudio();
  source?:PhoneSource;
  savedChannel:string='left';
  savedDelayMs:number=0;
  private sourceAck:number=-1;
  private id: string = '';
  private generation: number = 0;
  private timer: number = -1;
  private output?:PcmOutput;
  private lastGood:number=0;

  private latest?: Snapshot;
  private detailsKey:string='';
  private loadingKey:string='';
  private detailsRetry:number=0;
  private trackDetails?:TrackDetails;
  private async get(path:string,base:string,auth:string,bytes:boolean=false):Promise<http.HttpResponse>{
    const client=http.createHttp();
    try{
      const response=await client.request(base+path,{method:http.RequestMethod.GET,header:{Cookie:auth},
        expectDataType:bytes?http.HttpDataType.ARRAY_BUFFER:http.HttpDataType.STRING,usingCache:false,connectTimeout:2500,readTimeout:3500});
      if(response.responseCode!==200)throw new Error('Details '+response.responseCode);
      return response;
    }finally{client.destroy();}
  }
  private async loadDetails(s:Snapshot,gen:number):Promise<void>{
    const id=s.trackId,token=s.detailToken??'',key=id+'/'+token;
    if(!id)return;
    if(key===this.detailsKey&&this.trackDetails){s.roomDetails=this.trackDetails;return;}
    if(key===this.loadingKey||this.mono()<this.detailsRetry)return;
    this.loadingKey=key;
    const base=this.base,auth=this.auth;
    try{
      let details:TrackDetails;
      if(token){const r=await this.get('/api/track-details/'+encodeURIComponent(id)+'/'+encodeURIComponent(token),base,auth);details=JSON.parse(String(r.result)) as TrackDetails;}
      else{
        const r=await this.get('/api/lyrics/'+encodeURIComponent(id),base,auth);details=JSON.parse(String(r.result)) as TrackDetails;
        const art=await this.get('/artwork/'+encodeURIComponent(id),base,auth,true);
        const headers=art.header as Record<string,string>;
        const mime=headers['content-type']??'image/jpeg';
        details.cover='data:'+mime.split(';')[0]+';base64,'+new util.Base64Helper().encodeToStringSync(new Uint8Array(art.result as ArrayBuffer));
      }
      if(gen!==this.generation||this.latest?.trackId!==id||(this.latest?.detailToken??'')!==token)return;
      details.id=id;this.trackDetails=details;this.detailsKey=key;this.detailsRetry=0;
      this.latest.roomDetails=details;this.onState(this.latest);
    }catch(e){if(gen===this.generation)this.detailsRetry=this.mono()+2000;}
    finally{if(gen===this.generation&&this.loadingKey===key)this.loadingKey='';}
  }

  private offset:number=0;
  private clockWindow:number=0;
  private bestRtt:number=Infinity;

  private version:number=-1;
  private profile:string='';
  private mono():number{return systemDateTime.getUptime(systemDateTime.TimeType.STARTUP);}
  private onState:(s:Snapshot)=>void;
  private base: string = '';
  private auth: string = '';

  private notify: Status;
  private onSkin: (s?: Skin)=>void;
  constructor(notify: Status, onSkin: (s?:Skin)=>void,onState:(s:Snapshot)=>void) {this.notify=notify;this.onSkin=onSkin;this.onState=onState;}

  private async post(base: string, path: string, body: string, cookie: string): Promise<http.HttpResponse> {
    const client = http.createHttp();
    const headers: Record<string,string> = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    try {
      const response = await client.request(base+path, { method:http.RequestMethod.POST, header:headers,
        extraData:body, expectDataType:http.HttpDataType.STRING, usingCache:false, connectTimeout:2500, readTimeout:3500 });
      if(response.responseCode !== 200) throw new Error(response.responseCode === 401 ? '配对码错误或会话已过期' : '主机响应 '+response.responseCode);
      return response;
    } finally { client.destroy(); }
  }
  async connect(host: string, pin: string, profile:string, inviteToken:string='', deviceId:string=''): Promise<void> {
    this.stop();
    this.profile=profile;this.id='native-'+util.generateRandomUUID();
    const gen = this.generation;
    const base = (host.startsWith('http://')?host:'http://'+host).trim().replace(/\/$/,'');
    if (!/^http:\/\/[\w.-]+(:\d{1,5})?$/.test(base) || (pin!=='' && !/^\d{6}$/.test(pin))) {
      this.notify('请填写主机地址和六位配对码','','');return;
    }
    this.notify(inviteToken?'正在接受邀请':pin?'正在连接':'等待主机允许加入','','');
    try {
      let result:http.HttpResponse;
      if(inviteToken){
        try{result=await this.post(base,'/api/join/invite',JSON.stringify({inviteToken:inviteToken,deviceId:deviceId}),'');}
        catch(e){throw new Error('邀请已失效或连接失败，请让房主重新邀请');}
      }
      else if(pin){result=await this.post(base,'/api/pair',JSON.stringify({code:pin}),'');}
      else{
        const ticket=await this.post(base,'/api/join/request',JSON.stringify({platform:'HarmonyOS',model:phoneModel}),'');
        let approved:http.HttpResponse|undefined=undefined;
        for(let i=0;i<65 && gen===this.generation;i++){
          await new Promise<void>(resolve=>setTimeout(resolve,850));if(gen!==this.generation)return;
          const reply=await this.post(base,'/api/join/status',String(ticket.result),'');
          const verdict=JSON.parse(String(reply.result)) as Decision;
          if(verdict.decision==='allow'){approved=reply;break;}
          if(verdict.decision==='deny')throw new Error('主机已忽略请求');
        }
        if(!approved)throw new Error('等待加入超时');result=approved;
      }
      if(gen!==this.generation)return;
      const match = (String(result.cookies)+' '+JSON.stringify(result.header)).match(/lume_session=[a-f0-9]+/);
      if (!match) throw new Error('未取得配对会话');
      this.base=base;this.auth=match[0];await this.poll(gen);
    } catch(e) { if(gen===this.generation)this.fail((e as Error).message); }
  }
  async action(type:string,id:string='',position:number=0):Promise<void>{
    await this.command(JSON.stringify({type:type,trackId:id,position:position}));
  }
  async command(body:string):Promise<void>{
    if(!this.auth)return;
    try{await this.post(this.base,'/api/action',body,this.auth);}
    catch(e){this.notify((e as Error).message,'',this.latest?.channel??'');}
  }
  // Same monotonic presentation clock and output delay as PcmOutput.
  playbackPosition():number {
    const s=this.latest;
    if(!s)return 0;
    const elapsed=s.roomPlaying?(this.mono()-(s.serverTime-this.offset)-s.delayMs)/1000:0;
    return Math.max(0,Math.min(s.duration,s.position+elapsed));
  }
  private async poll(gen:number):Promise<void> {
    try{
      const before=this.mono();
      const response=await this.post(this.base,'/api/receiver',JSON.stringify({id:this.id,platform:'HarmonyOS',model:phoneModel,profile:this.profile,savedChannel:this.savedChannel,savedDelayMs:this.savedDelayMs,sourceSongs:this.sourceAck!==this.source?.library.songs.length?this.source?.library.songs.filter((s:Song)=>!s.hidden).map((s:Song):Song=>({id:s.id,title:s.title})):undefined,libraryVersion:this.version,bufferMs:this.output?.ahead??0,gaps:this.output?.gaps??0,underflows:this.output?.underflows??0}),this.auth);
      if(gen!==this.generation)return;
      const after=this.mono();this.lastGood=after;
      this.latest=JSON.parse(String(response.result)) as Snapshot;
      this.localAudio.select(this.latest.trackId,this.latest.audioIdentity??'',this.latest.audioBytes??0,this.source);
      this.latest.localSong=this.localAudio.match?.song??null;
      this.latest.localTrackId=this.localAudio.match?this.latest.trackId:'';
      if(after-this.clockWindow>10000 || after-before<=this.bestRtt){
        if(after-this.clockWindow>10000)this.clockWindow=after;
        this.bestRtt=after-before;this.offset=this.latest.serverTime-(before+after)/2;
      }
      this.loadDetails(this.latest,gen);
      this.version=this.latest.libraryVersion;this.onState(this.latest);this.onSkin(this.latest.skin);
      const s=this.latest;
      this.sourceAck=s.sourceAck??this.source?.library.songs.length??-1;
      if(s.transfer)this.source?.send(s.transfer,this.base,this.auth);
      if(s.media){
        if(!this.output)this.output=new PcmOutput();
        this.output.update(this.base+s.media.replace('/api/receiver-media/','/api/pcm/'),this.auth,s.playing,s.position,s.duration,s.delayMs,s.volume,s.serverTime-this.offset,this.localAudio.match?.path??'',s.channel,this.localAudio.match?.identity??'');
      }else{this.output?.close();this.output=undefined;}
      const state=this.output?.error || (!s.enabled?'输出已停用':s.playing?'正在播放':'已连接 · 已暂停');
      this.notify(state,s.roomTrack,s.channel);
    }catch(e){
      if(gen===this.generation && this.mono()-this.lastGood>6500){this.fail((e as Error).message);return;}
    }
    if(gen===this.generation)this.timer=setTimeout(()=>{this.poll(gen);},180);
  }
  private fail(message:string){this.stop();this.notify('连接失败 · '+message,'','');}
  stop(){
    this.localAudio.clear();
    this.generation++;this.detailsKey='';this.loadingKey='';this.detailsRetry=0;this.trackDetails=undefined;this.sourceAck=-1;clearTimeout(this.timer);this.version=-1;this.clockWindow=0;this.bestRtt=Infinity;
    if(this.auth)this.post(this.base,'/api/receiver',JSON.stringify({id:this.id,platform:'HarmonyOS',leave:true}),this.auth).catch(()=>{});
    this.latest=undefined;this.auth='';
    this.output?.close();this.output=undefined;
  }
}
