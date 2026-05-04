import { ProviderBase } from './ProviderBase.js';

const SAMPLE_INTERVAL_MS = 1000;
const CANVAS_WIDTH = 64;
const CANVAS_HEIGHT = 36;
const BLACK_LUMA_THRESHOLD = 18;
const BLACK_PIXEL_RATIO = 0.95;
const STATIC_DIFF_THRESHOLD = 6;
const MIN_BLACK_RUN_SEC = 4;
const MIN_STATIC_RUN_SEC = 20;
const MIN_INTRO_LEN_SEC = 8;

export class VisualProvider extends ProviderBase {
  constructor({ log, getSettings }) {
    super({ name: 'visual', log });
    this.getSettings = getSettings || (() => ({}));
    this.video = null;
    this.canvas = null;
    this.ctx2d = null;
    this.timer = null;
    this.samples = [];
    this.tainted = false;
    this.lastFrameData = null;
    this._lastEmit = null;
  }

  isApplicable(ctx) {
    if (!ctx || !ctx.video) return false;
    if (typeof document === 'undefined') return false;
    if (typeof OffscreenCanvas === 'undefined' && typeof document.createElement !== 'function') return false;
    return true;
  }

  async run(ctx, onUpdate) {
    this.video = ctx.video;
    this.onUpdate = onUpdate;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.ctx2d = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!this.ctx2d) return;

    if (!this._probeReadback()) {
      if (this.getSettings().debug) this.log('warn', 'visual provider: video tainted, disabled.');
      return;
    }

    this.samples = [];
    this.lastFrameData = null;
    this._lastEmit = null;
    this._scheduleTick();
  }

  cancel() {
    super.cancel();
    if (this.timer) {
      try { clearInterval(this.timer); } catch (e) { /* noop */ }
      this.timer = null;
    }
  }

  reset() {
    super.reset();
    this.video = null;
    this.canvas = null;
    this.ctx2d = null;
    this.samples = [];
    this.lastFrameData = null;
    this.tainted = false;
    this._lastEmit = null;
  }

  _probeReadback() {
    if (!this.video || !this.ctx2d) return false;
    try {
      this.ctx2d.drawImage(this.video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      this.ctx2d.getImageData(0, 0, 2, 2);
      this.tainted = false;
      return true;
    } catch (e) {
      this.tainted = true;
      return false;
    }
  }

  _scheduleTick() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), SAMPLE_INTERVAL_MS);
  }

  _tick() {
    if (this.cancelled || !this.video || !this.ctx2d) return;
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    if (duration <= 0) return;

    const t = Number(this.video.currentTime);
    if (!Number.isFinite(t)) return;

    const introZone = Math.min(360, duration * 0.3);
    const creditsZone = Math.max(duration - 300, duration * 0.7);
    const inIntro = t <= introZone;
    const inCredits = t >= creditsZone;
    if (!inIntro && !inCredits) return;

    let frameData;
    try {
      this.ctx2d.drawImage(this.video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      frameData = this.ctx2d.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } catch (e) {
      this.tainted = true;
      this.cancel();
      return;
    }

    const sample = this._analyseFrame(frameData);
    sample.t = t;
    sample.diff = this.lastFrameData ? this._diff(frameData, this.lastFrameData) : null;
    this.lastFrameData = frameData;

    this.samples.push(sample);
    while (this.samples.length > 600) this.samples.shift();

    this._evaluateSegments(duration);
  }

  _analyseFrame(imageData) {
    const data = imageData.data;
    const len = data.length;
    let sumLuma = 0;
    let blackPixels = 0;
    const total = (len >> 2);
    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = (r * 299 + g * 587 + b * 114) / 1000;
      sumLuma += luma;
      if (luma < BLACK_LUMA_THRESHOLD) blackPixels += 1;
    }
    const meanLuma = sumLuma / total;
    const blackRatio = blackPixels / total;
    return { meanLuma, blackRatio };
  }

  _diff(a, b) {
    if (!a || !b) return null;
    const da = a.data;
    const db = b.data;
    const len = Math.min(da.length, db.length);
    let acc = 0;
    let count = 0;
    for (let i = 0; i < len; i += 4) {
      acc += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      count += 3;
    }
    return acc / count;
  }

  _evaluateSegments(duration) {
    if (!this.samples.length) return;
    const ranges = { intro: [], credits: [] };

    const introSamples = this.samples.filter((s) => s.t <= Math.min(360, duration * 0.3));
    const intro = this._findIntroRange(introSamples);
    if (intro) ranges.intro.push(intro);

    const creditsSamples = this.samples.filter((s) => s.t >= Math.max(duration - 300, duration * 0.7));
    const credits = this._findCreditsRange(creditsSamples, duration);
    if (credits) ranges.credits.push(credits);

    if (!ranges.intro.length && !ranges.credits.length) return;

    const sig = JSON.stringify(ranges);
    if (sig === this._lastEmit) return;
    this._lastEmit = sig;

    if (this.onUpdate) this.onUpdate(ranges, { confidence: 'medium', source: 'visual', samples: this.samples.length });
  }

  _findIntroRange(samples) {
    if (samples.length < 8) return null;
    let runStart = null;
    let bestRun = null;
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      const isStatic = s.diff !== null && s.diff < STATIC_DIFF_THRESHOLD;
      const isDarkOrStatic = isStatic || s.blackRatio >= BLACK_PIXEL_RATIO || s.meanLuma < 40;
      if (isDarkOrStatic) {
        if (runStart === null) runStart = s.t;
        const length = s.t - runStart;
        if (length >= MIN_INTRO_LEN_SEC && (!bestRun || length > (bestRun.end - bestRun.start))) {
          bestRun = { start: runStart, end: s.t };
        }
      } else {
        runStart = null;
      }
    }
    return bestRun;
  }

  _findCreditsRange(samples, duration) {
    if (samples.length < 8) return null;
    let runStart = null;
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      const isBlack = s.blackRatio >= BLACK_PIXEL_RATIO || s.meanLuma < 30;
      const isStatic = s.diff !== null && s.diff < STATIC_DIFF_THRESHOLD;
      if (isBlack || isStatic) {
        if (runStart === null) runStart = s.t;
        if (i === samples.length - 1) {
          const length = s.t - runStart;
          if (length >= MIN_BLACK_RUN_SEC + MIN_STATIC_RUN_SEC * 0.4) {
            return { start: runStart, end: duration };
          }
        }
      } else {
        runStart = null;
      }
    }
    return null;
  }
}
