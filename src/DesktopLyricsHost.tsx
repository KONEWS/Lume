import {useCallback, useEffect, useRef, useState, type RefObject} from 'react';
import type {PlaybackClock} from './PlaybackSeek';
import type {DesktopWindowState, Playback, RoomAction, Track} from './types';
import {parseSongLyrics} from '../shared/song-details.mjs';
import './appearance/desktop-lyrics-host.css';
import {useLyricsDialog} from './useLyricsDialog';

const CHANNEL = 'lume-pc-lyrics';
const PREFERENCES = 'lume-pc-lyrics-preferences.v1';
const defaultPreferences = {
  topmost:false, closeToTaskbar:false, audioReactive:true, transparentBackground:false,
  coverTheme:true, autoImmersive:true, immersiveDelay:5, bottomHoverControls:true,
  source:'lume', onlineEnabled:false, onlineProviders:[], musicApps:[], blockedMusicApps:[],
  showMusicAppAddButton:false, autoDiscoverMusicApps:false,
};
type Preferences = typeof defaultPreferences;
type LyricsInput = {content:string; format?:'lrc'; translation?:string};

function timeTag(seconds:number) {
  const ms=Math.max(0,Math.round(seconds*1000));
  return String(Math.floor(ms/60000)).padStart(2,'0')+':'+
    String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');
}

function phoneLyrics(content:string):LyricsInput {
  const {rows}=parseSongLyrics(content);
  if(!rows.some(row=>row.translation))return {content};
  const original:string[]=[], translation:string[]=[];
  for(const row of rows) {
    const stamp='['+timeTag(row.time)+']';
    const words=row.words;
    let text=words?.map(word=>'<'+timeTag(word.startTime)+'>'+word.text).join('')||row.text;
    const end=words?.at(-1)?.endTime;
    if(end!==undefined)text+='<'+timeTag(end)+'>';
    original.push(stamp+text);
    if(row.translation)translation.push(stamp+row.translation.replace(/\n/g,' / '));
  }
  return {format:'lrc',content:original.join('\n'),translation:translation.join('\n')};
}

type Props = {
  open:boolean; onExited:()=>void;
  track:Track|null; clock:PlaybackClock; playback:Playback; audioEnabled:boolean; sourceKey:string;
  analyser:RefObject<AnalyserNode|null>; onAction:(action:RoomAction)=>Promise<unknown>;
  onClose:()=>void; onQueue:()=>void;
};

function readPreferences():Preferences {
  try {
    const saved=JSON.parse(localStorage.getItem(PREFERENCES)||'{}');
    const result={...defaultPreferences};
    for(const key of ['audioReactive','coverTheme','autoImmersive','bottomHoverControls'] as const) {
      if(typeof saved[key]==='boolean')result[key]=saved[key];
    }
    if(Number.isFinite(saved.immersiveDelay))result.immersiveDelay=Math.max(5,Math.min(300,saved.immersiveDelay));
    return result;
  } catch {return {...defaultPreferences};}
}

/** The Folia page owns presentation; only this host can issue Lume playback/native commands. */
export function DesktopLyricsHost(props:Props) {
  const dialog=useLyricsDialog(props.open,props.onExited);
  const iframe=useRef<HTMLIFrameElement>(null);
  const live=useRef(props); live.current=props;
  const ready=useRef(false);
  const lyrics=useRef<{id:string;input:LyricsInput}>({id:'',input:{content:''}});
  const sequence=useRef(0);
  const [initialPreferences]=useState(readPreferences);
  const preferences=useRef(initialPreferences);
  const windowState=useRef<DesktopWindowState>({fullscreen:false,maximized:false,alwaysOnTop:false});
  const [failed,setFailed]=useState(false);
  const [frameReady,setFrameReady]=useState(false);
  const send=useCallback((type:string,data:unknown)=>{
    if(ready.current)iframe.current?.contentWindow?.postMessage({channel:CHANNEL,message:{type,data}},location.origin);
  },[]);
  const sendWindow=useCallback((state:DesktopWindowState)=>{
    windowState.current=state;
    preferences.current.topmost=state.alwaysOnTop;
    send('windowState',{fullscreen:state.fullscreen,maximized:state.maximized,clickThrough:false});
    send('preferences',preferences.current);
  },[send]);
  const session=useCallback(()=>{
    const {track,clock,playback}=live.current;
    return {key:track?.id||'',sessionId:'lume',title:track?.title||'',artist:track?.artist||'',
      album:track?.album||'',cover:track?.artwork?new URL(track.artwork,location.href).href:'',
      source:'澄音',sources:[{id:'lume',label:'澄音',playing:playback.playing}],
      position:clock.getSnapshot(),duration:track?.duration||0,playing:playback.playing,
      rate:1,hasTimeline:!!track,received:performance.now(),sequence:++sequence.current,
      controls:{play:!!track,pause:!!track,toggle:!!track,previous:!!track,next:!!track}};
  },[]);
  const sendLyrics=useCallback(()=>{
    const track=live.current.track;
    if(!track || lyrics.current.id!==track.id)return;
    send('lyrics',{key:track.id,title:track.title,artist:track.artist,cover:track.artwork,
      ...lyrics.current.input,source:live.current.sourceKey==='local'?'澄音本地歌词':'手机空间歌词',embedded:true});
  },[send]);
  const sync=useCallback(()=>{
    send('preferences',preferences.current);
    send('appearance',{acrylic:false,solid:false,highContrast:false,transparent:false});
    sendWindow(windowState.current);
    send('session',session()); sendLyrics();
    send('playbackMode',{shuffle:live.current.playback.shuffle,repeat:live.current.playback.repeat});
    send('audioStatus',{text:live.current.audioEnabled?'跟随澄音本机音频':'本机声音未启用'});
    send('library',{folders:[],count:0});
  },[send,sendWindow,session,sendLyrics]);

  useEffect(()=>{
    const native=window.lumeDesktop;
    let disposed=false,changed=false;
    const stop=native?.onWindowStateChange?.(state=>{changed=true;sendWindow(state);});
    void native?.getWindowState?.().then(state=>{if(!disposed&&!changed)sendWindow(state);}).catch(()=>{});
    return ()=>{disposed=true;stop?.();};
  },[sendWindow]);

  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.origin!==location.origin || event.source!==iframe.current?.contentWindow || event.data?.channel!==CHANNEL)return;
      const {type,value}=event.data;
      const native=window.lumeDesktop;
      const report=(error:unknown)=>send('notice',{text:error instanceof Error?error.message:'操作未完成，请重试'});
      const handle=async()=>{
        if(type==='ready'){ready.current=true;setFailed(false);sync();setFrameReady(true);return;}
        if(type==='closeLyrics'){
          live.current.onClose();
          if(windowState.current.fullscreen)await native?.setFullscreen(false);
          return;
        }
        if(type==='queue'){live.current.onQueue();return;}
        if(type==='fullscreen'){await native?.setFullscreen(!windowState.current.fullscreen);return;}
        if(type==='exitFullscreen'){await native?.setFullscreen(false);return;}
        if(type==='topmost' && typeof value==='boolean'){await native?.setAlwaysOnTop(value);return;}
        if(type==='window'){
          if(value?.action==='minimize')native?.minimize();
          else if(value?.action==='maximize')native?.maximize();
          else if(value?.action==='close')native?.close();
          return;
        }
        if(type==='mediaControl'){
          if(typeof value?.requestId!=='string')return;
          try {
            if(value.sessionId!=='lume' || value.songKey!==live.current.track?.id)throw Error('歌曲已切换，请重试');
            if(!['play','pause','previous','next'].includes(value.action))throw Error('无效的播放操作');
            await live.current.onAction({type:value.action});
            send('transport',{requestId:value.requestId,success:true,message:''});
          } catch(error) {send('transport',{requestId:value.requestId,success:false,message:error instanceof Error?error.message:'播放操作失败'});}
          return;
        }
        if(type==='seek' && Number.isFinite(value?.position)){
          await live.current.onAction({type:'seek',position:Math.max(0,Math.min(value.position,live.current.track?.duration||0))});return;
        }
        if(type==='shuffle' && typeof value==='boolean'){
          // The two explicit modes must also replace a previously selected single-track repeat.
          await live.current.onAction({type:'repeat',value:'off'});
          await live.current.onAction({type:'shuffle',value});return;
        }
        if(type==='systemVolume' && Number.isFinite(value?.delta)){
          const volume=Math.max(0,Math.min(1,live.current.playback.volume+Math.max(-4,Math.min(4,value.delta))*.02));
          await live.current.onAction({type:'volume',value:volume});
          send('systemVolume',{percent:Math.round(volume*100),muted:live.current.playback.muted});return;
        }
        if(type==='querySystemFonts' && typeof value?.requestId==='string'){
          try {send('systemFonts',{requestId:value.requestId,families:await native?.getSystemFonts?.()||[]});}
          catch(error){send('systemFonts',{requestId:value.requestId,families:[],error:String(error)});}return;
        }
        if(['audioReactive','coverTheme','autoImmersive','bottomHoverControls'].includes(type) && typeof value==='boolean'){
          Object.assign(preferences.current,{[type]:value});
        } else if(type==='immersiveDelay' && Number.isFinite(value))preferences.current.immersiveDelay=Math.max(5,Math.min(300,value));
        else return;
        localStorage.setItem(PREFERENCES,JSON.stringify(preferences.current));
        send('preferences',preferences.current);
      };
      void handle().catch(report);
    };
    window.addEventListener('message',receive);
    return ()=>window.removeEventListener('message',receive);
  },[send,sync]);

  useEffect(()=>{
    const controller=new AbortController();
    const track=props.track;
    lyrics.current={id:track?.id||'',input:{content:''}};
    send('session',session());
    sendLyrics();
    if(!track)return;
    const read=async()=>{
      if(window.lumeDesktop?.readLyrics)return window.lumeDesktop.readLyrics(track.id);
      const response=await fetch('/api/lyrics/'+encodeURIComponent(track.id),{signal:controller.signal});
      if(!response.ok)throw Error('歌词读取失败');
      return (await response.json()).lyrics as string;
    };
    void read().then(content=>{
      if(controller.signal.aborted)return;
      lyrics.current={id:track.id,input:props.sourceKey==='local'?{content}:phoneLyrics(content)};sendLyrics();
    }).catch(error=>{if(!controller.signal.aborted)send('notice',{text:String(error)});});
    return ()=>controller.abort();
  },[props.track?.id,props.track?.detailKey,props.sourceKey,send,session,sendLyrics]);
  useEffect(()=>{send('session',session());},[props.track,props.playback.playing,send,session]);
  useEffect(()=>{send('playbackMode',{shuffle:props.playback.shuffle,repeat:props.playback.repeat});},[props.playback.shuffle,props.playback.repeat,send]);
  useEffect(()=>{send('audioStatus',{text:props.audioEnabled?'跟随澄音本机音频':'本机声音未启用'});},[props.audioEnabled,send]);
  useEffect(()=>props.clock.subscribe(()=>{
    const data=session();
    send('clock',{key:data.key,sessionId:data.sessionId,sequence:data.sequence,position:data.position,
      duration:data.duration,playing:data.playing,rate:1,hasTimeline:data.hasTimeline});
  }),[props.clock,send,session]);
  useEffect(()=>{
    let bins=new Uint8Array(0);
    const timer=setInterval(()=>{
      const analyser=live.current.analyser.current;
      if(!ready.current || !analyser || !live.current.playback.playing || !preferences.current.audioReactive)return;
      if(bins.length!==analyser.frequencyBinCount)bins=new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(bins);
      // Folia's bridge uses 1024 bins; keep frequency positions when Lume uses a smaller FFT.
      const values=new Uint8Array(1024);
      for(let i=0;i<values.length;i++)values[i]=bins[Math.min(bins.length-1,Math.floor(i*bins.length/values.length))];
      send('spectrum',{bins:btoa(String.fromCharCode(...values)),sampleRate:analyser.context.sampleRate});
    },50);
    return ()=>clearInterval(timer);
  },[send]);

  return <dialog className="pc-lyrics-screen" ref={dialog} aria-label="歌词播放页" onCancel={event=>{
    event.preventDefault();
    if(windowState.current.fullscreen)void window.lumeDesktop?.setFullscreen(false);
    else live.current.onClose();
  }}>
    {!failed && <div className="pc-lyrics-loading" inert={frameReady} data-ready={frameReady}>
      <img src={props.track?.artwork || '/covers/1.svg'} alt=""/><strong>{props.track?.title}</strong>
      <button onClick={props.onClose}>收起歌词</button>
    </div>}
    <iframe ref={iframe} data-ready={frameReady} title="澄音 Folia 歌词页" src="/pc-lyrics/desktop.html" onError={()=>setFailed(true)}/>
    {failed && <div className="pc-lyrics-error" role="alert"><p>歌词页面未能加载，请返回后重试。</p><button onClick={props.onClose}>返回澄音</button></div>}
  </dialog>;
}
