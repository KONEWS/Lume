import {useEffect,useState,useRef} from 'react';
import VisPlayground from './src/components/visualizer/window/VisPlayground';
import {useDesktopVisualSettings} from './src/desktopLyrics/useDesktopVisualSettings';
import {DESKTOP_DEFAULT_THEME} from './src/desktopLyrics/desktopTheme';
import {DESKTOP_BACKGROUND_MODES} from './src/desktopLyrics/desktopBackgrounds';
import {SettingsKitThemeContext} from './src/components/modal/settings/kit/kitTheme';
import DesktopStudioGlobalSettings from './src/desktopLyrics/visualFeatures/DesktopStudioGlobalSettings';
import {Group, Row, Toggle} from './src/components/modal/settings/kit';
import {useVisualizerSettingsStore} from './src/stores/useVisualizerSettingsStore';
import {useVisualTranslation} from './src/desktopLyrics/DesktopVisualControls';
import './src/desktopLyrics/desktop-visual-settings.css';

import {drawDesktopStylePicture,drawDesktopBackgroundPicture} from './src/desktopLyrics/visualFeatures/DesktopStylePicture';
import DesktopSettingsSearch from './src/desktopLyrics/DesktopSettingsSearch';
import SmartBeatSettingsCard from './src/components/visualizer/SmartBeatSettingsCard';
import DesktopRandomControls from './src/desktopLyrics/visualFeatures/DesktopRandomControls';
import {useDesktopSettingsSearchNavigation} from './src/desktopLyrics/useDesktopSettingsSearchNavigation';
import {useDesktopPreviewSource} from './src/desktopLyrics/visualFeatures/useDesktopPreviewSource';
import {useDesktopSettingsTransparency} from './src/desktopLyrics/useDesktopSettingsTransparency';

export function StyleStudio({initialMode, translated, onTranslation, onMode, close, content, signals, mobileLayout}) {
  const mode=useVisualizerSettingsStore(s=>s.visualizerMode);
  const panel=useRef(null);
  const [search,setSearch]=useState(null);
  const live=useDesktopPreviewSource(content,signals,signals.currentTime);
  useEffect(()=>{onMode(mode);},[mode,onMode]);
  useDesktopSettingsTransparency(panel);
  useDesktopSettingsSearchNavigation(panel,search,undefined,'[data-visual-section="'+(search?.entry.section??'visualizer')+'"]');
  const [shown, setShown] = useState(translated);
  const t=useVisualTranslation();
  function changeTranslation(value){setShown(value); onTranslation(value);}
  const model=useDesktopVisualSettings({baseTheme:DESKTOP_DEFAULT_THEME,cover:content.coverUrl || '',transparent:false,translated:shown,onTranslated:changeTranslation});
  const typography=model.typography, patch=model.patchTypography;
  function choose(next){useVisualizerSettingsStore.getState().handleSetVisualizerMode(mobileLayout && next==='still' ? 'classic' : next);}
  return <div className="desktop-lyrics" ref={panel} data-desktop-visual-studio><SettingsKitThemeContext.Provider value={{isDaylight:false,theme:model.mergedTheme}}>
    <VisPlayground theme={model.mergedTheme} isDaylight={false} visualizerMode={search?.entry.mode??mode} initialEditSection={search?.entry.section??'visualizer'} editSequence={search?.sequence}
      compactStyleShelf mobileLayout={mobileLayout} uiScale={mobileLayout ? 1 : 0.94} livePreviewSource={content.lines.length?live:undefined}
      stylePicture={drawDesktopStylePicture} backgroundPicture={drawDesktopBackgroundPicture}
      styleSettings={<DesktopRandomControls/>} inspectStyle={Boolean(search?.entry.mode)}
      onEditSectionChange={()=>setSearch(null)}
      headerActions={<DesktopSettingsSearch compact mobileLayout={mobileLayout} onNavigate={entry=>{model.commitSlider();setSearch({entry,sequence:performance.now()});}}/>}
      availableBackgroundModes={DESKTOP_BACKGROUND_MODES}
      backgroundConfig={search?.entry.background?{...model.backgroundConfig,mode:search.entry.background}:model.backgroundConfig} backgroundActions={model.backgroundActions}
      backgroundSettings={<Group def={{id:'background',titleKey:'desktopVisual.backgroundTitle'}}><Row label={t('desktopVisual.originalBackground')}><Toggle checked={model.backgroundEnabled} onChange={model.setBackgroundEnabled}/></Row></Group>}
      globalSettings={<><DesktopStudioGlobalSettings model={model} mode={mode} onMode={choose}/><SmartBeatSettingsCard t={t}/></>}
            visualizerOpacity={model.visualizer.visualizerOpacity} staticMode={model.staticMode}
            fontStyle={typography.lyricsFontStyle} fontScale={typography.lyricsFontScale} fontWeight={typography.lyricsFontWeight}
            customFontFamily={typography.lyricsCustomFont?.family ?? null} customFontLabel={typography.lyricsCustomFont?.label ?? null}
            fontFallbackFamilies={typography.lyricsFontFallbackFamilies} subtitleFontInheritsLyrics={typography.subtitleFontInheritsLyrics}
            subtitleFontStyle={typography.subtitleFontStyle} subtitleFontScale={typography.subtitleFontScale} subtitleFontWeight={typography.subtitleFontWeight}
            subtitleFontFamily={typography.subtitleFontFamily} subtitleFontFallbackFamilies={typography.subtitleFontFallbackFamilies}
            subtitleContentMode={typography.subtitleContentMode} subtitleOverlayLayout={typography.subtitleOverlayLayout}
            showSubtitleTranslation={model.translated} hideTranslationSubtitle={model.rendererProps.hideTranslationSubtitle}
            subtitleOverlayOpacity={typography.subtitleOverlayOpacity} subtitleOverlayBackground={typography.subtitleOverlayBackground}
            subtitleUpcomingLyricsBlur={typography.subtitleUpcomingLyricsBlur} showHarmonySubtitle={typography.showHarmonySubtitle}
            harmonySubtitleBackground={typography.harmonySubtitleBackground}
            onFontStyleChange={lyricsFontStyle => patch({ lyricsFontStyle })} onFontScaleChange={lyricsFontScale => patch({ lyricsFontScale })}
            onFontWeightChange={lyricsFontWeight => patch({ lyricsFontWeight })} onCustomFontChange={lyricsCustomFont => patch({ lyricsCustomFont })}
            onUploadCustomFont={typography.handleUploadLyricsCustomFont} onFontFallbackFamiliesChange={lyricsFontFallbackFamilies => patch({ lyricsFontFallbackFamilies })}
            onSubtitleFontInheritsLyricsChange={subtitleFontInheritsLyrics => patch({ subtitleFontInheritsLyrics })}
            onSubtitleFontStyleChange={subtitleFontStyle => patch({ subtitleFontStyle })} onSubtitleFontScaleChange={subtitleFontScale => patch({ subtitleFontScale })}
            onSubtitleFontWeightChange={subtitleFontWeight => patch({ subtitleFontWeight })} onSubtitleFontFamilyChange={subtitleFontFamily => patch({ subtitleFontFamily })}
            onSubtitleFontFallbackFamiliesChange={subtitleFontFallbackFamilies => patch({ subtitleFontFallbackFamilies })}
            onVisualizerModeChange={next => { model.commitSlider(); model.setStaticMode(next === 'still'); choose(next); }}
            onVisualizerOpacityChange={visualizerOpacity => model.patchVisualizer({ visualizerOpacity })}
            onToggleHideTranslationSubtitle={hidePlayerTranslationSubtitle => patch({ hidePlayerTranslationSubtitle })}
            onToggleShowSubtitleTranslation={model.setTranslated} onSubtitleContentModeChange={subtitleContentMode => patch({ subtitleContentMode })}
            onSubtitleOverlayLayoutChange={subtitleOverlayLayout => patch({ subtitleOverlayLayout })}
            onSubtitleOverlayOpacityChange={subtitleOverlayOpacity => patch({ subtitleOverlayOpacity })}
            onToggleSubtitleOverlayBackground={subtitleOverlayBackground => patch({ subtitleOverlayBackground })}
            onToggleSubtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur => patch({ subtitleUpcomingLyricsBlur })}
            onToggleShowHarmonySubtitle={showHarmonySubtitle => patch({ showHarmonySubtitle })}
            onToggleHarmonySubtitleBackground={harmonySubtitleBackground => patch({ harmonySubtitleBackground })}
      onClose={()=>{model.commitSlider();close();}}/>
  </SettingsKitThemeContext.Provider></div>;
}
