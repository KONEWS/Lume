// Install the same policy in the main page and each mobile Folia document.
// Cancel browser defaults only: song long presses and other app handlers still run.
(() => {
  const stylesheet = new URL('mobile-text.css', document.currentScript.src).href;
  const installed = new WeakSet();
  function install(doc) {
    if (installed.has(doc)) return;
    installed.add(doc);
    const css = doc.createElement('link');
    css.rel = 'stylesheet'; css.href = stylesheet; doc.head.append(css);
    const canSelectText = node => node?.matches?.('input[type="search"], #lume-device-name') === true;
    const blockDefault = event => {if (!canSelectText(event.target)) event.preventDefault();};
    doc.addEventListener('selectstart', blockDefault, true);
    doc.addEventListener('contextmenu', blockDefault, true);
    function clearSelection() {
      const input = doc.activeElement;
      if (canSelectText(input)) return;
      // Some WebViews allow selection inside text inputs despite user-select:none.
      // Keep the caret and keyboard editing, but collapse a text range outside editable selection fields.
      if (input && typeof input.selectionStart === 'number' && input.selectionStart !== input.selectionEnd) {
        input.setSelectionRange(input.selectionEnd, input.selectionEnd);
      }
      const selection = doc.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
    }
    doc.addEventListener('selectionchange', clearSelection);
    doc.addEventListener('select', clearSelection, true);
  }
  window.LumeTextSelection = {install};
  install(document);
  // Folia creates same-origin about:blank frames on demand. Attach independently
  // of its renderer so both the lyric canvas and settings get the same policy.
  const watchedFrames = new WeakSet();
  function watchFrame(frame) {
    if (watchedFrames.has(frame)) return;
    watchedFrames.add(frame);
    const attach = () => {
      try {if (frame.contentDocument?.head) install(frame.contentDocument);} catch {}
    };
    frame.addEventListener('load', attach);
    attach();
  }
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches('iframe')) watchFrame(node);
      node.querySelectorAll('iframe').forEach(watchFrame);
    }
  }).observe(document.documentElement, {childList:true, subtree:true});
  document.querySelectorAll('iframe').forEach(watchFrame);
})();
