/** Paint the rail and the custom thumb in the same task as the native range value. */
export function paintRangeValue(input, value) {
  const min = Number(input.min || 0), max = Number(input.max || 100);
  const next = Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  input.value = String(next);
  const displayed = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : next;
  const fraction = max > min ? (displayed - min) / (max - min) : 0;
  const rail = input.closest('.liquid-range');
  if (rail) {
    rail.style.setProperty('--progress', fraction * 100 + '%');
    rail.style.setProperty('--thumb-offset', (0.5 - fraction) * Number(input.dataset.thumbWidth || 0) + 'px');
  }
  return displayed;
}

/** Keep the drag active outside a narrow thumb or rail until the pointer is released. */
export function bindRangeDrag(input, preview, commit, cancel) {
  const events = new AbortController();
  const options = { signal: events.signal };
  let pointerId = null;
  const read = e => {
    const rect = input.getBoundingClientRect();
    const inset = Number(input.dataset.thumbWidth || 0) / 2;
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left - inset) / Math.max(1, rect.width - 2 * inset)));
    const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 1;
    return Math.max(min, Math.min(max, Number((min + Math.round(fraction * (max-min) / step) * step).toFixed(5))));
  };
  function show(e) { const v = paintRangeValue(input, read(e)); preview(v); return v; }
  function release(id) { if (input.hasPointerCapture(id)) input.releasePointerCapture(id); }
  input.addEventListener('pointerdown', e => {
    if (pointerId !== null || input.disabled || !e.isPrimary || e.button !== 0) return;
    e.preventDefault(); pointerId = e.pointerId; input.dataset.tracking = '';
    input.focus({preventScroll:true}); input.setPointerCapture(e.pointerId); show(e);
  }, options);
  input.addEventListener('pointermove', e => { if (pointerId === e.pointerId) show(e); }, options);
  input.addEventListener('pointerup', e => {
    if (pointerId !== e.pointerId) return;
    const v = show(e); pointerId = null; delete input.dataset.tracking; release(e.pointerId); commit(v);
  }, options);
  function abort() {
    if (pointerId === null) return;
    const id = pointerId; pointerId = null; delete input.dataset.tracking; release(id); cancel();
  }
  input.addEventListener('lostpointercapture', abort, options);
  input.addEventListener('pointercancel', abort, options);
  window.addEventListener('blur', abort, options);
  input.addEventListener('contextmenu', e => e.preventDefault(), options);
  return () => { events.abort(); if(pointerId!==null)release(pointerId); pointerId=null; delete input.dataset.tracking; };
}
