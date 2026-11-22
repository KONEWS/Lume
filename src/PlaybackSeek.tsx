import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { bindRangeDrag, paintRangeValue } from './appearance/drag-range.js';

export function PlaybackSeek({ position, duration, seek, preview }: { position: number; duration: number; seek: (seconds: number) => void; preview?: (seconds:number)=>void }) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({position,duration,seek,preview});
  latest.current = {position,duration,seek,preview};
  const pending = useRef<number|null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const paint = (value:number) => {
    const displayed=input.current?paintRangeValue(input.current,value):value;
    latest.current.preview?.(displayed);
  };
  const resumeClock = () => {
    clearTimeout(releaseTimer.current);pending.current=null;
    if(input.current)delete input.current.dataset.pendingSeek;
    paint(Math.max(0,Math.min(latest.current.position,latest.current.duration)));
  };
  const commit = (value:number) => {
    clearTimeout(releaseTimer.current);pending.current=value;
    if(input.current)input.current.dataset.pendingSeek='';
    paint(value);
    // Keep the release point visible while the server acknowledges the seek.
    releaseTimer.current=setTimeout(resumeClock,1500);
    latest.current.seek(value);
  };
  useEffect(() => {
    if (!input.current) return;
    const stop=bindRangeDrag(input.current,value=>{
      clearTimeout(releaseTimer.current);pending.current=null;
      if(input.current)delete input.current.dataset.pendingSeek;
      latest.current.preview?.(value);
    },commit,resumeClock);
    return ()=>{stop();clearTimeout(releaseTimer.current);};
  }, []);
  useLayoutEffect(()=>{
    if(input.current?.hasAttribute('data-tracking'))return;
    if(pending.current!==null && Math.abs(position-pending.current)>.75 && pending.current<=duration)return;
    resumeClock();
  },[position,duration]);
  return <label className="liquid-range">
    <input ref={input} data-thumb-width="14" type="range" aria-label="播放进度" min={0} max={duration || 1} step={0.1} defaultValue={position} disabled={!duration}
      onChange={e => { if (!e.currentTarget.hasAttribute('data-tracking')) commit(e.currentTarget.valueAsNumber); }} />
    <i aria-hidden="true" />
  </label>;
}

export interface PlaybackClock {
  getSnapshot:()=>number;
  subscribe:(listener:()=>void)=>(()=>void);
}
export function PlaybackProgress({clock,duration,seek,format}:{clock:PlaybackClock;duration:number;seek:(n:number)=>void;format:(n:number)=>string}){
  const position=useSyncExternalStore(clock.subscribe,clock.getSnapshot);
  const currentTime=useRef<HTMLSpanElement>(null);
  return <div className="playback-progress"><span ref={currentTime}/><PlaybackSeek position={position} duration={duration} seek={seek} preview={value=>{if(currentTime.current)currentTime.current.textContent=format(value);}}/><span>{format(duration)}</span></div>;
}
