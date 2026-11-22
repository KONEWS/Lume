import { CapsuleSpring } from './capsule-spring.js';

// Use one persistent lens per group. Repositioning that element lets the browser
// interpolate through intermediate positions, including rapid repeated selections.
export function installSelectionMotion(stage, invalidate) {
  let frame = 0, gesture = null, swallowClick = null;
  const observed = new Set();
  const springs = new WeakMap();
  const schedule = () => { if (!frame) frame = requestAnimationFrame(layout); };
  const resize = new ResizeObserver(schedule);
  function layout() {
    frame = 0;
    const groups = stage.querySelectorAll('[data-lens-group]');
    for (const group of observed) if (!group.isConnected) { resize.unobserve(group); observed.delete(group); }
    for (const group of groups) {
      if (gesture?.group === group && gesture.moved) continue;
      if (!observed.has(group)) { resize.observe(group); observed.add(group); }
      const marker = group.querySelector('[data-lens-position], [data-lens-marker]');
      const active = gesture?.spring && gesture.group === group ? gesture.button
        : group.querySelector('button:is([aria-current=page],[aria-pressed=true],.selected)');
      if (!marker) continue;
      if (!active || !active.offsetWidth) { marker.hidden = true; continue; }
      const left = active.offsetLeft, top = active.offsetTop;
      const width = active.offsetWidth, height = active.offsetHeight;
      const key = [left, top, width, height].join(',');
      if (!marker.hidden && marker.dataset.position === key) continue;
      const first = marker.hidden || !marker.dataset.position;
      marker.hidden = false;
      if (first) marker.style.transition = 'none';
      marker.dataset.position = key;
      marker.style.width = width + 'px'; marker.style.height = height + 'px';
      marker.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
      if (first) { marker.getBoundingClientRect(); marker.style.removeProperty('transition'); }
      invalidate(first ? 0 : 520);
    }
  }
  // Capture the original button so a held pointer keeps driving the lens in gaps
  // and beyond the last tab. Normal taps and keyboard clicks stay native.
  stage.addEventListener('pointerdown', event => {
    const button = event.target.closest('[data-lens-group] > button');
    if (gesture || !button || button.disabled || !event.isPrimary || event.button !== 0) return;
    const group = button.parentElement;
    const buttons = [...group.querySelectorAll(':scope > button')].filter(b => !b.disabled && b.offsetWidth);
    const marker = group.querySelector('[data-lens-position], [data-lens-marker]');
    if (!marker || buttons.length < 2) return;
    const vertical = Math.abs(buttons[1].offsetTop - buttons[0].offsetTop) > Math.abs(buttons[1].offsetLeft - buttons[0].offsetLeft);
    gesture = {id:event.pointerId, button, group, buttons, marker, vertical, start:vertical ? event.clientY : event.clientX, moved:false, target:button};
    const surface = marker.querySelector('[data-stretch-capsule]');
    if (surface) {
      if (!springs.has(surface)) springs.set(surface, new CapsuleSpring(surface, invalidate));
      gesture.spring = springs.get(surface);
      gesture.lastDelta = 0; gesture.lastTime = performance.now();
      // Preview the pressed tab immediately, while the native click still
      // commits the selection on release.
      if (frame) cancelAnimationFrame(frame);
      layout();
      gesture.spring.hold();
    }
    swallowClick = null;
    group.dataset.holding = '';
    button.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    const g = gesture;
    if (!g || g.id !== event.pointerId) return;
    const delta = (g.vertical ? event.clientY : event.clientX) - g.start;
    if (!g.moved && Math.abs(delta) < 4) return;
    if (g.spring) {
      const now = performance.now();
      const speed = 1000 * (delta - g.lastDelta) / Math.max(8, now - g.lastTime);
      g.spring.pull(delta, speed, g.button.offsetWidth);
      g.lastTime = now; g.lastDelta = delta;
    }
    g.moved = true; g.group.dataset.sliding = '';
    const pos = b => g.vertical ? b.offsetTop : b.offsetLeft;
    const origin = pos(g.button);
    const offset = Math.max(pos(g.buttons[0]), Math.min(pos(g.buttons[g.buttons.length-1]), origin + delta));
    g.target = g.buttons.reduce((near, b) => Math.abs(pos(b)-offset)<Math.abs(pos(near)-offset) ? b : near);
    g.marker.style.width = g.button.offsetWidth+'px'; g.marker.style.height = g.button.offsetHeight+'px';
    g.marker.style.transform = 'translate3d('+(g.vertical?g.button.offsetLeft:offset)+'px,'+(g.vertical?offset:g.button.offsetTop)+'px,0)';
    invalidate(0);
  });
  function finish(event, commit) {
    const g = gesture;
    if (!g || (event.pointerId !== undefined && g.id !== event.pointerId)) return;
    g.spring?.release();
    gesture = null; delete g.group.dataset.sliding; delete g.group.dataset.holding;
    if (!g.moved) {
      if (g.spring) schedule();
      return;
    }
    // The captured button also receives a browser click after pointerup.
    // Ignore only that pointer click after committing the destination ourselves.
    swallowClick = {group:g.group,until:performance.now()+550};
    g.marker.dataset.position = 'dragged';
    if (commit) g.target.click();
    schedule();
  }
  stage.addEventListener('pointerup', e => finish(e,true));
  stage.addEventListener('pointercancel', e => finish(e,false));
  stage.addEventListener('lostpointercapture', e => finish(e,false));
  window.addEventListener('blur', e => finish(e,false));
  stage.addEventListener('click', e => {
    if (e.isTrusted && e.detail && swallowClick?.group.contains(e.target) && performance.now()<swallowClick.until) {
      e.preventDefault(); e.stopImmediatePropagation(); swallowClick=null;
    }
  }, true);
  stage.addEventListener('contextmenu', e => { if (e.target.closest('[data-lens-group]')) e.preventDefault(); });
  new MutationObserver(records => {
    if (records.some(r => r.type === 'childList'
      ? [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && (n.matches('[data-lens-group], [data-lens-group] button') || n.querySelector('[data-lens-group]')))
      : r.target.matches('[data-lens-group] button') || (r.attributeName === 'hidden' && r.target.querySelector('[data-lens-group]')))) schedule();
  }).observe(stage, {childList:true,subtree:true,attributes:true,attributeFilter:['aria-current','aria-pressed','class','hidden']});
  schedule();
}
