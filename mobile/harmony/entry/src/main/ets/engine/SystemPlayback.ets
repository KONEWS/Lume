import { systemPhoneModel } from './DeviceModel';
import { common, wantAgent, WantAgent } from '@kit.AbilityKit';
import { avSession } from '@kit.AVSessionKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { image } from '@kit.ImageKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { LocalLibrary, Song } from './LocalLibrary';
import { Snapshot } from './Receiver';
import { CardState, emptyCard, formIds, readText, sendCard, writeFile } from '../widget/CardData';

interface FavoriteStore {imported:boolean;keys:string[]}
interface Selection {id:string;mode:string}
interface CoverRecord {key:string;name:string}
interface MediaState {id:string;title:string;artist:string;duration:number;playing:boolean;position:number;at:number}
function failed(error:Error):void{hilog.warn(0,'LumePlayback','%{public}s',error.message);}

class SystemPlayback {
  private context?:common.UIAbilityContext;
  library?:LocalLibrary;
  pageChanged?:()=>void;
  pageControl?:(action:string)=>void;
  pageFavorites?:(keys:string[])=>void;
  private favorites:Set<string>=new Set();
  private favoritesImported:boolean=false;
  private favoriteKey:string='';
  private roomArtists:Map<string,string>=new Map();
  private lastRemote:string='';
  private state:MediaState={id:'',title:'',artist:'',duration:0,playing:false,position:0,at:0};
  private artKey:string='';
  private cached:CoverRecord={key:'',name:''};
  private imageName:string='';
  private cardKey:string='';
  private cardWork:Promise<void>=Promise.resolve();
  private mediaWork:Promise<void>=Promise.resolve();
  private session?:avSession.AVSession;
  private agent?:WantAgent;
  private background:boolean=false;
  private lastMeta:string='';
  private selection:string='';
  private closing:boolean=false;
  private mediaRetry:number=0;
  private failures:number=0;

  attach(context:common.UIAbilityContext):void{
    this.closing=false;this.context=context;
    try{
      const saved=JSON.parse(readText(context.filesDir+'/player-favorites.json')) as FavoriteStore;
      this.favorites=new Set(saved.keys);this.favoritesImported=saved.imported;
    }catch{this.favorites=new Set();this.favoritesImported=false;}
  }
  getLibrary():LocalLibrary{
    if(!this.library){
      const context=this.context!;
      this.library=new LocalLibrary(context,()=>{
        if(this.pageChanged)this.pageChanged();else this.update(undefined,0);
      },systemPhoneModel);
      try{
        const saved=JSON.parse(readText(context.filesDir+'/player-selection.json')) as Selection;
        const index=this.library.songs.findIndex((s:Song)=>s.id===saved.id&&!s.hidden);
        if(index>=0)this.library.index=index;
        this.library.playMode=saved.mode;this.library.shuffle=saved.mode==='shuffle';
      }catch{}
      try{this.cached=JSON.parse(readText(context.filesDir+'/player-cover.json')) as CoverRecord;}catch{}
    }
    return this.library;
  }
  private saveFavorites():void{
    const keys=Array.from(this.favorites);
    writeFile(this.context!.filesDir+'/player-favorites.json',JSON.stringify({imported:this.favoritesImported,keys:keys}));
    this.pageFavorites?.(keys);this.publishCard();
  }
  importFavorites(legacy?:string[]):void{
    if(!this.favoritesImported&&legacy){
      for(const key of new Set(legacy)){
        if(this.favorites.has(key))this.favorites.delete(key);else this.favorites.add(key);
      }
      this.favoritesImported=true;this.saveFavorites();
    }else this.pageFavorites?.(Array.from(this.favorites));
  }
  setFavorite(key:string,value:boolean):void{
    if(!key)return;
    if(value)this.favorites.add(key);else this.favorites.delete(key);
    this.saveFavorites();
  }
  toggleCardFavorite(key:string):void{
    if(!this.pageControl){this.getLibrary();this.update(undefined,0);}
    if(key&&key===this.favoriteKey)this.setFavorite(key,!this.favorites.has(key));
  }
  command(action:string):void{
    if(!['play','pause','toggle','next','previous'].includes(action))return;
    if(this.pageControl){this.pageControl(action);return;}
    const l=this.getLibrary(),playing=l.player?.state==='playing';
    if(action==='next'||action==='previous')l.step(action==='next'?1:-1);
    else if(action==='toggle'||(action==='play')!==playing)l.toggle().catch(failed);
  }
  update(room:Snapshot|undefined,roomPosition:number,scope:string='local'):void{
    if(!this.context||!this.library||this.closing)return;
    const l=this.library,song=l.songs[l.index],p=l.player;
    const local=room?room.localSong??undefined:song?.hidden?undefined:song;
    const id=room?room.trackId:local?.id??'';
    const title=room?room.roomTrack:local?.title??'';
    const playing=room?room.roomPlaying:p?.state==='playing';
    const duration=room?room.duration*1000:Math.max(0,p?.duration??0);
    const position=room?roomPosition*1000:Math.max(0,p?.currentTime??0);
    const now=Date.now(),old=this.state;
    const remote=room?.roomDetails?.id===id?room?.roomDetails?.cover??'':'';
    if(room?.catalog){
      this.roomArtists.clear();
      for(const entry of room.catalog)this.roomArtists.set(entry.id,entry.artist??'');
    }else if(!room)this.roomArtists.clear();
    const artist=local?.artist||(room?this.roomArtists.get(id)??'':'');
    const keyForFavorites=id?JSON.stringify([room?scope:'local',id]):'';
    const scopeChanged=keyForFavorites!==this.favoriteKey;
    this.favoriteKey=keyForFavorites;
    const source=local?[local.id,local.coverFile??'',local.coverStamp??'',local.scanStamp??'',String(local.modifiedAt??0)].join('|'):'';
    const key=id?[id,source,room?.audioIdentity??'',room?.detailToken??'',String(remote.length)].join('|'):'';
    // Compare the actual payload as older room hosts do not publish revision tokens.
    const artChanged=this.artKey!==key||remote!==this.lastRemote;
    this.lastRemote=remote;
    const seek=Math.abs(position-old.position-(old.playing?now-old.at:0))>1400;
    if(this.cardKey&&!scopeChanged&&!artChanged&&!seek&&id===old.id&&title===old.title&&artist===old.artist&&playing===old.playing&&duration===old.duration)return;
    this.state={id:id,title:title,artist:artist,duration:duration,playing:playing,position:position,at:now};
    if(!room&&id){
      const saved=JSON.stringify({id:id,mode:l.playMode});
      if(saved!==this.selection){
        try{writeFile(this.context.filesDir+'/player-selection.json',saved);this.selection=saved;}catch(e){failed(e as Error);}
      }
    }
    if(artChanged){
      this.artKey=key;
      const rev=++this.artVersion;
      this.imageName='';
      if(id)this.loadArt(key,local,remote,rev).catch(failed);
    }
    this.publishCard();
    this.queueMedia();
  }
  private artVersion:number=0;
  private async loadArt(sourceKey:string,song:Song|undefined,remote:string,rev:number):Promise<void>{
    const dir=this.context!.filesDir;
    let hash=0;
    for(let i=0;i<remote.length;i++)hash=(Math.imul(hash,31)+remote.charCodeAt(i))|0;
    const key=sourceKey+'|'+hash;
    let name=this.cached.key===key?this.cached.name:'';
    if(!name||!fs.accessSync(dir+'/'+name)){
      let bytes:ArrayBuffer|undefined;
      if(song){
        const embedded=await this.library!.detailBytes(song.id,'systemArtwork',0,1).catch(()=>'');
        if(embedded)bytes=new util.Base64Helper().decodeSync(embedded).buffer as ArrayBuffer;
        if(!bytes&&song.coverFile)bytes=await this.thumbnail(dir+'/'+song.coverFile);
      }
      if(!bytes && remote.startsWith('data:image/') && remote.includes(',')){
        const buffer=new util.Base64Helper().decodeSync(remote.substring(remote.indexOf(',')+1)).buffer as ArrayBuffer;
        bytes=await this.thumbnail(buffer);
      }
      if(!bytes||rev!==this.artVersion)return;
      name='player-cover-'+util.generateRandomUUID()+'.jpg';
      writeFile(dir+'/'+name,bytes);
      const previous=this.cached.name;
      this.cached={key:key,name:name};writeFile(dir+'/player-cover.json',JSON.stringify(this.cached));
      if(previous && previous!==name){try{fs.unlinkSync(dir+'/'+previous);}catch{}}
    }
    if(rev!==this.artVersion)return;
    this.imageName=name;this.publishCard();this.queueMedia();
  }
  private async thumbnail(input:string|ArrayBuffer):Promise<ArrayBuffer|undefined>{
    let file:fs.File|undefined,src:image.ImageSource|undefined,pixel:image.PixelMap|undefined,packer:image.ImagePacker|undefined;
    try{
      if(typeof input==='string'){file=fs.openSync(input);src=image.createImageSource(file.fd);}
      else src=image.createImageSource(input);
      const info=await src.getImageInfo(),scale=Math.min(1,320/Math.max(info.size.width,info.size.height));
      pixel=await src.createPixelMap({desiredSize:{width:Math.max(1,Math.round(info.size.width*scale)),height:Math.max(1,Math.round(info.size.height*scale))}});
      packer=image.createImagePacker();
      return await packer.packToData(pixel,{format:'image/jpeg',quality:85});
    }catch{return undefined;}finally{await packer?.release();await pixel?.release();await src?.release();if(file)fs.closeSync(file);}
  }
  private publishCard():void{
    const dir=this.context!.filesDir;
    const card:CardState={title:this.state.title||emptyCard.title,artist:this.state.artist||(this.state.id?'未知艺人':''),
      favoriteKey:this.favoriteKey,liked:this.favorites.has(this.favoriteKey),playing:this.state.playing,imageName:this.imageName};
    const key=JSON.stringify(card);if(key===this.cardKey)return;
    this.cardKey=key;
    try{writeFile(dir+'/player-card.json',key);}catch(e){failed(e as Error);}
    this.cardWork=this.cardWork.then(async()=>{
      if(key!==this.cardKey)return;
      for(const id of formIds(dir))await sendCard(dir,id,card).catch(failed);
    }).catch(failed);
  }
  private queueMedia():void{
    this.mediaWork=this.mediaWork.then(async()=>{
      await this.syncMedia();this.failures=0;clearTimeout(this.mediaRetry);
    }).catch((error:Error)=>{
      failed(error);clearTimeout(this.mediaRetry);
      if(!this.closing && this.state.playing && this.failures<3){
        this.mediaRetry=setTimeout(()=>this.queueMedia(),1000*++this.failures);
      }
    });
  }
  private async syncMedia():Promise<void>{
    const context=this.context,s=this.state;
    if(!context||this.closing)return;
    if(!this.session && !s.playing)return;
    if(!this.session){
      this.agent=await wantAgent.getWantAgent({wants:[{bundleName:context.abilityInfo.bundleName,abilityName:'EntryAbility'}],
        operationType:wantAgent.OperationType.START_ABILITY,requestCode:0,wantAgentFlags:[wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]});
      const session=await avSession.createAVSession(context,'澄音播放器','audio');
      try{
        session.on('play',()=>this.command('play'));session.on('pause',()=>this.command('pause'));
        session.on('playNext',()=>this.command('next'));session.on('playPrevious',()=>this.command('previous'));
        await session.setLaunchAbility(this.agent);await session.activate();
        this.session=session;
      }catch(e){await session.destroy().catch(failed);throw new Error((e as Error).message);}
    }
    const session=this.session!;
    const meta=JSON.stringify([s.id,s.title,s.artist,s.duration,this.imageName]);
    if(meta!==this.lastMeta){
      const data:avSession.AVMetadata={assetId:s.id||'idle',title:s.title,artist:s.artist,duration:s.duration};
      let src:image.ImageSource|undefined,art:image.PixelMap|undefined,file:fs.File|undefined;
      try{
        if(this.imageName){file=fs.openSync(context.filesDir+'/'+this.imageName);src=image.createImageSource(file.fd);art=await src.createPixelMap();data.mediaImage=art;}
        await session.setAVMetadata(data);this.lastMeta=meta;
      }finally{await art?.release();await src?.release();if(file)fs.closeSync(file);}
    }
    await session.setAVPlaybackState({state:s.playing?avSession.PlaybackState.PLAYBACK_STATE_PLAY:avSession.PlaybackState.PLAYBACK_STATE_PAUSE,
      speed:s.playing?1:0,position:{elapsedTime:Math.round(s.position),updateTime:s.at}});
    if(s.playing&&!this.background){
      await backgroundTaskManager.startBackgroundRunning(context,backgroundTaskManager.BackgroundMode.AUDIO_PLAYBACK,this.agent!);
      this.background=true;
    }else if(!s.playing&&this.background){
      await backgroundTaskManager.stopBackgroundRunning(context);this.background=false;
    }
  }
  async close():Promise<void>{
    this.closing=true;this.artVersion++;clearTimeout(this.mediaRetry);
    this.pageControl=undefined;this.pageChanged=undefined;this.pageFavorites=undefined;
    this.state.playing=false;
    if(this.context)this.publishCard();
    await this.mediaWork;
    if(this.context&&this.background)await backgroundTaskManager.stopBackgroundRunning(this.context).catch(failed);
    this.background=false;await this.session?.destroy().catch(failed);this.session=undefined;this.lastMeta='';
    await this.library?.stop();this.library=undefined;this.lastRemote='';this.artKey='';this.context=undefined;
  }
}
export const systemPlayback=new SystemPlayback();
