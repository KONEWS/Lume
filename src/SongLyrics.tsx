import {useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {ListMusic} from 'lucide-react';
import type {PlaybackClock} from './PlaybackSeek';
import type {Track} from './types';
import {parseSongLyrics} from '../shared/song-details.mjs';
import {useLyricsDialog} from './useLyricsDialog';

const landscape = matchMedia('(orientation: landscape)');
const mobile = /Android|HarmonyOS|OpenHarmony/i.test(navigator.userAgent);
function subscribeOrientation(listener:()=>void) {
  landscape.addEventListener('change',listener);
  return () => landscape.removeEventListener('change',listener);
}
export function LyricsPage({open,onExited,title,onClose,onQueue,children}:{open:boolean;onExited:()=>void;title:string;onClose:()=>void;onQueue:()=>void;children:ReactNode}) {
  const page = useLyricsDialog(open,onExited);
  useEffect(()=>window.LumeFolia.autoHide(page.current!),[page]);
  return <dialog ref={page} className="lyrics-screen" aria-label="歌词播放页" tabIndex={-1} onCancel={event=>{event.preventDefault();onClose();}}>
    <div className="lyrics-heading lyric-control">
      <button type="button" onClick={onClose} aria-label="收起歌词">‹</button><h2>{title}</h2><button type="button" className="lyrics-queue" aria-label="播放列表" aria-haspopup="dialog" onClick={onQueue}><ListMusic size={20}/></button>
    </div>
    {children}
  </dialog>;
}

export function SongLyrics({track, clock, playing}:{track:Track | null; clock:PlaybackClock; playing:boolean}) {
  const position = useSyncExternalStore(clock.subscribe,clock.getSnapshot);
  const eligible = useSyncExternalStore(subscribeOrientation,()=>!mobile || landscape.matches);
  const [mode,setMode] = useState(window.LumeFolia.preference);
  const [lyrics,setLyrics] = useState('');
  const [message,setMessage] = useState('正在读取歌词…');
  const [showTranslation,setShowTranslation] = useState(window.LumeFolia.translationVisible);
  const [revision,refresh]=useState(0);
  const [failed,setFailed] = useState(false);
  const current = useRef<HTMLParagraphElement>(null);
  const previousLine = useRef(-1);
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<FoliaStage | null>(null);
  const id = track?.id;
  useEffect(()=>{
    const controller = new AbortController();
    async function read() {
      if (!id) return '';
      if (window.lumeDesktop?.readLyrics) return window.lumeDesktop.readLyrics(id);
      const response = await fetch('/api/lyrics/'+encodeURIComponent(id),{signal:controller.signal});
      if (!response.ok) throw Error();
      return (await response.json()).lyrics as string;
    }
    read().then(text=>{
      if (!controller.signal.aborted) {setLyrics(text);setMessage('暂无歌词');}
    }).catch(()=>{if(!controller.signal.aborted)setMessage('歌词读取失败');});
    return ()=>controller.abort();
  },[id,track?.detailKey]);
  const {rows,plain} = useMemo(()=>parseSongLyrics(lyrics),[lyrics]);
  const bilingual = useMemo(()=>rows.some(row=>row.translation),[rows]);
  const data = useMemo(()=>({id:id || '',title:track?.title || '',artist:track?.artist || '',
    duration:track?.duration || 0,rows,translated:showTranslation}),[id,track?.title,track?.artist,track?.duration,rows,showTranslation]);
  const immersive = eligible && mode!=='plain' && rows.length>0 && !failed;
  useEffect(()=>{
    if (!immersive || !viewport.current) return;
    const instance = window.LumeFolia.mount(viewport.current,()=>setFailed(true));
    stage.current=instance;
    return ()=>{stage.current=null;instance.close();};
  },[immersive,revision]);
  useEffect(()=>{
    stage.current?.update(data,mode,position,playing);
    window.LumeFolia.updateSettings(data,mode,position,playing);
  },[immersive,data,mode,position,playing,revision]);
  useEffect(()=>()=>{window.LumeFolia.closeSettings();},[eligible]);
  const next = rows.findIndex(line=>line.time>position);
  const index = next<0 ? rows.length-1 : next-1;
  useEffect(()=>{
    const follow = previousLine.current>=0 && index===previousLine.current+1 && playing;
    previousLine.current = immersive ? -1 : index;
    if (!immersive) current.current?.scrollIntoView({block:'center',
      behavior:follow && !matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'});
  },[index,immersive,showTranslation,playing]);
  return <>
    <div className="lyrics-options lyric-control">
    {eligible && <label className="lyric-style">歌词样式 <select value={mode} onChange={e=>{
      const choice=e.target.value;window.LumeFolia.save(choice);setMode(choice);setFailed(false);
    }}><option value="plain">普通歌词</option>{Object.entries(window.LumeFolia.styles).map(([key,label])=>
      <option key={key} value={key}>Folia · {label}</option>)}</select></label>}
    {eligible && <button type="button" aria-label="歌词样式设置" title="歌词样式设置" onClick={()=>{
      window.LumeFolia.openSettings(mode,choice=>{setMode(choice);setShowTranslation(window.LumeFolia.translationVisible());setFailed(false);refresh(n=>n+1);});
      window.LumeFolia.updateSettings(data,mode,position,playing);
    }}>⚙</button>}
    {bilingual && <label className="translation-choice"><input type="checkbox" checked={showTranslation} onChange={e=>{
      setShowTranslation(e.target.checked);window.LumeFolia.saveTranslation(e.target.checked);
    }}/>显示译文</label>}
    </div>
    {failed && <small className="lyric-error" role="status">此样式未能显示，已恢复普通歌词。</small>}
    {immersive ? <div className="folia-viewport" ref={viewport}/> : <div className="song-lyrics">{rows.length ?
      rows.map((line,i)=><p key={i} ref={i===index?current:undefined} aria-current={i===index?'true':undefined}>{line.text}{showTranslation && line.translation && <small className="lyric-translation">{line.translation}</small>}</p>) :
      plain || message}</div>}
  </>;
}
