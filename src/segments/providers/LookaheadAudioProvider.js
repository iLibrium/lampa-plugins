import { ProviderBase } from './ProviderBase.js';
import { mergeSegments } from '../ranges.js';
import { MseTap } from '../../playback/mseTap.js';
import { readTimescale, segmentStartSec } from '../../playback/fmp4.js';

const WINDOW_SEC = 0.5;
const MIN_ANALYSIS_SEC = 40;
const MERGE_GAP_SEC = 3;
const ABS_RMS_FLOOR = 0.04;
// Разделение считается осмысленным, только если громкий класс заметно
// оторвался от тихого. Иначе перед нами ровная дорожка без заставки.
const MIN_CLASS_SEPARATION = 0.015;
// Заставка звучит непрерывно, а громкая сцена с диалогом провисает в паузах
// между репликами. Доля тихих окон внутри кандидата отсекает второе.
const MAX_QUIET_FRACTION = 0.2;
const INTRO_MIN_START_SEC = 20;
const INTRO_MIN_DURATION_SEC = 25;
const INTRO_MAX_FRACTION = 0.3;
const MAX_LOOKAHEAD_SEC = 300;
const HISTOGRAM_BINS = 64;

/**
 * Разделение гистограммы на два класса по максимуму межклассовой дисперсии.
 *
 * Обычная опора по медиане ломается, когда громкий кусок занимает большую
 * часть разобранного окна: в первые тридцать секунд буфера заставка вполне
 * может быть большинством, и медиана уезжает внутрь неё. Оцу устойчив к любой
 * пропорции классов, потому что ищет не «типичный уровень», а границу.
 */
export function otsuThreshold(values, bins = HISTOGRAM_BINS) {
  if (values.length < 2) return null;
  let lo = Infinity; let hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) return null;

  const hist = new Array(bins).fill(0);
  const width = (hi - lo) / bins;
  for (const v of values) {
    let idx = Math.floor((v - lo) / width);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    hist[idx] += 1;
  }

  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i += 1) sumAll += (lo + (i + 0.5) * width) * hist[i];

  let sumLow = 0; let countLow = 0; let best = -1; let bestIdx = -1;
  for (let i = 0; i < bins - 1; i += 1) {
    countLow += hist[i];
    if (!countLow) continue;
    const countHigh = total - countLow;
    if (!countHigh) break;
    sumLow += (lo + (i + 0.5) * width) * hist[i];
    const meanLow = sumLow / countLow;
    const meanHigh = (sumAll - sumLow) / countHigh;
    const between = countLow * countHigh * (meanHigh - meanLow) * (meanHigh - meanLow);
    if (between > best) { best = between; bestIdx = i; }
  }
  if (bestIdx < 0) return null;

  const threshold = lo + (bestIdx + 1) * width;
  let sl = 0; let cl = 0; let sh = 0; let ch = 0;
  for (const v of values) { if (v <= threshold) { sl += v; cl += 1; } else { sh += v; ch += 1; } }
  if (!cl || !ch) return null;
  return { threshold, meanQuiet: sl / cl, meanLoud: sh / ch };
}

export class LookaheadAudioProvider extends ProviderBase {
  constructor({ log, getSettings, onUpdate }) {
    super({ name: 'lookahead_audio', log });
    this.getSettings = getSettings || (() => ({}));
    this.onUpdate = onUpdate || (() => {});

    this.tap = null;
    this.video = null;
    this.timescale = null;
    this.windows = [];
    this.covered = 0;
    this._queue = [];
    this._draining = false;
    this._lastEmitted = null;
    this._decodeCtx = null;
  }

  isApplicable(ctx) {
    if (!ctx || !ctx.video) return false;
    if (typeof window === 'undefined' || !window.MediaSource || !window.SourceBuffer) return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    return !!AudioCtx;
  }

  /**
   * Ставится отдельно от run: init-сегмент уходит в MSE один раз, ещё до того
   * как элемент <video> появится в DOM. Опоздать с перехватом значит остаться
   * без init, а без него медиа-сегменты не декодируются.
   */
  installTap() {
    if (this.tap) return this.tap.isInstalled();
    this.tap = new MseTap({
      log: this.log,
      wantsMore: () => this._wantsMore(),
      onSegment: (bytes) => this._enqueue(bytes)
    });
    const ok = this.tap.install();
    if (this.getSettings().debug) {
      this.log('log', ok ? 'lookahead_audio: перехват MSE установлен.'
        : 'lookahead_audio: перехват не установлен (MSE недоступен или уже занят).');
    }
    return ok;
  }

  async run(ctx) {
    this.video = ctx.video;
    this.installTap();
    if (this.getSettings().debug && this.tap && !this.tap.sawAudioBuffer()) {
      this.log('log', 'lookahead_audio: звуковой SourceBuffer пока не создан — источник, похоже, не через MSE.');
    }
  }

  cancel() {
    super.cancel();
    if (this.tap) { this.tap.uninstall(); this.tap = null; }
    if (this._decodeCtx) { try { this._decodeCtx.close(); } catch (e) { /* noop */ } this._decodeCtx = null; }
    this.windows = [];
    this._queue = [];
    this.covered = 0;
    this.timescale = null;
    this._lastEmitted = null;
  }

  _searchEndSec() {
    const duration = this.video && Number.isFinite(this.video.duration) ? this.video.duration : 0;
    if (!duration) return MAX_LOOKAHEAD_SEC;
    return Math.min(duration * INTRO_MAX_FRACTION + 30, MAX_LOOKAHEAD_SEC);
  }

  _wantsMore() {
    if (this.cancelled) return false;
    return this.covered < this._searchEndSec();
  }

  _enqueue(bytes) {
    if (this.cancelled) return;
    this._queue.push(bytes);
    if (this._draining) return;
    this._draining = true;
    // Разбор уводим с пути воспроизведения: в appendBuffer только копирование.
    setTimeout(() => this._drain(), 0);
  }

  async _drain() {
    while (this._queue.length && !this.cancelled) {
      const bytes = this._queue.shift();
      try { await this._consume(bytes); } catch (e) { /* сегмент пропускаем */ }
    }
    this._draining = false;
  }

  async _consume(media) {
    const init = this.tap && this.tap.getInitSegment();
    if (!init) return;
    if (this.timescale === null) this.timescale = readTimescale(init);

    const startSec = segmentStartSec(media, this.timescale);
    if (startSec === null || startSec > this._searchEndSec()) return;

    const joined = new Uint8Array(init.length + media.length);
    joined.set(init, 0);
    joined.set(media, init.length);

    const ctx = this._ctx();
    if (!ctx) return;
    let buffer;
    try { buffer = await ctx.decodeAudioData(joined.buffer); }
    catch (e) { return; }
    if (this.cancelled) return;

    this._appendWindows(buffer, startSec);
    this._analyse();
  }

  _ctx() {
    if (this._decodeCtx) return this._decodeCtx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try { this._decodeCtx = new AudioCtx(); } catch (e) { return null; }
    return this._decodeCtx;
  }

  _appendWindows(buffer, startSec) {
    const data = buffer.getChannelData(0);
    const rate = buffer.sampleRate;
    const size = Math.max(1, Math.floor(WINDOW_SEC * rate));
    for (let offset = 0; offset + size <= data.length; offset += size) {
      let sumSq = 0;
      for (let i = 0; i < size; i += 1) { const s = data[offset + i]; sumSq += s * s; }
      const t = startSec + offset / rate;
      this.windows.push({ start: t, end: t + WINDOW_SEC, rms: Math.sqrt(sumSq / size) });
    }
    this.windows.sort((a, b) => a.start - b.start);
    const last = this.windows[this.windows.length - 1];
    if (last) this.covered = last.end;
  }

  _analyse() {
    if (this.covered < MIN_ANALYSIS_SEC) return;
    const duration = this.video && Number.isFinite(this.video.duration) ? this.video.duration : 0;
    if (!duration) return;

    const result = this.detect(this.windows, duration);
    if (!result) return;
    if (this._lastEmitted
      && Math.abs(this._lastEmitted.start - result.start) < 0.5
      && Math.abs(this._lastEmitted.end - result.end) < 0.5) return;

    this._lastEmitted = result;
    if (this.getSettings().debug) {
      this.log('log', 'lookahead_audio: найдено вступление', {
        start: +result.start.toFixed(1), end: +result.end.toFixed(1),
        covered: +this.covered.toFixed(1),
        playhead: this.video ? +this.video.currentTime.toFixed(1) : null
      });
    }
    this.onUpdate({ intro: [{ start: result.start, end: result.end }], credits: [] },
      { confidence: 'medium', source: 'lookahead_audio' });
  }

  /** Чистая часть: из окон RMS в границы вступления. Вынесена ради проверок. */
  detect(windows, duration) {
    if (!windows.length) return null;
    const split = otsuThreshold(windows.map((w) => w.rms));
    if (!split) return null;
    if (split.meanLoud - split.meanQuiet < MIN_CLASS_SEPARATION) return null;
    if (split.meanLoud < ABS_RMS_FLOOR) return null;

    const loud = windows
      .filter((w) => w.rms > split.threshold && w.rms >= ABS_RMS_FLOOR)
      .map((w) => ({ start: w.start, end: w.end }));
    if (!loud.length) return null;

    const merged = mergeSegments(loud, MERGE_GAP_SEC);
    const zoneEnd = duration * INTRO_MAX_FRACTION;
    const analysedUpTo = windows[windows.length - 1].end;

    for (const seg of merged) {
      if (seg.start < INTRO_MIN_START_SEC) continue;
      if (seg.start > zoneEnd) continue;
      if ((seg.end - seg.start) < INTRO_MIN_DURATION_SEC) continue;
      // Кусок, упирающийся в край разобранного, ещё не кончился: его конец
      // это граница наших данных, а не граница заставки.
      if (analysedUpTo - seg.end < WINDOW_SEC * 2) continue;
      const inside = windows.filter((w) => w.start >= seg.start && w.end <= seg.end);
      if (!inside.length) continue;
      const quiet = inside.filter((w) => w.rms <= split.threshold).length / inside.length;
      if (quiet > MAX_QUIET_FRACTION) continue;
      return { start: seg.start, end: seg.end };
    }
    return null;
  }
}
