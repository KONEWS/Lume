import core from 'liblume.so';
import { picker, fileUri, fileIo as fs, fileShare } from '@kit.CoreFileKit';
import { media } from '@kit.MediaKit';
import { image } from '@kit.ImageKit';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { ScanFilter } from './ScanFilter';

interface AudioFacts {fileName?:string; duration?:number; year?:string; trackNumber?:string; discNumber?:string; modifiedAt?:number; addedAt?:number; sortMetadata?:boolean; bytes?:number; quality?:string; hasLyrics?:boolean; factsVersion?:number; playCount?:number; hidden?:boolean}
interface AudioTags extends AudioFacts {title?:string; artist?:string; album?:string; albumArtist?:string}
interface ScanFile {uri:string; folder:string; stem:string; stamp?:string}
export interface HostSong extends AudioFacts { hasSideCover?:boolean; hasSideLyrics?:boolean; id:string; title:string; path:string; artist?:string; album?:string; folder?:string }
export interface Song extends AudioFacts { id:string; title:string; artist?:string; album?:string; metadataVersion?:number; folder?:string; sourceUri?:string; lyricsFile?:string; coverFile?:string; coverUri?:string; scanStamp?:string; lyricUri?:string; lyricStamp?:string; coverStamp?:string; embeddedHasLyrics?:boolean }
export class LocalLibrary {
  songs:Song[]=[];
  index:number=0;
  order:string[]=[];
  shuffle:boolean=false;
  playMode:string='sequence';
  playNext:string[]=[];
  queueNext(song:Song):void{
    this.playNext=this.playNext.filter((id:string)=>id!==song.id);this.playNext.unshift(song.id);
    if(!this.order.length)this.order=this.songs.filter((s:Song)=>!s.hidden).map((s:Song)=>s.id);
    this.order=this.order.filter((id:string)=>id!==song.id);
    const current=this.songs[this.index]?.id??'';
    this.order.splice(this.order.indexOf(current)+1,0,song.id);this.changed();
  }
  saveSongs():void{
    const tmp=this.manifest+'.actions.tmp';
    const f=fs.openSync(tmp,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{fs.writeSync(f.fd,JSON.stringify(this.songs));}finally{fs.closeSync(f);}
    fs.renameSync(tmp,this.manifest);this.revision++;this.changed();
  }
  async hideSong(song:Song):Promise<void>{
    song.hidden=true;this.order=this.order.filter((id:string)=>id!==song.id);this.playNext=this.playNext.filter((id:string)=>id!==song.id);
    if(this.songs[this.index]?.id===song.id){await this.stop();this.index=Math.max(0,this.songs.findIndex((s:Song)=>!s.hidden));}this.saveSongs();
  }
  restoreSongs():void{for(const s of this.songs)s.hidden=false;this.saveSongs();}
  async removeSong(song:Song):Promise<void>{
    const current=this.songs[this.index]?.id;
    if(current===song.id)await this.stop();
    this.songs=this.songs.filter((s:Song)=>s.id!==song.id);this.order=this.order.filter((id:string)=>id!==song.id);this.playNext=this.playNext.filter((id:string)=>id!==song.id);
    this.index=Math.max(0,this.songs.findIndex((s:Song)=>s.id===current));this.saveSongs();
    // Sidecar covers can be shared by an album: only remove unreferenced copies.
    for(const name of [song.lyricsFile,song.coverFile])if(name&&!this.songs.some((s:Song)=>s.lyricsFile===name||s.coverFile===name)){
      try{await fs.unlink(this.context.filesDir+'/'+name);}catch(e){}
    }
  }
  step(offset:number):void{
    if(!this.songs.length)return;
    if(offset>0)while(this.playNext.length){const id=this.playNext.shift();const i=this.songs.findIndex((s:Song)=>s.id===id&&!s.hidden);if(i>=0){this.play(i);return;}}
    if(!this.order.length)this.order=this.songs.filter((s:Song)=>!s.hidden).map((s:Song)=>s.id);
    if(!this.order.length)return;
    if(this.shuffle){
      // Keep the selected queue's scope, matching the room player's random mode.
      const known=new Set(this.songs.map((s:Song)=>s.id));
      const ids=this.order.length?this.order:Array.from(known);
      const candidates=ids.filter((id:string)=>id!==this.songs[this.index]?.id&&known.has(id));
      if(candidates.length){
        const id=candidates[Math.floor(Math.random()*candidates.length)];
        this.play(this.songs.findIndex((s:Song)=>s.id===id));return;
      }
    }
    if(!this.order.length){this.play(this.index+offset);return;}
    const pos=this.order.indexOf(this.songs[this.index].id);
    const id=this.order[(pos+offset+this.order.length)%this.order.length];
    const idx=this.songs.findIndex((s:Song)=>s.id===id);
    if(idx>=0)this.play(idx);
  }
  player?:media.AVPlayer;
  generation:number=0;
  error:string='';
  private opened?:fs.File;
  private context:common.UIAbilityContext;
  private changed:()=>void;
  private manifest:string;
  private scanRoots:string[]=[];
  private rootWarning:string='';
  private shortCache:Record<string,string>={};
  private legacyFill?:Promise<void>;
  counts:Record<string,number>={};
  revision:number=0;
  scanTotal:number=0;
  scanDone:number=0;
  scanFound:number=0;
  scanRead:number=0;
  scanUnchanged:number=0;
  private static stamp(name:string,stat:fs.Stat):string{
    // Prefer nanoseconds and inode identity where exposed by the document provider.
    return Number.isFinite(stat.size)&&stat.size>=0&&Number.isFinite(stat.mtime)&&stat.mtime>0?
      '1|'+stat.size+'|'+(stat.mtimeNs?.toString()??String(stat.mtime))+'|'+(stat.ctimeNs?.toString()??String(stat.ctime??''))+'|'+(stat.ino?.toString()??'')+'|'+name:'';
  }
  private static needsFacts(song:Song):boolean{
    return song.bytes===undefined||song.metadataVersion!==1||song.factsVersion!==2||!song.sortMetadata;
  }
  private lastScanNotice:number=0;
  private reportScan():void{
    const now=Date.now();if(now-this.lastScanNotice>=100){this.lastScanNotice=now;this.changed();}
  }
  reloadCounts():void{this.counts=JSON.parse(core.room('{"type":"history"}')) as Record<string,number>;}
  private facts(song:Song,path:string,name:string):void{
    const facts=JSON.parse(core.room(JSON.stringify({type:'audioFacts',path:path,format:name.split('.').pop()?.toLowerCase()??''}))) as AudioTags;
    this.applyFacts(song,facts);
    this.applyTags(song,facts);
    if(facts.bytes!==undefined)song.metadataVersion=1;
  }
  private cleanTag(value?:string):string{
    const text=(value??'').replace(/\u0000/g,'').trim();return text.toLowerCase()==='<unknown>'?'':text;
  }
  private applyFacts(song:Song,facts:AudioFacts):void{
    if(facts.bytes!==undefined)song.bytes=facts.bytes;
    if(facts.quality!==undefined)song.quality=facts.quality;
    if(facts.factsVersion===2||facts.hasLyrics!==undefined)song.embeddedHasLyrics=facts.hasLyrics;
    song.hasLyrics=song.lyricsFile?true:song.embeddedHasLyrics;
    if(facts.factsVersion!==undefined)song.factsVersion=facts.factsVersion;
  }
  private applyTags(song:Song,tags:AudioTags):void{
    if(tags.year)song.year=tags.year;
    if(tags.trackNumber)song.trackNumber=tags.trackNumber;
    if(tags.discNumber)song.discNumber=tags.discNumber;
    const title=this.cleanTag(tags.title),artist=this.cleanTag(tags.artist)||(!this.cleanTag(song.artist)?this.cleanTag(tags.albumArtist):''),album=this.cleanTag(tags.album);
    if(title)song.title=title;if(artist)song.artist=artist;if(album)song.album=album;
  }
  private async readTags(song:Song,path:string):Promise<number>{
    const source=await fs.open(path,fs.OpenMode.READ_ONLY);let duration=0;
    try{
      // The common parser also works for formats the system extractor only partially exposes.
      const tags=JSON.parse(core.room(JSON.stringify({type:'audioFacts',path:'/proc/self/fd/'+source.fd,format:''}))) as AudioTags;
      this.applyFacts(song,tags);this.applyTags(song,tags);if(tags.bytes!==undefined)song.metadataVersion=1;
      try{
        const reader=await media.createAVMetadataExtractor();
        try{
          reader.fdSrc={fd:source.fd,offset:0,length:(await fs.stat(source.fd)).size};
          const system=await reader.fetchMetadata();duration=Number(system.duration)||0;
          if(duration>0)song.duration=duration/1000;
          this.applyTags(song,{year:system.dateTime?.match(/\d{4}/)?.[0],title:system.title,artist:system.artist,album:system.album,albumArtist:system.albumArtist});song.metadataVersion=1;
        }finally{await reader.release();}
      }catch(e){}
    }finally{await fs.close(source);}
    if(song.sourceUri){
      try{song.fileName=new fileUri.FileUri(song.sourceUri).name;}catch(e){}
      try{song.modifiedAt=(await fs.stat(song.sourceUri)).mtime*1000;}catch(e){}
    }
    song.sortMetadata=true;
    return duration;
  }
  constructor(context:common.UIAbilityContext,changed:()=>void){
    this.context=context;this.changed=changed;this.manifest=context.filesDir+'/music.json';
    try{this.shortCache=JSON.parse(fs.readTextSync(context.filesDir+'/scan-short-cache.json')) as Record<string,string>;}catch(e){}
    try{
      const roots=JSON.parse(fs.readTextSync(context.filesDir+'/scan-roots.json')) as string[];
      if(Array.isArray(roots))this.scanRoots=roots.filter((uri:string)=>typeof uri==='string'&&uri.startsWith('file://'));
    }catch(e){}
    this.counts=JSON.parse(core.room(JSON.stringify({type:'openHistory',path:context.filesDir+'/plays.json'}))) as Record<string,number>;
    if(fs.accessSync(this.manifest)){
      try{this.songs=(JSON.parse(fs.readTextSync(this.manifest)) as Song[]).filter((song:Song)=>
        !['demo','demo-moon','demo-forest'].includes(song.id));}catch(e){}
    }
    const previous=new Set<string>();
    for(const song of this.songs){
      song.artist=this.cleanTag(song.artist);song.album=this.cleanTag(song.album);
      if(song.sourceUri?.startsWith('file://docs/')&&song.folder){
        try{previous.add(LocalLibrary.folderKey(new fileUri.FileUri(song.sourceUri).getFullDirectoryUri()));}catch(e){}
      }
    }
    this.scanHistory=Array.from(previous);
  }
  async fillLegacyFacts():Promise<void>{
    if(!this.legacyFill)this.legacyFill=this.fillLegacyFactsNow();
    await this.legacyFill;
  }
  private async fillLegacyFactsNow():Promise<void>{
    let n=0;
    for(const song of this.songs){
      if(!LocalLibrary.needsFacts(song))continue;
      const path=this.context.filesDir+'/'+song.id;
      try{
        await this.readTags(song,path);
      }catch(e){continue;}
      if(++n%8===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    if(n)this.saveSongs();
  }
  async hostSongs():Promise<HostSong[]> {
    const items:HostSong[]=[];
    for(const s of this.songs){
      if(s.hidden)continue;
      const path=this.context.filesDir+'/'+s.id;
      items.push({id:s.id,title:s.title,path:path,hasSideCover:!!s.coverFile,hasSideLyrics:!!s.lyricsFile,quality:s.quality,bytes:s.bytes,hasLyrics:s.hasLyrics,artist:s.artist,album:s.album,folder:s.folder,fileName:s.fileName,year:s.year,duration:s.duration,trackNumber:s.trackNumber,discNumber:s.discNumber,modifiedAt:s.modifiedAt,addedAt:s.addedAt});
    }
    return items;
  }
  scanning:boolean=false;
  scanStatus:string='';
  paused:boolean=false;
  private gate?:Promise<void>;
  private resume?:()=>void;
  pauseImport(pause:boolean):void {
    if(!this.scanning||pause===this.paused)return;
    this.paused=pause;
    if(pause)this.gate=new Promise<void>(resolve=>{this.resume=resolve;});
    else {this.resume?.();this.gate=undefined;this.resume=undefined;}
    this.changed();
  }
  private async waitForImport():Promise<void>{while(this.gate)await this.gate;}
  async detailBytes(id:string,kind:string,offset:number,length:number):Promise<string>{
    const song=this.songs.find((s:Song)=>s.id===id);
    if((kind==='thumbnail'||kind==='artwork') && song)return this.listThumbnail(song,kind==='artwork'?640:128);
    const name=kind==='audio'?song?.id:kind==='lyrics'?song?.lyricsFile:kind==='cover'?song?.coverFile:undefined;
    if(!name||!/^[-a-f0-9]{36}(\.lrc|\.art)?$/i.test(name)||!Number.isSafeInteger(offset)||offset<0||
      !Number.isSafeInteger(length)||length<1||length>512*1024)return '';
    const file=await fs.open(this.context.filesDir+'/'+name,fs.OpenMode.READ_ONLY);
    try{
      const buffer=new ArrayBuffer(length);
      const n=await fs.read(file.fd,buffer,{offset:offset});
      return new util.Base64Helper().encodeToStringSync(new Uint8Array(buffer,0,n));
    }finally{await fs.close(file);}
  }
  private async listThumbnail(song:Song,maxSide:number):Promise<string>{
    const file=await fs.open(this.context.filesDir+'/'+song.id,fs.OpenMode.READ_ONLY);
    try{
      const reader=await media.createAVMetadataExtractor();
      try{
        reader.fdSrc={fd:file.fd};
        const cover=await reader.fetchAlbumCover();
        try{
          const info=await cover.getImageInfo();
          const scale=Math.min(1,maxSide/Math.max(info.size.width,info.size.height));
          if(scale<1)await cover.scale(scale,scale);
          const packer=image.createImagePacker();
          try{
            const bytes=await packer.packToData(cover,{format:'image/jpeg',quality:82});
            return new util.Base64Helper().encodeToStringSync(new Uint8Array(bytes));
          }finally{await packer.release();}
        }finally{await cover.release();}
      }finally{await reader.release();}
    }finally{await fs.close(file);}
  }
  scanHistory:string[]=[];
  historyRevision:number=0;
  static folderKey(uri:string):string{
    const parts=uri.split('/');
    for(let i=3;i<parts.length;i++){
      try{parts[i]=encodeURIComponent(decodeURIComponent(parts[i]));}catch(e){}
    }
    return parts.join('/').replace(/\/$/,'');
  }
  async chooseDirectory():Promise<string>{
    const opts=new picker.DocumentSelectOptions();
    opts.selectMode=picker.DocumentSelectMode.FOLDER;opts.maxSelectNumber=1;
    const folders=await new picker.DocumentViewPicker(this.context).select(opts);
    return folders[0]??'';
  }
  private async directoriesForScan(rescan:boolean):Promise<string[]>{
    this.rootWarning='';
    if(rescan&&this.scanRoots.length){
      const available:string[]=[];let unavailable=0;
      for(const uri of this.scanRoots){
        try{
          const policies:fileShare.PolicyInfo[]=[{uri:uri,operationMode:fileShare.OperationMode.READ_MODE}];
          if(!(await fileShare.checkPersistentPermission(policies))[0]){unavailable++;continue;}
          await fileShare.activatePermission(policies);available.push(uri);
        }catch(e){unavailable++;}
      }
      if(unavailable)this.rootWarning=unavailable+' 个目录授权已失效，请重新选择文件夹';
      if(!available.length)this.scanStatus=this.rootWarning||'请重新选择音乐文件夹。';
      return available.filter((uri:string)=>!available.some((parent:string)=>parent!==uri&&LocalLibrary.folderKey(uri).startsWith(LocalLibrary.folderKey(parent)+'/')));
    }
    if(rescan){this.scanStatus='请先选择音乐文件夹，之后可点击开始扫描复扫。';this.changed();}
    const uri=await this.chooseDirectory();
    if(!uri){this.scanStatus='已取消选择文件夹';return [];}
    try{
      await fileShare.persistPermission([{uri:uri,operationMode:fileShare.OperationMode.READ_MODE}]);
      const roots=Array.from(new Set(this.scanRoots.concat([uri])));
      const target=this.context.filesDir+'/scan-roots.json',tmp=target+'.tmp';
      const file=fs.openSync(tmp,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      try{fs.writeSync(file.fd,JSON.stringify(roots));}finally{fs.closeSync(file);}
      fs.renameSync(tmp,target);this.scanRoots=roots;
    }catch(e){this.rootWarning='本次目录授权未能保存，下次扫描需重新选择文件夹';}
    return [uri];
  }
  private async readFile(uri:string,folder:string,skipShort:boolean,existing?:Song):Promise<Song|undefined>{
    let name='本机音乐';
    try{name=new fileUri.FileUri(uri).name||name;}catch(e){}
    const id=existing?.id??util.generateRandomUUID(),target=this.context.filesDir+'/'+id;
    const path=existing?target+'.scan-'+util.generateRandomUUID():target;
    const song:Song={id:id,title:name.replace(/\.(mp3|flac|wav|wave|m4a|aac|ogg|opus|wma|aif|aiff|ape|alac)$/i,''),folder:folder,sourceUri:uri,
      addedAt:existing?existing.addedAt:Date.now(),fileName:name,playCount:existing?.playCount,hidden:existing?.hidden};
    const ms=await this.readTags(song,uri);
    if(ScanFilter.skipsAudio(skipShort,ms,song.album??''))return undefined;
    const copy=await fs.open(uri,fs.OpenMode.READ_ONLY);
    try{await fs.copyFile(copy.fd,path);this.facts(song,path,name);if(existing)fs.renameSync(path,target);}
    catch(e){if(fs.accessSync(path))fs.unlinkSync(path);throw new Error((e as Error).message);}
    finally{await fs.close(copy);}
    return song;
  }
  async pick(folderMode:boolean=false,skipShort:boolean=false,blocked:string[]=[],blockedFormats:string[]=[],rescan:boolean=false):Promise<void>{
    if(this.scanning)return;
    this.scanRead=0;this.scanUnchanged=0;
    this.scanTotal=0;this.scanDone=0;this.scanFound=0;this.scanning=true;this.scanStatus='';this.changed();
    await this.legacyFill?.catch(()=>{});
    let failed=0,shortFiles=0,excludedFolders=0,excludedFormats=0;
    const scanFilter=new ScanFilter(blockedFormats);
    const history=new Set<string>();
    const batch:Song[]=[];
    const candidates:ScanFile[]=[],sidecars=new Map<string,string>();
    const sideStamps=new Map<string,string>(),completeDirs=new Set<string>();
    const refresh=new Map<string,Song>(),byUri=new Map<string,Song>();
    const coverFiles=new Map<string,Promise<string>>();
    const created:string[]=[];
    for(const song of this.songs){
      if(song.sourceUri)byUri.set(song.sourceUri,song);
      if(song.coverUri&&song.coverFile&&song.coverStamp&&fs.accessSync(this.context.filesDir+'/'+song.coverFile))coverFiles.set(song.coverUri+'|'+song.coverStamp,Promise.resolve(song.coverFile));
    }
    const known=new Set<string>();
    const copySide=async(uri:string,suffix:string):Promise<string>=>{
      const name=util.generateRandomUUID()+suffix;
      try{
        const file=await fs.open(uri,fs.OpenMode.READ_ONLY);
        try{await fs.copyFile(file.fd,this.context.filesDir+'/'+name);}finally{await fs.close(file);}
        created.push(name);return name;
      }catch(e){try{fs.unlinkSync(this.context.filesDir+'/'+name);}catch(ignored){}return '';}
    };
    try{
      if(folderMode){
        const roots=await this.directoriesForScan(rescan);
        if(!roots.length)return;
        this.scanStatus='正在扫描文件夹…';this.changed();
        for(const selected of roots){
        const root=new fileUri.FileUri(selected);
        const pending:string[]=[selected];
        while(pending.length){
          await this.waitForImport();
          const dir=pending.pop() as string;
          const key=LocalLibrary.folderKey(dir);
          if(blocked.some((parent:string)=>key===parent||key.startsWith(parent+'/'))){excludedFolders++;continue;}
          let opened:fs.File|undefined=undefined;
          try{
            opened=fs.openSync(dir,fs.OpenMode.READ_ONLY);
            const directory=opened.path;
            const names=await fs.listFile(directory);
            let complete=true;
            history.add(key);
            for(let start=0;start<names.length;start+=16){
              await this.waitForImport();
              const group=names.slice(start,start+16);
              const stats=await Promise.all(group.map((name:string)=>fs.lstat(directory+'/'+name).catch(()=>undefined)));
              for(let i=0;i<group.length;i++){
              const name=group[i],stat=stats[i];
              if(!stat){failed++;complete=false;continue;}
              const uri=dir.replace(/\/$/,'')+'/'+encodeURIComponent(name);
              try{
                if(stat.isDirectory()){pending.push(uri);continue;}
                const key=dir+'/'+name.replace(/\.[^.]+$/,'').toLowerCase();
                if(stat.isFile()&&stat.size>0){
                  sideStamps.set(uri,LocalLibrary.stamp(name,stat));
                  if(/\.lrc$/i.test(name)&&stat.size<=512*1024)sidecars.set(key+'.lrc',uri);
                  if(/\.(jpg|jpeg|webp|png)$/i.test(name)&&stat.size<=16*1024*1024)sidecars.set(dir+'/'+name.toLowerCase(),uri);
                }
                if(stat.isFile()&&/\.(mp3|m4a|aac|flac|ogg|opus|wav|aif|aiff|wma|alac)$/i.test(name)){
                  if(scanFilter.blocksName(name)){excludedFormats++;continue;}
                  const folder=root.name+decodeURIComponent(dir.substring(selected.length));
                  candidates.push({uri:uri,folder:folder,stem:key,stamp:LocalLibrary.stamp(name,stat)});this.scanFound++;this.reportScan();
                }
              }catch(e){failed++;complete=false;}
              }
            }
            if(complete)completeDirs.add(dir);
          }catch(e){failed++;}finally{if(opened)fs.closeSync(opened);}
        }
        }
      }else{
        const opts=new picker.AudioSelectOptions();opts.maxSelectNumber=16;
        for(const uri of await new picker.AudioViewPicker(this.context).select(opts)){
          let folder='';
          try{folder=new fileUri.FileUri(new fileUri.FileUri(uri).getFullDirectoryUri()).name;}catch(e){}
          candidates.push({uri:uri,folder:folder,stem:''});
        }
      }
      this.scanTotal=candidates.length;this.changed();
      let cursor=0;
      const added=new Map<number,Song>();
      const worker=async():Promise<void>=>{
        while(cursor<candidates.length){
          await this.waitForImport();
          if(cursor>=candidates.length)break;
          const index=cursor++,item=candidates[index];
          try{
            if(known.has(item.uri))continue;
            known.add(item.uri);
            const prior=byUri.get(item.uri);
            let song=prior;
            const unchanged=!!(prior&&item.stamp&&item.stamp===prior.scanStamp&&!LocalLibrary.needsFacts(prior)&&fs.accessSync(this.context.filesDir+'/'+prior.id));
            if(!prior&&folderMode&&skipShort&&item.stamp&&this.shortCache[item.uri]===item.stamp){shortFiles++;this.scanUnchanged++;continue;}
            if(!unchanged){
              this.scanRead++;
              song=await this.readFile(item.uri,item.folder,!prior&&folderMode&&skipShort,prior);
              if(!song){shortFiles++;if(item.stamp)this.shortCache[item.uri]=item.stamp;continue;}
              this.shortCache[item.uri]='';song.scanStamp=item.stamp;
              if(prior){
                song.lyricsFile=prior.lyricsFile;song.lyricUri=prior.lyricUri;song.lyricStamp=prior.lyricStamp;
                song.coverFile=prior.coverFile;song.coverUri=prior.coverUri;song.coverStamp=prior.coverStamp;
                if(song.lyricsFile)song.hasLyrics=true;
                refresh.set(song.id,song);
              }else{added.set(index,song);batch.push(song);}
            }else this.scanUnchanged++;
            if(!song)continue;
            const update:Song={
              id:song.id,title:song.title,artist:song.artist,album:song.album,metadataVersion:song.metadataVersion,folder:song.folder,
              fileName:song.fileName,duration:song.duration,year:song.year,trackNumber:song.trackNumber,discNumber:song.discNumber,modifiedAt:song.modifiedAt,addedAt:song.addedAt,sortMetadata:song.sortMetadata,
              sourceUri:song.sourceUri,lyricsFile:song.lyricsFile,coverFile:song.coverFile,coverUri:song.coverUri,
              bytes:song.bytes,quality:song.quality,hasLyrics:song.hasLyrics,factsVersion:song.factsVersion,playCount:song.playCount,hidden:song.hidden,
              scanStamp:song.scanStamp,lyricUri:song.lyricUri,lyricStamp:song.lyricStamp,coverStamp:song.coverStamp,embeddedHasLyrics:song.embeddedHasLyrics
            };
            if(!folderMode)continue;
            const dir=item.stem.substring(0,item.stem.lastIndexOf('/')+1);
            const complete=completeDirs.has(dir.substring(0,dir.length-1));
            const lyric=sidecars.get(item.stem+'.lrc');
            const lyricStamp=lyric?sideStamps.get(lyric):undefined;
            if(lyric&&(!lyricStamp||lyricStamp!==song.lyricStamp||lyric!==song.lyricUri||!song.lyricsFile||!fs.accessSync(this.context.filesDir+'/'+song.lyricsFile))){
              const name=await copySide(lyric,'.lrc');
              if(name){update.hasLyrics=true;update.lyricsFile=name;update.lyricUri=lyric;update.lyricStamp=lyricStamp;refresh.set(song.id,update);}else failed++;
            }else if(!lyric&&complete&&song.lyricsFile){
              if(update.embeddedHasLyrics===undefined){this.scanRead++;await this.readTags(update,this.context.filesDir+'/'+song.id);}
              update.lyricsFile=undefined;update.lyricUri=undefined;update.lyricStamp=undefined;update.hasLyrics=update.embeddedHasLyrics;
              refresh.set(song.id,update);
            }
            let art:string|undefined=undefined;
            for(const base of [item.stem,dir+'cover',dir+'folder',dir+'front']){
              for(const ext of ['.jpg','.jpeg','.png','.webp']){
                art=sidecars.get(base+ext);if(art)break;
              }
              if(art)break;
            }
            const artStamp=art?sideStamps.get(art):undefined;
            if(art&&(!artStamp||artStamp!==song.coverStamp||art!==song.coverUri||!song.coverFile||!fs.accessSync(this.context.filesDir+'/'+song.coverFile))){
              const cacheKey=art+'|'+(artStamp??'');
              let copying=coverFiles.get(cacheKey);
              if(!copying){copying=copySide(art,'.art');coverFiles.set(cacheKey,copying);}
              const name=await copying;
              if(name){update.coverUri=art;update.coverFile=name;update.coverStamp=artStamp;refresh.set(song.id,update);}else failed++;
            }else if(!art&&complete&&song.coverFile){
              update.coverUri=undefined;update.coverFile=undefined;update.coverStamp=undefined;refresh.set(song.id,update);
            }
          }catch(e){failed++;}finally{this.scanDone++;this.reportScan();}
        }
      };
      await Promise.all([worker(),worker()]);
      if(batch.length||refresh.size){
        const ordered:Song[]=[];
        for(let i=0;i<candidates.length;i++){const song=added.get(i);if(song)ordered.push(song);}
        const updated=this.songs.concat(ordered).map((song:Song):Song=>refresh.get(song.id)??song);
        const tmp=this.manifest+'.tmp';
        const file=fs.openSync(tmp,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
        try{fs.writeSync(file.fd,JSON.stringify(updated));}finally{fs.closeSync(file);}
        fs.renameSync(tmp,this.manifest);
        for(const song of this.songs){
          const next=refresh.get(song.id);
          if(next&&song.lyricsFile&&next.lyricsFile!==song.lyricsFile){try{fs.unlinkSync(this.context.filesDir+'/'+song.lyricsFile);}catch(e){}}
          if(next&&song.coverFile&&!updated.some((s:Song)=>s.coverFile===song.coverFile)){try{fs.unlinkSync(this.context.filesDir+'/'+song.coverFile);}catch(e){}}
        }
        this.songs=updated;this.revision++;
      }
      try{
        const cachePath=this.context.filesDir+'/scan-short-cache.json',cacheTemp=cachePath+'.tmp';
        const file=fs.openSync(cacheTemp,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
        try{fs.writeSync(file.fd,JSON.stringify(this.shortCache));}finally{fs.closeSync(file);}
        fs.renameSync(cacheTemp,cachePath);
      }catch(e){}
      this.scanStatus='完成，新增 '+batch.length+' 首'+(shortFiles?'，跳过短音频 '+shortFiles+' 首':'')+(excludedFormats?'，跳过屏蔽格式 '+excludedFormats+' 首':'')+(excludedFolders?'，跳过屏蔽目录 '+excludedFolders+' 个':'')+(failed?'，无法读取 '+failed+' 项':'');
      if(folderMode)this.scanStatus+='；枚举 '+this.scanFound+' 首，读取 '+this.scanRead+' 首，未变化 '+this.scanUnchanged+' 首';
      if(folderMode&&this.rootWarning)this.scanStatus+='；'+this.rootWarning;
    }catch(e){
      for(const name of created){try{fs.unlinkSync(this.context.filesDir+'/'+name);}catch(ignored){}}
      for(const song of batch){try{fs.unlinkSync(this.context.filesDir+'/'+song.id);}catch(ignored){}}
      throw new Error((e as Error).message);
    }finally{
      if(history.size){this.scanHistory=Array.from(history);this.historyRevision++;}
      this.pauseImport(false);this.scanning=false;this.changed();
    }
  }
  private playSession:string='';
  private statisticsSeeking:boolean=false;
  samplePlayback():void {if(this.player&&!this.statisticsSeeking)this.playbackEvent('sample');}
  private playbackEvent(event:string,value:number=0):void {
    this.counts=JSON.parse(core.room(JSON.stringify({type:'playbackEvent',session:this.playSession,event:event,
      id:this.songs[this.index]?.id??'',title:this.songs[this.index]?.title??'',metadata:this.songs[this.index],trackDuration:Math.max(0,this.player?.duration??0)/1000,cursor:event==='complete'?value:Math.max(0,this.player?.currentTime??0)/1000,duration:value,position:value}))) as Record<string,number>;
  }
  async stop():Promise<void>{
    this.playbackEvent('stop');
    this.generation++;
    const old=this.player,fd=this.opened;this.player=undefined;this.opened=undefined;
    if(old)await old.release().catch(()=>{});
    if(fd)fs.closeSync(fd);
  }
  async play(index:number):Promise<void>{
    if(!this.songs.length)return;
    if(this.songs[(index+this.songs.length)%this.songs.length].hidden){this.step(1);return;}
    const stopped=this.stop(),gen=this.generation;await stopped;if(gen!==this.generation)return;
    this.index=(index+this.songs.length)%this.songs.length;this.error='';
    try{
      const p=await media.createAVPlayer();if(gen!==this.generation){await p.release();return;}this.player=p;
      p.on('error',()=>{if(this.player===p){this.error='这首音乐无法播放';this.stop();this.changed();}});
      this.playSession=util.generateRandomUUID();this.playbackEvent('begin');
      this.statisticsSeeking=false;p.on('seekDone',()=>{if(this.player===p){this.statisticsSeeking=false;this.playbackEvent('seeked');}});
      p.on('stateChange',async state=>{
        if(this.player!==p)return;
        try{
          if(state==='initialized')await p.prepare();
          else if(state==='prepared')await p.play();
          else if(state==='playing')this.playbackEvent('play');
          else if(state==='paused')this.playbackEvent('pause');
          else if(state==='completed'){this.playbackEvent('complete',p.duration/1000);if(this.playMode==='repeatOne')this.play(this.index);else this.step(1);return;}
        }catch(e){if(this.player===p)this.error='播放失败';}
        this.changed();
      });
      this.opened=fs.openSync(this.context.filesDir+'/'+this.songs[this.index].id);p.fdSrc={fd:this.opened.fd};
    }catch(e){this.error='文件无法读取';await this.stop();}
    this.changed();
  }
  async toggle():Promise<void>{const p=this.player;if(!p)await this.play(this.index);else if(p.state==='playing')await p.pause();else if(p.state==='paused'||p.state==='prepared')await p.play();this.changed();}
  seek(seconds:number){if(this.player && (this.player.state==='playing'||this.player.state==='paused')){this.playbackEvent('seek',seconds);this.statisticsSeeking=true;this.player.seek(Math.round(seconds*1000),media.SeekMode.SEEK_CLOSEST);}}
}

