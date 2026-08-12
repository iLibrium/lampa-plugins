/**
 * Отсчитывает время до автопропуска. Прогресс рисует CSS-анимация,
 * поэтому здесь нет покадрового цикла — только один таймаут на завершение.
 */
export class ProgressTimer {
  constructor({ duration = 5000, onDone }) {
    this.duration = duration;
    this.onDone = onDone || (() => {});

    this._timeout = null;
    this._startedAt = 0;
    this._elapsed = 0;
    this._running = false;
    this._cancelled = false;
    this._completed = false;
  }

  start() {
    this._cancelled = false;
    this._completed = false;
    this._elapsed = 0;
    this._arm();
  }

  pause() {
    if (!this._running) return;
    this._elapsed += this._now() - this._startedAt;
    this._running = false;
    this._clearTimeout();
  }

  resume() {
    if (this._running || this._cancelled || this._completed) return;
    this._arm();
  }

  /** Сброс на ноль без запуска: отсчёт считается отменённым. */
  reset() {
    this.cancel();
    this._elapsed = 0;
    this._completed = false;
  }

  cancel() {
    this._cancelled = true;
    this._running = false;
    this._clearTimeout();
  }

  isRunning() { return this._running; }
  isCompleted() { return this._completed; }

  remaining() {
    const spent = this._running
      ? this._elapsed + (this._now() - this._startedAt)
      : this._elapsed;
    return Math.max(0, this.duration - spent);
  }

  _arm() {
    this._startedAt = this._now();
    this._running = true;
    this._clearTimeout();
    this._timeout = setTimeout(() => {
      this._timeout = null;
      if (this._cancelled) return;
      this._running = false;
      this._completed = true;
      try { this.onDone(); } catch (e) { /* noop */ }
    }, this.remaining());
  }

  _clearTimeout() {
    if (this._timeout === null) return;
    try { clearTimeout(this._timeout); } catch (e) { /* noop */ }
    this._timeout = null;
  }

  _now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }
}
