const STORAGE_KEY = 'autoskip_settings';
const LEGACY_LOCAL_KEY = 'autoskip_settings';
const LEGACY_LOCAL_KEY_OLD = 'anilibria_autoskip_settings';

const DEFAULTS = {
  enabled: true,
  autoStart: true,
  skipIntro: true,
  skipCredits: true,
  showNotifications: true,
  debug: false,
  useAniSkip: true
};

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

function migrateLegacyKeys(obj) {
  if (!obj) return null;
  if (obj.skipOpenings !== undefined && obj.skipIntro === undefined) {
    obj.skipIntro = obj.skipOpenings;
  }
  if (obj.skipEndings !== undefined && obj.skipCredits === undefined) {
    obj.skipCredits = obj.skipEndings;
  }
  return obj;
}

function readFromLocalStorage() {
  if (typeof window.localStorage === 'undefined') return null;
  for (const key of [LEGACY_LOCAL_KEY, LEGACY_LOCAL_KEY_OLD]) {
    try {
      const parsed = safeParse(window.localStorage.getItem(key));
      if (parsed) return migrateLegacyKeys(parsed);
    } catch (e) { /* noop */ }
  }
  return null;
}

function readFromLampaStorage() {
  const lampa = getLampa();
  if (!lampa || !lampa.Storage) return null;
  try {
    if (typeof lampa.Storage.get === 'function') {
      const value = lampa.Storage.get(STORAGE_KEY, null);
      if (value && typeof value === 'object') return migrateLegacyKeys(value);
      if (typeof value === 'string') return migrateLegacyKeys(safeParse(value));
    }
  } catch (e) { /* noop */ }
  return null;
}

function writeToLampaStorage(obj) {
  const lampa = getLampa();
  if (!lampa || !lampa.Storage || typeof lampa.Storage.set !== 'function') return false;
  try {
    lampa.Storage.set(STORAGE_KEY, obj);
    return true;
  } catch (e) {
    return false;
  }
}

function writeToLocalStorage(obj) {
  if (typeof window.localStorage === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    return true;
  } catch (e) {
    return false;
  }
}

export class SettingsStore {
  constructor({ log = null } = {}) {
    this.log = log;
    this.values = Object.assign({}, DEFAULTS);
    this._loaded = false;
  }

  load() {
    if (this._loaded) return this.values;

    let stored = readFromLampaStorage();
    let migratedFromLocal = false;

    if (!stored) {
      stored = readFromLocalStorage();
      if (stored) migratedFromLocal = true;
    }

    if (stored) Object.assign(this.values, stored);
    this._loaded = true;

    if (migratedFromLocal) {
      this.save();
      if (this.log) this.log('log', 'settings migrated from localStorage to Lampa.Storage');
    }

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
    this.save();
  }

  update(patch) {
    if (!this._loaded) this.load();
    Object.assign(this.values, patch || {});
    this.save();
  }

  save() {
    if (!writeToLampaStorage(this.values)) {
      writeToLocalStorage(this.values);
    }
  }
}

export const SETTINGS_DEFAULTS = DEFAULTS;
