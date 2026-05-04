const STORAGE_KEY = 'autoskip_segment_cache_v2';
const LEGACY_LOCAL_KEY = 'autoskip_segment_cache';
const LEGACY_LAMPA_KEY = 'autoskip_segment_cache';
const MAX_ENTRIES = 50;

function getLampa() {
  return typeof Lampa !== 'undefined' ? Lampa : null;
}

function safeParse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) { /* noop */ }
  return null;
}

function readLampa() {
  const lampa = getLampa();
  if (!lampa || !lampa.Storage || typeof lampa.Storage.get !== 'function') return null;
  try {
    const value = lampa.Storage.get(STORAGE_KEY, null);
    if (value && typeof value === 'object') return value;
    if (typeof value === 'string') return safeParse(value);
  } catch (e) { /* noop */ }
  return null;
}

function readLocal() {
  if (typeof window.localStorage === 'undefined') return null;
  try {
    return safeParse(window.localStorage.getItem(LEGACY_LOCAL_KEY));
  } catch (e) {
    return null;
  }
}

function writeLampa(data) {
  const lampa = getLampa();
  if (!lampa || !lampa.Storage || typeof lampa.Storage.set !== 'function') return false;
  try {
    lampa.Storage.set(STORAGE_KEY, data);
    return true;
  } catch (e) {
    return false;
  }
}

function writeLocal(data) {
  if (typeof window.localStorage === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

function pruneOldest(data, maxEntries) {
  const keys = Object.keys(data);
  if (keys.length <= maxEntries) return;
  keys.sort((a, b) => (data[a].ts || 0) - (data[b].ts || 0));
  for (let i = 0; i < keys.length - maxEntries; i += 1) {
    delete data[keys[i]];
  }
}

export class SegmentCache {
  constructor({ log = null, maxEntries = MAX_ENTRIES } = {}) {
    this.log = log;
    this.maxEntries = maxEntries;
    this.data = {};
    this._loaded = false;
    this._saveTimer = null;
  }

  load() {
    if (this._loaded) return this.data;

    const stored = readLampa();

    if (stored) this.data = stored;
    this._loaded = true;

    this._dropLegacyKeys();

    return this.data;
  }

  _dropLegacyKeys() {
    const lampa = getLampa();
    if (lampa && lampa.Storage && typeof lampa.Storage.set === 'function') {
      try { lampa.Storage.set(LEGACY_LAMPA_KEY, ''); } catch (e) { /* noop */ }
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      try { window.localStorage.removeItem(LEGACY_LOCAL_KEY); } catch (e) { /* noop */ }
    }
  }

  read(key) {
    if (!this._loaded) this.load();
    if (!key) return null;
    return this.data[key] || null;
  }

  write(key, ranges, meta = {}) {
    if (!key) return;
    if (!ranges) return;
    const intro = Array.isArray(ranges.intro) ? ranges.intro : [];
    const credits = Array.isArray(ranges.credits) ? ranges.credits : [];
    if (!intro.length && !credits.length) return;

    if (!this._loaded) this.load();

    this.data[key] = Object.assign({}, this.data[key] || {}, {
      intro: intro.slice(),
      credits: credits.slice(),
      ts: Date.now()
    }, meta || {});

    pruneOldest(this.data, this.maxEntries);
  }

  markValidated(key) {
    if (!key) return;
    if (!this._loaded) this.load();
    if (!this.data[key]) return;
    this.data[key].validated = true;
    this.data[key].ts = Date.now();
  }

  scheduleSave(delayMs = 1500) {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => this.save(), delayMs);
  }

  save() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this._loaded) return;
    if (!writeLampa(this.data)) writeLocal(this.data);
  }
}
