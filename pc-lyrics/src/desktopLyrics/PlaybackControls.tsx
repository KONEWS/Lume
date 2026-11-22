import { useEffect, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, LoaderCircle, Shuffle, ListOrdered, Repeat, Repeat1 } from 'lucide-react';
import { listen, send, type Session } from './bridge';
import type { MediaControls } from './useMediaControls';

// src/desktopLyrics/PlaybackControls.tsx
export default function PlaybackControls({ session, controls }: { session: Session; controls: MediaControls }) {
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  useEffect(() => listen(message => { if (message.type === 'playbackMode') { setShuffle(message.data.shuffle); setRepeat(message.data.repeat ?? 'off'); } }), []);
  const modeLabel = repeat === 'one' ? '单曲循环' : repeat === 'all' ? '列表循环' : shuffle ? '随机播放' : '顺序播放';
  const { connected, pending, feedback, caps, canPlayPause, control } = controls;
  const unavailable = !connected || pending;
  const playLabel = session.playing ? '暂停音乐' : '继续播放音乐';
  const title = (enabled: boolean, label: string) => !connected ? '请先连接音乐播放器'
    : pending ? '正在等待播放器响应' : enabled ? `${label} · ${session.source}` : '当前播放器未开放这项控制';
  return <div className="playback-controls" role="group" aria-label="澄音播放控制" aria-busy={pending}>
    <div className="transport-buttons">
      <button className={shuffle || repeat !== 'off' ? 'selected' : ''} aria-label={`${modeLabel}，切换为${shuffle ? '顺序' : '随机'}播放`} title={modeLabel} aria-pressed={shuffle || repeat !== 'off'} onClick={() => send('shuffle', !shuffle)}>{repeat === 'one' ? <Repeat1 size={17}/> : repeat === 'all' ? <Repeat size={17}/> : shuffle ? <Shuffle size={17}/> : <ListOrdered size={17}/>}</button>
      <button aria-label="上一首" title={title(Boolean(caps?.previous), '上一首')} disabled={unavailable || !caps?.previous} onClick={() => control('previous')}><SkipBack size={17}/></button>
      <button className="transport-primary" aria-label={playLabel} title={title(canPlayPause, playLabel)} disabled={unavailable || !canPlayPause} onClick={() => control(session.playing ? 'pause' : 'play')}>
        {pending ? <LoaderCircle size={20} className="transport-spinner"/> : session.playing ? <Pause size={20}/> : <Play size={20}/>}</button>
      <button aria-label="下一首" title={title(Boolean(caps?.next), '下一首')} disabled={unavailable || !caps?.next} onClick={() => control('next')}><SkipForward size={17}/></button>
    </div>
    {feedback?.error ? <span className="transport-caption error" role="alert" title={feedback.text}>{feedback.text}</span> : null}
  </div>;
}
