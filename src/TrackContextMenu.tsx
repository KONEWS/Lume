import {useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import {ChevronRight,Heart,ListMusic,ListPlus,Send,Trash2} from 'lucide-react';
import type {Playlist,RoomAction,Track} from './types';
import './track-context-menu.css';

export interface TrackAnchor {id:string;x:number;y:number;element:HTMLElement}
interface Peer {id:string;name:string;trusted:boolean;synced:boolean}
type Branch='lists'|'peers';
async function personal(body:object){
  const res=await fetch('/api/personal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await res.json();if(!res.ok||result.error)throw Error(result.error||'设备请求失败');return result;
}
export function TrackContextMenu({anchor,track,lists,action,close,notify,joined}:{
  anchor:TrackAnchor;track:Track;lists:Playlist[];action:(command:RoomAction)=>Promise<unknown>;
  close:()=>void;notify:(message:string)=>void;joined:boolean;
}){
  const root=useRef<HTMLDivElement>(null);
  const flyout=useRef<HTMLDivElement>(null);
  const [branch,setBranch]=useState<Branch|null>(null);
  const [peers,setPeers]=useState<Peer[]>([]),[peerStatus,setPeerStatus]=useState('正在查找设备…');
  const [top,setTop]=useState(0);
  const x=Math.max(4,Math.min(anchor.x,window.innerWidth-212));
  const y=Math.max(4,Math.min(anchor.y,window.innerHeight-208));
  useLayoutEffect(()=>{root.current?.querySelector<HTMLButtonElement>('button:enabled')?.focus({preventScroll:true});},[anchor]);
  useEffect(()=>{
    const dismiss=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))close();};
    window.addEventListener('pointerdown',dismiss,true);window.addEventListener('resize',close);window.addEventListener('blur',close);
    return ()=>{window.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('resize',close);window.removeEventListener('blur',close);};
  },[close]);
  useEffect(()=>{
    if(branch!=='peers')return;
    let active=true;
    personal({op:'status'}).then(data=>{
      if(active){setPeers((data.peers as Peer[]).filter(p=>p.trusted&&p.synced));setPeerStatus('暂无在线的已授权设备');}
    }).catch((e:Error)=>{if(active)setPeerStatus(e.message);});
    return ()=>{active=false;};
  },[branch]);
  function dismiss(){close();anchor.element.focus({preventScroll:true});}
  function perform(work:()=>Promise<unknown>,message:string){dismiss();void work().then(()=>notify(message)).catch((e:Error)=>notify(e.message));}
  const act=(type:string,message:string,extra:Partial<RoomAction>={})=>perform(()=>action({type,trackId:track.id,...extra}),message);
  function expand(value:Branch,target:HTMLElement){setTop(target.getBoundingClientRect().top);setBranch(value);}
  function keys(e:KeyboardEvent<HTMLDivElement>){
    const target=e.target as HTMLButtonElement;
    const inSub=flyout.current?.contains(target);
    const panel=inSub?flyout.current:root.current;
    const buttons=Array.from(panel?.querySelectorAll<HTMLButtonElement>(':scope > button:enabled')||[]);
    if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();dismiss();return;}
    if(e.key==='ArrowLeft'&&inSub){e.preventDefault();root.current?.querySelector<HTMLButtonElement>('[aria-expanded=true]')?.focus();setBranch(null);return;}
    if(e.key==='ArrowRight'&&target.dataset.branch){e.preventDefault();expand(target.dataset.branch as Branch,target);requestAnimationFrame(()=>flyout.current?.querySelector<HTMLButtonElement>('button:enabled')?.focus());return;}
    if(!buttons.length||!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
    e.preventDefault();const i=buttons.indexOf(target),n=buttons.length;
    buttons[e.key==='Home'?0:e.key==='End'?n-1:(i+(e.key==='ArrowUp'?-1:1)+n)%n].focus();
  }
  const branchButton=(key:Branch,label:string,Icon:typeof ListMusic,disabled:boolean)=><button role="menuitem" disabled={disabled} data-branch={key} aria-haspopup="menu" aria-expanded={branch===key}
    onMouseEnter={e=>expand(key,e.currentTarget)} onClick={e=>expand(key,e.currentTarget)}><Icon/>{label}<ChevronRight className="track-menu-arrow"/></button>;
  return <div ref={root} role="menu" aria-label={track.title+'的操作'} className="track-context" style={{left:x,top:y}} onKeyDown={keys} onContextMenu={e=>e.preventDefault()}>
    <button role="menuitem" disabled={joined} onMouseEnter={()=>setBranch(null)} onClick={()=>act('queue-next','已设为下一首播放')}><ListPlus/>下一首播放</button>
    <button role="menuitem" disabled={joined} onMouseEnter={()=>setBranch(null)} onClick={()=>act('favorite',track.favorite?'已取消喜欢':'已加入喜欢',{value:!track.favorite})}><Heart fill={track.favorite?'currentColor':'none'}/>{track.favorite?'取消喜欢':'喜欢'}</button>
    <hr/>
    {branchButton('lists','加入歌单',ListMusic,joined)}
    {branchButton('peers','发送到设备',Send,joined||track.source==='phone')}
    <hr/>
    <button role="menuitem" disabled={joined||track.source==='phone'} onMouseEnter={()=>setBranch(null)} onClick={()=>{
      if(window.confirm('从音乐库中移除《'+track.title+'》？磁盘文件和播放记录会保留。'))act('library-remove','已从音乐库中移除');else dismiss();
    }}><Trash2/>从音乐库中移除</button>
    {branch&&<div ref={flyout} className="track-context track-submenu" role="menu" aria-label={branch==='lists'?'加入歌单':'发送到设备'}
      style={{left:x+410<=window.innerWidth?x+203:Math.max(4,x-203),top:Math.max(4,Math.min(top,window.innerHeight-8-Math.min(250,14+36*Math.max(1,branch==='lists'?lists.length:peers.length))))}}>
      {branch==='lists'?(lists.length?lists.map(list=><button key={list.id} role="menuitem" disabled={list.trackIds.includes(track.id)} onClick={()=>act('playlist-add','已加入「'+list.name+'」',{playlistId:list.id})}>{list.name}</button>):<small>暂无歌单</small>):
      peers.length?peers.map(p=><button key={p.id} role="menuitem" onClick={()=>perform(()=>personal({op:'offer',id:track.id,peer:p.id}),'已发送请求，等待对方接收')}>{p.name}</button>):<small>{peerStatus}</small>}
    </div>}
  </div>;
}
