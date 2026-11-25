// Native WebViews do not consistently expose the window's avoid areas through env().
// Keep the surface edge-to-edge and pass only content insets to the shared UI.
(() => {
  // Set the saved home palette before the WebView can paint the document.
  let theme = 'light';
  try { if (JSON.parse(localStorage.getItem('lume-listen-theme')) === 'dark') theme = 'dark'; } catch {}
  document.documentElement.dataset.phoneTheme = theme;
  const edges = ['top', 'right', 'bottom', 'left'];
  window.lumeInsets = (insets = {}) => {
    const root = document.documentElement;
    for (const edge of edges) {
      const value = Number(insets[edge]);
      root.style.setProperty('--lume-safe-' + edge, (Number.isFinite(value) ? Math.max(0, value) : 0) + 'px');
    }
    window.dispatchEvent(new Event('lume-insets-change'));
  };
  // Transparent bars need icons that remain readable on the light home/player theme.
  let appearance, scheduled = false;
  function updateAppearance() {
    scheduled = false;
    if (!document.body || !window.LumeNative) return;
    const full = document.getElementById('full');
    const folia = document.getElementById('folia-stage');
    const visual = full && !full.hidden && folia && !folia.hidden;
    // Portrait lyrics paint a dark header scrim even with the light app theme.
    const lyricHeader = full && !full.hidden && full.classList.contains('lyrics-screen') && !full.classList.contains('split-player');
    const settings = document.querySelector('dialog[aria-label="歌词样式设置"][open]');
    const color = getComputedStyle(document.body).getPropertyValue('--studio-bg').trim();
    const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color)?.[1];
    const rgb = hex && (hex.length === 3 ? [...hex].map(c => c + c).join('') : hex).match(/../g).map(c => parseInt(c, 16));
    const dark = !visual && !lyricHeader && !settings && !!rgb && (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 160);
    if (appearance === dark) return;
    appearance = dark;
    window.LumeNative.dispatch(JSON.stringify({type:'systemBarAppearance', dark}));
  }
  function scheduleAppearance() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(updateAppearance); }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(scheduleAppearance);
    observer.observe(document.documentElement, {
      attributes:true, attributeFilter:['data-phone-theme','data-custom-skin','style']
    });
    observer.observe(document.body, {childList:true, attributes:true, attributeFilter:['class']});
    for (const id of ['full', 'folia-stage']) {
      const node = document.getElementById(id);
      if (node) observer.observe(node, {attributes:true, attributeFilter:['hidden','class']});
    }
    scheduleAppearance();
  }, {once:true});
})();
