import { ProviderBase } from './ProviderBase.js';
import { computeMedian, mergeSegments } from '../ranges.js';

const PROBE_TIMEOUT_MS = 6000;
const FETCH_TIMEOUT_MS = 30000;
const MAX_INTRO_BYTES = 8 * 1024 * 1024;
const MAX_CREDITS_BYTES = 8 * 1024 * 1024;
const FRAME_SAMPLES = 4096;
const RMS_WINDOW_SEC = 0.5;
const BASELINE_WINDOWS = 30;
const MIN_BASELINE_RMS = 0.012;
const MIN_THRESHOLD = 0.01;
const ABS_RMS_FLOOR = 0.04;
const MIN_INTRO_SEG_SEC = 6;
const MERGE_GAP_SEC = 3;
const Z_THRESHOLD = 1.5;

function fetchWithTimeout(url, options, timeoutMs) {
  if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
  let timer = null;
  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  const opts = Object.assign({}, options || {});
  if (ctrl) {
    opts.signal = ctrl.signal;
    timer = setTimeout(() => { try { ctrl.abort(); } catch (e) { /* noop */ } }, timeoutMs);
  }
  return fetch(url, opts).finally(() => { if (timer) clearTimeout(timer); });
}

function isMp4ContentType(ct) {
  if (!ct) return false;
  const lowered = String(ct).toLowerCase();
  return lowered.indexOf('mp4') !== -1 || lowered.indexOf('m4a') !== -1;
}

function urlLooksLikeMp4(url) {
  if (!url || typeof url !== 'string') return false;
  return /\.(mp4|m4v|m4a)(\?|#|$)/i.test(url);
}

export class PrefetchAudioProvider extends ProviderBase {
  constructor({ log, getSettings }) {
    super({ name: 'prefetch_audio', log });
    this.getSettings = getSettings || (() => ({}));
    this._abort = null;
  }

  isApplicable(ctx) {
    if (!ctx || !ctx.video) return false;
    if (typeof fetch !== 'function') return false;
    const AudioCtx = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AudioCtx) return false;
    const src = ctx.video.currentSrc || ctx.video.src;
    if (!src) return false;
    if (!urlLooksLikeMp4(src)) {
      if (this.getSettings().debug) this.log('log', `prefetch_audio: src is not mp4-like (${src.slice(0, 80)}...), skipping.`);
      return false;
    }
    return true;
  }

  async run(ctx, onUpdate) {
    const video = ctx.video;
    const src = video.currentSrc || video.src;
    if (!src) return;

    const probe = await this._probeSource(src);
    if (this.cancelled) return;
    if (!probe || !probe.isMp4) {
      if (this.getSettings().debug) this.log('log', 'prefetch_audio: source not eligible', probe);
      return;
    }

    // Ноль означает, что сервер не раскрыл content-range — размер неизвестен,
    // но начало файла скачать это не мешает.
    const total = probe.totalBytes;
    const introEnd = total ? Math.min(MAX_INTRO_BYTES - 1, total - 1) : (MAX_INTRO_BYTES - 1);
    const introBlob = await this._fetchRange(src, 0, introEnd);
    if (this.cancelled || !introBlob) return;

    const introResult = await this._analyseSegment(introBlob, 'intro');
    if (this.cancelled) return;

    let creditsResult = null;
    if (total > MAX_INTRO_BYTES + MAX_CREDITS_BYTES) {
      const tailStart = Math.max(0, total - MAX_CREDITS_BYTES);
      const tailBlob = await this._fetchRange(src, tailStart, total - 1);
      if (this.cancelled) return;
      if (tailBlob) creditsResult = await this._analyseSegment(tailBlob, 'credits', { tailStart, totalBytes: total, duration: video.duration });
      if (this.cancelled) return;
    } else if (!total && this.getSettings().debug) {
      this.log('log', 'prefetch_audio: размер файла не раскрыт (content-range скрыт CORS) — титры по звуку пропускаем.');
    }

    const ranges = { intro: [], credits: [] };
    if (introResult && introResult.intro) ranges.intro.push(introResult.intro);
    if (creditsResult && creditsResult.credits) ranges.credits.push(creditsResult.credits);

    if (!ranges.intro.length && !ranges.credits.length) {
      if (this.getSettings().debug) this.log('log', 'prefetch_audio: no segments found in prefetch windows.');
      return;
    }

    if (this.getSettings().debug) this.log('log', 'prefetch_audio: segments found', ranges);
    onUpdate(ranges, { confidence: 'medium', source: 'prefetch_audio' });
  }

  cancel() {
    super.cancel();
    if (this._abort) {
      try { this._abort.abort(); } catch (e) { /* noop */ }
      this._abort = null;
    }
  }

  /**
   * Проба источника двухбайтовым диапазонным запросом вместо HEAD.
   *
   * HEAD на раздающих CDN нередко просто висит и отваливается по таймауту —
   * именно на этом провайдер и умирал, не дойдя до самих диапазонов. Обычный
   * GET с Range отвечает быстро и заодно доказывает поддержку кодом 206.
   */
  async _probeSource(url) {
    let response;
    try {
      response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-1' },
        mode: 'cors',
        credentials: 'omit'
      }, PROBE_TIMEOUT_MS);
    } catch (e) {
      this.log('warn', 'prefetch_audio: проба диапазона не удалась', e && e.message ? e.message : e);
      return null;
    }
    if (!response || response.status !== 206) {
      this.log('warn', `prefetch_audio: на пробу диапазона получен ${response ? response.status : 'нет ответа'} вместо 206.`);
      return null;
    }

    const ct = response.headers.get('content-type') || '';
    // content-range не safelisted, так что на чужом origin его обычно не видно.
    // Тогда работаем без общего размера: вступление это не блокирует.
    const cr = response.headers.get('content-range') || '';
    const m = cr.match(/\/\s*(\d+)\s*$/);
    const total = m ? Number(m[1]) : 0;

    return {
      totalBytes: Number.isFinite(total) && total > 0 ? total : 0,
      contentType: ct,
      isMp4: isMp4ContentType(ct) || urlLooksLikeMp4(url)
    };
  }

  async _fetchRange(url, start, end) {
    const headers = { Range: `bytes=${start}-${end}` };
    let response;
    try {
      response = await fetchWithTimeout(url, { method: 'GET', headers, mode: 'cors', credentials: 'omit' }, FETCH_TIMEOUT_MS);
    } catch (e) {
      this.log('warn', 'prefetch_audio: range fetch failed', e && e.message ? e.message : e);
      return null;
    }
    // Строго 206: на 200 сервер проигнорировал Range и собрался отдать файл
    // целиком — на приставке это сотни мегабайт трафика впустую.
    if (response.status !== 206) {
      this.log('warn', `prefetch_audio: сервер ответил ${response.status} вместо 206 — диапазоны не поддерживаются, отказ.`);
      return null;
    }
    try {
      return await response.arrayBuffer();
    } catch (e) {
      return null;
    }
  }

  async _analyseSegment(arrayBuffer, kind, tailMeta) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let audioCtx;
    try { audioCtx = new AudioCtx({ latencyHint: 'interactive' }); }
    catch (e) { return null; }

    let audioBuffer;
    try { audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0)); }
    catch (e) {
      try { audioCtx.close(); } catch (err) { /* noop */ }
      if (this.getSettings().debug) this.log('log', `prefetch_audio: decode failed for ${kind}`, e && e.message ? e.message : e);
      return null;
    }

    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const windowSize = Math.max(1, Math.floor(RMS_WINDOW_SEC * sampleRate));
    const windows = [];
    for (let offset = 0; offset + windowSize <= channelData.length; offset += windowSize) {
      let sumSq = 0;
      for (let i = 0; i < windowSize; i += 1) {
        const sample = channelData[offset + i];
        sumSq += sample * sample;
      }
      const rms = Math.sqrt(sumSq / windowSize);
      const t = offset / sampleRate;
      windows.push({ start: t, end: t + RMS_WINDOW_SEC, rms });
    }

    try { audioCtx.close(); } catch (e) { /* noop */ }
    if (!windows.length) return null;

    const baselineSize = Math.min(BASELINE_WINDOWS, windows.length);
    const baseline = windows.slice(0, baselineSize).map((w) => w.rms);
    const rawMedian = computeMedian(baseline);
    const median = Math.max(rawMedian, MIN_BASELINE_RMS);
    let mad = computeMedian(baseline.map((v) => Math.abs(v - median)));
    if (!Number.isFinite(mad) || mad < 1e-6) mad = 1e-5;
    const threshold = Math.max(Z_THRESHOLD * mad * 1.4826, MIN_THRESHOLD);

    const flagged = [];
    for (let i = 0; i < windows.length; i += 1) {
      const w = windows[i];
      const outlier = (w.rms - median) > threshold;
      const aboveFloor = w.rms >= ABS_RMS_FLOOR;
      if (outlier && aboveFloor) flagged.push({ start: w.start, end: w.end });
    }

    const merged = mergeSegments(flagged, MERGE_GAP_SEC);
    const filtered = merged.filter((seg) => (seg.end - seg.start) >= MIN_INTRO_SEG_SEC);
    if (!filtered.length) return null;

    const result = {};
    if (kind === 'intro') {
      filtered.sort((a, b) => a.start - b.start);
      result.intro = filtered[0];
    } else if (kind === 'credits' && tailMeta && Number.isFinite(tailMeta.duration)) {
      filtered.sort((a, b) => a.start - b.start);
      const last = filtered[filtered.length - 1];
      const proportion = tailMeta.tailStart / tailMeta.totalBytes;
      const tailDurationStart = tailMeta.duration * proportion;
      result.credits = {
        start: tailDurationStart + last.start,
        end: tailMeta.duration
      };
    }
    return result;
  }
}
