function bindQueuePull(sheet, list) {
  let drag = null, frame = 0, offset = 0, height = 0;

  function paint(y) {
    offset = Math.max(0, Math.min(y, height));
    sheet.style.setProperty('--queue-offset', offset + 'px');
    sheet.style.setProperty('--queue-shade', String(.48 * (1 - offset / height)));
    sheet.dataset.pulling = '';
  }
  function reset() {
    cancelAnimationFrame(frame);
    drag = null;
    offset = 0;
    delete sheet.dataset.pulling;
    sheet.style.removeProperty('--queue-offset');
    sheet.style.removeProperty('--queue-shade');
  }
  function settle(close, velocity = 0) {
    const from = offset, to = close ? height : 0, start = performance.now();
    const duration = Math.min(260, Math.max(110, Math.abs(to - from) / Math.max(1.8, Math.abs(velocity))));
    function finish() {
      if (close && sheet.open) {
        sheet.close();
        // Commit the hidden state before restoring the normal dialog transitions.
        sheet.getBoundingClientRect();
      }
      reset();
    }
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      paint(to + (from - to) * (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(tick);
      else finish();
    }
    if (from === to || quietMotion.matches) finish();
    else frame = requestAnimationFrame(tick);
  }
  // Only the downward gesture is handled here. Upward swipes use native scrolling.
  // Inertia from a list scroll stops at the first song and never dismisses the sheet.
  function coast(velocity) {
    let last = performance.now();
    function tick(now) {
      const dt = Math.min(50, now - last), previous = list.scrollTop;
      last = now;
      list.scrollTop -= velocity * dt;
      velocity *= Math.exp(-dt / 180);
      if (list.scrollTop !== previous && Math.abs(velocity) > .035)
        frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }
  function cancel() {
    drag = null;
    cancelAnimationFrame(frame);
    if (offset) settle(false);
  }
  sheet.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { cancel(); return; }
    const finger = event.touches[0], bounds = sheet.getBoundingClientRect();
    if (finger.clientX < bounds.left || finger.clientX > bounds.right ||
        finger.clientY < bounds.top || finger.clientY > bounds.bottom) return;
    cancelAnimationFrame(frame);
    height = Math.max(1, bounds.height);
    drag = {x:finger.clientX, y:finger.clientY, origin:offset - list.scrollTop,
      tracking:false, samples:[[event.timeStamp, finger.clientY]]};
  }, {passive:true});
  sheet.addEventListener('touchmove', event => {
    if (!drag) return;
    const finger = event.touches[0], dy = finger.clientY - drag.y;
    if (!drag.tracking) {
      const dx = Math.abs(finger.clientX - drag.x);
      if (Math.max(dx, Math.abs(dy)) < 5) return;
      if (dx >= Math.abs(dy) || (dy < 0 && !offset)) { cancel(); return; }
      drag.tracking = true;
    }
    if (!event.cancelable) { cancel(); return; }
    event.preventDefault();
    const position = drag.origin + dy;
    list.scrollTop = Math.max(0, -position);
    if (position > 0 || offset) paint(position);
    const samples = drag.samples;
    samples.push([event.timeStamp, finger.clientY]);
    while (samples.length > 1 && samples[1][0] < event.timeStamp - 100) samples.shift();
  }, {passive:false});
  sheet.addEventListener('touchend', event => {
    if (!drag) return;
    if (!drag.tracking) { cancel(); return; }
    if (event.cancelable) event.preventDefault();
    const [time, y] = drag.samples[0], dt = event.timeStamp - time;
    const speed = dt > 0 && dt <= 160 ? (event.changedTouches[0].clientY - y) / dt : 0;
    drag = null;
    if (offset) {
      const flick = offset >= 18 && Math.abs(speed) >= .55;
      settle(flick ? speed > 0 : offset >= height * .4, speed);
    } else {
      reset();
      if (Math.abs(speed) > .1) coast(speed);
    }
  }, {passive:false});
  sheet.addEventListener('touchcancel', cancel);
  sheet.addEventListener('close', reset);
  window.addEventListener('resize', cancel);
}
