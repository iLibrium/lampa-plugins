import { isTimeInRanges } from '../segments/ranges.js';

export class PlaybackController {
  constructor({ resolver, getSettings, onSegmentEnter, onSegmentLeave, log }) {
    this.resolver = resolver;
    this.getSettings = getSettings;
    this.onSegmentEnter = onSegmentEnter;
    this.onSegmentLeave = onSegmentLeave;
    this.log = log || (() => {});

    this.video = null;
    this.timeHandler = null;

    this.activeSegment = null;
    this.activeRange = null;
    this.skipped = { intro: false, credits: false };
    this.dismissed = { intro: false, credits: false };
  }

  attach(video) {
    if (this.video === video) return;
    this.detach();
    this.video = video;
    if (!video) return;
    this.timeHandler = () => this._tick();
    video.addEventListener('timeupdate', this.timeHandler);
  }

  detach() {
    if (this.video && this.timeHandler) {
      try { this.video.removeEventListener('timeupdate', this.timeHandler); } catch (e) { /* noop */ }
    }
    this.video = null;
    this.timeHandler = null;
    this.activeSegment = null;
    this.activeRange = null;
  }

  resetSession() {
    this.activeSegment = null;
    this.activeRange = null;
    this.skipped = { intro: false, credits: false };
    this.dismissed = { intro: false, credits: false };
  }

  markSkipped(kind) {
    if (kind in this.skipped) this.skipped[kind] = true;
  }

  markDismissed(kind) {
    if (kind in this.dismissed) this.dismissed[kind] = true;
  }

  getActiveSegment() {
    return this.activeSegment;
  }

  getActiveRange() {
    return this.activeRange;
  }

  _tick() {
    if (!this.video) return;
    const t = this.video.currentTime;
    const d = this.video.duration;
    if (!Number.isFinite(d) || d <= 0) return;

    const detected = this._detect(t);

    if (detected) {
      const ranges = this.resolver.getRanges()[detected];
      const firstRange = ranges && ranges.length ? ranges[0] : null;
      const isSame = this.activeSegment === detected;
      this.activeSegment = detected;
      this.activeRange = firstRange ? Object.assign({}, firstRange) : null;
      if (this.onSegmentEnter) this.onSegmentEnter(detected, this.activeRange, isSame);
    } else if (this.activeSegment) {
      const prev = this.activeSegment;
      this.activeSegment = null;
      this.activeRange = null;
      if (this.onSegmentLeave) this.onSegmentLeave(prev);
    }
  }

  _detect(time) {
    const settings = this.getSettings();
    const ranges = this.resolver.getRanges();

    if (settings.skipIntro && !this.skipped.intro && !this.dismissed.intro) {
      if (isTimeInRanges(time, ranges.intro || [])) return 'intro';
    }
    if (settings.skipCredits && !this.skipped.credits && !this.dismissed.credits) {
      if (isTimeInRanges(time, ranges.credits || [])) return 'credits';
    }
    return null;
  }
}
