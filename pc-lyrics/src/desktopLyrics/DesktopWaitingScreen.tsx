import { AudioLines, ArrowLeft, LoaderCircle } from 'lucide-react';
import { send, type OnlineState, type Preferences, type Session } from './bridge';
import './waiting-screen.css';
import type { DesktopSettingsTarget } from '../types/desktopSettings';
type Props = { session: Session; online: OnlineState; preferences: Preferences; connectionError: string;
  lyricStatus: 'idle' | 'parsing' | 'ready' | 'invalid'; title: string; scanning: boolean;
  onSettings: (target?: DesktopSettingsTarget) => void };
export default function DesktopWaitingScreen(p: Props) {
  const parsing = p.lyricStatus === 'parsing';
  return <section className="waiting-screen" aria-label="歌词状态">
    <div className="waiting-symbol" aria-hidden="true">{parsing ? <LoaderCircle className="online-spinner" size={36}/> : <AudioLines size={40} strokeWidth={1}/>}</div>
    <div className="eyebrow">LUME LYRICS</div>
    <h1>{parsing ? '正在读取歌词' : p.session.key ? '暂无歌词' : '等待音乐'}</h1>
    <p className="waiting-description">{p.connectionError || (p.session.key ? '歌词会随澄音中的歌曲播放。' : '从澄音曲库选择一首歌即可开始。')}</p>
    {p.title ? <p className="waiting-track" title={p.title}>{p.title}</p> : null}
    <div className="waiting-actions"><button className="primary-button" onClick={() => send('closeLyrics')}><ArrowLeft size={16}/>返回澄音</button></div>
  </section>;
}

