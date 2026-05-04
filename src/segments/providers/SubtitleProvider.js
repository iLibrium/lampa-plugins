import { ProviderBase } from './ProviderBase.js';

const MUSIC_MARKERS = /[♪♫♬♩]|\[(music|opening|theme|song|musical|opening theme|theme song|intro)\]|\((music|theme|opening|musical|opening theme|theme song)\)|♪|♫|♬|♩/i;
const RECAP_MARKERS = /\bpreviously on\b|ранее в|в предыдущ|в прошлы(й|х) сери/i;
const CREDITS_MARKERS_EN = /\b(directed by|created by|written by|produced by|executive producer|cast|music by|edited by|editor|cinematography|director of photography|costumes by|production designer|original music)\b/i;
const CREDITS_MARKERS_RU = /\b(режиссёр|режиссер|сценар|продюсер|оператор|композитор|производство|в ролях|монтаж)\b/iu;

const COLLECTION_RETRIES = 12;
const COLLECTION_INTERVAL_MS = 600;
const MIN_INTRO_LEN_SEC = 8;
const MIN_RECAP_LEN_SEC = 10;
const SILENCE_GAP_FOR_CREDITS_SEC = 75;

function getLampaPlayerListener() {
  if (typeof Lampa === 'undefined') return null;
  if (!Lampa.Player || !Lampa.Player.listener) return null;
  return Lampa.Player.listener;
}

function maybeFetchSubtitleUrl(url, timeoutMs = 6000) {
  if (typeof fetch !== 'function') return Promise.resolve(null);
  if (!url || typeof url !== 'string') return Promise.resolve(null);

  let timer = null;
  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  const opts = { method: 'GET', mode: 'cors', credentials: 'omit' };
  if (ctrl) {
    opts.signal = ctrl.signal;
    timer = setTimeout(() => { try { ctrl.abort(); } catch (e) { /* noop */ } }, timeoutMs);
  }

  return fetch(url, opts)
    .then((res) => res.ok ? res.text() : null)
    .catch(() => null)
    .finally(() => { if (timer) clearTimeout(timer); });
}

function parseTimestamp(input) {
  if (!input) return NaN;
  const cleaned = String(input).trim().replace(',', '.');
  const m = cleaned.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return NaN;
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

function parseSrtOrVtt(text) {
  if (!text || typeof text !== 'string') return [];
  const cues = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line === 'WEBVTT' || line.startsWith('NOTE') || line.startsWith('STYLE')) { i += 1; continue; }
    let timecode = line;
    if (!/-->/.test(timecode)) {
      i += 1;
      if (i >= lines.length) break;
      timecode = lines[i].trim();
      if (!/-->/.test(timecode)) continue;
    }
    const parts = timecode.split('-->');
    if (parts.length < 2) { i += 1; continue; }
    const start = parseTimestamp(parts[0].trim());
    const end = parseTimestamp(parts[1].trim().split(' ')[0]);
    i += 1;
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '') {
      buf.push(lines[i]);
      i += 1;
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      cues.push({ start, end, text: buf.join('\n') });
    }
    while (i < lines.length && lines[i].trim() === '') i += 1;
  }
  return cues;
}

export class SubtitleProvider extends ProviderBase {
  constructor({ log, getSettings }) {
    super({ name: 'subtitle', log });
    this.getSettings = getSettings || (() => ({}));
    this._listenerRefs = [];
  }

  isApplicable(ctx) {
    if (!ctx || !ctx.video) return false;
    if (typeof document === 'undefined') return false;
    return true;
  }

  async run(ctx, onUpdate) {
    const video = ctx.video;
    const debug = !!this.getSettings().debug;
    const cues = await this._collectCues(video);
    if (this.cancelled) return;
    if (!cues || !cues.length) {
      if (debug) {
        const reason = (video && video.customSubs && video.customSubs.length)
          ? 'customSubs URL not fetchable / not parsed'
          : (video && video.textTracks && video.textTracks.length)
            ? 'textTracks empty (no cues)'
            : 'no subtitle tracks attached';
        this.log('log', `subtitle provider: no cues collected — ${reason}.`);
      }
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) return;

    const ranges = this._analyse(cues, duration);
    if (!ranges.intro.length && !ranges.credits.length) {
      if (debug) this.log('log', `subtitle provider: ${cues.length} cues collected, no intro/credits markers matched.`);
      return;
    }

    if (debug) {
      this.log('log', `subtitle provider: ${cues.length} cues, segments`, { intro: ranges.intro, credits: ranges.credits });
    }
    onUpdate(ranges, { confidence: 'medium', source: 'subtitle', cues: cues.length });
  }

  async _collectCues(video) {
    for (let attempt = 0; attempt < COLLECTION_RETRIES; attempt += 1) {
      if (this.cancelled) return null;
      const direct = this._extractTextTracksCues(video);
      if (direct && direct.length) return direct;
      const lampaCues = await this._extractLampaCues(video);
      if (this.cancelled) return null;
      if (lampaCues && lampaCues.length) return lampaCues;
      await new Promise((r) => setTimeout(r, COLLECTION_INTERVAL_MS));
    }
    return null;
  }

  _extractTextTracksCues(video) {
    if (!video || !video.textTracks) return null;
    const result = [];
    for (let i = 0; i < video.textTracks.length; i += 1) {
      const track = video.textTracks[i];
      if (!track) continue;
      if (track.kind && track.kind !== 'subtitles' && track.kind !== 'captions') continue;
      const cues = track.cues;
      if (!cues || !cues.length) continue;
      for (let j = 0; j < cues.length; j += 1) {
        const cue = cues[j];
        if (!cue) continue;
        const start = Number(cue.startTime);
        const end = Number(cue.endTime);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        result.push({ start, end, text: cue.text || '' });
      }
    }
    return result.length ? result : null;
  }

  async _extractLampaCues(video) {
    const customSubs = video && video.customSubs;
    if (!customSubs || !customSubs.length) return null;
    const active = customSubs.find((s) => s && (s.mode === 'showing' || s.active === true)) || customSubs[0];
    if (!active || !active.url) return null;

    const text = await maybeFetchSubtitleUrl(active.url);
    if (!text) return null;
    const cues = parseSrtOrVtt(text);
    return cues.length ? cues : null;
  }

  _analyse(cues, duration) {
    const ranges = { intro: [], credits: [] };
    const introZone = duration * 0.30;
    const creditsZone = duration * 0.70;

    const introMusic = cues.filter((c) => c.start <= introZone && MUSIC_MARKERS.test(c.text));
    if (introMusic.length) {
      const start = Math.min.apply(null, introMusic.map((c) => c.start));
      const end = Math.max.apply(null, introMusic.map((c) => c.end));
      if (end - start >= MIN_INTRO_LEN_SEC) ranges.intro.push({ start, end });
    }

    if (!ranges.intro.length) {
      const recap = cues.filter((c) => c.start <= introZone && RECAP_MARKERS.test(c.text));
      if (recap.length) {
        const start = Math.min.apply(null, recap.map((c) => c.start));
        const end = Math.max.apply(null, recap.map((c) => c.end));
        if (end - start >= MIN_RECAP_LEN_SEC) ranges.intro.push({ start, end });
      }
    }

    const creditsCue = cues.filter((c) => c.start >= creditsZone && (CREDITS_MARKERS_EN.test(c.text) || CREDITS_MARKERS_RU.test(c.text)));
    if (creditsCue.length) {
      const start = Math.min.apply(null, creditsCue.map((c) => c.start));
      ranges.credits.push({ start, end: duration });
    } else {
      const lastBody = cues.filter((c) => c.end < creditsZone).pop();
      const tailCues = cues.filter((c) => c.start >= creditsZone);
      if (!tailCues.length && lastBody && (duration - lastBody.end) >= SILENCE_GAP_FOR_CREDITS_SEC) {
        ranges.credits.push({ start: lastBody.end + 5, end: duration });
      }
    }

    return ranges;
  }
}
