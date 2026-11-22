import { useState } from 'react';
import { Play, Smartphone } from 'lucide-react';
import type { PhoneLibrary } from './types';

export function PhoneLibraries({libraries,query,choose}:{libraries:PhoneLibrary[];query:string;choose:(id:string,song:string)=>void}){
  const [selected,setSelected]=useState('');
  const active=libraries.find(s=>s.id===selected)??libraries[0];
  if(!active)return null;
  const songs=active.songs.filter(t=>t.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="phone-libraries glass"><div><h2><Smartphone size={19}/>手机媒体库</h2>
    <select aria-label="选择音源手机" value={active.id} onChange={e=>setSelected(e.target.value)}>
      {libraries.map(s=><option key={s.id} value={s.id}>{s.name} · {s.songs.length} 首</option>)}</select></div>
    <ul>{songs.map(song=><li key={song.id}><button onClick={()=>choose(active.id,song.id)} aria-label={'从'+active.name+'播放 '+song.title}>
      <Play size={16}/><span>{song.title}</span></button></li>)}</ul>
    {!songs.length&&<p>{query?'没有匹配的手机歌曲':'可在这部手机的曲库中导入音乐。'}</p>}</section>;
}

