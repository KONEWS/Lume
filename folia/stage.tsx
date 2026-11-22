import React from 'react';
import 'pixi.js/unsafe-eval';
import './src/i18n/config';
import {createRoot} from 'react-dom/client';
import {motionValue} from 'framer-motion';
import {DESKTOP_DEFAULT_THEME as theme} from './src/desktopLyrics/desktopTheme';
import VisualizerRenderer from './src/components/visualizer/VisualizerRenderer';
import {useDesktopVisualSettings} from './src/desktopLyrics/useDesktopVisualSettings';
import {restoreUploadedLyricsFont} from './src/services/customLyricsFont';
import {useVisualizerSettingsStore} from './src/stores/useVisualizerSettingsStore';
import {resolveDesktopRandomMode} from './src/desktopLyrics/visualFeatures/desktopRandomMode';
import {StyleStudio} from './StyleStudio';
const currentTime = motionValue(0);
const silent = motionValue(0);
const audioBands = {bass:silent, lowMid:silent, mid:silent, vocal:silent, treble:silent,spectrum:motionValue(new Uint8Array(64))};
const root = createRoot(document.getElementById('stage')!, {onUncaughtError:error=>{console.error('Folia', error);window.foliaFailed?.();}});
let track, lines = [], mode, playing, index = -1;
let anchor = 0, stamp = 0, frame = 0;

function makeLines(rows, duration) {
  return rows.map(({time, text, words, translation}, i) => {
    const end = Math.max(time + 0.01, rows[i + 1]?.time ?? (duration || time + 4));
    if (words?.length) {
      return {startTime:time,endTime:end,fullText:text,translation,words:words.map((word,j)=>({
        text:word.text,startTime:word.startTime,endTime:Math.max(word.startTime,word.endTime ?? words[j+1]?.startTime ?? end)
      }))};
    }
    // LRC records line starts. Subdivide a line for the visual effects only.
    const units = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+\s*|\s+/gu) || [];
    return {startTime:time, endTime:end, fullText:text, translation, words:units.map((word, j) => ({
      text:word, startTime:time + (end-time)*j/units.length, endTime:time + (end-time)*(j+1)/units.length
    }))};
  });
}

const androidViewport = document.documentElement.dataset.platform === 'Android';
const noop=()=>{};
function Stage({track, mode, lines, index, playing, scale}) {
  const model=useDesktopVisualSettings({baseTheme:theme,cover:track.cover || '',transparent:false,translated:track.translated,onTranslated:noop});
  const font=model.typography.lyricsCustomFont;
  React.useEffect(()=>{if(font?.source==='uploaded') void restoreUploadedLyricsFont(font.fontId).catch(()=>{});},[font]);
  const look=model.rendererProps;
  const tunings=React.useMemo(()=>scale===1?look.visualizerTunings:{...look.visualizerTunings,
    monet:{...look.visualizerTunings.monet,fontScale:look.visualizerTunings.monet.fontScale*scale}},[look.visualizerTunings,scale]);
  return <VisualizerRenderer mode={mode} lines={lines} duration={track.duration} currentTime={currentTime} currentLineIndex={index}
    theme={model.mergedTheme} audioPower={silent} audioBands={audioBands} songTitle={track.title} songArtist={track.artist}
    seed={track.id} paused={!playing} isPlayerChromeHidden {...look} visualizerTunings={tunings}
    lyricsFontScale={look.lyricsFontScale*scale} subtitleFontScale={look.subtitleFontScale*scale}
    staticMode={look.staticMode || matchMedia('(prefers-reduced-motion: reduce)').matches}/>;
}
let studio=null, previousId=null, previousMode=null;
const signals={currentTime,audioPower:silent,audioBands};
function paint() {
  if(studio){
    root.render(<StyleStudio {...studio} signals={signals} content={{lines,duration:track?.duration||0,songTitle:track?.title||'',coverUrl:track?.cover,currentLineIndex:index,seed:track?.id||''}}/>);
    return;
  }
  const scale=androidViewport ? Math.max(.73,Math.min(1,window.innerHeight/470)) : 1;
  root.render(<Stage {...{track,mode,lines,index,playing,scale}}/>);
}
window.foliaStudio = (mode,translated,onMode,onTranslation,close,mobileLayout) => {
  useVisualizerSettingsStore.getState().handleSetVisualizerMode(mode,{notify:false,preserveRandom:true});
  studio={initialMode:mode,translated,onMode,onTranslation,close,mobileLayout};
  paint();
};
function advance() {
  const pos = Math.min(track.duration || Infinity, anchor + (playing ? (performance.now()-stamp)/1000 : 0));
  currentTime.set(pos);
  let lo = 0, hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].startTime <= pos) lo = mid + 1;
    else hi = mid;
  }
  const next = lo - 1;
  if (next !== index) {index = next; return true;}
  return false;
}
function tick() {
  if (advance()) paint();
  frame = requestAnimationFrame(tick);
}
window.foliaUpdate = (nextTrack, nextMode, pos, isPlaying) => {
  const changed = track !== nextTrack;
  const repaint = changed || playing !== isPlaying || previousMode !== nextMode;
  if (changed) {track = nextTrack; lines = makeLines(track.rows, track.duration);}
  if(!studio){
    const prefs=useVisualizerSettingsStore.getState();
    const choice=resolveDesktopRandomMode({previousSong:previousId,song:nextTrack.id,enabled:prefs.randomVisualizerModePerSong,mode:previousId===nextTrack.id && previousMode===nextMode ? mode:nextMode,pool:prefs.randomVisualizerModes});
    mode=choice.mode; previousId=nextTrack.id; previousMode=nextMode;
  }
  playing = isPlaying;
  anchor = pos;
  stamp = performance.now();
  if (advance() || repaint) paint();
  if (playing && !frame) frame = requestAnimationFrame(tick);
  if (!playing && frame) {cancelAnimationFrame(frame); frame = 0;}
};
function resize() {if (track) paint();}
if (androidViewport) window.addEventListener('resize',resize);
window.foliaDispose = () => {window.removeEventListener('resize',resize);cancelAnimationFrame(frame);root.unmount();};
