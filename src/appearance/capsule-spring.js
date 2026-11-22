import { Spring, clamp } from './lens/internal/jelly-physics.js';

// The carrier owns tab-to-tab travel. The glass and lettering can move
// independently of the buttons' hit targets.
export class CapsuleSpring {
  constructor(surface, invalidate) {
    this.surface = surface;
    this.words = [...surface.closest('nav').querySelectorAll('[data-lens-word]')].map(word => {
      const letters = Array.from(word.textContent, character => {
        const letter = document.createElement('span');
        letter.textContent = character;
        return letter;
      });
      word.replaceChildren(...letters);
      return { word, letters };
    });
    this.invalidate = invalidate;
    this.press = new Spring();
    this.trail = new Spring();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.frame = 0;
    this.advance = this.advance.bind(this);
  }
  hold() {
    this.press.snap(this.reduced.matches ? 0 : 1);
    this.paint();
    this.wake();
  }
  pull(distance, speed, width) {
    const strain = clamp(Math.abs(distance) / Math.max(1, width), 0, 1);
    const lag = Math.min(.32, .23 * strain + .10 * Math.min(1, Math.abs(speed) / 800));
    this.trail.target = -Math.sign(distance) * lag * width * .25;
    this.wake();
  }
  release() {
    this.press.target = this.trail.target = 0;
    this.wake();
  }
  wake() {
    if (this.frame) return;
    this.previous = performance.now();
    this.frame = requestAnimationFrame(this.advance);
  }
  advance(now) {
    const dt = (now - this.previous) / 1000;
    this.previous = now;
    this.frame = 0;
    if (this.reduced.matches || !this.surface.isConnected) {
      this.press.snap(0); this.trail.snap(0);
    } else {
      this.press.step(dt, 240, 20);
      this.trail.step(dt, 265, 18);
    }
    this.paint();
    // A tap on a different tab also slides the carrier beneath the letters.
    const travelling = this.press.target && this.surface.parentElement?.getAnimations().some(animation => animation.playState === 'running');
    if (this.press.moving || this.trail.moving || travelling) this.frame = requestAnimationFrame(this.advance);
  }
  paint() {
    const length = 1 + .42 * this.press.value;
    const height = 1 + .44 * this.press.value;
    this.surface.style.transform = 'matrix(' + [length, 0, 0, height, this.trail.value, 0].join(',') + ')';
    this.refractLetters(clamp(this.press.value, 0, 1));
    this.invalidate(0);
  }

  refractLetters(strength) {
    const box = this.surface.getBoundingClientRect();
    const radius = Math.max(1, box.width / 2);
    const center = box.left + radius;
    const offsets = this.words.map(({word, letters}) => {
      const left = word.getBoundingClientRect().left;
      return letters.map(letter => (left + letter.offsetLeft + letter.offsetWidth / 2 - center) / radius);
    });
    this.words.forEach(({letters}, i) => letters.forEach((letter, j) => {
      const x = offsets[i][j];
      const lens = Math.max(0, 1 - x * x) * strength;
      if (!lens) {
        if (letter.style.transform) letter.style.removeProperty('transform');
        return;
      }
      // A convex lens magnifies its centre; at its rim the glyphs lean outward.
      letter.style.transform = `matrix(${1 + .09*lens},0,${.13*x*lens},${1 + .13*lens},${4*x*lens},${-1.25*lens})`;
    }));
  }
}
