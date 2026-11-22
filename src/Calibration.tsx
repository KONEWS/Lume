import {useEffect,useState} from 'react';
import type {Device} from './types';

export function DelayControl({device,change}:{device:Device;change:(ms:number)=>void}){
  const [value,setValue]=useState(device.delayMs??0);
  const [dragging,drag]=useState(false);
  useEffect(()=>{if(!dragging)setValue(device.delayMs??0);},[device.delayMs,dragging]);
  const apply=(ms:number)=>{const v=Math.min(1000,Math.max(-1000,ms));setValue(v);change(v);};
  return <div className="delay-control"><label>输出延迟 <output>{value>0?'+':''}{value} ms</output>
    <input type="range" min="-1000" max="1000" step="1" value={value} onPointerDown={()=>drag(true)}
      onPointerUp={()=>drag(false)} onPointerCancel={()=>drag(false)} onChange={e=>apply(Number(e.target.value))}/></label>
    <div>{[-10,-1,1,10].map(n=><button key={n} onClick={()=>apply(value+n)}>{n>0?'+':''}{n} ms</button>)}<button onClick={()=>apply(0)}>归零</button></div></div>;
}

