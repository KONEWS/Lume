import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { AudioLines, CalendarDays, ChevronRight, Disc3, Folder, ListMusic, Music2, Pause, Play, Plus, RefreshCw, Shuffle, UsersRound } from 'lucide-react';
import { groupTitle, type Section } from './MusicBrowser';
import type { PlaybackClock } from './PlaybackSeek';
import type { RoomState, Track } from './types';
import { parseSongLyrics } from '../shared/song-details.mjs';

const categories = [
  { id:'artists', label:'艺术家', icon:UsersRound },
  { id:'albums', label:'专辑', icon:Disc3 },
  { id:'library', label:'曲目', icon:Music2 },
  { id:'folders', label:'文件夹', icon:Folder },
] as const;
const fallbackArt = '/covers/1.svg';
function shuffled<T,>(items:T[]) {
  const result = items.slice();
  for (let i=result.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}

function Spectrum({analyser,playing}:{analyser:RefObject<AnalyserNode|null>;playing:boolean}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const el=canvas.current, ctx=el?.getContext('2d');
    if(!el||!ctx)return;
    let frame=0;
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const bins=new Uint8Array(128);
    function draw(){
      if(!el||!ctx)return;
      const width=el.clientWidth,height=el.clientHeight, scale=window.devicePixelRatio||1;
      if(el.width!==Math.round(width*scale)||el.height!==Math.round(height*scale)){
        el.width=Math.round(width*scale);el.height=Math.round(height*scale);
      }
      ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,width,height);
      const live=playing&&analyser.current&&!motion.matches;
      if(live)analyser.current!.getByteFrequencyData(bins);
      ctx.fillStyle=getComputedStyle(el).color;
      const count=Math.min(100,Math.max(1,Math.floor(width/6)));
      for(let i=0;i<count;i++){
        const level=live?bins[Math.floor(i*bins.length/count)]/255:0;
        const h=3+(i%5===0?4:0)+level*(height-8);
        ctx.fillRect(i*width/count,height-h,Math.max(2,width/count*.5),h);
      }
      if(live)frame=requestAnimationFrame(draw);
    }
    const redraw=()=>{cancelAnimationFrame(frame);draw();};
    const size=new ResizeObserver(redraw);size.observe(el);motion.addEventListener('change',redraw);
    draw();
    return ()=>{cancelAnimationFrame(frame);size.disconnect();motion.removeEventListener('change',redraw);};
  },[analyser,playing]);
  return <canvas className="dashboard-spectrum" ref={canvas} aria-hidden="true"/>;
}

function LyricExcerpt({id,clock,open}:{id:string;clock:PlaybackClock;open:()=>void}) {
  const [content,setContent]=useState('');
  const position=useSyncExternalStore(clock.subscribe,clock.getSnapshot);
  useEffect(()=>{
    const controller=new AbortController();
    const load=window.lumeDesktop?.readLyrics(id) ?? fetch('/api/lyrics/'+encodeURIComponent(id),{signal:controller.signal})
      .then(async r=>r.ok?(await r.json()).lyrics:'');
    load.then(text=>{if(!controller.signal.aborted)setContent(text);}).catch(()=>{});
    return ()=>controller.abort();
  },[id]);
  const {rows,plain}=useMemo(()=>parseSongLyrics(content),[content]);
  const next=rows.findIndex(row=>row.time>position);
  const excerpt=rows[next===-1?rows.length-1:Math.max(0,next-1)]?.text || plain.split('\n')[0];
  return <button className="lyric-excerpt" onClick={open} aria-label="查看歌词"><AudioLines size={16}/><span>{excerpt||'查看歌词'}</span><ChevronRight size={14}/></button>;
}

function dateKey(d:Date){
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function ListeningWeek({days,now}:{days:RoomState['listeningDays'];now:number}){
  const today=new Date(now), monday=new Date(today);
  monday.setHours(0,0,0,0);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
  const first=new Date(monday);first.setDate(first.getDate()-13*7);
  let starts=0, ms=0;
  const cells=Array.from({length:98},(_,i)=>{
    const date=new Date(first);date.setDate(first.getDate()+i);
    const key=dateKey(date), value=days?.[key];
    if(date>=monday&&value){starts+=value.starts;ms+=value.ms;}
    const count=value?.starts||0, minutes=Math.floor((value?.ms||0)/60000);
    return <i key={key} title={key+' · '+count+' 次 · '+minutes+' 分钟'} data-level={date>today?'future':Math.min(4, Math.ceil(Math.log2(1+Math.max(count,minutes/5))))}/>;
  });
  return <section className="dashboard-week"><h2>本周</h2>
    <div className="week-numbers"><div><strong>{starts}</strong> 次<small>本周播放</small></div><div><strong>{Math.floor(ms/60000)}</strong> 分钟<small>聆听时长</small></div></div>
    <div className="week-range"><CalendarDays size={13}/>{first.getMonth()+1} 月 — {today.getMonth()+1} 月</div>
    <div className="week-grid" aria-label="最近十四周的播放活动">{cells}</div>
  </section>;
}

function CoverShelf({tracks,play,empty}:{tracks:Track[];play:(t:Track)=>void;empty:string}){
  return tracks.length?<div className="cover-shelf">{tracks.map(track=><button key={track.id} className="shelf-item" onClick={()=>play(track)} title={track.title+' · '+track.artist}>
    <div><img src={track.artwork||fallbackArt} loading="lazy" alt=""/><span><Play size={15} fill="currentColor"/></span></div>
    <strong>{track.title}</strong><small>{track.artist||'未知艺术家'}</small>
  </button>)}</div>:<p className="shelf-empty">{empty}</p>;
}

export function PlaybackHome({state,currentTrack,clock,analyser,audioEnabled,play,toggle,queue,lyrics,importMusic,visit,playCollection}:{
  state:RoomState;currentTrack:Track|null;clock:PlaybackClock;analyser:RefObject<AnalyserNode|null>;audioEnabled:boolean;play:(t:Track)=>void;toggle:()=>void;
  queue:()=>void;lyrics:()=>void;importMusic:()=>void;visit:(page:Section)=>void;playCollection:(tracks:Track[])=>void;
}){
  const {tracks,playback}=state, featured=currentTrack??tracks[0];
  const [tab,setTab]=useState<'added'|'played'>('added');
  const [pickOffset,setPickOffset]=useState(0);
  const data=useMemo(()=>{
    const counts=categories.map(c=>c.id==='library'?tracks.length:new Set(tracks.map(t=>groupTitle(t,c.id as 'albums'|'artists'|'folders'))).size);
    const added=[...tracks].reverse().sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
    const played=tracks.filter(t=>t.lastPlayedAt).sort((a,b)=>b.lastPlayedAt!-a.lastPlayedAt!);
    const artistCounts=new Map<string,number>();
    for(const t of tracks)if(t.playCount)artistCounts.set(t.artist,(artistCounts.get(t.artist)||0)+t.playCount);
    const ranking=[...artistCounts].sort((a,b)=>b[1]-a[1]).slice(0,5);
    const suggestions=[...tracks].sort((a,b)=>Number(b.favorite)-Number(a.favorite)||(a.playCount||0)-(b.playCount||0)||a.id.localeCompare(b.id));
    return {counts,added,played,ranking,suggestions};
  },[tracks]);
  const picks=data.suggestions.filter(t=>t.id!==featured?.id);
  const recommendations=Array.from({length:Math.min(4,picks.length)},(_,i)=>picks[(pickOffset+i)%picks.length]);
  const facts=featured?[featured.format.toUpperCase(), featured.bitDepth&&featured.bitDepth+' bit',featured.sampleRate&&featured.sampleRate/1000+' kHz',featured.channels&&featured.channels+' ch'].filter(Boolean).join('  ·  '):'';
  return <div className="playback-home page-enter">
    <section className="dashboard-hero">
      <div className="dashboard-art">{featured?<img src={featured.artwork||fallbackArt} alt={featured.title+' 封面'}/>:<Disc3 size={64}/>}</div>
      <div className="dashboard-track"><h1>{featured?.title||'导入第一首歌'}</h1>
        <p className="dashboard-byline"><b>{featured?.artist}</b>{featured?.album&&' · '+featured.album}</p>
        <small className="dashboard-source">{featured?({demo:'来自内置试听',phone:'来自手机曲库',import:'来自本地曲库'})[featured.source]:'选择本地音频，或将文件拖入窗口。'}</small>
        <div className="dashboard-actions">
          <button className="dashboard-primary" onClick={()=>currentTrack?toggle():featured?play(featured):importMusic()}>{featured?playback.playing?<Pause size={16}/>:<Play size={16} fill="currentColor"/>:<Plus size={16}/>}{featured?playback.playing?'暂停播放':playback.position>0?'继续播放':'开始播放':'导入音乐'}</button>
          <button onClick={queue}><ListMusic size={17}/>查看队列</button>
          <button disabled={tracks.length<2} onClick={()=>playCollection(shuffled(tracks))}><Shuffle size={16}/>随机播放</button>
        </div>
        {facts&&<p className="dashboard-facts">{facts}</p>}
        {currentTrack&&<LyricExcerpt key={JSON.stringify([state.guestRoom?.url,currentTrack.id,currentTrack.detailKey])} id={currentTrack.id} clock={clock} open={lyrics}/>}
        <Spectrum analyser={analyser} playing={playback.playing&&audioEnabled}/>
      </div>
    </section>
    <div className="category-strip">{categories.map(({id,label,icon:Icon},i)=><button key={id} onClick={()=>visit(id)}><Icon size={28} strokeWidth={1.45}/><span><strong>{data.counts[i]}</strong><small>{label}</small></span></button>)}</div>
    <div className="dashboard-columns">
      <section><header className="shelf-heading"><h2>最近活动</h2><div className="activity-tabs">{(['played','added'] as const).map(key=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{key==='added'?'最近添加':'已播放'}</button>)}</div></header>
        <CoverShelf tracks={(tab==='added'?data.added:data.played).slice(0,4)} play={play} empty={tab==='played'?'播放一首歌后，会在这里留下记录。':'曲库中暂无歌曲。'}/></section>
      <ListeningWeek days={state.listeningDays} now={state.serverTime}/>
      <section><header className="shelf-heading"><h2>为你推荐</h2>{picks.length>1&&<button className="shelf-link" onClick={()=>setPickOffset(n=>n+Math.min(4,picks.length-1))}><RefreshCw size={14}/>换一组</button>}</header>
        <CoverShelf tracks={recommendations} play={play} empty="导入更多曲目后，在这里发现下一首。"/></section>
      <section><h2>艺人排行榜</h2>{data.ranking.length?<ol className="artist-rank">{data.ranking.map(([artist,count],i)=><li key={artist}><b>{String(i+1).padStart(2,'0')}</b><div><strong>{artist||'未知艺术家'}</strong><small>{count} 次播放</small><progress value={count} max={data.ranking[0][1]}/></div></li>)}</ol>:<p className="shelf-empty">听过的艺术家会按播放次数排列。</p>}</section>
    </div>
  </div>;
}
