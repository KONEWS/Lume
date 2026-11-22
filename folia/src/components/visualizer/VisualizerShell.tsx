import React, {forwardRef} from 'react';
import {resolveThemeFontStack, resolveThemeFontWeight} from '../../utils/fontStacks';

// LUME supplies the viewport, background and player controls around the original lyric renderers.
export default forwardRef(function VisualizerShell({children, theme, className = ''}, ref) {
  return <div ref={ref} className={'relative w-full h-full flex flex-col items-center justify-center overflow-hidden ' + className}
    style={{fontFamily:resolveThemeFontStack(theme),fontWeight:resolveThemeFontWeight(theme, 400)}}>{children}</div>;
});
