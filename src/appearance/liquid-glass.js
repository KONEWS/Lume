import { bindRangeDrag } from './drag-range.js';
import { installSelectionMotion } from './selection-motion.js';
import { GlassRenderer } from './lens/internal/renderer.js';
import { JellyController } from './lens/internal/jelly.js';

// The same painted scene is the WebGL refraction source and the non-GPU backdrop.
function paintScene(ctx, { width, height }) {
  const style = getComputedStyle(document.documentElement);
  const color = token => style.getPropertyValue(token).trim();
  const wash = ctx.createRadialGradient(width * .35, height * .24, 0, width * .35, height * .24, Math.max(width,height) * .85);
  wash.addColorStop(0, color('--studio-surface'));
  wash.addColorStop(1, color('--studio-bg'));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);
}

// The dock floats above scrolling covers. Paint its refracted scene above those
// covers too, so underlying song labels cannot show through the transport.
function paintDock(source) {
  const dock = document.querySelector('.dock-material');
  if (!dock || !dock.offsetWidth) return;
  const box = dock.getBoundingClientRect(), scene = source.getBoundingClientRect();
  const sx = source.width / scene.width, sy = source.height / scene.height;
  const w = Math.max(1, Math.round(box.width * sx)), h = Math.max(1, Math.round(box.height * sy));
  if (dock.width !== w || dock.height !== h) { dock.width = w; dock.height = h; }
  dock.getContext('2d').drawImage(source, (box.x-scene.x)*sx, (box.y-scene.y)*sy, w, h, 0, 0, w, h);
}

function start() {
  const stage = document.body;
  const root = document.documentElement;
  const acrylic = window.lumeDesktop?.platform === 'Windows' || (stage.querySelector('#root') && /Windows/i.test(navigator.userAgent));
  stage.classList.toggle('acrylic', Boolean(acrylic));
  let canvas;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  let renderer, jelly, sceneKey = '';
  function sync() {
    const reduced = root.dataset.glass === 'reduced' || reducedTransparency.matches;
    if (reduced) {
      jelly?.destroy(); renderer?.destroy(); jelly = renderer = undefined;
      canvas?.remove(); canvas = undefined;
      stage.classList.remove('webgl-ready', 'fallback', 'liquid-stage');
      return;
    }
    stage.classList.add('liquid-stage');
    if (!acrylic && !renderer) {
      canvas = document.createElement('canvas');
      canvas.className = 'lume-optics'; canvas.setAttribute('aria-hidden', 'true');
      stage.prepend(canvas);
      renderer = new GlassRenderer(canvas, stage, {
        scene: 'ocean', artwork: paintScene, afterRender: stage.querySelector('#root') ? paintDock : undefined, motion: false, brightness: 1,
        refraction: 1.12, dispersion: .88, blur: .08
      });
      sceneKey = '';
    }
    if (!jelly) { jelly = new JellyController(stage, renderer, { intensity: .85 }); renderer?.setMotionSource(jelly); }
    jelly.reduced = reducedMotion.matches;
    if (renderer) renderer.reducedMotion = reducedMotion.matches;
    const palette = [root.dataset.phoneTheme, root.dataset.customSkin, ...['background','surface','accent'].map(k=>root.style.getPropertyValue('--skin-'+k))].join('|');
    if (sceneKey !== palette) {
      sceneKey = palette; renderer?.setScene('ocean');
      const fallback = document.createElement('canvas');
      fallback.width = 650; fallback.height = 650;
      paintScene(fallback.getContext('2d'), fallback);
      stage.style.setProperty('--liquid-wallpaper', 'url(' + fallback.toDataURL('image/jpeg', .89) + ')');
    }
    renderer?.invalidate();
  }
  // Freeze the existing GPU frame during a mobile sheet drag. The opaque sheet
  // supplies its own material; avoid rebuilding optics on every pointer event.
  if(document.getElementById('full'))window.lumePlayerTransition=active=>{
    if(!renderer)return;
    renderer.transitionPaused=active;
    if(active){cancelAnimationFrame(renderer.frame);renderer.frame=0;}
    else renderer.invalidate();
  };
  // Register on first contact so React can replace controls without remounting the scene.
  stage.addEventListener('pointerdown', event => {
    const target = event.target.closest('[data-elastic]');
    if (!jelly || !target || target.disabled || target.closest('[data-lens-group]')) return;
    for (const element of jelly.bodies.keys()) if (!element.isConnected) jelly.bodies.delete(element);
    if (!jelly.bodies.has(target)) jelly.register(target, { mode: target.dataset.elastic, maxTravel: 12 });
  }, true);
  installSelectionMotion(stage, duration => renderer?.invalidate(duration));
  stage.addEventListener('pointerdown', () => { stage.dataset.inputMode = 'pointer'; }, true);
  stage.addEventListener('keydown', e => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) stage.dataset.inputMode = 'keyboard'; }, true);
  sync();
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-glass','data-custom-skin','data-phone-theme','style'] });
  reducedMotion.addEventListener('change', sync);
  reducedTransparency.addEventListener('change', sync);
}
if (document.getElementById('seek')) window.lumeBindRange = bindRangeDrag;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
else start();
