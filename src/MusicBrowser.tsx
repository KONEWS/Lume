import '../mobile/player-assets/player/scan-rules.js';
import '../mobile/player-assets/player/scan-meter.js';
import '../mobile/player-assets/player/scan-meter.css';
import '../mobile/player-assets/player/scan-rules.css';
import '../mobile/player-assets/player/quality-labels.js';
import '../mobile/player-assets/player/library-report.js';
import '../mobile/player-assets/player/library-report.css';
import './listening';
import '../mobile/player-assets/player/statistics-data.js';
import '../mobile/player-assets/player/statistics.js';
import '../mobile/player-assets/player/statistics.css';
import type { ListeningData } from './listening';
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Radio, Album, ChartNoAxesCombined, ChevronLeft, ChevronRight, Disc3, Folder, ScanLine, Info, Library, ListMusic, UsersRound, Play, Plus, Settings, Star } from 'lucide-react';
import type { Playlist, RoomAction, Track, ScanFailure } from './types';

export const sections = [
  { id: 'library', label: '歌曲', icon: Disc3 },
  { id: 'albums', label: '专辑', icon: Album },
  { id: 'artists', label: '艺术家', icon: UsersRound },
  { id: 'folders', label: '文件夹', icon: Folder },
  { id: 'playlists', label: '歌单', icon: ListMusic },
  { id: 'transfer', label: '歌曲传送', icon: Radio },
  { id: 'scan', label: '扫描音乐', icon: ScanLine },
  { id: 'sources', label: '音乐库', icon: Library },
  { id: 'stats', label: '统计', icon: ChartNoAxesCombined },
  { id: 'settings', label: '设置', icon: Settings },
  { id: 'about', label: '关于', icon: Info },
] as const;
export type Section = typeof sections[number]['id'];
type GroupPage = 'albums' | 'artists' | 'folders';
export function groupTitle(t: Track, page: GroupPage) {
  if (page === 'artists') return t.artist || '未知艺术家';
  if (page === 'albums') return t.album || '未知专辑';
  return t.folder || ({ phone:'手机曲库', import:'未提供文件夹' })[t.source];
}
function PlaylistForm({ list, tracks, save, cancel }: {
  list?: Playlist; tracks: Track[]; save: (name: string, ids: string[]) => void; cancel: () => void;
}) {
  const [name,setName]=useState(list?.name || '');
  const [ids,setIds]=useState(new Set(list?.trackIds));
  return <form className="collection-form glass" onSubmit={e=>{e.preventDefault();if(name.trim())save(name.trim(),[...ids]);}}>
    <h2>{list?'编辑歌单':'新建歌单'}</h2>
    <label>歌单名称<input autoFocus required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label>
    <div className="collection-choices">{tracks.map(t=><label key={t.id}><input type="checkbox" checked={ids.has(t.id)} onChange={e=>{const next=new Set(ids);if(e.target.checked)next.add(t.id);else next.delete(t.id);setIds(next);}}/>{t.title}<small>{t.artist}</small></label>)}</div>
    <button className="button button-primary" disabled={!name.trim()}>保存</button><button type="button" className="button button-secondary" onClick={cancel}>取消</button>
  </form>;
}
function Report({tracks,stats=false,listening}:{tracks:Track[];stats?:boolean;listening?:ListeningData}){
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let report=container.current?.firstElementChild as (HTMLElement & {songs:Track[];listening?:ListeningData})|null;
    const tag=stats?'lume-play-stats':'lume-library-report';
    if(!report||report.localName!==tag){report=document.createElement(tag) as typeof report & HTMLElement;container.current?.replaceChildren(report);}
    report.listening=listening;report.songs=tracks;
  },[tracks,stats,listening]);
  return <div ref={container}/>;
}
function ScanRules({busy,pick}:{busy:boolean;pick:()=>void}){
  const ref=useRef<HTMLDivElement>(null);
  const onPick=useRef(pick);
  onPick.current=pick;
  useEffect(()=>{
    const node=document.createElement('lume-scan-rules');
    const choose=()=>onPick.current();
    node.addEventListener('pick-block',choose);ref.current?.replaceChildren(node);
    return ()=>{node.removeEventListener('pick-block',choose);node.remove();};
  },[]);
  useEffect(()=>{ref.current?.firstElementChild?.toggleAttribute('disabled',busy);},[busy]);
  return <div ref={ref}/>;
}
export function MusicBrowser({ page, tracks, playlists, listening, listTracks, play, run, scan, stopScan, changeRoot, pickBlock, busy, status, failures, meter, version, sources, openSongs, openFavorites }: {
  page: Section; tracks: Track[]; playlists: Playlist[]; listening:ListeningData; listTracks: (songs: Track[])=>ReactNode;
  play: (songs: Track[])=>void; run: (action: RoomAction)=>void; scan: ()=>void; stopScan:()=>void; changeRoot?:()=>void; pickBlock:()=>void; busy: boolean;
  status: string; failures: ScanFailure[]; meter: {done:number;total:number;found:number}; version?: string; sources: ReactNode; openSongs: ()=>void; openFavorites: ()=>void;
}) {
  const [detail,setDetail]=useState<string|null>(null);
  const [editing,setEditing]=useState(false);
  const section=sections.find(s=>s.id===page)!;
  let title: string=section.label, content: ReactNode;
  const back=()=>{setDetail(null);setEditing(false);};
  const collection=(songs: Track[])=><><div className="collection-tools"><button className="button button-primary" disabled={!songs.length} onClick={()=>play(songs)}><Play size={15}/>播放全部</button><span>{songs.length} 首</span></div>{songs.length?listTracks(songs):<p className="collection-note">暂无歌曲</p>}</>;
  const row=(name:string,count:number,go:()=>void,icon:ReactNode)=><button key={name} className="browse-row" onClick={go}>{icon}<strong>{name}</strong><span>{count} 首</span><ChevronRight size={16}/></button>;
  if(page==='albums'||page==='artists'||page==='folders'){
    const groups=new Map<string,Track[]>();
    for(const track of tracks){const key=groupTitle(track,page);if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(track);}
    if(detail!==null){title=detail;content=collection(groups.get(detail)||[]);}
    else content=groups.size?[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,songs])=>row(key,songs.length,()=>setDetail(key),<section.icon size={21}/>)):<p>导入音乐后即可在这里浏览。</p>;
  }else if(page==='playlists'){
    const list=playlists.find(p=>p.id===detail);
    if(editing)content=<PlaylistForm list={list} tracks={tracks} save={(name,ids)=>{run({type:'playlist-save',playlistId:list?.id,value:name,trackIds:ids});setEditing(false);}} cancel={()=>setEditing(false)}/>;
    else if(list){title=list.name;content=<><button className="text-button" onClick={()=>setEditing(true)}>编辑歌单</button>{collection(list.trackIds.map(id=>tracks.find(t=>t.id===id)).filter((t):t is Track=>!!t))}</>;}
    else content=<><button className="button button-primary" onClick={()=>setEditing(true)}><Plus size={16}/>新建歌单</button>{row('我的收藏',tracks.filter(t=>t.favorite).length,openFavorites,<Star size={20}/>)}{playlists.map(p=><button className="browse-row" key={p.id} onClick={()=>setDetail(p.id)}><ListMusic size={20}/><strong>{p.name}</strong><span>{p.trackIds.length} 首</span><ChevronRight size={16}/></button>)}</>;
  }else if(page==='sources')content=<><Report tracks={tracks}/>{row('主机曲库',tracks.length,openSongs,<Library size={21}/>)}{sources}</>;
  else if(page==='stats')content=<Report tracks={tracks} stats listening={listening}/>;
  else if(page==='scan')content=<><p className="collection-note">选择音乐文件夹，扫描其中及子文件夹内的音频。再次扫描会沿用上次目录，仅处理变化的文件。</p><div className="scan-actions"><button className="button button-primary" disabled={busy} onClick={scan}><ScanLine size={17}/>开始扫描</button><button className="button" disabled={!busy} onClick={stopScan}>终止扫描</button>{changeRoot&&<button className="button" disabled={busy} onClick={changeRoot}>更换扫描目录</button>}</div>{busy&&createElement('lume-scan-meter',{'data-total':meter.total,'data-done':meter.done,'data-found':meter.found})}<p className="scan-result" role="status">{busy?(status.startsWith('正在导入 · ')?status.slice(7):''):status}</p>
    {!busy&&failures.length>0&&<details className="scan-failures">
      <summary>查看失败项（{failures.length}）</summary>
      <ol>{failures.map((item,i)=><li key={i}><strong>{item.name}</strong><span>{item.stage} · {item.reason}</span></li>)}</ol>
    </details>}
    <ScanRules busy={busy} pick={pickBlock}/></>;
  else if(page==='about')content=<><img src="/lume.png" width="38" height="38" alt=""/><h2>澄音 LUME</h2><p className="collection-note">局域网音乐播放器 · v{version}</p><p>在本机听歌，也可以让同一 Wi-Fi 下的设备一起播放。</p></>;
  return <section className="collection-page page-enter">{(detail!==null||editing)&&<button className="text-button" onClick={back}><ChevronLeft size={16}/>返回{section.label}</button>}<h1>{title}</h1>{content}</section>;
}
