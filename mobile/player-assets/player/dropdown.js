// Keep the select as the source of truth for labels, form values and change handlers.
const playerDropdown = (() => {
  const selector = 'select:not([multiple]):not([size]):enabled';
  const menu = document.createElement('dialog');
  menu.id = 'player-dropdown';
  const list = document.createElement('div');
  list.setAttribute('role', 'listbox');
  menu.append(list);
  document.body.append(menu);
  let field;

  function close() {
    if (!menu.open) return false;
    menu.close();
    observer.disconnect();
    field.removeAttribute('aria-controls');
    field.setAttribute('aria-expanded', 'false');
    field = null;
    syncBack();
    return true;
  }

  function position() {
    if (!menu.open) return;
    if (!field.isConnected || !field.getClientRects().length) { close(); return; }
    const edge = 8, gap = 4;
    const box = field.getBoundingClientRect();
    const below = innerHeight - box.bottom - gap - edge;
    const above = box.top - gap - edge;
    menu.style.width = Math.min(innerWidth - edge * 2, Math.max(160, box.width)) + 'px';
    const upwards = below < menu.scrollHeight + 2 && above > below;
    menu.dataset.placement = upwards ? 'above' : 'below';
    menu.style.maxHeight = Math.max(0, upwards ? above : below) + 'px';
    menu.style.left = Math.max(edge, Math.min(box.left, innerWidth - edge - menu.offsetWidth)) + 'px';
    menu.style.top = (upwards ? box.top - gap - menu.offsetHeight : box.bottom + gap) + 'px';
  }
  const observer = new MutationObserver(() => {
    if (!field?.isConnected || field.disabled || !field.getClientRects().length) close();
  });

  function open(input) {
    if (!input.options.length || menu.open) return;
    field = input;
    field.focus({preventScroll: true});
    const label = input.getAttribute('aria-label') || input.labels[0]?.firstChild?.textContent.trim() || '选择';
    menu.setAttribute('aria-label', label);
    list.setAttribute('aria-label', label);
    list.replaceChildren();
    for (const option of input.options) {
      if (option.hidden) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.disabled = option.matches(':disabled');
      item.textContent = option.label;
      item.onclick = () => {
        close();
        if (!option.isConnected || option.selected) return;
        input.selectedIndex = option.index;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
      };
      list.append(item);
    }
    field.setAttribute('aria-controls', menu.id);
    field.setAttribute('aria-expanded', 'true');
    menu.showModal();
    position();
    const current = list.querySelector('[aria-selected=true]:enabled') || list.querySelector(':enabled');
    current?.focus({preventScroll: true});
    current?.scrollIntoView({block: 'nearest'});
    observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'disabled']});
    syncBack();
  }

  document.addEventListener('mousedown', e => {
    if (e.button === 0 && e.target.matches(selector)) e.preventDefault();
  }, true);
  document.addEventListener('click', e => {
    if (e.target.matches(selector)) { e.preventDefault(); open(e.target); }
  }, true);
  document.addEventListener('keydown', e => {
    if (e.target.matches(selector) && ['Enter',' ','ArrowDown','ArrowUp','F4'].includes(e.key)) {
      e.preventDefault();
      open(e.target);
    }
  }, true);
  menu.addEventListener('keydown', e => {
    const options = [...list.querySelectorAll('button:enabled')];
    const index = options.indexOf(document.activeElement);
    const next = {Home: 0, End: options.length - 1, ArrowDown: index + 1, ArrowUp: index - 1}[e.key];
    if (next !== undefined) {
      e.preventDefault();
      options[Math.max(0, Math.min(options.length - 1, next))]?.focus();
    }
  });
  menu.addEventListener('click', e => {
    if (e.target !== menu) return;
    const box = menu.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) close();
  });
  menu.addEventListener('cancel', e => { e.preventDefault(); close(); });
  window.addEventListener('resize', position);
  return {close};
})();
