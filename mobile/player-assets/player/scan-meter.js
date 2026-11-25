// Negative total means the scanner is still discovering work.
class LumeScanMeter extends HTMLElement {
  static get observedAttributes() { return ['data-total', 'data-done', 'data-found']; }

  connectedCallback() {
    if (!this.hasChildNodes()) {
      this.innerHTML = '<div class="scan-caption"><strong></strong><span class="scan-value"></span></div>' +
        '<div class="scan-track" role="progressbar"><i></i></div><small class="scan-count"></small>';
    }
    this.render();
  }

  attributeChangedCallback() {
    if (!this.isConnected || this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; if (this.isConnected) this.render(); });
  }

  render() {
    const total = Number(this.dataset.total ?? -1);
    const known = total >= 0;
    const done = Math.min(total, Math.max(0, Number(this.dataset.done) || 0));
    const found = Math.max(0, Number(this.dataset.found) || 0);
    const percent = total > 0 ? Math.floor(100 * done / total) : 0;
    const title = !known ? '正在查找音乐' : done === total ? '正在整理曲库' : '正在处理歌曲';
    const count = known ? done.toLocaleString() + ' / ' + total.toLocaleString() + ' 首' : '已发现 ' + found.toLocaleString() + ' 首';
    this.dataset.mode = !known ? 'finding' : total === 0 ? 'empty' : 'counted';
    this.querySelector('strong').textContent = title;
    this.querySelector('.scan-value').textContent = !known ? count : total ? percent + '%' : '0 首';
    const caption = this.querySelector('.scan-count');
    caption.hidden = !known || !total;
    caption.textContent = caption.hidden ? '' : count;
    const rail = this.querySelector('.scan-track');
    rail.hidden = known && total === 0;
    rail.setAttribute('aria-label', title);
    rail.setAttribute('aria-valuetext', count);
    if (known && total) {
      rail.setAttribute('aria-valuemin', '0');
      rail.setAttribute('aria-valuemax', String(total));
      rail.setAttribute('aria-valuenow', String(done));
      rail.style.setProperty('--scan-share', (100 * done / total) + '%');
    } else {
      for (const name of ['aria-valuenow','aria-valuemin','aria-valuemax']) rail.removeAttribute(name);
      rail.style.removeProperty('--scan-share');
    }
  }
}
customElements.define('lume-scan-meter', LumeScanMeter);
