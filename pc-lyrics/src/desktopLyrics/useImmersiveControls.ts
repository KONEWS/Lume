import { useEffect, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { Preferences } from './bridge';

type Options = { root: RefObject<HTMLElement | null>; immersive: boolean; setImmersive: Dispatch<SetStateAction<boolean>>;
  panel: boolean; hasLyrics: boolean; clickThrough: boolean; fullscreen: boolean; restore: number; preferences: Preferences };

// LUME keeps windowed controls persistent. Only actual fullscreen owns an idle timer.
export function useImmersiveControls({ root, immersive, setImmersive, panel, fullscreen, restore }: Options) {
  const [cursorHidden, setCursorHidden] = useState(false);
  const keyboardInteraction = useRef(false);
  useEffect(() => {
    const surface = root.current;
    if (!surface) return;
    let timer = 0, held = false;
    const chrome = '.desktop-topbar-shell,.window-chrome,.desktop-statusbar,.desktop-top-menu,.control-panel,.audio-progress';
    const interacting = () => panel || held || Boolean(surface.querySelector(chrome.split(',').map(selector => selector + ':hover').join(','))) ||
      keyboardInteraction.current && document.activeElement instanceof Element && Boolean(document.activeElement.closest(chrome)) ||
      Boolean(surface.querySelector('[aria-expanded="true"], [role="dialog"], [role="listbox"]'));
    const arm = () => {
      window.clearTimeout(timer);
      if (!fullscreen || panel) return;
      timer = window.setTimeout(() => {
        if (interacting()) { arm(); return; }
        setImmersive(true); setCursorHidden(true);
      }, 5000);
    };
    const reveal = () => { setImmersive(false); setCursorHidden(false); arm(); };
    const pointer = (event: PointerEvent) => {
      reveal();
    };
    const down = (event: PointerEvent) => { held = true; keyboardInteraction.current = false; pointer(event); };
    const up = () => { held = false; arm(); };
    const focus = () => { reveal(); };
    const blur = () => { arm(); };
    const key = () => { keyboardInteraction.current = true; reveal(); };
    const leave = () => { held = false; arm(); };
    if (!fullscreen || panel) { setImmersive(false); setCursorHidden(false); }
    else if (immersive) setCursorHidden(true);
    arm();
    surface.addEventListener('pointermove', pointer, { passive: true });
    surface.addEventListener('pointerdown', down, { passive: true });
    surface.addEventListener('pointerleave', leave);
    surface.addEventListener('focusin', focus);
    surface.addEventListener('focusout', blur);
    surface.addEventListener('wheel', reveal, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, true);
    return () => {
      window.clearTimeout(timer);
      surface.removeEventListener('pointermove', pointer); surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointerleave', leave); surface.removeEventListener('focusin', focus);
      surface.removeEventListener('focusout', blur); surface.removeEventListener('wheel', reveal);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key, true);
    };
  }, [root, immersive, setImmersive, panel, fullscreen, restore]);
  return { cursorHidden: fullscreen && cursorHidden, controlsRevealed: false, topControlsRevealed: false };
}

