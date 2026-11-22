import { useEffect, useRef, useState } from 'react';
export interface Skin {name:string; background:string; surface:string; ink:string; accent:string}
const dusk:Skin={name:'暮色',background:'#142625',surface:'#34483F',ink:'#F1EFE7',accent:'#DFC49A'};
export function useSkin(skin?:Skin){
  useEffect(()=>{
    const root=document.documentElement;
    if(!skin){delete root.dataset.customSkin;return;}
    root.dataset.customSkin='on';
    for(const key of ['background','surface','ink','accent'] as const)root.style.setProperty('--skin-'+key,skin[key]);
    return ()=>{
      delete root.dataset.customSkin;
      for(const key of ['background','surface','ink','accent'])root.style.removeProperty('--skin-'+key);
    };
  },[skin?.name,skin?.background,skin?.surface,skin?.ink,skin?.accent]);
}
export function RoomSkin({skin,change}:{skin?:Skin;change:(value:string)=>void}){
  const file=useRef<HTMLInputElement>(null);
  const [error,setError]=useState('');
  return <div className="setting-row"><div><h3>空间皮肤 · {skin?.name??'蓝夜'}</h3><p>已连接的手机也会采用此配色。</p>{error&&<p role="alert">{error}</p>}</div>
    <div className="skin-options">
      <button onClick={()=>change('')}>蓝夜</button><button onClick={()=>change(JSON.stringify(dusk))}>暮色</button>
      <button onClick={()=>file.current?.click()}>导入皮肤</button>
      <input hidden ref={file} type="file" accept=".json" onChange={async e=>{
        const selected=e.target.files?.[0];e.target.value='';if(!selected)return;
        try{if(selected.size>4096)throw Error();const input=JSON.parse(await selected.text());
          if(typeof input?.name!=='string'||!input.name.trim()||!['background','surface','ink','accent'].every(k=>/^#[0-9a-f]{6}$/i.test(input[k])))throw Error();
          setError('');change(JSON.stringify(input));
        }catch{setError('需要包含名称和四个六位颜色值的皮肤 JSON。');}
      }}/>
    </div></div>;
}
