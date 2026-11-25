import type { CSSProperties } from 'react';
import { Disc3, Heart, ListMusic, Pause, Play, Radio, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { IconButton } from './IconButton';
import { PlaybackProgress, type PlaybackClock } from './PlaybackSeek';
import type { Playback, RoomAction, Track } from './types';

interface PlayerBarProps {
  track: Track | null;
  playback: Playback;
  clock: PlaybackClock;
  volume: number;
  muted: boolean;
  joinedPhone: boolean;
  inert: boolean;
  canPlay: boolean;
  queueOpen: boolean;
  devicesActive: boolean;
  formatTime: (seconds: number) => string;
  run: (action: RoomAction) => void;
  toggle: () => void;
  shuffle: () => void;
  lyrics: () => void;
  devices: () => void;
  queue: () => void;
}

export function DesktopPlayerBar({
  track, playback, clock, volume, muted, joinedPhone, inert, canPlay, queueOpen,
  devicesActive, formatTime, run, toggle, shuffle, lyrics, devices, queue,
}: PlayerBarProps) {
  const { playing, repeat } = playback;
  return <footer inert={inert} className="player-bar glass listening-surface" aria-label="播放器">
    <div className="player-extras">
      <IconButton label="歌词" disabled={!track} onClick={lyrics}>词</IconButton>
      <div className="master-volume">
        <IconButton label={muted ? '取消静音' : joinedPhone ? '本机静音' : '全组静音'} active={muted}
          onClick={() => run({ type: 'muted', value: !muted })}>{muted || !volume ? <VolumeX size={19} /> : <Volume2 size={19} />}</IconButton>
        <input type="range" aria-label={joinedPhone ? '本机音量' : '全组音量'} min={0} max={1} step={0.01} value={volume}
          style={{ '--progress': volume * 100 + '%' } as CSSProperties} onChange={event => run({ type: 'volume', value: event.target.valueAsNumber })} />
      </div>
      <IconButton label="播放设备" active={devicesActive} onClick={devices}><Radio size={20} /></IconButton>
      <IconButton label="播放队列" active={queueOpen} onClick={queue}><ListMusic size={21} /></IconButton>
    </div>
    <div className="dock-playback">
      <div className="player-track">
        <button className="open-track-lyrics" aria-label="打开当前曲目歌词" disabled={!track} onClick={lyrics} />
        {track?.artwork ? <img src={track.artwork} alt="" /> : <span className="dock-cover-empty"><Disc3 /></span>}
        <div><strong title={track?.title}>{track?.title || '尚未选曲'}</strong><span>{track?.artist}</span></div>
        <IconButton label={track?.favorite ? '取消收藏当前歌曲' : '收藏当前歌曲'} active={track?.favorite}
          disabled={!track} onClick={() => track && run({ type: 'favorite', trackId: track.id })}>
          <Heart size={17} fill={track?.favorite ? 'currentColor' : 'none'} />
        </IconButton>
      </div>
      <div className="player-center">
        <div className="transport-controls">
          <IconButton label={playback.shuffle ? '随机播放 · 切换顺序播放' : '顺序播放 · 切换随机播放'}
            active={playback.shuffle} className="secondary-transport" onClick={shuffle}><Shuffle size={17} /></IconButton>
          <IconButton label="上一首" disabled={!canPlay} onClick={() => run({ type: 'previous' })}><SkipBack size={19} fill="currentColor" /></IconButton>
          <button className={playing ? 'play-button playing' : 'play-button'} aria-label={playing ? '暂停' : '播放'} disabled={!canPlay} onClick={toggle}>
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <IconButton label="下一首" disabled={!canPlay} onClick={() => run({ type: 'next' })}><SkipForward size={19} fill="currentColor" /></IconButton>
          <IconButton label={repeat === 'off' ? '开启列表循环' : repeat === 'all' ? '切换单曲循环' : '关闭循环'}
            active={repeat !== 'off'} disabled={joinedPhone} className="secondary-transport"
            onClick={() => run({ type: 'repeat', value: repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off' })}>
            {repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </IconButton>
        </div>
        <PlaybackProgress clock={clock} duration={track?.duration ?? 0} format={formatTime} seek={position => run({ type: 'seek', position })} />
      </div>
    </div>
  </footer>;
}
