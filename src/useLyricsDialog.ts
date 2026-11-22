import {useLayoutEffect, useRef} from 'react';

/** Keep the live lyrics surface mounted until it has folded back into the dock. */
export function useLyricsDialog(open: boolean, onExited: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  const motion = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const page = dialog.current!;
    page.showModal();
    return () => {
      motion.current?.cancel();
      motion.current = null;
      page.close();
    };
  }, []);

  useLayoutEffect(() => {
    const page = dialog.current!;
    const dock = document.querySelector<HTMLElement>('.player-bar');
    const box = dock?.getBoundingClientRect();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    if (!box?.height || reduced.matches) {
      motion.current?.cancel();
      motion.current = null;
      if (!open) onExited();
      return;
    }

    // Reuse an in-flight animation so Back / Forward can reverse mid-transition.
    let animation = motion.current;
    if (!animation) {
      // Keep the two sets of transport controls near each other as the upper edge rises.
      const lift = Math.min(box.height / 2, Math.max(0, box.top));
      const top = Math.max(0, box.top - lift);
      const right = Math.max(0, page.clientWidth - box.right);
      const bottom = Math.max(0, page.clientHeight - box.bottom + lift);
      const corner = getComputedStyle(dock!).borderTopLeftRadius;
      animation = page.animate([
        {transform: `translateY(${lift}px)`, opacity: 0,
          clipPath: `inset(${top}px ${right}px ${bottom}px ${box.left}px round ${corner})`},
        {transform: 'translateY(0px)', opacity: 1, clipPath: 'inset(0px 0px 0px 0px round 0px)'},
      ], {duration: 350, easing: 'cubic-bezier(.4,0,.22,1)', fill: 'both'});
      motion.current = animation;
      if (!open) animation.currentTime = 350;
    }
    animation.playbackRate = open ? 1 : -1;
    animation.play();
    animation.onfinish = () => {
      if (!open) onExited();
      else animation.cancel(); // Restore ordinary layout for fullscreen and resize.
      motion.current = null;
    };
    const reduceMotion = () => { if (reduced.matches) animation.finish(); };
    reduced.addEventListener('change', reduceMotion);
    return () => {
      animation.onfinish = null;
      reduced.removeEventListener('change', reduceMotion);
    };
  }, [open, onExited]);

  return dialog;
}
