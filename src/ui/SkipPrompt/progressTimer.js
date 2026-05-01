export class ProgressTimer {
  constructor({ duration = 5000, onTick, onDone }) {
    this.duration = duration;
    this.onTick = onTick || (() => {});
    this.onDone = onDone || (() => {});

    this._raf = null;
    this._startedAt = 0;
    this._elapsedBeforePause = 0;
    this._running = false;
    this._cancelled = false;
    this._completed = false;
  }

  start() {
    this._cancelled = false;
    this._completed = false;
    this._elapsedBeforePause = 0;
    this._startedAt = this._now();
    this._running = true;
    this._loop();
  }

  pause() {
    if (!this._running) return;
    this._elapsedBeforePause += this._now() - this._startedAt;
    this._running = false;
    if (this._raf) {
      try { cancelAnimationFrame(this._raf); } catch (e) { /* noop */ }
      this._raf = null;
    }
  }

  resume() {
    if (this._running || this._cancelled || this._completed) return;
    this._startedAt = this._now();
    this._running = true;
    this._loop();
  }

  reset() {
    this.cancel();
    this._elapsedBeforePause = 0;
    this._completed = false;
  }

  cancel() {
    this._cancelled = true;
    this._running = false;
    if (this._raf) {
      try { cancelAnimationFrame(this._raf); } catch (e) { /* noop */ }
      this._raf = null;
    }
  }

  isRunning() { return this._running; }
  isCompleted() { return this._completed; }

  _now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  _loop() {
    const tick = () => {
      if (this._cancelled || !this._running) return;
      const elapsed = this._elapsedBeforePause + (this._now() - this._startedAt);
      const pct = Math.max(0, Math.min(1, elapsed / this.duration));
      try { this.onTick(pct); } catch (e) { /* noop */ }
      if (pct >= 1) {
        this._running = false;
        this._completed = true;
        try { this.onDone(); } catch (e) { /* noop */ }
        return;
      }
      this._raf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame(tick)
        : setTimeout(tick, 16);
    };
    tick();
  }
}
