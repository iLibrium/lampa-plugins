import { ensureTimelineMarkerStyles } from './styles.js';

const TIMELINE_SELECTORS = [
  '.player .player-panel__timeline',
  '.player-panel__timeline'
];

export class TimelineMarkers {
  constructor({ log } = {}) {
    this.log = log || (() => {});
    this.timeline = null;
    this.elements = [];
    this.ranges = { intro: [], credits: [] };
    this.duration = 0;
    this._domObserver = null;
    this._lastSnapshot = null;
  }

  attach(video) {
    ensureTimelineMarkerStyles();
    this.video = video;
    this._mount();
    this._observeDom();
  }

  detach() {
    this.clear();
    this._stopObserve();
    this.timeline = null;
    this.video = null;
    this.duration = 0;
    this.ranges = { intro: [], credits: [] };
    this._lastSnapshot = null;
  }

  setRanges(ranges, duration) {
    this.ranges = {
      intro: Array.isArray(ranges && ranges.intro) ? ranges.intro : [],
      credits: Array.isArray(ranges && ranges.credits) ? ranges.credits : []
    };
    if (Number.isFinite(duration) && duration > 0) this.duration = duration;
    this._render();
  }

  _mount() {
    if (this.timeline && document.body.contains(this.timeline)) return true;
    if (typeof document === 'undefined') return false;
    for (const selector of TIMELINE_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) {
        this.timeline = el;
        return true;
      }
    }
    this.timeline = null;
    return false;
  }

  _observeDom() {
    if (typeof MutationObserver === 'undefined') return;
    if (this._domObserver) return;
    this._domObserver = new MutationObserver(() => {
      const stillThere = this.timeline && document.body.contains(this.timeline);
      if (stillThere) return;
      if (this._mount()) this._render();
    });
    try { this._domObserver.observe(document.body, { childList: true, subtree: true }); }
    catch (e) { this._domObserver = null; }
  }

  _stopObserve() {
    if (this._domObserver) {
      try { this._domObserver.disconnect(); } catch (e) { /* noop */ }
      this._domObserver = null;
    }
  }

  _snapshot() {
    return JSON.stringify({ ranges: this.ranges, duration: this.duration });
  }

  _render() {
    if (!this._mount()) return;
    if (!this.duration || this.duration <= 0) {
      const liveDuration = this.video && Number.isFinite(this.video.duration) ? this.video.duration : 0;
      if (liveDuration > 0) this.duration = liveDuration;
      else { this.clear(); return; }
    }

    const snapshot = this._snapshot();
    if (snapshot === this._lastSnapshot && this.elements.length) return;
    this._lastSnapshot = snapshot;

    this.clear();

    ['intro', 'credits'].forEach((kind) => {
      const ranges = this.ranges[kind] || [];
      ranges.forEach((range) => {
        const start = Math.max(0, Number(range.start));
        const end = Math.max(start, Number(range.end));
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;

        const left = Math.min(100, Math.max(0, (start / this.duration) * 100));
        const right = Math.min(100, Math.max(0, (end / this.duration) * 100));
        const width = Math.max(0, right - left);
        if (width <= 0) return;

        const seg = document.createElement('div');
        seg.className = `player-panel__timeline-segment player-panel__timeline-segment--autoskip player-panel__timeline-segment--autoskip-${kind}`;
        seg.style.left = `${left}%`;
        seg.style.width = `${width}%`;
        this.timeline.appendChild(seg);
        this.elements.push({ kind, el: seg });
      });
    });
  }

  clear() {
    this.elements.forEach(({ el }) => {
      try { el.remove(); } catch (e) { /* noop */ }
    });
    this.elements = [];
  }
}
