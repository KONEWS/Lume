function dismissSettingsSheet(sheet) {
  if (!sheet.open || sheet.dataset.closing !== undefined) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sheet.close();
    return;
  }
  sheet.dataset.closing = '';
  const motion = sheet.animate(
    [{transform: getComputedStyle(sheet).transform}, {transform: 'translateY(100%)'}],
    {duration: 220, easing: 'cubic-bezier(.4,0,.8,1)', fill: 'forwards'}
  );
  motion.onfinish = () => {
    if (sheet.open) sheet.close();
    motion.cancel();
  };
}

for (const sheet of document.querySelectorAll('.settings-sheet')) {
  const header = sheet.querySelector('.settings-sheet-header');
  const grip = sheet.querySelector('.settings-sheet-grip');
  const content = sheet.querySelector('.settings-sheet-content');
  const min = Number(grip.getAttribute('aria-valuemin'));
  const max = Number(grip.getAttribute('aria-valuemax'));
  let drag = null;
  let outsideStart = false;

  function resize(percent) {
    const height = Math.max(min, Math.min(max, percent));
    sheet.style.setProperty('--settings-sheet-height', height + 'dvh');
    grip.setAttribute('aria-valuenow', Math.round(height));
  }

  function outside(event) {
    if (event.target !== sheet) return false;
    const box = sheet.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right ||
      event.clientY < box.top || event.clientY > box.bottom;
  }
  sheet.addEventListener('pointerdown', event => { outsideStart = outside(event); });
  sheet.addEventListener('click', event => {
    if (outsideStart && outside(event)) dismissSettingsSheet(sheet);
    outsideStart = false;
  });
  sheet.addEventListener('cancel', event => {
    event.preventDefault();
    dismissSettingsSheet(sheet);
  });

  header.addEventListener('pointerdown', event => {
    if (drag || sheet.dataset.closing !== undefined || !event.isPrimary || event.button !== 0) return;
    drag = {id: event.pointerId, height: sheet.offsetHeight, x: event.clientX, y: event.clientY};
    event.target.setPointerCapture(event.pointerId);
  });
  function track(event) {
    if (drag?.id !== event.pointerId) return;
    const dy = event.clientY - drag.y;
    if (Math.abs(dy) < Math.max(4, Math.abs(event.clientX - drag.x))) return;
    resize((drag.height - dy) * 100 / window.innerHeight);
    if (dy >= 28) {
      drag = null;
      dismissSettingsSheet(sheet);
    }
  }
  header.addEventListener('pointermove', track);
  header.addEventListener('pointerup', event => {
    track(event);
    if (drag?.id === event.pointerId) drag = null;
  });
  header.addEventListener('lostpointercapture', event => {
    if (drag?.id === event.pointerId) drag = null;
  });
  grip.addEventListener('keydown', event => {
    const current = sheet.offsetHeight * 100 / window.innerHeight;
    const sizes = {ArrowUp: current + 5, ArrowDown: current - 5, Home: min, End: max};
    if (!Object.hasOwn(sizes, event.key)) return;
    event.preventDefault();
    resize(sizes[event.key]);
  });
  sheet.addEventListener('close', () => {
    drag = null;
    delete sheet.dataset.closing;
    outsideStart = false;
    sheet.style.removeProperty('--settings-sheet-height');
    grip.setAttribute('aria-valuenow', '67');
    content.scrollTop = 0;
  });
}
