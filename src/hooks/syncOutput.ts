// Room snapshots and the UI timer can arrive only milliseconds apart. Require
// elapsed time at the same correction level before acting on clock samples.
export class OutputSynchronizer {
  private trim: number | null = null;
  private transportTime?: number;
  private pending = 0;
  private since = 0;

  sync(el: HTMLMediaElement, position: number, playing: boolean, trimMs: number,
       latency: number, sharedOutput: boolean, transportTime?: number, now = performance.now()) {
    const presentation = position + (playing ? latency : 0) - trimMs / 1000;
    const shouldPlay = playing && presentation >= 0;
    if (el.readyState < 1 || el.seeking) {
      this.pending = 0;
      return shouldPlay;
    }

    const target = Math.min(Math.max(0, presentation), Number.isFinite(el.duration) ? el.duration : Infinity);
    const drift = target - el.currentTime;
    const distance = Math.abs(drift);
    let rate = el.playbackRate;
    // The local host changes updatedAt only on transport commands. Phone
    // hosts supply a fresh timestamp on every poll, so use drift for them.
    if (this.trim !== trimMs || this.transportTime !== transportTime || !shouldPlay || el.paused ||
        (el.readyState >= 3 && distance >= 1)) {
      const tolerance = this.trim !== trimMs ? 0.00001 : 0.012;
      if (distance > tolerance) el.currentTime = target;
      rate = 1;
      this.pending = 0;
      this.trim = trimMs;
      this.transportTime = transportTime;
    } else if (el.readyState >= 3) {
      // Keep a fixed gentle correction until the clocks converge. The separate
      // entry/exit thresholds avoid toggling around a single noisy reading.
      const direction = Math.sign(drift);
      const correcting = Math.sign(rate - 1) === direction;
      const adjustRate = sharedOutput && distance > (correcting ? 0.012 : 0.032);
      const correction = distance > 0.15 ? 2 * direction : adjustRate ? direction : 0;
      if (correction !== this.pending) {
        this.pending = correction;
        this.since = now;
      } else if (now - this.since >= 450) {
        if (Math.abs(correction) === 2) {
          el.currentTime = target;
          rate = 1;
          this.pending = 0;
        } else {
          rate = 1 + correction * 0.004;
        }
      }
    } else {
      this.pending = 0;
      this.since = now;
    }
    if (el.playbackRate !== rate) el.playbackRate = rate;
    return shouldPlay;
  }
}
