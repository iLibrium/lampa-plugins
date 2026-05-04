const STORAGE_KEY_PREFIX = 'autoskip_';
const LEGACY_JSON_KEYS = ['autoskip_settings', 'anilibria_autoskip_settings'];

const DEFAULTS = {
  enabled: true,
  autoStart: true,
  skipIntro: true,
  skipCredits: true,
  showNotifications: true,
  debug: false,
  useAniSkip: true,
  useTheIntroDB: true
};

const KEY_ALIASES = {
  skipOpenings: 'skipIntro',
  skipEndings: 'skipCredits'
};

function getLampa() {
  return typeof Lampa !== 'undefined' ? Lampa : null;
}

function lampaStorageGet(key, fallback) {
  const lampa = getLampa();
  if (!lampa || !lampa.Storage) return fallback;
  try {
    if (typeof lampa.Storage.field === 'function') {
      const value = lampa.Storage.field(key);
      if (value !== undefined && value !== null && value !== '') return value;
    }
    if (typeof lampa.Storage.get === 'function') {
      const value = lampa.Storage.get(key, fallback);
      if (value !== undefined && value !== null && value !== '') return value;
    }
  } catch (e) { /* noop */ }
  return fallback;
}

function lampaStorageSet(key, value) {
  const lampa = getLampa();
  if (!lampa || !lampa.Storage || typeof lampa.Storage.set !== 'function') return false;
  try { lampa.Storage.set(key, value); return true; } catch (e) { return false; }
}

function lampaStorageRemove(key) {
  const lampa = getLampa();
  if (!lampa || !lampa.Storage) return;
  try {
    if (typeof lampa.Storage.set === 'function') lampa.Storage.set(key, '');
  } catch (e) { /* noop */ }
}

function readLegacyJson() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  for (const key of LEGACY_JSON_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return { key, data: parsed };
    } catch (e) { /* noop */ }
  }
  return null;
}

function clearLegacyJson(key) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.removeItem(key); } catch (e) { /* noop */ }
}

function applyAliases(obj) {
  if (!obj) return obj;
  const out = Object.assign({}, obj);
  for (const [from, to] of Object.entries(KEY_ALIASES)) {
    if (out[from] !== undefined && out[to] === undefined) out[to] = out[from];
  }
  return out;
}

export class SettingsStore {
  constructor({ log = null } = {}) {
    this.log = log;
    this.values = Object.assign({}, DEFAULTS);
    this._loaded = false;
  }

  load() {
    if (this._loaded) return this.values;

    const legacy = readLegacyJson();
    if (legacy) {
      const aliased = applyAliases(legacy.data);
      Object.keys(DEFAULTS).forEach((key) => {
        if (aliased[key] !== undefined) {
          lampaStorageSet(STORAGE_KEY_PREFIX + key, !!aliased[key]);
        }
      });
      const legacyCacheJson = (() => {
        try { return window.localStorage.getItem('autoskip_segment_cache'); }
        catch (e) { return null; }
      })();
      if (legacyCacheJson) lampaStorageSet('autoskip_segment_cache_legacy', legacyCacheJson);
      clearLegacyJson(legacy.key);
      if (this.log) this.log('log', `settings migrated from localStorage[${legacy.key}] to Lampa.Storage`);
    }

    Object.keys(DEFAULTS).forEach((key) => {
      const stored = lampaStorageGet(STORAGE_KEY_PREFIX + key, undefined);
      if (stored === undefined) return;
      this.values[key] = !!stored;
    });

    this._loaded = true;
    return this.values;
  }

  get(key) {
    if (!this._loaded) this.load();
    return this.values[key];
  }

  all() {
    if (!this._loaded) this.load();
    return this.values;
  }

  set(key, value) {
    if (!this._loaded) this.load();
    this.values[key] = value;
    if (key in DEFAULTS) lampaStorageSet(STORAGE_KEY_PREFIX + key, value);
  }

  update(patch) {
    Object.keys(patch || {}).forEach((key) => this.set(key, patch[key]));
  }

  ensureDefaultsPersisted() {
    if (!this._loaded) this.load();
    Object.keys(DEFAULTS).forEach((key) => {
      const stored = lampaStorageGet(STORAGE_KEY_PREFIX + key, undefined);
      if (stored === undefined) lampaStorageSet(STORAGE_KEY_PREFIX + key, !!this.values[key]);
    });
  }
}

export const SETTINGS_DEFAULTS = DEFAULTS;
export { STORAGE_KEY_PREFIX };
