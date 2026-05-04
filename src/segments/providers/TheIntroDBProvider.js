import { ProviderBase } from './ProviderBase.js';

const API_BASE = 'https://api.theintrodb.org/v2/media';
const USER_AGENT = 'AutoSkip Lampa Plugin';
const REQUEST_TIMEOUT_MS = 6000;
const CACHE_KEY_PREFIX = 'autoskip_tidb_';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getLampaStorage() {
  if (typeof Lampa === 'undefined' || !Lampa.Storage) return null;
  return Lampa.Storage;
}

function readStorageField(key) {
  const storage = getLampaStorage();
  if (!storage || typeof storage.field !== 'function') return null;
  try {
    const raw = storage.field(key);
    if (raw === '' || raw === undefined || raw === null) return null;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch (e) { return null; }
    }
    return raw;
  } catch (e) { return null; }
}

function writeStorageField(key, value) {
  const storage = getLampaStorage();
  if (!storage || typeof storage.set !== 'function') return;
  try { storage.set(key, value); } catch (e) { /* noop */ }
}

export class TheIntroDBProvider extends ProviderBase {
  constructor({ log, getSettings, getContentIds }) {
    super({ name: 'theintrodb', log });
    this.getSettings = getSettings || (() => ({}));
    this.getContentIds = getContentIds || (() => null);
    this.abortController = null;
  }

  isApplicable() {
    const settings = this.getSettings();
    if (settings.useTheIntroDB === false) return false;
    if (typeof fetch !== 'function') return false;
    const ids = this.getContentIds();
    if (!ids) return false;
    return !!(ids.tmdb_id || ids.imdb_id);
  }

  async run(ctx, onUpdate) {
    const ids = this.getContentIds();
    if (!ids) return;
    const cacheKey = this._cacheKey(ids);
    const cached = readStorageField(cacheKey);

    if (cached && this._isFreshCache(cached)) {
      if (cached.empty) {
        if (this.getSettings().debug) {
          this.log('log', 'TheIntroDB cache hit (empty), skipping fetch.');
        }
        return;
      }
      if (this.cancelled) return;
      const ranges = this._normalizeRanges(cached.ranges);
      if (ranges.intro.length || ranges.credits.length) {
        onUpdate(ranges, { confidence: 'high', source: 'theintrodb_cache' });
      }
      return;
    }

    const queryString = this._buildQuery(ids);
    if (!queryString) return;
    const url = `${API_BASE}?${queryString}`;

    const settings = this.getSettings();
    const headers = { 'User-Agent': USER_AGENT };
    if (settings.theIntroDbApiKey) headers.Authorization = `Bearer ${settings.theIntroDbApiKey}`;

    let timeoutId = null;
    if (typeof AbortController === 'function') {
      this.abortController = new AbortController();
      timeoutId = setTimeout(() => {
        if (this.abortController) {
          try { this.abortController.abort(); } catch (e) { /* noop */ }
        }
      }, REQUEST_TIMEOUT_MS);
    }

    const fetchOptions = {
      method: 'GET',
      headers,
      mode: 'cors',
      credentials: 'omit'
    };
    if (this.abortController) fetchOptions.signal = this.abortController.signal;

    let response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (!this.cancelled) this.log('warn', 'TheIntroDB fetch failed', err && err.message ? err.message : err);
      return;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (this.cancelled) return;

    if (response.status === 404) {
      writeStorageField(cacheKey, { ts: Date.now(), empty: true });
      if (settings.debug) this.log('log', 'TheIntroDB: not in database (404), negative cache.');
      return;
    }
    if (!response.ok) {
      this.log('warn', `TheIntroDB HTTP ${response.status}`);
      return;
    }

    let json;
    try {
      json = await response.json();
    } catch (e) {
      this.log('warn', 'TheIntroDB response not JSON', e);
      return;
    }
    if (this.cancelled) return;

    const ranges = this._parseResponse(json);
    if (!ranges.intro.length && !ranges.credits.length) {
      writeStorageField(cacheKey, { ts: Date.now(), empty: true });
      if (settings.debug) this.log('log', 'TheIntroDB: empty payload, negative cache.', json);
      return;
    }

    writeStorageField(cacheKey, { ts: Date.now(), ranges });
    if (settings.debug) {
      this.log('log', 'TheIntroDB segments fetched', {
        intro: ranges.intro,
        credits: ranges.credits,
        query: queryString
      });
    }
    onUpdate(ranges, { confidence: 'high', source: 'theintrodb', query: queryString });
  }

  cancel() {
    super.cancel();
    if (this.abortController) {
      try { this.abortController.abort(); } catch (e) { /* noop */ }
      this.abortController = null;
    }
  }

  reset() {
    super.reset();
    this.abortController = null;
  }

  _isFreshCache(entry) {
    if (!entry || typeof entry !== 'object' || !Number.isFinite(entry.ts)) return false;
    const age = Date.now() - entry.ts;
    if (entry.empty) return age < NEGATIVE_CACHE_TTL_MS;
    return age < CACHE_TTL_MS;
  }

  _buildQuery(ids) {
    const parts = [];
    if (ids.tmdb_id) parts.push(`tmdb_id=${encodeURIComponent(ids.tmdb_id)}`);
    else if (ids.imdb_id) parts.push(`imdb_id=${encodeURIComponent(ids.imdb_id)}`);
    else return null;
    if (ids.season !== null && ids.season !== undefined) parts.push(`season=${encodeURIComponent(ids.season)}`);
    if (ids.episode !== null && ids.episode !== undefined) parts.push(`episode=${encodeURIComponent(ids.episode)}`);
    return parts.join('&');
  }

  _cacheKey(ids) {
    const idPart = ids.tmdb_id ? `tmdb_${ids.tmdb_id}` : `imdb_${ids.imdb_id}`;
    const s = (ids.season === null || ids.season === undefined) ? 0 : ids.season;
    const e = (ids.episode === null || ids.episode === undefined) ? 0 : ids.episode;
    return `${CACHE_KEY_PREFIX}${idPart}_s${s}_e${e}`;
  }

  _parseResponse(json) {
    const ranges = { intro: [], credits: [] };
    if (!json || typeof json !== 'object') return ranges;

    const introList = Array.isArray(json.intro) ? json.intro : [];
    const recapList = Array.isArray(json.recap) ? json.recap : [];
    const creditsList = Array.isArray(json.credits) ? json.credits : [];

    introList.forEach((seg) => {
      const range = this._segToRange(seg);
      if (range) ranges.intro.push(range);
    });
    recapList.forEach((seg) => {
      const range = this._segToRange(seg);
      if (range) ranges.intro.push(range);
    });
    creditsList.forEach((seg) => {
      const range = this._segToRange(seg);
      if (range) ranges.credits.push(range);
    });

    return ranges;
  }

  _segToRange(seg) {
    if (!seg || typeof seg !== 'object') return null;
    const startMs = Number(seg.start_ms !== undefined ? seg.start_ms : seg.startMs);
    const endMs = Number(seg.end_ms !== undefined ? seg.end_ms : seg.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    const start = startMs / 1000;
    const end = endMs / 1000;
    if (end <= start) return null;
    return { start, end };
  }

  _normalizeRanges(raw) {
    const result = { intro: [], credits: [] };
    if (!raw || typeof raw !== 'object') return result;
    if (Array.isArray(raw.intro)) raw.intro.forEach((r) => {
      const start = Number(r.start);
      const end = Number(r.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) result.intro.push({ start, end });
    });
    if (Array.isArray(raw.credits)) raw.credits.forEach((r) => {
      const start = Number(r.start);
      const end = Number(r.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) result.credits.push({ start, end });
    });
    return result;
  }
}
