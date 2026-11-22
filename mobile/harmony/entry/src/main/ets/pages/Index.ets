import core from 'liblume.so';
import { picker } from '@kit.CoreFileKit';
import { PhoneSource } from '../engine/PhoneSource';
import { window } from '@kit.ArkUI';
import { audio, AVVolumePanel } from '@kit.AudioKit';
import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { Receiver, Skin, Snapshot, phoneModel, Ticket, Peer, OutputPatch, TrackDetails, Completion, PlayRecord } from '../engine/Receiver';
import { LocalLibrary, Song } from '../engine/LocalLibrary';
import { SongActions } from '../engine/SongActions';
import { DiscoverySession, Space } from '../engine/Discovery';

PersistentStorage.persistProp('lumeHost', '');
PersistentStorage.persistProp('lumeProfile', '');

PersistentStorage.persistProp('routeDelay',0);
PersistentStorage.persistProp('routeChannel','left');
PersistentStorage.persistProp('playbackShuffle',false);
PersistentStorage.persistProp('playbackMode','');
PersistentStorage.persistProp('landscapeAwake',false);
if(!AppStorage.has('lumeForeground'))AppStorage.setOrCreate('lumeForeground',false);
interface Invitation {url?:string;name?:string;inviteToken?:string;deviceId?:string}
interface NearbyPhone {id:string;platform:string;model:string;address:string}
interface SafeInsets {top:number;right:number;bottom:number;left:number}
interface HostInfo {nearbyPhones?:NearbyPhone[];phoneSearching?:boolean;inviteStatus?:string;pin?:string; address?:string; port?:number; pending?:Ticket[]; outputs?:Peer[];error?:string}
interface Action { inviteToken?:string;deviceId?:string;mode?:string;delta?:number; blocked?:string[]; blockedFormats?:string[]; skipShort?:boolean; token?:number; kind?:string; offset?:number; length?:number; patch?:OutputPatch; order?:string[]; type:string; id?:string; url?:string; pin?:string; seconds?:number; enabled?:boolean; lyrics?:boolean; dark?:boolean; value?:boolean; channel?:string; delayMs?:number }
interface Update { platform?:string;roomDetails?:TrackDetails|null;completion?:Completion;playRecords?:PlayRecord[];
  localSong?:Song|null;localTrackId?:string;
  nearbyPhones?:NearbyPhone[];phoneSearching?:boolean;inviteStatus?:string;
  landscapeAwake?:boolean;
  searching?:boolean;
  scanHistory?:string[]; pickedScanBlock?:string;
  selfId?:string;
  order?:string[];
  playMode?:string;shuffle?:boolean;
  shuffleAvailable?:boolean;
  counts?:Record<string,number>; scanTotal?:number; scanDone?:number; scanFound?:number;
  scanStatus?:string; scanning?:boolean; scanPaused?:boolean;
  model?:string;
  hosting?:boolean; creating?:boolean; hostError?:string; hostPin?:string; address?:string; pending?:Ticket[]; outputs?:Peer[]; delayMs?:number;
  songs?:Song[]; hosts?:Space[]; id?:string; title?:string; duration?:number; pos?:number; playing?:boolean;
  joined?:boolean; host?:string; savedHost?:string; status?:string; channel?:string; skin?:Skin|null; error?:string;
}
class PlayerBridge {
  private receive:(message:string)=>void;
  constructor(receive:(message:string)=>void) { this.receive=receive; }
  dispatch(message:string):void { this.receive(message); }
}

@Entry
@Component
struct Index {
  private songActions?:SongActions;
  private songResult(token:number,ok:boolean,message:string):void{
    this.controller.runJavaScript('window.lumeSongActionResult('+token+','+ok+','+JSON.stringify(message)+')').catch(()=>{});
  }
  @StorageLink('routeDelay') routeDelay:number=0;
  @StorageLink('routeChannel') routeChannel:string='left';
  @StorageLink('playbackMode') localMode:string='';
  @StorageLink('playbackShuffle') localShuffle:boolean=false;
  @StorageLink('landscapeAwake') landscapeAwake:boolean=false;
  @StorageLink('lumeForeground') @Watch('foregroundChanged') foreground:boolean=false;
  private awakeDesired:boolean=false;
  private awakeWork:Promise<void>=Promise.resolve();
  private hosting:boolean=false;
  private creating:boolean=false;
  private hostError:string='';
  private pendingHostSelection:string='';
  private joining:boolean=false;
  private listening:boolean=false;
  private memberView:string='';
  private hostView:string='';
  private disposed:boolean=false;
  private discovery?:DiscoverySession;
  private searching:boolean=false;
  @StorageLink('lumeHost') host:string='';
  @StorageLink('lumeProfile') profile:string='';
  private controller:webview.WebviewController = new webview.WebviewController();
  private ready:boolean=false;
  private canBack:boolean=false;
  private styleWindowWork:Promise<void>=Promise.resolve();
  private playerIsFullscreen:boolean=false;
  private playerSessionActive:boolean=false;
  private playerSessionLyrics:boolean=false;
  private appliedPlayerFullscreen?:boolean;
  private darkSystemBarIcons:boolean=false;
  private mainWindow?:window.Window;
  private lastInsets:string='';
  private avoidAreaChanged=(_data:window.AvoidAreaOptions):void=>{this.sendInsets();};
  private windowSizeChanged=(_size:window.Size):void=>{this.syncPlayerWindow();this.sendInsets();this.syncKeepAwake();};
  private windowEventChanged=(event:window.WindowEventType):void=>{
    if(event===window.WindowEventType.WINDOW_ACTIVE)this.syncPlayerWindow(true);
  };
  private systemBarProperties():window.SystemBarProperties {
    const color=this.darkSystemBarIcons?'#18202D':'#F1FFFA';
    return {statusBarColor:'#00000000',statusBarContentColor:color,
      navigationBarColor:'#00000000',navigationBarContentColor:color};
  }
  private systemBarAppearance(dark:boolean):void {
    if(this.darkSystemBarIcons===dark)return;
    this.darkSystemBarIcons=dark;
    const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
    // Share the queue with fullscreen transitions so a late restore cannot overwrite the theme.
    this.styleWindowWork=this.styleWindowWork.then(async()=>{
      const main=await window.getLastWindow(context);
      await main.setWindowSystemBarProperties(this.systemBarProperties());
    }).catch(()=>{});
  }
  private bindWindow():void {
    const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
    window.getLastWindow(context).then((main:window.Window)=>{
      if(this.disposed)return;
      this.mainWindow=main;
      this.syncKeepAwake();
      main.on('avoidAreaChange',this.avoidAreaChanged);
      main.on('windowSizeChange',this.windowSizeChanged);
      main.on('windowEvent',this.windowEventChanged);
      this.syncPlayerWindow();
      this.sendInsets();
    }).catch(()=>{});
  }
  private sendInsets():void {
    const main=this.mainWindow;
    if(!main||!this.ready||this.disposed)return;
    const insets:SafeInsets={top:0,right:0,bottom:0,left:0};
    try {
      // On desktop/freeform windows the system may retain its own avoidance.
      if(main.getWindowProperties().isLayoutFullScreen){
        // A user-revealed system bar overlays the player without moving its content.
        const types:window.AvoidAreaType[]=this.playerIsFullscreen ? [window.AvoidAreaType.TYPE_CUTOUT] :
          [window.AvoidAreaType.TYPE_SYSTEM,window.AvoidAreaType.TYPE_CUTOUT,window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR];
        for(const type of types){
          const area=main.getWindowAvoidArea(type);
          insets.top=Math.max(insets.top,this.getUIContext().px2vp(area.topRect.height));
          insets.right=Math.max(insets.right,this.getUIContext().px2vp(area.rightRect.width));
          insets.bottom=Math.max(insets.bottom,this.getUIContext().px2vp(area.bottomRect.height));
          insets.left=Math.max(insets.left,this.getUIContext().px2vp(area.leftRect.width));
        }
      }
      // Landscape player controls can use the camera-hole side of the screen.
      const rect=main.getWindowProperties().windowRect;
      if(this.playerIsFullscreen && rect.width>rect.height){insets.left=0;insets.right=0;}
      const key=JSON.stringify(insets);
      if(key===this.lastInsets)return;
      this.lastInsets=key;
      this.controller.runJavaScript('window.lumeInsets&&window.lumeInsets('+key+')').catch(()=>{this.lastInsets='';});
    }catch{}
  }
  private playerSession(enabled:boolean,lyrics:boolean=false):void {
    this.playerSessionActive=enabled;
    this.playerSessionLyrics=lyrics;
    this.syncPlayerWindow();
  }
  private foregroundChanged():void {
    this.syncKeepAwake();
    if(this.foreground)this.syncPlayerWindow(true);
  }
  private syncPlayerWindow(force:boolean=false):void {
    const main=this.mainWindow;
    if(!main)return;
    const rect=main.getWindowProperties().windowRect;
    this.playerFullscreen(this.playerSessionActive && (this.playerSessionLyrics || rect.width>rect.height),force);
  }
  private playerFullscreen(enabled:boolean,force:boolean=false):void {
    if(!force && this.playerIsFullscreen===enabled && this.appliedPlayerFullscreen===enabled)return;
    this.playerIsFullscreen=enabled;
    const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.styleWindowWork=this.styleWindowWork.then(async()=>{
      const main=await window.getLastWindow(context);
      // Read the latest target when this queued work runs; never replay stale
      // enter/exit requests after a quick rotation or a cancelled opening drag.
      const target=this.playerIsFullscreen;
      if(!force && this.appliedPlayerFullscreen===target)return;
      // EntryAbility establishes edge-to-edge once. Page changes do not reset it.
      // Harmony's gesture indicator is separate from the legacy navigation bar.
      await Promise.all([
        main.setSpecificSystemBarEnabled('status',!target,false),
        main.setSpecificSystemBarEnabled('navigation',!target,false),
        main.setSpecificSystemBarEnabled('navigationIndicator',!target,false)
      ]);
      this.appliedPlayerFullscreen=target;
      await main.setWindowSystemBarProperties(this.systemBarProperties());
      this.sendInsets();
    }).catch(()=>{});
  }
  private joined:boolean=false;
  private status:string='';
  private channel:string='';
  private theme?:Skin;
  private snapshot?:Snapshot;
  private catalog:Song[]=[];
  private spaces:Space[]=[];
  private timer:number=-1;
  private scan:number=0;
  @State mediaPanelLevel:number|undefined=undefined;
  private volumeStart:number=0;
  private volumeMin:number=0;
  private volumeMax:number=0;
  private local?:LocalLibrary;
  private songCount:number=-1;
  private songRevision:number=-1;
  private scanHistoryRevision:number=-1;
  private lastPlay:string='';
  private bridge:PlayerBridge=new PlayerBridge((message:string)=>{
    let action:Action;
    try { action=JSON.parse(message) as Action; } catch { return; }
    this.handle(action);
  });
  private receiver:Receiver=new Receiver((status:string,title:string,channel:string)=>{
    if(status.startsWith('请填写'))this.joining=false;
    if(status.startsWith('连接失败')){
      if(this.hosting){
        core.room('{"type":"stop"}');this.hosting=false;this.creating=false;
        this.pendingHostSelection='';this.hostError=status;this.syncKeepAwake();
        this.send({hosting:false,creating:false,hostError:this.hostError});
      }
      this.reset(status);return;
    }
    if(status!==this.status || channel!==this.channel){
      this.status=status; this.channel=channel; this.send({status:status,channel:channel});
    }
  },(skin?:Skin)=>{
    if(JSON.stringify(skin)!==JSON.stringify(this.theme)){this.theme=skin;this.send({skin:skin??null});}
  },(s:Snapshot)=>{
    const first=!this.joined;
    this.joining=false;this.joined=true;this.snapshot=s;
    this.setRoute(s.channel,s.delayMs);
    this.showMembers(s);
    if(s.catalog)this.catalog=s.catalog;
    if(first || s.catalog)this.send({joined:true,host:this.hosting?'本机空间':this.host,songs:this.catalog});
    this.playback();
    if(first&&this.hosting&&this.pendingHostSelection){
      const id=this.pendingHostSelection;this.pendingHostSelection='';
      if(this.catalog.some((song:Song)=>song.id===id))this.receiver.action('play',id);
      else this.send({error:'所选歌曲不在空间曲库中，请重新选择'});
    }
  });

  aboutToAppear(){
    this.disposed=false;this.bindWindow();
    if(!this.profile)this.profile=util.generateRandomUUID();
    this.local=new LocalLibrary(this.getUIContext().getHostContext() as common.UIAbilityContext,()=>this.localChanged());
    if(!this.localMode)this.localMode=this.localShuffle?'shuffle':'sequence';
    this.local.playMode=this.localMode;this.local.shuffle=this.localMode==='shuffle';
    this.local.fillLegacyFacts().catch(()=>{});
    this.receiver.source=new PhoneSource(this.local,this.getUIContext().getHostContext() as common.UIAbilityContext);
    this.receiver.savedDelayMs=this.routeDelay;this.receiver.savedChannel=this.routeChannel;
    this.search();this.timer=setInterval(()=>{this.checkNearby();if(!this.joined)this.playback();if(this.hosting)this.showHost();},350);
  }
  checkNearby():void {
    if(this.ready&&!this.disposed&&!this.joined&&!this.joining&&!this.creating&&!this.hosting){
      const reply:string=core.room(JSON.stringify({type:'nearby',platform:'HarmonyOS',model:phoneModel}));
      this.listening=true;
      const invite=JSON.parse(reply) as Invitation;
      if(invite.url)this.controller.runJavaScript('window.lumeInvite('+JSON.stringify(invite)+')').catch(()=>{});
    }else if(this.listening){
      core.room('{"type":"nearbyStop"}');this.listening=false;
    }
  }
  aboutToDisappear(){
    this.stopSearch();
    this.disposed=true;this.syncKeepAwake();
    this.playerSession(false);
    try{this.mainWindow?.off('avoidAreaChange',this.avoidAreaChanged);}catch{}
    try{this.mainWindow?.off('windowSizeChange',this.windowSizeChanged);}catch{}
    try{this.mainWindow?.off('windowEvent',this.windowEventChanged);}catch{}
    this.mainWindow=undefined;this.lastInsets='';
    this.local?.pauseImport(false);this.disposed=true;this.checkNearby();this.ready=false;if(this.hosting)core.room('{"type":"stop"}');this.scan++;clearInterval(this.timer);this.receiver.stop();this.local?.stop();
  }
  onBackPress():boolean {
    if(!this.canBack)return false;
    this.controller.runJavaScript('window.lumeBack()').catch(()=>{});
    return true;
  }
  send(data:Update):void {
    if(this.ready)this.controller.runJavaScript('window.lumeUpdate('+JSON.stringify(data)+')').catch(()=>{});
  }
  playback():void {
    this.local?.samplePlayback();
    this.syncKeepAwake();
    const s=this.snapshot,p=this.local?.player,song=this.local?.songs[this.local.index];
    const data:Update={
      playRecords:s?s.playRecords:(JSON.parse(core.room('{"type":"historyRecords"}')) as Record<string,PlayRecord[]>).records,
      roomDetails:s?.roomDetails??null,localSong:s?.localSong??null,localTrackId:s?.localTrackId??'',completion:s?s.completion:JSON.parse(core.room('{"type":"historyEvent"}')) as Completion,
      id:s?s.trackId:song?.hidden?'':song?.id??'',title:s?s.roomTrack:song?.hidden?'':song?.title??'',
      playing:s?s.roomPlaying:p?.state==='playing',duration:s?s.duration:Math.max(0,p?.duration??0)/1000,
      playMode:s?s.playMode??(s.shuffle?'shuffle':'sequence'):this.localMode,
      shuffle:s?s.shuffle??false:this.localMode==='shuffle',
      shuffleAvailable:!s||typeof s.shuffle==='boolean',
      pos:s?this.receiver.playbackPosition():Math.max(0,p?.currentTime??0)/1000,error:s?s.roomError??'':this.local?.error??''
    };
    const key=JSON.stringify(data);
    if(key!==this.lastPlay){this.lastPlay=key;this.send(data);}
  }
  localChanged():void {
    if(!this.local)return;
    if(this.scanHistoryRevision!==this.local.historyRevision){
      this.scanHistoryRevision=this.local.historyRevision;this.send({scanHistory:this.local.scanHistory});
    }
    this.send({order:this.local.order,counts:this.local.counts,scanTotal:this.local.scanTotal,scanDone:this.local.scanDone,scanFound:this.local.scanFound,scanStatus:this.local.scanStatus,scanning:this.local.scanning,scanPaused:this.local.paused});
    if(this.joined)return;
    if(this.songCount!==this.local.songs.length||this.songRevision!==this.local.revision){this.songRevision=this.local.revision;this.songCount=this.local.songs.length;this.send({songs:this.local.songs});}
    this.playback();
  }
  reset(status:string):void {
    this.memberView='';this.send({outputs:[],pending:[],selfId:''});
    this.joining=false;this.joined=false;this.snapshot=undefined;this.theme=undefined;this.channel='';this.status=status;
    this.local?.reloadCounts();this.send({joined:false,counts:this.local?.counts,order:this.local?.order??[],songs:this.local?.songs??[],status:status,channel:'',skin:null});this.playback();
  }
  stopSearch():void {
    ++this.scan;this.searching=false;this.discovery?.stop();this.send({searching:false});
  }
  async search():Promise<void> {
    if(this.disposed||this.joined||this.joining||this.creating||this.hosting)return;
    this.stopSearch();const run=++this.scan;
    // Wait for socket closure before rebinding; rapid refreshes cannot overlap.
    await this.discovery?.done.catch(()=>{});
    if(run!==this.scan||this.disposed)return;
    this.spaces=[];this.searching=true;this.status='正在搜索附近空间 · 30 秒后停止';
    this.send({hosts:this.spaces,status:this.status,searching:true});
    this.discovery=new DiscoverySession(this.host,(space:Space)=>{
      if(run===this.scan&&!this.spaces.some((s:Space)=>s.url===space.url)){
        this.spaces.push(space);this.send({hosts:this.spaces});
      }
    });
    await this.discovery.done.catch(()=>{});
    if(run!==this.scan||this.disposed)return;
    this.discovery=undefined;this.searching=false;
    this.status=this.spaces.length?'':'未发现空间，请确认两台设备已连接同一 Wi-Fi。';
    this.send({status:this.status,searching:false});
  }
  setRoute(channel:string,ms:number):void {
    if(!['left','right','stereo','mono'].includes(channel)||!Number.isFinite(ms))return;
    if(this.routeChannel!==channel)this.routeChannel=channel;
    if(this.routeDelay!==ms)this.routeDelay=ms;
    this.receiver.savedChannel=channel;this.receiver.savedDelayMs=ms;
  }
  syncKeepAwake():void {
    const main=this.mainWindow;if(!main)return;
    const rect=main.getWindowProperties().windowRect;
    const playing=this.snapshot?this.snapshot.roomPlaying:this.local?.player?.state==='playing';
    const enabled=!this.disposed&&this.foreground&&this.landscapeAwake&&!!playing&&rect.width>rect.height;
    if(enabled===this.awakeDesired)return;this.awakeDesired=enabled;
    this.awakeWork=this.awakeWork.then(()=>main.setWindowKeepScreenOn(enabled)).catch(()=>{});
  }
  showMembers(s:Snapshot):void {
    const update:Update={outputs:s.outputs??[],selfId:s.selfId??'',pending:s.pending??[]};
    const key=JSON.stringify(update);
    if(this.memberView!==key){this.memberView=key;this.send(update);}
  }
  showHost():void {
    const info=JSON.parse(core.room('{"type":"status"}')) as HostInfo;

    const update:Update={hosting:true,hostPin:info.pin,address:info.address,nearbyPhones:info.nearbyPhones,phoneSearching:info.phoneSearching,inviteStatus:info.inviteStatus};
    const key=JSON.stringify(update);if(key!==this.hostView){this.hostView=key;this.send(update);}
  }
  async createHost():Promise<void>{
    if(this.creating||this.hosting||this.joined||!this.local)return;
    this.stopSearch();
    this.creating=true;this.hostError='';this.pendingHostSelection='';this.status='正在创建空间';
    this.send({creating:true,hostError:'',status:this.status});
    try{
      await this.local.stop();const songs=await this.local.hostSongs();
      if(this.disposed)return;
      const info=JSON.parse(core.room(JSON.stringify({type:'start',name:phoneModel+' 的播放空间',songs:songs,shuffle:this.localShuffle,playMode:this.localMode}))) as HostInfo;
      if(!info.pin)throw new Error(info.error??'无法创建空间');
      this.scan++;this.hosting=true;this.syncKeepAwake();this.hostView='';this.showHost();
      await this.receiver.connect('http://127.0.0.1:'+info.port,info.pin,this.profile);
    }catch(e){
      this.pendingHostSelection='';
      this.hostError=(e as Error).message||'未能创建空间，请重试';
      this.send({hostError:this.hostError,error:this.hostError});
    }finally{
      this.creating=false;
      this.send({creating:false,hosting:this.hosting,hostError:this.hostError});
    }
  }
  async importSongs(folderMode:boolean=false,skipShort:boolean=false,blocked:string[]=[],blockedFormats:string[]=[],rescan:boolean=false):Promise<void>{
    if(!this.local||(this.joined&&!this.hosting))return;
    await this.local.pick(folderMode,skipShort,blocked,blockedFormats,rescan);
    if(this.hosting)core.room(JSON.stringify({type:'update',songs:await this.local.hostSongs()}));
  }
  async join(url:string,pin:string,inviteToken:string='',deviceId:string=''):Promise<void>{
    if(this.creating||this.hosting||this.joined||this.joining)return;
    this.joining=true;
    this.stopSearch();
    if(this.local)await this.local.stop();
    this.joining=true;this.scan++;this.host=url;this.send({host:url,savedHost:url});await this.receiver.connect(url,pin,this.profile,inviteToken,deviceId);
  }
  handle(a:Action):void{
    // A host connects to its own room asynchronously. Never start private local
    // playback during that handoff, or the first empty room snapshot will erase it.
    if(!this.joined&&(this.creating||this.hosting)){
      if(a.type==='select'){
        if(this.local?.songs.some((song:Song)=>song.id===a.id)){
          this.pendingHostSelection=a.id??'';
          this.send({status:'已选择歌曲，正在连接播放空间…'});
        }
        return;
      }
      if(['toggle','next','previous','seek','shuffle','playMode'].includes(a.type)){
        this.send({status:'正在连接播放空间，请稍候…'});return;
      }
    }
    switch(a.type){
      case 'playMode':
        if(!a.mode||!['sequence','repeatOne','shuffle'].includes(a.mode))break;
        if(this.joined)this.receiver.command(JSON.stringify({type:'playMode',mode:a.mode}));
        else if(this.local){this.localMode=a.mode;this.local.playMode=a.mode;this.localShuffle=a.mode==='shuffle';this.local.shuffle=this.localShuffle;this.playback();}
        break;
      case 'shuffle':
        if(typeof a.value!=='boolean')break;
        if(this.joined&&typeof this.snapshot?.shuffle!=='boolean')break;
        if(this.joined)this.receiver.command(JSON.stringify({type:'shuffle',value:a.value}));
        else if(this.local){this.localShuffle=a.value;this.local.shuffle=a.value;this.localMode=a.value?'shuffle':'sequence';this.local.playMode=this.localMode;this.playback();}
        break;
      case 'mediaVolumeStart':{
        const group=audio.getAudioManager().getVolumeManager().getVolumeGroupManagerSync(audio.DEFAULT_VOLUME_GROUP_ID);
        const music=audio.AudioVolumeType.MEDIA;
        this.volumeStart=group.getVolumeSync(music);
        this.volumeMin=group.getMinVolumeSync(music);
        this.volumeMax=group.getMaxVolumeSync(music);
        this.mediaPanelLevel=this.volumeStart;
        break;
      }
      case 'mediaVolumeDrag':{
        const level=this.volumeStart+Math.round((a.delta??0)*(this.volumeMax-this.volumeMin));
        this.mediaPanelLevel=Math.max(this.volumeMin,Math.min(this.volumeMax,level));
        break;
      }
      case 'trackDetails':if(this.hosting)core.room(JSON.stringify(a));break;
      case 'systemBarAppearance':this.systemBarAppearance(a.dark??false);break;
      case 'playerSession':this.playerSession(a.enabled??false,a.lyrics??false);break;
      case 'backState':this.canBack=a.enabled??false;break;
      case 'ready':
        this.playerSession(false);
        this.ready=true;this.lastPlay='';this.memberView='';if(this.snapshot)this.showMembers(this.snapshot);if(this.hosting){this.hostView='';this.showHost();}
        this.lastInsets='';this.sendInsets();
        this.send({platform:'HarmonyOS',landscapeAwake:this.landscapeAwake,searching:this.searching,creating:this.creating,hosting:this.hosting,hostError:this.hostError,scanHistory:this.local?.scanHistory,model:phoneModel,counts:this.local?.counts,order:this.local?.order??[],joined:this.joined,savedHost:this.host,host:this.host,hosts:this.spaces,status:this.status,
          skin:this.theme??null,channel:this.channel,songs:this.joined?this.catalog:this.local?.songs??[]});
        this.playback();break;
      case 'createHost':this.createHost();break;
      case 'decide':if(this.joined)this.receiver.command(JSON.stringify({type:a.enabled?'join-allow':'join-deny',value:a.id}));break;
      case 'output':if(this.joined&&a.patch)this.receiver.command(JSON.stringify({type:'output',id:a.id,patch:a.patch}));break;
      case 'search':this.search();break;
      case 'landscapeAwake':this.landscapeAwake=!!a.enabled;this.syncKeepAwake();this.send({landscapeAwake:this.landscapeAwake});break;
      case 'searchPhones':case 'invitePhone':if(this.hosting){core.room(JSON.stringify(a));this.showHost();}break;
      case 'join':this.join(a.url??'',a.pin??'',a.inviteToken??'',a.deviceId??'');break;
      case 'leave':this.receiver.stop();this.hostError='';this.pendingHostSelection='';if(this.hosting){core.room('{"type":"stop"}');this.hosting=false;this.syncKeepAwake();this.send({hosting:false,hostError:'',pending:[],outputs:[]});}this.reset('已离开空间');break;
      case 'pauseImport':this.local?.pauseImport(a.enabled??false);break;
      case 'songNext':case 'songShare':case 'songHide':case 'songDelete':case 'songRestore':{
        const token=a.token??0;
        if(this.joined||!this.local){this.songResult(token,false,'请先离开播放空间');break;}
        if(!this.songActions)this.songActions=new SongActions(getContext(this) as common.UIAbilityContext,this.local);
        this.songActions.run(a.type,a.id??'').then((message:string)=>this.songResult(token,message!=='已取消删除，歌曲已保留',message)).catch((error:Error)=>this.songResult(token,false,error.message||'操作失败，歌曲已保留'));
        break;
      }
      case 'detailRead':{
        const token=a.token??0;
        if(!Number.isSafeInteger(token))break;
        this.local?.detailBytes(a.id??'',a.kind??'',a.offset??0,a.length??0).catch(()=>'').then(bytes=>{
          if(!this.disposed)this.controller.runJavaScript('window.lumeReadResult('+token+','+JSON.stringify(bytes)+')').catch(()=>{});
        });
        break;
      }
      case 'pickScanBlock':
        if(this.local&&!this.local.scanning&&(!this.joined||this.hosting))this.local.chooseDirectory().then((uri:string)=>{
          if(uri)this.send({pickedScanBlock:LocalLibrary.folderKey(uri)});
        }).catch(()=>{});
        break;
      case 'scan':this.importSongs(true,a.skipShort??true,a.blocked??[],a.blockedFormats??[]).catch(()=>this.send({error:'未能扫描文件夹'}));break;
      case 'rescan':this.importSongs(true,a.skipShort??true,a.blocked??[],a.blockedFormats??[],true).catch(()=>this.send({error:'未能扫描已选文件夹，请检查授权或重新选择文件夹'}));break;
      case 'import':this.importSongs().catch(()=>this.send({error:'未导入文件'}));break;
      case 'toggle':
        if(this.joined)this.receiver.action(this.snapshot?.roomPlaying?'pause':'play');
        else this.local?.toggle().catch(()=>this.send({error:'播放失败'}));break;
      case 'next':case 'previous':
        if(this.joined)this.receiver.action(a.type);
        else if(this.local)this.local.step(a.type==='next'?1:-1);break;
      case 'seek':
        if(this.joined)this.receiver.action('seek','',a.seconds??0);else this.local?.seek(a.seconds??0);break;
      case 'select':
        if(this.joined)this.receiver.action('play',a.id??'');
        else if(this.local){
          const index=this.local.songs.findIndex((s:Song)=>s.id===a.id);
          if(index>=0){
            const ids=new Set(this.local.songs.map((s:Song)=>s.id));
            const order=Array.from(new Set(a.order??[])).filter((id:string)=>ids.has(id));
            this.local.playNext=[];this.local.order=order.includes(a.id??'')?order:[];this.send({order:this.local.order});this.local.play(index);
          }
        }
        break;
    }
  }
  build(){
    Stack(){
      AVVolumePanel({volumeLevel:this.mediaPanelLevel})
      Web({src:$rawfile('player/index.html'),controller:this.controller})
      .width('100%').height('100%').backgroundColor('#10121E').javaScriptAccess(true).domStorageAccess(true)
      .expandSafeArea([SafeAreaType.SYSTEM,SafeAreaType.CUTOUT],[SafeAreaEdge.TOP,SafeAreaEdge.BOTTOM,SafeAreaEdge.START,SafeAreaEdge.END])
      .javaScriptProxy({object:this.bridge,name:'LumeNative',methodList:['dispatch'],controller:this.controller})
      .onShowFileSelector((event)=>{
        const options = new picker.DocumentSelectOptions();
        options.maxSelectNumber = event.fileSelector.getMode() === FileSelectorMode.FileOpenMultipleMode ? 100 : 1;
        const files = new picker.DocumentViewPicker(this.getUIContext().getHostContext() as common.UIAbilityContext);
        files.select(options).then((uris:string[])=>event.result.handleFileList(uris)).catch(()=>event.result.handleFileList([]));
        return true;
      })
      .onLoadIntercept((event)=>{
        if(!event || !event.data.isMainFrame())return false;
        const url=event.data.getRequestUrl();
        return !(url.startsWith('resource://') || url.startsWith('file:///') && url.endsWith('/player/index.html'));
      })
    }.height('100%').width('100%').backgroundColor('#10121E')
    .expandSafeArea([SafeAreaType.SYSTEM,SafeAreaType.CUTOUT],[SafeAreaEdge.TOP,SafeAreaEdge.BOTTOM,SafeAreaEdge.START,SafeAreaEdge.END])
  }
}
