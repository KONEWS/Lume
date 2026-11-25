const $ = id => document.getElementById(id);
const icons = {
  cloud:'<path d="M7 18a5 5 0 1 1 .4-10A6 6 0 0 1 19 10a4 4 0 1 1 0 8Z"/>',
  person:'<circle cx="12" cy="8" r="3.5"/><path d="M4 21v-2c0-7 16-7 16 0v2Z"/>',
  sort:'<path d="M4 6h15M4 12h10M4 18h5m10-8v11m-3-3 3 3 3-3"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  menu:'<path d="M3 5h18M3 12h18M3 19h18"/>',
  shuffle:'<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 5-5m3-5c1-1 2-2 4-2h3m-4-4 4 4-4 4"/>',
  repeatOne:'<path d="M5 7h13l-3-3m3 3-3 3M19 17H6l3 3m-3-3 3-3"/><path d="M11 10l2-1v6"/>',
  sequence:'<path d="M4 5h12M4 11h12M4 17h7m7-6v10m-3-3 3 3 3-3"/>',
  disc:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  library:'<path d="M3 4v16m5-16v16m5-16v16m3-15 5 14"/>',
  radio:'<circle cx="12" cy="12" r="1.8"/><path d="M8.1 7.8a5.8 5.8 0 0 0 0 8.4M15.9 7.8a5.8 5.8 0 0 1 0 8.4M5.2 4.7a10 10 0 0 0 0 14.6M18.8 4.7a10 10 0 0 1 0 14.6"/>',
  previous:'<path d="M5 5v14m14-14L8 12l11 7z" fill="currentColor"/>',
  next:'<path d="M19 5v14M5 5l11 7-11 7z" fill="currentColor"/>',
  play:'<path d="m7 4 13 8-13 8z" fill="currentColor"/>',
  pause:'<path d="M8 5v14m8-14v14" stroke-width="4"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',down:'<path d="m5 9 7 7 7-7"/>',expand:'<path d="M7 17 17 7M7 7h10v10"/>',
  search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',heart:'<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 0 9 8 15 8-6 12-11 8-15z"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
  levels:'<path d="M4 10v4m5-8v12m5-15v18m5-13v8"/>'
};
function glyph(name) { return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(icons[name]||menuIcons[name])+'</svg>'; }
document.querySelectorAll('[data-icon]').forEach(node=>node.innerHTML=glyph(node.dataset.icon));
const state={songs:[],hosts:[],id:'',title:'',duration:0,pos:0,playing:false,shuffle:false,shuffleAvailable:true,joined:false,hosting:false,creating:false,hostError:'',host:'',status:'',channel:'',skin:null};
// Native positions are presentation-time samples. Advance between samples without
// changing state.pos: metadata-only patches must not reset or replay an old sample.
let playbackAnchor=0,playbackAt=performance.now(),playbackFrame=0;
function playbackPosition(){
  const position=playbackAnchor+(state.playing?(performance.now()-playbackAt)/1000:0);
  return Math.max(0,Math.min(state.duration||Infinity,position));
}
function refreshPlaybackFrame(){
  playbackFrame=0;
  if(document.hidden||!state.playing)return;
  window.lumeCover.paintRotation();
  renderProgress();followLyrics();
  playbackFrame=requestAnimationFrame(refreshPlaybackFrame);
}
function schedulePlaybackFrame(){
  if(playbackFrame)cancelAnimationFrame(playbackFrame);
  playbackFrame=0;
  if(state.playing&&!document.hidden)playbackFrame=requestAnimationFrame(refreshPlaybackFrame);
}
document.addEventListener('visibilitychange',()=>{
  schedulePlaybackFrame();
  if(!document.hidden){renderProgress();syncLyricView();followLyrics();}
});
let tab='home', expanded=false, onlyLiked=false, dragging=false, scrollPositions={}, liked=new Set();
let homeDirty=true;
function refreshHome(){
  homeDirty=tab!=='home';
  if(!homeDirty)window.lumeHome.render();
}
try { liked=new Set(JSON.parse(localStorage.getItem('lume-favorites')||'[]')); } catch {}
const command=(type,props={})=>window.LumeNative?.dispatch(JSON.stringify({type,...props}));
const active=()=>state.songs.find(s=>s.id===state.id);
const artist=s=>s?.artist||'';
function songInfo(node,song,showQuality=false){
  const text=[artist(song),song?.album].filter(Boolean).join(' · ');
  const label=showQuality && songQualityLabel(song);
  node.replaceChildren();
  if(text){const label=document.createElement('span');label.className='song-credit';label.textContent=text;node.append(label);}
  if(label){
    const badge=element('span',label,'song-quality');
    badge.title=label;node.append(badge);
  }
  node.classList.add('song-info');
}
const favKey=id=>JSON.stringify([state.joined?state.host:'local',id]);
function artwork(id='') {
  let hue=0;for(const c of id)hue=(hue*31+c.charCodeAt(0))%360;
  return 'radial-gradient(ellipse at 43% 38%, transparent 19%,hsla('+hue+',42%,86%,.7) 21%,transparent 25%),repeating-radial-gradient(ellipse at 45% 38%,transparent 0 12%,#ffffff30 13%,transparent 14%),linear-gradient(130deg,hsl('+hue+',32%,28%),hsl('+((hue+60)%360)+',36%,58%),#213931)';
}
const detailsCache=new Map(), pendingDetails=new Map();
const decodedCovers=new Map();

function detailKey(song){
  return JSON.stringify([state.joined?state.host:'local',state.joined?libraryCovers.session():0,song?.coverRevision,state.joined&&state.localTrackId===song?.id?localDetailKey(state.localSong):'',localDetailKey(song)]);
}
function localDetailKey(song){
  return JSON.stringify([song?.id,song?.thumbSource,song?.sourceUri,song?.path,song?.bytes,song?.scanStamp,song?.modifiedAt,song?.coverStamp,song?.coverFile,song?.hasSideCover,song?.lyricStamp,song?.lyricsFile,song?.hasSideLyrics]);
}
function decodeCover(cover){
  if(!decodedCovers.has(cover)){
    const image=new Image();image.src=cover;
    decodedCovers.set(cover,image.decode().then(()=>image,()=>null));
    if(decodedCovers.size>8)decodedCovers.delete(decodedCovers.keys().next().value);
  }
  return decodedCovers.get(cover);
}
let reading=0,showLyrics=false,lyricText='',timedLines=[],currentLine=-1;
const landscape=matchMedia('(orientation: landscape)');
let playerSessionActive=false, playerSessionLyrics=false;
function syncPlayerSession(){
  // A visible drag preview is not yet a committed player session. Changing bars
  // here resizes the native WebView and cancels that same drag. Keep the previous
  // window state until settling finishes, including a cancelled opening/closing.
  if(playerMotion)return;
  const enabled=expanded;
  const lyrics=enabled && showLyrics;
  if(playerSessionActive===enabled && playerSessionLyrics===lyrics)return;
  playerSessionActive=enabled;
  playerSessionLyrics=lyrics;
  command('playerSession',{enabled,lyrics});
}
const styleSelect=$('lyric-style');
window.LumeFolia.populate(styleSelect);
styleSelect.value=window.LumeFolia.preference();
let moreLyrics=false;
let stage=null, stageTrack=null, stageFailed=false, stopControlTimer=null;
const translationToggle=$('translation-choice');
const pageHeader=$('full').querySelector('.full-head');
const queueButton=pageHeader.querySelector('[data-action="player-queue"]');
const trackHeader=$('full').querySelector('.full-meta');
const lyricTools=translationToggle.parentElement;
const styleOptions=$('style-settings').parentElement;
function positionLandscapeControls(){
  const split=landscape.matches && !moreLyrics;
  $('full').classList.toggle('split-player',split);
  $('landscape-lyrics').hidden=!split;
  $('album').setAttribute('role',split?'img':'button');
  $('album').tabIndex=split?-1:0;
  (split ? trackHeader : pageHeader).append(queueButton);
  if(!landscape.matches){pageHeader.insertBefore(styleOptions,queueButton);lyricTools.append(translationToggle);}
  else if(moreLyrics){
    pageHeader.insertBefore(styleOptions,queueButton);
    styleOptions.append(translationToggle);
  }else{
    lyricTools.prepend(styleOptions);
    lyricTools.append(translationToggle);
  }
}
function showMoreMode(more){
  if(moreLyrics===more)return;
  moreLyrics=more;
  positionLandscapeControls();
}
positionLandscapeControls();
let translated;
translated=window.LumeFolia.translationVisible();
function updateTranslation(){
  translationToggle.setAttribute('aria-pressed',String(translated));
  window.LumeFolia.saveTranslation(translated);
  $('full').classList.toggle('with-translation',translated);
  currentLine=-1;syncLyricView();followLyrics();
};
translationToggle.onclick=()=>{translated=!translated;updateTranslation();};
translationToggle.setAttribute('aria-pressed',String(translated));
$('full').classList.toggle('with-translation',translated);
function syncLyricView(){
  const eligible=!$('full').hidden && showLyrics;
  const immersive=eligible && landscape.matches && moreLyrics && styleSelect.value!=='plain' && timedLines.length>0 && !stageFailed;
  $('style-picker').hidden=!eligible || !moreLyrics;
  $('more-lyrics').hidden=!eligible || !landscape.matches || moreLyrics;
  $('style-settings').hidden=!eligible;
  if(!eligible)window.LumeFolia.closeSettings();
  const lyricsPage=!$('full').hidden && showLyrics;
  $('full').classList.toggle('lyrics-screen',lyricsPage);
  const autoHide=lyricsPage && landscape.matches && moreLyrics;
  if(autoHide && !stopControlTimer)stopControlTimer=window.LumeFolia.autoHide($('full'));
  if(!autoHide && stopControlTimer){stopControlTimer();stopControlTimer=null;}
  $('album').hidden=showLyrics && (!landscape.matches || moreLyrics);
  $('album').setAttribute('aria-label',landscape.matches?'专辑封面':'查看歌词');
  $('landscape-lyrics').setAttribute('aria-pressed',String(showLyrics));
  $('landscape-lyrics').setAttribute('aria-label',showLyrics?'显示播放控件':'显示普通歌词');
  $('lyrics-panel').hidden=!showLyrics || immersive;
  $('folia-stage').hidden=!immersive;
  $('translation-choice').hidden=!showLyrics || !timedLines.some(line=>line.translation);
  const cover=$('album').detailSong?.id===state.id ? $('album').detailCover || '' : '';
  if(!stageTrack || stageTrack.cover!==cover || stageTrack.id!==state.id || stageTrack.rows!==timedLines || stageTrack.duration!==state.duration || stageTrack.title!==state.title || stageTrack.translated!==translated)
    stageTrack={id:state.id,cover,title:state.title,artist:artist(active()),duration:state.duration,rows:timedLines,translated:translated};
  window.LumeFolia.updateSettings(stageTrack,styleSelect.value,playbackPosition(),state.playing);
  if(!immersive){
    if(stage){stage.close();stage=null;currentLine=-1;followLyrics();}
    return;
  }
  if(!stage)stage=window.LumeFolia.mount($('folia-stage'),()=>{
    stageFailed=true;showMoreMode(false);syncLyricView();
    $('notice').textContent='此样式未能显示，已恢复普通歌词。';$('notice').hidden=false;
    clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,3200);
  });
  stage.update(stageTrack,styleSelect.value,playbackPosition(),state.playing);
}
function syncLyricPlayback(){
  const position=playbackPosition();
  window.LumeFolia.updateSettings(stageTrack,styleSelect.value,position,state.playing);
  stage?.update(stageTrack,styleSelect.value,position,state.playing);
}
const plainSettings=$('plain-lyric-settings'),fontScale=$('plain-font-scale'),centerPlain=$('plain-center');
const plainPreference=readPreference('lume-plain-lyrics',{});
window.lumePlain.init(plainPreference,()=>{
  savePreference('lume-plain-lyrics',window.lumePlain.preference());
  if(lyricText){const text=lyricText;lyricText='';renderLyrics(text);}
  syncLyricView();currentLine=-1;followLyrics();
});
plainSettings.addEventListener('close',()=>{$('full').dispatchEvent(new Event('show-player-controls'));syncBack();});
$('style-settings').onclick=()=>{
  if(!moreLyrics || styleSelect.value==='plain'){plainSettings.showModal();syncBack();return;}
  window.LumeFolia.openSettings(styleSelect.value,choice=>{
    if(stage){stage.close();stage=null;}
    styleSelect.value=choice;stageFailed=false;
    translated=window.LumeFolia.translationVisible();
    updateTranslation();
  },{mobileLayout:true});
  syncLyricView();
};
styleSelect.onchange=()=>{stageFailed=false;window.LumeFolia.save(styleSelect.value);if(styleSelect.value==='plain'){setLyrics(true);return;}syncLyricView();followLyrics();};
let playerLandscape=landscape.matches;
function syncPlayerOrientation(){
  syncPlayerSession();
  if(playerLandscape===landscape.matches)return;
  playerLandscape=landscape.matches;
  lyricMotion?.skipTransition();
  if(plainSettings.open)dismissSettingsSheet(plainSettings);showMoreMode(false);positionLandscapeControls();
  // Rotating preserves the current player/lyrics level.
  syncLyricView();currentLine=-1;followLyrics();
}
landscape.addEventListener('change',syncPlayerOrientation);
// Some WebViews defer the media-query event while a View Transition is captured.
window.addEventListener('resize',syncPlayerOrientation);
function renderLyrics(text){
  if(!text)window.lumePlain.source('none',false);
  if(lyricText===text)return;
  const parsed=window.lumePlain.parse(text,window.lumeSongDetails.parseSongLyrics);
  lyricText=text;timedLines=parsed.rows;currentLine=-1;
  $('translation-choice').hidden=!timedLines.some(line=>line.translation);
  const panel=$('lyrics-panel');
  panel.textContent=timedLines.length?'':parsed.plain||'暂无歌词';
  for(const line of timedLines){
    const p=window.lumePlain.row(line);
    if(line.translation){
      const sub=document.createElement('small');sub.className='lyric-translation';sub.textContent=line.translation;p.append(sub);
    }
    panel.append(p);
  }
  syncLyricView();followLyrics();
}
function followLyrics(){
  if(!expanded||!showLyrics||!timedLines.length||stage)return;
  const position=playbackPosition();
  let start=0,end=timedLines.length;
  while(start<end){
    const mid=Math.floor((start+end)/2);
    if(timedLines[mid].time<=position)start=mid+1;else end=mid;
  }
  const i=start-1;
  const panel=$('lyrics-panel');
  if(i!==currentLine){
    const continuous=currentLine>=0&&i===currentLine+1;
    window.lumePlain.follow(panel,i,continuous&&state.playing&&!quietMotion.matches);
    panel.children[currentLine]?.removeAttribute('aria-current');currentLine=i;
    panel.children[i]?.setAttribute('aria-current','true');
  }
  window.lumePlain.progress(panel,timedLines,position,state.duration,state.playing);
}
function pumpDetails(){
  for(const [id,entry] of pendingDetails){
    if(reading>=2)break;
    if(entry.started)continue;
    if(![...entry.nodes].some(node=>node.isConnected&&node.detailKey===id)){pendingDetails.delete(id);continue;}
    entry.started=true;reading++;
    libraryCovers.details(localDetailKey(entry.song),()=>window.lumeSongDetails.load(entry.song),state.joined&&state.hosting).catch(()=>({lyrics:'',cover:''})).then(data=>{
      if(pendingDetails.get(id)!==entry)return;
      if(entry.local)data={...data,localDetails:true};
      detailsCache.set(id,data);
      if(detailsCache.size>64)detailsCache.delete(detailsCache.keys().next().value);
      for(const node of entry.nodes)if(node.isConnected&&node.detailKey===id)paintDetails(node,data);
      pendingDetails.delete(id);
    }).finally(()=>{reading--;pumpDetails();});
  }
}
function showArtwork(node,background,image){
  // The generic placeholder has concentric green rings. Keep the mini cover
  // neutral so its new progress curve is the only line around the artwork.
  if(node.id==='mini-art' && background.startsWith('radial-gradient('))
    background='linear-gradient(145deg,var(--studio-control),var(--studio-surface))';
  if(node.renderedBackground!==background){node.style.backgroundImage=background;node.renderedBackground=background;}
  node.artReady=true;
  if(node.id==='album' && node.detailSong?.id===state.id)
    window.lumeCoverTheme.show(image,node.detailKey);
  node.onArtReady?.();
}
// One small synchronous preview bridges the first frame while IndexedDB opens.
const previewSlot='lume-now-playing-cover';
let startupArt;
try{startupArt=JSON.parse(localStorage.getItem(previewSlot));}catch{}
function retainPreview(key,cover,image){
  const signature=coverSignature(cover);
  if(startupArt?.key===key && startupArt?.signature===signature)return;
  try{
    const canvas=document.createElement('canvas'),scale=Math.min(1,144/Math.max(image.width,image.height));
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    startupArt={key,signature,url:canvas.toDataURL('image/jpeg',.8)};
    localStorage.setItem(previewSlot,JSON.stringify(startupArt));
  }catch{}
}
function coverSignature(cover){
  let hash=2166136261;
  for(let i=0;i<cover.length;i++)hash=Math.imul(hash^cover.charCodeAt(i),16777619);
  return cover.length+':'+(hash>>>0);
}
function paintDetails(node,data){
  let remoteLyrics=state.joined&&!state.hosting;
  if(data.localDetails){
    const remote=state.roomDetails?.id===node.detailSong?.id?state.roomDetails:{};
    remoteLyrics=!data.lyrics;
    const hostCover=remote.cover&&!remote.cover.startsWith('data:image/svg')?remote.cover:'';
    data={...data,cover:hostCover||data.cover||remote.cover||'',lyrics:data.lyrics||remote.lyrics||'',lyricsSource:data.lyrics?data.lyricsSource:remote.lyricsSource};
  }
  const candidate=data.cover||node.roomPreview||'';
  const cover=/^data:image\/(?:png|jpeg|webp|gif|bmp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(candidate)?candidate:'';
  const key=node.detailKey;
  if(node.requestedCover!==cover){
    node.requestedCover=cover;
    const request=node.coverRequest={};
    const commit=image=>{
      // Both the native read and image decode may finish after another next tap,
      // a rescan, or a switch to a room that reuses the same song ID.
      if(!node.isConnected||node.detailKey!==key||node.coverRequest!==request)return;
      showArtwork(node,image?'url("'+cover+'")':artwork(node.detailSong?.id||''),image);
      if(node.id==='album' && node.detailSong?.id===state.id){
        node.detailCover=image?cover:'';
        if(image)retainPreview(key,cover,image);
        else if(startupArt?.key===key){startupArt=null;try{localStorage.removeItem(previewSlot);}catch{}}
        syncLyricView();
      }
    };
    if(cover)decodeCover(cover).then(commit);else commit(null);
  }
  if(node.id==='album' && node.detailSong?.id===state.id){
    window.lumePlain.source(data.lyricsSource || (data.lyrics?'unknown':'none'),remoteLyrics);
    if(lyricText===data.lyrics)syncLyricView();
    else renderLyrics(data.lyrics);
    if(state.hosting && state.joined && node.detailSong?.id===state.id)command('trackDetails',{id:state.id,coverRevision:node.detailSong.coverRevision,cover:data.cover||'',lyrics:data.lyrics||'',lyricsSource:data.lyricsSource||'unknown',audioInfo:data.audioInfo});
  }
}
function requestDetails(node,song=node.detailSong){
  if(!song)return;
  const key=node.detailKey;
  if(detailsCache.has(key)){paintDetails(node,detailsCache.get(key));return;}
  let entry=pendingDetails.get(key);
  if(!entry){entry={song,local:state.joined&&!state.hosting&&song!==node.detailSong,nodes:new Set(),started:false};pendingDetails.set(key,entry);}
  entry.nodes.add(node);queueMicrotask(pumpDetails);
}
function requestRoomPreview(node,song){
  const key=node.detailKey;
  if(!song?.coverRevision||node.roomPreviewKey===key)return;
  node.roomPreviewKey=key;
  libraryCovers.roomThumb(song).then(cover=>{
    if(!cover||!node.isConnected||node.detailKey!==key)return;
    node.roomPreview=cover;
    if(!node.requestedCover)paintDetails(node,detailsCache.get(key)||(state.roomDetails?.id===song.id?state.roomDetails:{lyrics:''}));
  }).catch(()=>setTimeout(()=>{
    if(node.isConnected&&node.detailKey===key&&!node.requestedCover){node.roomPreviewKey=null;requestRoomPreview(node,song);}
  },750));
}
function bindArt(node,song){
  if(!catalogReceived&&!song)return;
  const key=detailKey(song),changed=node.detailKey!==key;
  if(changed && song && startupArt?.key===key && /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(startupArt.url)){
    const preview='url("'+startupArt.url+'")';
    if(!node.renderedBackground){node.style.backgroundImage=preview;node.renderedBackground=preview;}
  }
  const otherTrack=node.detailSong?.id!==song?.id || node.roomSource!==(state.joined?state.host:'');
  node.roomSource=state.joined?state.host:'';
  node.detailSong=song;
  if(changed){
    node.detailKey=key;node.coverRequest=null;node.requestedCover=undefined;node.artReady=false;node.roomPreview='';
    if(node.id==='album')node.detailCover='';
    if(state.joined&&otherTrack)showArtwork(node,artwork(song?.id||''));
  }
  // Keep the last rendered image while the next song's artwork is read and
  // decoded. Only a resolved empty/invalid cover should become a placeholder.
  if(!song){showArtwork(node,artwork(''));return;}
  if(state.joined&&!state.hosting){
    if(song?.coverRevision&&!state.roomDetails?.cover)requestRoomPreview(node,song);
    if(state.localTrackId===song?.id&&state.localSong){requestDetails(node,state.localSong);return;}
    if(song&&state.roomDetails?.id===song.id)paintDetails(node,state.roomDetails);
    else if(node.onArtReady && !node.artReady && node.requestedCover===undefined)showArtwork(node,artwork(song?.id||''));
    return;
  }
  requestDetails(node,libraryCovers.hosted(song));
}
function setLyrics(show,more=false){
  if(!expanded || (show===showLyrics && more===moreLyrics))return;
  function update(){
    if(!expanded)return;
    syncPlayerOrientation();
    showLyrics=show;showMoreMode(more && landscape.matches);
    syncPlayerSession();
    if(more && styleSelect.value==='plain')styleSelect.value='classic';
    syncLyricView();currentLine=-1;followLyrics();
  }
  if(more!==moreLyrics)changeMoreLyrics(more,update);
  else changeLyricPage(show,update);
}
$('more-lyrics').onclick=()=>setLyrics(true,true);
function swipeLyricPage(dx){
  if(dx<0){if(!showLyrics)setLyrics(true);else if(landscape.matches&&!moreLyrics)setLyrics(true,true);}
  else if(moreLyrics)setLyrics(true);
  else if(showLyrics)setLyrics(false);
  else player(false);
}
function backFromPlayer(){
  if(moreLyrics)setLyrics(true);
  else if(showLyrics)setLyrics(false);
  else player(false);
}
$('landscape-lyrics').onclick=()=>setLyrics(!showLyrics);
$('album').onclick=()=>{if(!landscape.matches)setLyrics(true);};
$('album').onkeydown=e=>{if(!landscape.matches && (e.key==='Enter'||e.key===' ')){e.preventDefault();setLyrics(true);}};
const releasePlayerGesture=bindPlayerSwipes();
let plainViewportHeight=0;
new ResizeObserver(()=>{
  const panel=$('lyrics-panel'),height=panel.clientHeight;
  if(height===plainViewportHeight)return;
  plainViewportHeight=height;panel.style.setProperty('--plain-view-height',height+'px');
  if(!playerMotion){currentLine=-1;followLyrics();}
}).observe($('lyrics-panel'));

$('scan-stop').onclick=()=>command('stopScan');
// Only current-playback titles opt into scrolling; list rows use plain text.
const titleSizes = new ResizeObserver(entries=>{
  for(const entry of entries){
    const title=entry.target.closest('lume-song-title');
    if(title?.isConnected)title.measure();
  }
});
const visibleTitles = new IntersectionObserver(entries=>{
  for(const {target:title,isIntersecting} of entries){
    if(isIntersecting && title.isConnected){
      titleSizes.observe(title);
      titleSizes.observe(title.firstElementChild);
    }else{
      title.stop();
    }
  }
});
customElements.define('lume-song-title',class extends HTMLElement {
  connectedCallback(){
    if(!this.firstElementChild)this.append(document.createElement('span'));
    if(this.hasAttribute('data-title'))visibleTitles.observe(this);
  }
  disconnectedCallback(){
    visibleTitles.unobserve(this);
    this.stop();
  }
  set songName(value){
    if(!this.firstElementChild)this.append(document.createElement('span'));
    if(this.firstElementChild.textContent!==value){
      this.firstElementChild.textContent=value;
      if(this.repeatTitle)this.repeatTitle.textContent=value;
      if(this.hasAttribute('data-scrolling')){
        for(const animation of this.getAnimations({subtree:true}))animation.currentTime=0;
      }
    }
  }
  measure(){
    if(!this.hasAttribute('data-title')){this.stop();return;}
    const width=this.firstElementChild.offsetWidth;
    const scroll=this.clientWidth>0 && width>this.clientWidth+1;
    this.toggleAttribute('data-scrolling',scroll);
    if(!scroll){this.clearRepeat();return;}
    const cycle=width+32;
    this.style.setProperty('--title-cycle',cycle+'px');
    this.style.setProperty('--title-duration',cycle/30+'s');
    if(!this.repeatTitle){
      this.repeatTitle=document.createElement('span');
      this.repeatTitle.className='title-repeat';
      this.repeatTitle.setAttribute('aria-hidden','true');
      this.repeatTitle.textContent=this.firstElementChild.textContent;
      this.append(this.repeatTitle);
    }
  }
  clearRepeat(){
    this.repeatTitle?.remove();
    this.repeatTitle=null;
  }
  stop(){
    this.clearRepeat();
    titleSizes.unobserve(this);
    if(this.firstElementChild)titleSizes.unobserve(this.firstElementChild);
    this.removeAttribute('data-scrolling');
  }
});
const librarySort = initLibrarySort();
function songRow(s,order,display){
  const b=document.createElement('div');b.className='song'+(s.id===state.id?' current':'');
  b.innerHTML='<button class="song-play"><lume-list-cover class="thumb"></lume-list-cover><span class="meta"><strong></strong><small></small></span></button><button class="end"></button>';
  if (display && !display.covers) b.querySelector('.thumb').remove();
  else libraryCovers.bind(b.querySelector('.thumb'),s,!state.joined || state.hosting);
  b.querySelector('strong').textContent=display?.filenames ? librarySort.name(s) : s.title;
  songInfo(b.querySelector('small'),s,true);
  if (display?.next && !state.joined) {
    const next = button('', e => { e.stopPropagation(); songActions.queueNext(s); }, 'song-next');
    next.setAttribute('aria-label','下一首播放：'+s.title);
    next.innerHTML = glyph('plus');
    b.insertBefore(next,b.lastChild);
  }
  songActions.bind(b,s);
  b.onclick=()=>command('select',{id:s.id,...(Array.isArray(order)&&!state.joined?{order}: {})});
  return b;
}
function rows(id,songs,empty){
  songs=songs.filter(s=>!s.hidden);
  const list=$(id);
  if(songs.length && list.songItems?.length===songs.length && list.coverVersion===listCoverVersion &&
    songs.every((s,index)=>s===list.songItems[index])){
    if(list.activeId!==state.id){
      for(const [index,song] of songs.entries()){
        if(song.id!==state.id && song.id!==list.activeId)continue;
        const row=list.children[index], selected=song.id===state.id;
        row.classList.toggle('current',selected);
        row.querySelector('.end').innerHTML=songActions.more;
      }
      list.activeId=state.id;
    }
    return;
  }
  list.activeId=state.id;list.songItems=songs;list.coverVersion=listCoverVersion;
  const order = songs.map(s => s.id);
  list.replaceChildren(...songs.map(s => songRow(s,order,librarySort.prefs)));
  if(!songs.length){const p=document.createElement('p');p.className='empty';p.textContent=empty;list.append(p);}
}
function matchesLibraryQuery(song,q){
  if(q.startsWith('专辑：'))return groupName(song,'albums').toLocaleLowerCase()===q.slice(3);
  return (song.title+' '+artist(song)+' '+groupName(song,'albums')).toLocaleLowerCase().includes(q);
}
function showAlbumSongs(name){
  onlyLiked=false;$('query').value='专辑：'+name;
  library();navigate('library');$('scroll').scrollTop=0;
}
function library(){
  const q=$('query').value.trim().toLocaleLowerCase();
  const songs=state.songs.filter(s=>!s.hidden&&(!onlyLiked||liked.has(favKey(s.id)))&&matchesLibraryQuery(s,q));
  librarySort.sort(songs);
  $('song-count').textContent=songs.length+' 首';
  $('shuffle-song').disabled=!songs.length;
  $('shuffle-song').onclick=()=>{const pool=songs.length>1?songs.filter(s=>s.id!==state.id):songs;command('select',{id:pool[Math.floor(Math.random()*pool.length)].id});};
  rows('library-list',songs,q?'没有找到匹配的歌曲':onlyLiked?'在播放页点爱心，即可把歌曲加入收藏。':'曲库里还没有歌曲。');
  $('all').setAttribute('aria-pressed',!onlyLiked);$('liked').setAttribute('aria-pressed',onlyLiked);
  libraryLocate?.refresh();
}
const playerQueue=$('queue-sheet');
bindQueuePull(playerQueue,$('queue-tracks'));
function renderPlayerQueue(){
  const songs=queuedSongs();
  const list=$('queue-tracks');
  list.replaceChildren();
  addTracks(list,songs,'播放列表为空');
  $('queue-title').textContent=(state.joined?'空间曲目':'播放列表')+' · '+modeLabel();
}
function showPlayerQueue(){
  renderPlayerQueue();
  playerQueue.showModal();
  $('queue-tracks').querySelector('.current')?.scrollIntoView({block:'nearest'});
  syncBack();
}
$('close-queue').onclick=()=>playerQueue.close();
playerQueue.addEventListener('click',e=>{
  if(e.target.closest('.song')){playerQueue.close();return;}
  if(e.target!==playerQueue)return;
  const rect=playerQueue.getBoundingClientRect();
  if(e.clientX<rect.left || e.clientX>rect.right || e.clientY<rect.top || e.clientY>rect.bottom)playerQueue.close();
});
playerQueue.addEventListener('close',()=>{$('full').dispatchEvent(new Event('show-player-controls'));syncBack();});
function renderSongs(){
  if(playerQueue.open)renderPlayerQueue();
  updateSideSelection();
  refreshHome();
  library();
  document.querySelectorAll('[data-title]:not(#home-title)').forEach(el=>el.songName=state.title||active()?.title||'尚未选曲');
  document.querySelectorAll('[data-artist]').forEach(el=>songInfo(el,active()));
  if($('album').detailSong?.id!==active()?.id || !active())renderLyrics('');
  const displayedSong=active()||(!state.joined?state.songs.find(s=>!s.hidden):undefined);
  window.lumeCoverTheme.track(state.id && active()?detailKey(active()):null);
  for(const el of [$('album'),$('mini-art')])bindArt(el,displayedSong);
  if(tab==='browse')renderBrowse();
  const canPlay=Boolean(state.id)||state.songs.some(song=>!song.hidden);
  for(const button of document.querySelectorAll('[data-action="toggle"],[data-action="previous"],[data-action="next"]'))button.disabled=!canPlay;
  $('favorite').disabled=!state.id;$('favorite').setAttribute('aria-pressed',liked.has(favKey(state.id)));
}
function time(n){n=Math.floor(Math.max(0,n||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');}
let seekPending=null;
function setSeekLens(value){
  const fraction=Math.max(0,Math.min(1,Number(value)/1000||0));
  const rail=$('seek').parentElement;
  rail.style.setProperty('--seek-progress',fraction*100+'%');
  rail.style.setProperty('--seek-offset',(0.5-fraction)*14+'px');
}
function renderProgress(){
  if(seekPending && (seekPending.id!==state.id || state.duration<=0 || performance.now()>seekPending.until || Math.abs(state.pos-seekPending.seconds)<0.75))seekPending=null;
  const position=seekPending?seekPending.seconds:playbackPosition();
  const value=state.duration?Math.min(1000,1000*position/state.duration):0;
  if(!dragging){setSeekLens(value);$('seek').value=value;if($('elapsed').textContent!==time(position))$('elapsed').textContent=time(position);}
  if($('seek').disabled!==(state.duration<=0))$('seek').disabled=state.duration<=0;
  const durationText=time(state.duration);
  if($('duration').textContent!==durationText)$('duration').textContent=durationText;
  const circle=$('mini-circle-progress');
  circle.style.visibility=state.duration>0?'visible':'hidden';
  const circleFill=circle.querySelector('.circle-fill');
  circleFill.style.strokeDasharray=`${value/10} 100`;
  circleFill.style.visibility=value>0?'visible':'hidden';
  window.lumeDockProgress?.set(value/1000);
}
window.lumeDockSeek=fraction=>{
  if(!state.id||state.duration<=0)return false;
  const seconds=Math.max(0,Math.min(1,Number(fraction)||0))*state.duration;
  seekPending={id:state.id,seconds,until:performance.now()+1500};
  renderProgress();
  command('seek',{seconds});
  return true;
};
const invite=$('room-invite');
const shownRequests=new Set();
let visibleOffer=null;
function finishOffer(status){
  const offer=visibleOffer;visibleOffer=null;
  if(offer?.offerId && status)command('inviteFeedback',{offerId:offer.offerId,status});
}
invite.addEventListener('close',()=>{
  finishOffer('declined');
  syncBack();
  syncJoinRequestSheet();
});
let inviteExpiry;
window.lumeInvite=function(peer){
  if(invite.open||state.creating||(state.joined&&!state.hosting)||!!state.hosting!==!!peer.switchHost)return;
  visibleOffer=peer;
  delete invite.dataset.requestId;
  $('invite-title').textContent='播放空间邀请';
  const otherMembers=(state.outputs||[]).filter(p=>p.id!==state.selfId).length;
  $('invite-from').textContent=peer.name+' 邀请这台设备加入。'+(state.hosting?'同意后将结束本机主持的空间并切换到对方空间。'+(otherMembers?'当前空间的其他听众会断开连接。':''):'');
  $('accept-invite').textContent=state.hosting?'结束本空间并加入':peer.inviteToken?'加入':'申请加入';
  $('accept-invite').onclick=()=>{finishOffer();invite.close();navigate('space');if(peer.offerId)command('acceptRoomInvite',{offerId:peer.offerId});else command('join',{url:peer.url,pin:'',inviteToken:peer.inviteToken||'',deviceId:peer.deviceId||''});};
  $('decline-invite').onclick=()=>invite.close();
  clearDrawerDrag();invite.showModal();syncBack();
  if(peer.offerId)command('inviteFeedback',{offerId:peer.offerId,status:'shown'});
  clearTimeout(inviteExpiry);
  inviteExpiry=setTimeout(()=>{if(!invite.dataset.requestId&&invite.open){finishOffer('expired');invite.close();}},30000);
};
function memberName(p){return p.name || p.model || (p.platform==='Android'?'安卓手机':'鸿蒙手机');}
// A request can appear in many native snapshots. Present it once, even off the space tab.
function syncJoinRequestSheet(){
  const pending=state.hosting&&state.joined ? state.pending||[] : [];
  const ids=new Set(pending.map(peer=>peer.id));
  for(const id of shownRequests)if(!ids.has(id))shownRequests.delete(id);
  if(invite.open){
    const id=invite.dataset.requestId;
    if(id ? !ids.has(id) : state.creating||!!visibleOffer?.switchHost!==!!state.hosting||(state.joined&&!state.hosting))invite.close();
    return;
  }
  const peer=pending.find(peer=>!shownRequests.has(peer.id));
  if(!peer)return;
  clearTimeout(inviteExpiry);
  shownRequests.add(peer.id);
  invite.dataset.requestId=peer.id;
  $('invite-title').textContent='加入空间申请';
  $('invite-from').textContent=memberName(peer)+' 请求加入你的播放空间。';
  $('accept-invite').textContent='允许加入';
  function decide(enabled){
    if(!invite.open||invite.dataset.requestId!==peer.id)return;
    command('decide',{id:peer.id,enabled});
    invite.close();
  }
  $('accept-invite').onclick=()=>decide(true);
  $('decline-invite').onclick=()=>decide(false);
  clearDrawerDrag();invite.showModal();syncBack();
}
const guestConnection=$('guest-connection');
const guestFields=['room-status','host-details','room-action'].map(id=>{
  const field=$(id),anchor=document.createComment(id);
  field.before(anchor);return {field,anchor};
});
let guestConnectionUrl=null,guestConnectionTimer;
guestConnection.querySelector('summary').addEventListener('click',()=>clearTimeout(guestConnectionTimer));
function updateGuestConnection(){
  // Waiting, disconnected and failed states stay visible until resolved.
  const key=state.joined&&!state.hosting&&!/失败|中断|重连|断开|错误/.test(state.status||'')?state.host:null;
  if(key===guestConnectionUrl)return;
  clearTimeout(guestConnectionTimer);guestConnectionUrl=key;
  guestConnection.hidden=key===null;
  for(const {field,anchor} of guestFields){
    if(key===null)anchor.after(field);else guestConnection.append(field);
  }
  if(key!==null){
    guestConnection.open=true;
    guestConnectionTimer=setTimeout(()=>{if(!guestConnection.matches(':focus-within'))guestConnection.open=false;},4000);
  }
}
const editDeviceName=()=>window.dispatchEvent(new Event('lume-edit-device-name'));
$('local-device').onclick=editDeviceName;
const renderOutputs=createOutputControls($('outputs'),(id,patch)=>command('output',{id,patch}),editDeviceName);
$('search-phones').onclick=()=>command('searchPhones');
let nearbyView='',discoveredView='';
let phoneStatusTimer=0;
let spaceRefreshUntil=0,spaceRefreshTimer;
function renderSpaceRefresh(searching){
  const button=$('refresh-spaces'),now=performance.now();
  if(searching&&!button.classList.contains('searching'))spaceRefreshUntil=now+900;
  clearTimeout(spaceRefreshTimer);
  button.setAttribute('aria-busy',String(searching));
  const remaining=spaceRefreshUntil-now;
  button.classList.toggle('searching',searching||remaining>0);
  if(!searching&&remaining>0)spaceRefreshTimer=setTimeout(()=>renderSpaceRefresh(!!state.searching),remaining+16);
}
function renderSpace(){
  syncJoinRequestSheet();
  $('this-device').textContent=state.model||'正在读取机型…';
  $('local-device').hidden=!!(state.joined&&state.selfId&&state.outputs?.some(device=>device.id===state.selfId));
  $('space-tools').hidden=state.joined||state.hosting||state.creating;
  $('refresh-spaces').setAttribute('aria-label',state.searching?'重新开始 30 秒搜索':'刷新附近空间，搜索 30 秒');
  renderSpaceRefresh(!!state.searching);
  $('source').textContent=state.joined?'空间播放':'本机播放';
  updateGuestConnection();
  $('room-heading').textContent=state.joined?'播放空间':'附近的播放空间';
  const routes={left:'左声道',right:'右声道',mono:'单声道',stereo:'立体声'};
  const waitingForHost=state.status==='等待主机允许加入'&&!state.joined;
  const waitingUrl=waitingForHost?state.host:'';
  const waitingInList=waitingUrl&&state.hosts.some(host=>host.url===waitingUrl);
  $('room-status').textContent=[!waitingInList&&state.status,state.joined&&routes[state.channel]].filter(Boolean).join(' · ');
  const outputLabel=state.joined?'播放空间输出 · '+(routes[state.channel]||'已连接'):'本机输出';
  $('output').setAttribute('aria-label',outputLabel);$('output').title=outputLabel;
  $('manual-box').hidden=state.joined||state.hosting||state.creating;
  $('create-room').hidden=state.joined||state.hosting;
  $('create-room').disabled=state.creating;
  $('create-room').textContent=state.creating?'正在创建空间…':state.hostError?'重新创建空间':'用本机创建空间';
  $('room-action').disabled=state.creating;
  const hostState=$('host-state');
  hostState.hidden=!state.creating&&!state.hosting&&!state.hostError;
  hostState.dataset.state=state.creating?'creating':state.hosting?'ready':'error';
  hostState.textContent=state.creating?'正在创建播放空间，请稍候…':state.hosting?'空间已创建 · 本机是房主，其他设备可加入':state.hostError;
  $('source').textContent=state.creating?'创建空间中':state.hosting?'房主 · 空间已创建':state.joined?'空间播放':'本机播放';
  $('host-tools').hidden=!state.joined&&!state.hosting;
  $('invite-tools').hidden=!state.hosting;
  if(state.platform==='HarmonyOS'){
    if(!phoneStatusTimer)phoneStatusTimer=setInterval(()=>{if(!document.hidden)command('phoneSearchStatus');},750);
  }else if(phoneStatusTimer){clearInterval(phoneStatusTimer);phoneStatusTimer=0;}
  $('search-phones').textContent=state.phoneSearching?'重新搜索设备':'搜索附近设备';
  $('phone-search-status').textContent=state.inviteStatus||(state.phoneSearching?'正在搜索…请让另一台手机打开澄音并连接同一局域网。':'搜索附近设备，邀请对方加入本空间；每次搜索 30 秒。');
  const phoneView=JSON.stringify([state.hosting,state.phoneSearching,state.nearbyPhones]);
  if(phoneView!==nearbyView){
    nearbyView=phoneView;
    $('nearby-phones').replaceChildren(...(state.hosting?state.nearbyPhones||[]:[]).map(p=>{
      const row=element('div',undefined,'space-device discovered-device'),info=element('div');
      info.append(element('strong',memberName(p)),element('small',p.platform+' · '+p.address));
      const busy={hosting:'正在主持空间',joined:'已加入空间',connecting:'正在连接'}[p.availability];
      const eligible=!busy||(p.availability==='hosting'&&p.hostInvitable);
      if(busy&&eligible)info.append(element('small',busy));
      const b=button(eligible?'邀请加入':busy,()=>command('invitePhone',{id:p.id}),'pill');b.disabled=!eligible;
      row.append(info,b);return row;
    }));
  }
  $('host-pair').hidden=!state.hosting;
  if(state.joined||state.hosting){
    let ip=state.hosting?state.address:state.hostAddress;
    if(!ip&&!state.hosting)try{ip=new URL(state.host).hostname;}catch{}
    const valid=typeof ip==='string'&&/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)&&ip.split('.').every(v=>+v<=255)&&!ip.startsWith('127.');
    $('host-details').textContent='主机地址　'+(valid?ip:'暂无');
  }
  if(state.hosting){
    $('room-heading').textContent='本机创建的空间';
    $('host-code').textContent='配对码　'+(state.hostPin||'暂无');
  }
  renderOutputs(state.joined?state.outputs:[],state.selfId);
  $('compat-note').hidden=!state.joined||!!state.selfId;
  {
    $('requests').replaceChildren(...(state.joined?state.pending||[]:[]).map(p=>{
      const row=document.createElement('div');row.textContent=memberName(p)+'请求加入 ';
      for(const [label,enabled] of [['允许',true],['忽略',false]]){
        const b=document.createElement('button');b.className='pill';b.textContent=label;
        b.onclick=()=>command('decide',{id:p.id,enabled});row.append(b);
      }return row;
    }));
  }
  $('room-action').hidden=!state.joined&&!state.hosting;
  $('room-action').textContent=state.hosting?'结束空间':'离开空间';
  const hosts=state.joined||state.hosting||state.creating?[]:state.hosts;
  const view=JSON.stringify([hosts,waitingUrl]);
  if(view!==discoveredView){
    discoveredView=view;
    const expanded=new Set([...$('hosts').querySelectorAll('details[open]')].map(node=>node.dataset.url));
    $('hosts').replaceChildren(...hosts.map(host=>{
      const row=element('div',undefined,'space-device discovered-device');
      const details=element('details');
      details.dataset.url=host.url;
      details.open=expanded.has(host.url);
      details.append(element('summary',host.name||'播放空间'),element('small',host.url));
      const join=button(host.url===waitingUrl?'等待主机允许':'加入',()=>command('join',{url:host.url,pin:''}),'pill');
      join.disabled=waitingForHost;
      row.append(details,join);
      return row;
    }));
  }
}
function applySkin(){
  const root=document.documentElement.style,s=window.lumeCoverTheme.palette()||(state.joined&&state.skin);
  for(const [css,key] of [['--page','background'],['--panel','surface'],['--ink','ink'],['--accent','accent']]){
    if(s&&/^#[a-f0-9]{6}$/i.test(s[key]))root.setProperty(css,s[key]);else root.removeProperty(css);
  }
  document.documentElement.toggleAttribute('data-custom-skin',Boolean(s));
  for(const key of ['background','surface','accent','ink']) {
    if(s&&/^#[a-f0-9]{6}$/i.test(s[key]))root.setProperty('--skin-'+key,s[key]);else root.removeProperty('--skin-'+key);
  }
  if(s)root.setProperty('--muted','color-mix(in srgb,var(--ink) 76%,var(--page))');else root.removeProperty('--muted');
}
let noticeTimer;
let listCoverVersion=0;
let catalogReceived=false;
window.lumeUpdate=function(patch){
  if(Array.isArray(patch.songs))catalogReceived=true;
  const countsChanged=Object.hasOwn(patch,'counts')&&JSON.stringify(patch.counts)!==JSON.stringify(state.counts);
  if(patch.scanHistory)window.lumeScanRules.remember(patch.scanHistory);
  if(patch.pickedScanBlock)window.lumeScanRules.block(patch.pickedScanBlock,true);
  const changed=new Set(Object.keys(patch).filter(k=>state[k]!==patch[k]));
  if(changed.has('order') && Array.isArray(patch.order) && patch.order.length===state.order?.length &&
      patch.order.every((id,i)=>id===state.order[i]))changed.delete('order');
  const has=(...keys)=>keys.some(k=>changed.has(k));
  const rescanned=has('scanning') && state.scanning && !patch.scanning;
  if(rescanned || has('host','joined','hosting','coverLibrary') || (state.joined&&!state.hosting&&!active()?.coverRevision&&has('localTrackId','roomDetails')))listCoverVersion++;
  if(rescanned || has('host','joined','hosting')){pendingDetails.clear();detailsCache.clear();}
  if(has('host','joined'))renderLyrics('');
  if(has('id','host','joined') && !Object.hasOwn(patch,'roomDetails'))state.roomDetails=null;
  const previousPosition=playbackPosition();
  const resetClock=has('id','host','joined');
  Object.assign(state,patch);
  if(has('id','playing'))window.lumeCover.playback(state.id,state.playing);
  if(has('host','joined','hosting'))libraryCovers.roomChanged();
  if(has('localTrackId','localSong') && state.joined&&!state.hosting)libraryCovers.matchChanged();
  if(has('coverLibrary','hosting'))libraryCovers.setHostSongs(state.hosting?state.coverLibrary:null);
  if(state.hosting&&state.coverRequests?.length&&has('coverRequests','coverRevision','coverLibrary','hosting'))
    void libraryCovers.shareRequested(state.coverRevision).catch(()=>{});
  if(Object.hasOwn(patch,'pos')||has('playing')||resetClock){
    playbackAnchor=Number.isFinite(patch.pos)?patch.pos:resetClock?0:previousPosition;
    playbackAt=performance.now();
  }
  if(has('playing'))schedulePlaybackFrame();
  window.lumeHome.observe();
  if(rescanned || has('songs','host','joined','hosting','coverLibrary'))libraryCovers.update(state.joined&&!state.hosting?[]:state.songs,rescanned);
  if(has('platform'))document.documentElement.dataset.platform=state.platform;
  if(has('scanning','scanDone','scanTotal','scanTotalKnown','scanFound')){
    $('scan-stop').hidden=!state.scanning;
    $('scan-stop').textContent='终止扫描';
    const meter=$('library-scan-meter');meter.hidden=!state.scanning;
    if(state.scanning)updateScanMeter(meter);
  }
  if(has('id','host','joined'))stageFailed=false;
  if(has('joined','host') && browseSource!==sourceKey())resetBrowse();
  if(countsChanged&&tab==='browse'&&browsePage==='stats'){const report=document.querySelector('lume-play-stats');if(report)report.songs=state.joined?state.songs:state.songs.map(s=>({...s,playCount:state.counts?.[s.id]||0}));else renderBrowse();}
  if(countsChanged && librarySort.prefs.mode==='count')library();
  if(tab==='browse'){
    if(has('landscapeAwake','scanStatus','scanning','hosting','model'))renderBrowse();
    else if(browsePage==='scan'&&has('scanTotalKnown','scanTotal','scanDone','scanFound'))updateScanMeter($('browse-content').querySelector('lume-scan-meter'));
  }
  if(has('savedHost')&&!$('host').value)$('host').value=patch.savedHost;
  if(has('skin','joined'))applySkin();
  const songsChanged=rescanned || has('songs','id','title','joined','host','hosting','roomDetails','localSong','localTrackId','coverLibrary');
  if(songsChanged){renderSongs();songActions?.refreshLyrics();}
  else if(has('order')){
    if(playerQueue.open)renderPlayerQueue();
    if(tab==='browse'&&browsePage==='queue')renderBrowse();
  }
  if(has('nearbyPhones','phoneSearching','inviteStatus','searching','model','hosts','status','channel','joined','hosting','creating','hostError','pending','outputs','selfId','delayMs','hostPin','hostAddress','address'))renderSpace();
  if(has('shuffle','playMode','shuffleAvailable','creating','hosting','joined')){renderPlayOrder();if(playerQueue.open)renderPlayerQueue();}
  if(has('playing'))renderPlayButtons();
  if(!songsChanged && (countsChanged || has('playing','shuffle')))refreshHome();
  if(has('duration','pos','id'))renderProgress();
  if(has('duration','id','playing'))syncLyricView();
  else if(has('pos'))syncLyricPlayback();
  if(has('duration','pos','id','playing'))followLyrics();
  if(has('error','creating','hosting','joined')){
    const message=state.error|| (state.creating?'正在创建播放空间…':state.hosting&&!state.joined?'正在准备空间播放，请稍候…':'');
    $('playback-status').textContent=message;$('playback-status').hidden=!message;
  }
  if(has('error')&&patch.error){$('notice').textContent=patch.error;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,3200);}
};
const phoneDock = $('phone-dock'), dockNavButton = $('dock-nav-button');
const miniTrack = phoneDock.querySelector('.mini-track');
function showDockSide(side,focus=true){
  if(!dockPages.length)side='mini';
  phoneDock.dataset.open=side;
  dockNavButton.setAttribute('aria-expanded',String(side==='nav'));
  if(side==='mini'){
    miniTrack.setAttribute('aria-label','打开完整播放器');
    miniTrack.removeAttribute('aria-expanded');
    if(focus)miniTrack.focus({preventScroll:true});
  }else{
    miniTrack.setAttribute('aria-label','展开迷你播放器');
    miniTrack.setAttribute('aria-expanded','false');
    const tabs=$('dock-tabs');
    if(focus)(tabs.querySelector('[aria-current="page"]') || tabs.querySelector('button')).focus({preventScroll:true});
  }
}
const mainTabs = ['home', 'library', 'space'];
const dockOptions = {
  home:['聆听','disc'], library:['曲库','library'], artists:['艺术家','person'], space:['播放空间','radio'],
  playlists:['歌单','list'], albums:['专辑','albums'], sources:['音乐库','sources'], stats:['播放统计','stats'],
  folders:['文件夹','folders'], scan:['扫描音乐','scan'], queue:['播放列表','list'], settings:['设置','settings'], about:['关于','about']
};
const defaultDockPages=['home','library','artists','space','playlists'];
const maxDockPages=5;
const savedDock=readPreference('lume-dock-pages',defaultDockPages);
let dockPages=Array.isArray(savedDock)?[...new Set(savedDock.filter(id=>Object.hasOwn(dockOptions,id)))].slice(0,maxDockPages):[...defaultDockPages];
if(Array.isArray(savedDock) && savedDock.length!==dockPages.length)savePreference('lume-dock-pages',dockPages);
let lastMainPage=0,tabEntrance;
function switchSetting(label,checked,change){
  const row=element('label',undefined,'collection-row cover-setting');
  const input=element('input');input.type='checkbox';input.setAttribute('role','switch');input.checked=checked;
  input.onchange=()=>change(input.checked);
  const track=element('span',undefined,'cover-switch-track');track.setAttribute('aria-hidden','true');
  row.append(element('strong',label),input,track);
  return row;
}
function renderDockSettings(body){
  const editor=element('div');editor.id='dock-editor';
  const selected=element('div'),available=element('div');
  selected.className='dock-selected';
  const title=element('h2'),hint=element('p', '长按已选项，上下拖动调整顺序。','browse-note');
  editor.append(title,hint,selected,element('h2','可添加'),available);
  body.append(editor);
  function commit(ids){
    dockPages=ids;
    savePreference('lume-dock-pages',ids);
    rebuildDock();
  }
  function refresh(){
    title.textContent='已选 '+dockPages.length+' / '+maxDockPages;
    selected.replaceChildren();available.replaceChildren();
    hint.hidden=dockPages.length<2;
    for(const id of [...dockPages,...Object.keys(dockOptions).filter(id=>!dockPages.includes(id))]){
      const active=dockPages.includes(id),label=dockOptions[id][0];
      const row=element('div',undefined,'dock-setting-row');row.dataset.page=id;
      const toggle=switchSetting(label,active,enabled=>{
        if(enabled && dockPages.length>=maxDockPages)return;
        commit(enabled?[...dockPages,id]:dockPages.filter(page=>page!==id));
        refresh();
        if(document.body.dataset.inputMode!=='pointer')editor.querySelector('[data-page="'+id+'"] input').focus({preventScroll:true});
      });
      toggle.querySelector('input').disabled=!active && dockPages.length>=maxDockPages;
      row.append(toggle);
      (active?selected:available).append(row);
    }
  }
  bindDockReorder(selected,commit);
  refresh();
}
function bindDockReorder(list,commit){
  let drag,timer,frame,blockClick=false;
  function preview(){
    if(!drag?.active)return;
    if(!list.isConnected || !list.offsetHeight){finish(false);return;}
    const scroll=$('scroll'),viewport=scroll.getBoundingClientRect();
    const bottom=Math.min(viewport.bottom,phoneDock.getBoundingClientRect().top);
    if(drag.y<viewport.top+32)scroll.scrollTop-=6;
    else if(drag.y>bottom-32)scroll.scrollTop+=6;

    const {row,rows,slots,start,height}=drag;
    const localY=drag.y-list.getBoundingClientRect().top-drag.grab;
    const top=Math.max(0,Math.min(slots.at(-1).bottom-height,localY));
    const center=localY+height/2;
    let target=start;
    while(target>0 && center<slots[target-1].middle)target--;
    while(target<rows.length-1 && center>slots[target+1].middle)target++;
    if(target!==drag.target){
      rows.forEach((item,i)=>{
        if(item===row)return;
        const offset=i>start && i<=target?-height:i<start && i>=target?height:0;
        item.style.transform='translateY('+offset+'px)';
      });
      drag.target=target;
    }
    row.style.transform='translateY('+(top-slots[start].top)+'px)';
  }
  function tick(){preview();if(drag?.active)frame=requestAnimationFrame(tick);}
  function begin(target,x,y,pointer){
    if(drag || list.children.length<2)return;
    const row=target.closest('.dock-setting-row');
    if(!row || row.parentElement!==list)return;
    blockClick=false;
    drag={row,x,y,startY:y,pointer,active:false};
    timer=setTimeout(()=>{
      if(!row.isConnected || !list.offsetHeight){finish(false);return;}
      const rows=[...list.children],origin=list.getBoundingClientRect().top;
      for(const item of rows)for(const motion of item.getAnimations())motion.cancel();
      const slots=rows.map(item=>{
        const rect=item.getBoundingClientRect();
        return {top:rect.top-origin,bottom:rect.bottom-origin,middle:rect.top-origin+rect.height/2};
      });
      const start=rows.indexOf(row),slot=slots[start];
      Object.assign(drag,{active:true,rows,slots,start,target:start,height:slot.bottom-slot.top,grab:drag.startY-origin-slot.top});
      if(pointer!==null)list.setPointerCapture(pointer);
      list.classList.add('reordering');row.classList.add('sorting');
      blockClick=true;tick();
    },350);
  }
  function move(x,y){
    if(!drag)return;
    if(!drag.active && Math.hypot(x-drag.x,y-drag.startY)>8){finish(false);return;}
    drag.y=y;
  }
  function finish(save){
    clearTimeout(timer);cancelAnimationFrame(frame);
    if(!drag)return;
    const current=drag;drag=null;
    if(!current.active)return;
    const {row,rows,start,target,pointer}=current;
    if(pointer!==null && list.hasPointerCapture(pointer))list.releasePointerCapture(pointer);
    const positions=rows.map(item=>item.getBoundingClientRect().top);
    list.classList.remove('reordering');row.classList.remove('sorting');
    for(const item of rows)item.style.removeProperty('transform');
    if(save && start!==target){
      const ordered=[...rows];ordered.splice(start,1);ordered.splice(target,0,row);
      list.append(...ordered);
      commit(ordered.map(item=>item.dataset.page));
    }
    if(!quietMotion.matches && list.offsetHeight){
      rows.forEach((item,i)=>{
        const offset=positions[i]-item.getBoundingClientRect().top;
        if(Math.abs(offset)>0.5)item.animate([{transform:'translateY('+offset+'px)'},{transform:'none'}],
          {duration:155,easing:'cubic-bezier(.2,.75,.25,1)'});
      });
    }
  }
  // Keep native scrolling until a stationary long press claims the touch.
  list.addEventListener('touchstart',event=>{
    if(event.touches.length!==1){finish(false);return;}
    const t=event.touches[0];begin(event.target,t.clientX,t.clientY,null);
  },{passive:true});
  list.addEventListener('touchmove',event=>{
    if(!drag || drag.pointer!==null)return;
    if(event.touches.length!==1 || !event.cancelable){finish(false);return;}
    if(drag.active)event.preventDefault();
    const t=event.touches[0];move(t.clientX,t.clientY);
  },{passive:false});
  list.addEventListener('touchend',event=>{
    if(drag?.pointer!==null)return;
    if(drag.active){
      if(event.cancelable)event.preventDefault();
      drag.y=event.changedTouches[0].clientY;preview();
    }
    finish(true);
  },{passive:false});
  list.ontouchcancel=()=>finish(false);
  list.onpointerdown=event=>{
    if(event.pointerType!=='touch' && event.isPrimary && event.button===0)
      begin(event.target,event.clientX,event.clientY,event.pointerId);
  };
  list.onpointermove=event=>{if(drag?.pointer===event.pointerId)move(event.clientX,event.clientY);};
  list.onpointerup=event=>{
    if(drag?.pointer!==event.pointerId)return;
    if(drag.active){drag.y=event.clientY;preview();}
    finish(true);
  };
  list.onpointercancel=list.onlostpointercapture=event=>{if(drag?.pointer===event.pointerId)finish(false);};
  list.onpointerleave=event=>{if(drag?.pointer===event.pointerId && !drag.active)finish(false);};
  list.oncontextmenu=event=>event.preventDefault();
  list.addEventListener('click',event=>{
    if(blockClick && event.detail){event.preventDefault();event.stopImmediatePropagation();blockClick=false;}
  },true);
  list.onkeydown=event=>{
    if(!['ArrowUp','ArrowDown'].includes(event.key))return;
    const row=event.target.closest('.dock-setting-row');
    if(!row)return;
    event.preventDefault();
    const i=dockPages.indexOf(row.dataset.page),j=i+(event.key==='ArrowUp'?-1:1);
    if(j<0 || j>=dockPages.length)return;
    const other=list.children[j];
    list.insertBefore(row,j<i?other:other.nextSibling);
    commit(Array.from(list.children,item=>item.dataset.page));
    row.querySelector('input').focus();
  };
}
function rebuildDock(){
  const tabs=$('dock-tabs');
  tabs.replaceChildren(...dockPages.map(id=>{
    const [label,icon]=dockOptions[id],b=element('button');
    b.dataset[mainTabs.includes(id)?'tab':'browse']=id;
    b.setAttribute('aria-label',label);
    const i=element('i');i.dataset.icon=icon;i.innerHTML=glyph(icon);
    b.append(i,element('span',label));return b;
  }));
  phoneDock.classList.toggle('mini-only',!dockPages.length);
  if(!dockPages.length)showDockSide('mini',false);
  updateDockSelection();
}
function updateDockSelection(){
  const id=tab==='browse'?browsePage:tab;
  const index=dockPages.indexOf(id);
  lastMainPage=index<0?Math.min(lastMainPage,dockPages.length-1):index;
  const tabs=$('dock-tabs');
  Array.from(tabs.children).forEach((b,i)=>{
    if(i===index)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  const [label,icon]=dockOptions[id]||[browseNames[id]||'导航','menu'];
  dockNavButton.querySelector('i').innerHTML=glyph(icon);
  dockNavButton.querySelector('span').textContent=label;
  dockNavButton.setAttribute('aria-label',label+'，展开页面导航');
  const selected=tabs.children[index];
  if(selected && tabs.clientWidth && tabs.scrollWidth>tabs.clientWidth)
    selected.scrollIntoView({block:'nearest',inline:'nearest'});
}
function stepMainPage(direction){
  if(!dockPages.length)return;
  const next=dockPages[(lastMainPage+direction+dockPages.length)%dockPages.length];
  if(mainTabs.includes(next))navigate(next,direction);
  else openBrowse(next,null,direction);
}
$('scroll').addEventListener('scroll',()=>{
  document.querySelector('header').classList.toggle('listen-scrolled',tab==='home'&&$('scroll').scrollTop>20);
},{passive:true});
function navigate(next,direction=0){
  setDrawer(false);
  const from = mainTabs.indexOf(tab), to = mainTabs.indexOf(next);
  if (tab !== next || direction) tabEntrance?.cancel();
  scrollPositions[tab]=$('scroll').scrollTop;tab=next;
  document.body.classList.toggle('listen-page',next==='home');
  if(next==='home'&&homeDirty)refreshHome();
  for(const name of [...mainTabs,'browse'])$(name).hidden=tab!==name;
  updateDockSelection();
  updateCollectionHeader();
  $('page-heading').textContent=tab==='browse'?browseNames[browsePage]:dockOptions[tab][0];
  $('scroll').scrollTop=scrollPositions[tab]||0;updateSideSelection();syncBack();
  if ((direction || (from >= 0 && to >= 0 && from !== to)) && !quietMotion.matches) {
    const offset = 18 * (direction || Math.sign(to-from));
    tabEntrance = $(next).animate([
      { transform: 'translateX(' + offset + 'px)', opacity: next==='home'?1:0.55 },
      { transform: 'translateX(0)', opacity: 1 }
    ], { duration: 210, easing: 'cubic-bezier(.2,.75,.25,1)' });
  }
}
let playerOpener;
function preparePlayerMotion(createMotion=createPlayerDrag){
  if(playerMotion)return playerMotion;
  setDrawer(false);
  const page=$('full');
  lyricMotion?.skipTransition();
  // Keep the underlying list visible before the first layout read, including on close.
  page.dataset.morphing='';
  window.lumePlayerTransition?.(true);
  if(page.hidden){
    playerOpener=document.activeElement;
    page.hidden=false;page.scrollTop=0;showLyrics=false;showMoreMode(false);
    syncPlayerSession();
    syncLyricView();currentLine=-1;followLyrics();
  }
  window.lumeCover.paintRotation();
  playerMotion=createMotion(Number(expanded),()=>{
    page.hidden=!expanded;
    delete page.dataset.morphing;
    playerMotion=null;
    for(const node of [document.querySelector('header'),$('scroll'),phoneDock])node.inert=expanded;
    page.inert=!expanded;
    syncPlayerSession();
    if(expanded){page.focus({preventScroll:true});currentLine=-1;followLyrics();}
    else{
      showLyrics=false;showMoreMode(false);
      syncLyricView();
      if(playerOpener?.isConnected && playerOpener!==document.body)playerOpener.focus({preventScroll:true});
    }
    syncBack();
    window.lumePlayerTransition?.(false);
  });
  syncBack();
  return playerMotion;
}
function player(show,velocity,instant=false){
  if(expanded===show && !playerMotion)return;
  releasePlayerGesture();
  const motion=preparePlayerMotion(instant?(_initial,finished)=>({settle:finished}):undefined);
  expanded=show;
  motion.settle(show,velocity);syncBack();
}
function openPlayer(instant=false){player(true,undefined,instant);}
window.lumeOpenWidgetPlayer=()=>{
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  openPlayer(true);
  if(showLyrics)setLyrics(false);
};
window.lumeBack=()=>{if(invite.open){invite.close();return true;}if(playerDropdown.close()||songActions.close())return true;else if($('album-settings').open)dismissSettingsSheet($('album-settings'));else if($('library-sort').open)dismissSettingsSheet($('library-sort'));else if(plainSettings.open)dismissSettingsSheet(plainSettings);else if(window.LumeFolia.closeSettings())return true;else if(playerQueue.open)playerQueue.close();else if(listEditor.open)closePlaylistEditor();else if(drawerOpen)setDrawer(false);else if(expanded||playerMotion)backFromPlayer();else if(tab==='browse'&&browseDetail!==null)openBrowse(browsePage);else if(tab!=='home')navigate('home');else return false;return true;};
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.tab || b.dataset.browse){
    const id=b.dataset.tab||b.dataset.browse;
    const current=tab==='browse'?browsePage:tab;
    const direction=b.closest('#dock-tabs') && (id!==current || (tab==='browse' && browseDetail!==null))
      ? Math.sign(dockPages.indexOf(id)-dockPages.indexOf(current))||1 : 0;
    if(b.dataset.tab)navigate(id,direction);else openBrowse(id,null,direction);
    return;
  }
  switch(b.dataset.action){
    case 'show-tabs':showDockSide('nav');break;
    case 'mini-track':
      if(phoneDock.dataset.open==='nav')showDockSide('mini');
      else openPlayer();
      break;
    case 'expand':openPlayer();break;
    case 'close':backFromPlayer();break;
    case 'player-queue':showPlayerQueue();break;
    case 'space':player(false);navigate('space');break;
    case 'toggle':
      if(b.closest('#mini'))pulsePlayButton(b);
      command('toggle');break;
    case 'shuffle':{const modes=['sequence','repeatOne','shuffle'];command('playMode',{mode:modes[(modes.indexOf(playMode())+1)%modes.length]});break;}
    case 'previous':case 'next':case 'import':command(b.dataset.action);break;
  }
});
function setSongFavorite(key,enabled){
  if(enabled)liked.add(key);else liked.delete(key);
  try{localStorage.setItem('lume-favorites',JSON.stringify([...liked]));}catch{}
  command('favoriteSet',{key,enabled});renderSongs();
}
window.lumeFavoriteState=keys=>{
  if(!Array.isArray(keys))return;
  const next=new Set(keys);
  if(next.size===liked.size&&[...liked].every(key=>next.has(key)))return;
  liked=next;
  try{localStorage.setItem('lume-favorites',JSON.stringify([...liked]));}catch{}
  renderSongs();
};
$('favorite').onclick=()=>{if(state.id){const key=favKey(state.id);setSongFavorite(key,!liked.has(key));}};
$('query').oninput=library;
$('all').onclick=()=>{onlyLiked=false;library();};$('liked').onclick=()=>{onlyLiked=true;library();};
$('room-action').onclick=()=>command('leave');
$('refresh-spaces').onclick=()=>{
  spaceRefreshUntil=performance.now()+900;
  renderSpaceRefresh(!!state.searching);
  command('search');
};
$('create-room').onclick=()=>{if(!state.creating)command('createHost');};
$('manual-button').onclick=()=>{$('pair').hidden=!$('pair').hidden;$('manual-button').setAttribute('aria-expanded',!$('pair').hidden);};
$('pair').onsubmit=e=>{e.preventDefault();command('join',{url:$('host').value.trim(),pin:$('pin').value});};
let seekSong;
function previewSeek(value){
  if(!dragging){seekSong=state.id;seekPending=null;}
  dragging=true;setSeekLens(value);
  $('seek-target').hidden=false;$('seek-target').textContent=time(value*state.duration/1000);
}
function endSeek(){dragging=false;$('seek-target').hidden=true;renderProgress();}
function commitSeek(value){
  const valid=expanded && state.duration>0 && (!dragging || state.id===seekSong);
  if(valid){
    const seconds=Math.max(0,Math.min(1000,value))*state.duration/1000;
    seekPending={id:state.id,seconds,until:performance.now()+1500};
    dragging=false;$('seek-target').hidden=true;renderProgress();
    command('seek',{seconds});
  }else endSeek();
}
$('seek').dataset.thumbWidth='14';
window.lumeBindRange($('seek'),previewSeek,commitSeek,endSeek);
$('seek').oninput=e=>previewSeek(+e.target.value);
$('seek').onchange=e=>commitSeek(+e.target.value);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]'))window.lumeBack();});
initSongActions();initSidebar();initLibraryLocate();initAlbumSettings();rebuildDock();
navigate('home');renderSongs();renderSpace();renderProgress();
function renderPlayButtons(){
  $('album').dataset.playing=String(state.playing);
  for(const button of document.querySelectorAll('.toggle')){
    if(!button.firstElementChild){
      const halo=button.closest('#mini')?'<span class="play-halo" aria-hidden="true"></span>':'';
      button.innerHTML=halo+glyph('play')+glyph('pause');
    }
    button.dataset.playing=String(state.playing);
    button.setAttribute('aria-label',state.playing?'暂停':'播放');
  }
}
function playMode(){return state.playMode|| (state.shuffle?'shuffle':'sequence');}
function modeLabel(){return {sequence:'列表顺序',repeatOne:'单曲循环',shuffle:'随机播放'}[playMode()];}
function renderPlayOrder(){
  const button=$('play-order'),mode=playMode();
  button.disabled=!state.shuffleAvailable||state.creating||(state.hosting&&!state.joined);
  button.innerHTML=glyph(mode);
  button.removeAttribute('aria-pressed');button.dataset.mode=mode;
  button.setAttribute('aria-label',modeLabel()+'，切换播放模式');button.title=modeLabel();
}
renderPlayButtons();renderPlayOrder();
command('ready',{favoriteKeys:[...liked]});
