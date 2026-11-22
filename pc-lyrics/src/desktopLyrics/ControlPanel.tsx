import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useMotionValueEvent, type MotionValue } from 'framer-motion';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';
import type { VisualizerMode } from '../types';
import { send, type LibrarySummary, type Preferences, type Session, type OnlineState } from './bridge';
import { timeLabel, type ManualClock } from './clock';
import { MODES } from './desktopModes';
import { useDesktopSettingsDismiss } from './useDesktopSettingsDismiss';
import type { DesktopSettingsRequest } from '../types/desktopSettings';
import { useDesktopSettingsNavigation } from './useDesktopSettingsNavigation';
import DesktopSettingsSearch from './DesktopSettingsSearch';
import type { DesktopSettingsSearchEntry, DesktopSettingsSearchRequest } from '../types/desktopSettingsSearch';
import { useDesktopSettingsSearchNavigation } from './useDesktopSettingsSearchNavigation';
import DesktopSettingsTransparency from './DesktopSettingsTransparency';
export { MODES };
export function ClockReadout({ time, duration }: { time: MotionValue<number>; duration: number }) {
  const label = useRef<HTMLSpanElement>(null), previous = useRef(-1);
  useMotionValueEvent(time, 'change', value => { if (label.current && Math.floor(value) !== previous.current) { previous.current = Math.floor(value); label.current.textContent = timeLabel(value); } });
  return <div className="clock-readout"><span ref={label}>{timeLabel(time.get())}</span><span> / {duration > 0 ? timeLabel(duration) : '—:—'}</span></div>;
}
type Props = { mode: VisualizerMode; onMode: (mode: VisualizerMode) => void; session: Session; preferences: Preferences;
  library: LibrarySummary; online: OnlineState; scan: { active: boolean; text: string }; offset: number; onOffset: (value: number) => void;
  translated: boolean; onTranslated: (value: boolean) => void; immersiveProgress: boolean; onImmersiveProgress: (value: boolean) => void; manual: ManualClock; setManual: Dispatch<SetStateAction<ManualClock>>; audioStatus: string; onClose: () => void;
  navigation?: DesktopSettingsRequest; returnFocus?: HTMLElement | null; lyricSource?: string; onVisualSettings?: () => void;
  canSegment?: boolean; onSegmentation?: () => void; searchNavigation?: DesktopSettingsSearchRequest; onSearchNavigate: (entry: DesktopSettingsSearchEntry) => void };
export default function ControlPanel(p: Props) {
  const panelRef = useRef<HTMLElement>(null), scrollRef = useRef<HTMLDivElement>(null);
  useDesktopSettingsDismiss(panelRef, p.onClose);
  useDesktopSettingsNavigation(scrollRef, p.navigation);
  const searchHint = useDesktopSettingsSearchNavigation(scrollRef, p.searchNavigation);
  useEffect(() => {
    const opener = p.returnFocus ?? document.querySelector<HTMLElement>('[data-settings-trigger]');
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [p.returnFocus]);
  return <aside ref={panelRef} className="control-panel desktop-main-settings" aria-label="歌词设置">
    <button className="lume-panel-close icon-button" aria-label="关闭歌词设置" onClick={p.onClose}><X size={18}/></button>
    <DesktopSettingsSearch onNavigate={p.onSearchNavigate}/>
    {searchHint ? <p className="desktop-settings-search-hint" role="status">{searchHint}</p> : null}
    <div ref={scrollRef} className="desktop-settings-scroll">
      <section data-settings-section="sync"><div className="section-label">歌词同步</div>
        {p.lyricSource ? <p className="hint current-lyric-source">歌词来源：{p.lyricSource}</p> : null}
        <div className="offset-row">
          <button aria-label="歌词延后 0.2 秒" onClick={() => p.onOffset(p.offset - .2)}><Minus size={16}/></button>
          <span>{p.offset === 0 ? '时间无偏移' : `${p.offset > 0 ? '提前' : '延后'} ${Math.abs(p.offset).toFixed(1)} 秒`}</span>
          <button aria-label="歌词提前 0.2 秒" onClick={() => p.onOffset(p.offset + .2)}><Plus size={16}/></button>
          <button aria-label="重置歌词偏移" onClick={() => p.onOffset(0)}><RotateCcw size={14}/></button>
        </div>
        <label className="toggle"><span>显示译文</span><input type="checkbox" checked={p.translated} onChange={e => p.onTranslated(e.target.checked)}/></label>
        {p.onSegmentation ? <button type="button" className="wide-button settings-segmentation-entry" data-settings-target="segmentation" disabled={!p.canSegment} onClick={p.onSegmentation}>本曲分词</button> : null}
      </section>
      {p.onVisualSettings ? <button className="wide-button settings-visual-entry" onClick={p.onVisualSettings}>歌词样式更多设置</button> : null}
      <section data-settings-section="immersion"><div className="section-label">主题与全屏</div>
        <label className="toggle"><span>主题跟随歌曲封面</span><input type="checkbox" checked={p.preferences.coverTheme} onChange={e => send('coverTheme', e.target.checked)}/></label>
        <DesktopSettingsTransparency/>
        <p className="hint">普通窗口保持控件常驻。进入全屏后，空闲 5 秒隐藏控件；移动鼠标或按键即可唤醒，Esc 退出全屏。</p>
      </section>
      <section data-settings-section="window-sound"><div className="section-label">窗口与声音</div>
        <label className="toggle"><span>全屏沉浸时显示进度条</span><input type="checkbox" checked={p.immersiveProgress} onChange={e => p.onImmersiveProgress(e.target.checked)}/></label>
        <label className="toggle"><span>窗口置顶</span><input type="checkbox" checked={p.preferences.topmost} onChange={e => send('topmost', e.target.checked)}/></label>
        <label className="toggle" data-settings-target="audio"><span>跟随澄音播放声音</span><input type="checkbox" checked={p.preferences.audioReactive} onChange={e => send('audioReactive', e.target.checked)}/></label>
        <p className="hint audio-status">{p.audioStatus}</p>
      </section>
      <footer className="panel-footer">澄音 LUME · PC 歌词页<br/>基于 Folia Desktop Lyrics 0.5.7 · AGPL-3.0<br/><a href="source.zip" download>下载对应源码与许可</a><br/>HarmonyOS Sans · © 2021 Huawei Device Co., Ltd.</footer>
    </div>
  </aside>;
}

