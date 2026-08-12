'use strict';
(() => {
  // src/core/logger.js
  function createLogger({ tag }) {
    return function log(level, message, extra = void 0) {
      const fn = console[level] || console.log;
      const prefix = `${tag} `;
      if (extra !== void 0)
        fn.call(console, `${prefix}${message}`, extra);
      else
        fn.call(console, `${prefix}${message}`);
    };
  }

  // src/core/capabilities.js
  function getLampa() {
    return typeof Lampa !== "undefined" ? Lampa : null;
  }
  function probeAudioContext() {
    return typeof (window.AudioContext || window.webkitAudioContext) === "function";
  }
  function probeAudioWorklet() {
    return typeof window.AudioWorkletNode !== "undefined";
  }
  function probeIndexedDB() {
    if (typeof window.indexedDB === "undefined")
      return false;
    try {
      const probe2 = window.indexedDB.open("autoskip_capability_probe", 1);
      probe2.onsuccess = () => {
        try {
          probe2.result && probe2.result.close();
        } catch (e) {
        }
        try {
          window.indexedDB.deleteDatabase("autoskip_capability_probe");
        } catch (e) {
        }
      };
      probe2.onerror = () => {
      };
      return true;
    } catch (e) {
      return false;
    }
  }
  function probeLocalStorage() {
    try {
      const k = "__autoskip_probe__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }
  function probeIsTV() {
    const lampa = getLampa();
    try {
      if (lampa && lampa.Platform && typeof lampa.Platform.screen === "function") {
        return lampa.Platform.screen("tv");
      }
    } catch (e) {
    }
    return false;
  }
  function probe() {
    const lampa = getLampa();
    return {
      audioContext: probeAudioContext(),
      audioWorklet: probeAudioWorklet(),
      indexedDB: probeIndexedDB(),
      localStorage: probeLocalStorage(),
      lampaStorage: !!(lampa && lampa.Storage),
      lampaController: !!(lampa && lampa.Controller && typeof lampa.Controller.add === "function"),
      lampaLang: !!(lampa && lampa.Lang),
      isTV: probeIsTV()
    };
  }

  // src/storage/SettingsStore.js
  var STORAGE_KEY_PREFIX = "autoskip_";
  var LEGACY_JSON_KEYS = ["autoskip_settings", "anilibria_autoskip_settings"];
  var DEFAULTS = {
    enabled: true,
    autoStart: true,
    skipIntro: true,
    skipCredits: true,
    showNotifications: true,
    debug: false,
    useAniSkip: true,
    useTheIntroDB: true
  };
  var KEY_ALIASES = {
    skipOpenings: "skipIntro",
    skipEndings: "skipCredits"
  };
  function getLampa2() {
    return typeof Lampa !== "undefined" ? Lampa : null;
  }
  function lampaStorageGet(key, fallback) {
    const lampa = getLampa2();
    if (!lampa || !lampa.Storage)
      return fallback;
    try {
      if (typeof lampa.Storage.field === "function") {
        const value = lampa.Storage.field(key);
        if (value !== void 0 && value !== null && value !== "")
          return value;
      }
      if (typeof lampa.Storage.get === "function") {
        const value = lampa.Storage.get(key, fallback);
        if (value !== void 0 && value !== null && value !== "")
          return value;
      }
    } catch (e) {
    }
    return fallback;
  }
  function lampaStorageSet(key, value) {
    const lampa = getLampa2();
    if (!lampa || !lampa.Storage || typeof lampa.Storage.set !== "function")
      return false;
    try {
      lampa.Storage.set(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }
  function readLegacyJson() {
    if (typeof window === "undefined" || !window.localStorage)
      return null;
    for (const key of LEGACY_JSON_KEYS) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw)
          continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object")
          return { key, data: parsed };
      } catch (e) {
      }
    }
    return null;
  }
  function clearLegacyJson(key) {
    if (typeof window === "undefined" || !window.localStorage)
      return;
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
    }
  }
  function applyAliases(obj) {
    if (!obj)
      return obj;
    const out = Object.assign({}, obj);
    for (const [from, to] of Object.entries(KEY_ALIASES)) {
      if (out[from] !== void 0 && out[to] === void 0)
        out[to] = out[from];
    }
    return out;
  }
  var SettingsStore = class {
    constructor({ log = null } = {}) {
      this.log = log;
      this.values = Object.assign({}, DEFAULTS);
      this._loaded = false;
    }
    load() {
      if (this._loaded)
        return this.values;
      const legacy = readLegacyJson();
      if (legacy) {
        const aliased = applyAliases(legacy.data);
        Object.keys(DEFAULTS).forEach((key) => {
          if (aliased[key] !== void 0) {
            lampaStorageSet(STORAGE_KEY_PREFIX + key, !!aliased[key]);
          }
        });
        const legacyCacheJson = (() => {
          try {
            return window.localStorage.getItem("autoskip_segment_cache");
          } catch (e) {
            return null;
          }
        })();
        if (legacyCacheJson)
          lampaStorageSet("autoskip_segment_cache_legacy", legacyCacheJson);
        clearLegacyJson(legacy.key);
        if (this.log)
          this.log("log", `settings migrated from localStorage[${legacy.key}] to Lampa.Storage`);
      }
      Object.keys(DEFAULTS).forEach((key) => {
        const stored = lampaStorageGet(STORAGE_KEY_PREFIX + key, void 0);
        if (stored === void 0)
          return;
        this.values[key] = !!stored;
      });
      this._loaded = true;
      return this.values;
    }
    get(key) {
      if (!this._loaded)
        this.load();
      return this.values[key];
    }
    all() {
      if (!this._loaded)
        this.load();
      return this.values;
    }
    set(key, value) {
      if (!this._loaded)
        this.load();
      this.values[key] = value;
      if (key in DEFAULTS)
        lampaStorageSet(STORAGE_KEY_PREFIX + key, value);
    }
    update(patch) {
      Object.keys(patch || {}).forEach((key) => this.set(key, patch[key]));
    }
    ensureDefaultsPersisted() {
      if (!this._loaded)
        this.load();
      Object.keys(DEFAULTS).forEach((key) => {
        const stored = lampaStorageGet(STORAGE_KEY_PREFIX + key, void 0);
        if (stored === void 0)
          lampaStorageSet(STORAGE_KEY_PREFIX + key, !!this.values[key]);
      });
    }
  };
  var SETTINGS_DEFAULTS = DEFAULTS;

  // src/storage/SegmentCache.js
  var STORAGE_KEY = "autoskip_segment_cache_v2";
  var LEGACY_LOCAL_KEY = "autoskip_segment_cache";
  var LEGACY_LAMPA_KEY = "autoskip_segment_cache";
  var MAX_ENTRIES = 50;
  function getLampa3() {
    return typeof Lampa !== "undefined" ? Lampa : null;
  }
  function safeParse(raw) {
    if (!raw || typeof raw !== "string")
      return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object")
        return parsed;
    } catch (e) {
    }
    return null;
  }
  function readLampa() {
    const lampa = getLampa3();
    if (!lampa || !lampa.Storage || typeof lampa.Storage.get !== "function")
      return null;
    try {
      const value = lampa.Storage.get(STORAGE_KEY, null);
      if (value && typeof value === "object")
        return value;
      if (typeof value === "string")
        return safeParse(value);
    } catch (e) {
    }
    return null;
  }
  function writeLampa(data) {
    const lampa = getLampa3();
    if (!lampa || !lampa.Storage || typeof lampa.Storage.set !== "function")
      return false;
    try {
      lampa.Storage.set(STORAGE_KEY, data);
      return true;
    } catch (e) {
      return false;
    }
  }
  function writeLocal(data) {
    if (typeof window.localStorage === "undefined")
      return false;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }
  function pruneOldest(data, maxEntries) {
    const keys = Object.keys(data);
    if (keys.length <= maxEntries)
      return;
    keys.sort((a, b) => (data[a].ts || 0) - (data[b].ts || 0));
    for (let i = 0; i < keys.length - maxEntries; i += 1) {
      delete data[keys[i]];
    }
  }
  var SegmentCache = class {
    constructor({ log = null, maxEntries = MAX_ENTRIES } = {}) {
      this.log = log;
      this.maxEntries = maxEntries;
      this.data = {};
      this._loaded = false;
      this._saveTimer = null;
    }
    load() {
      if (this._loaded)
        return this.data;
      const stored = readLampa();
      if (stored)
        this.data = stored;
      this._loaded = true;
      this._dropLegacyKeys();
      return this.data;
    }
    _dropLegacyKeys() {
      const lampa = getLampa3();
      if (lampa && lampa.Storage && typeof lampa.Storage.set === "function") {
        try {
          lampa.Storage.set(LEGACY_LAMPA_KEY, "");
        } catch (e) {
        }
      }
      if (typeof window !== "undefined" && window.localStorage) {
        try {
          window.localStorage.removeItem(LEGACY_LOCAL_KEY);
        } catch (e) {
        }
      }
    }
    read(key) {
      if (!this._loaded)
        this.load();
      if (!key)
        return null;
      return this.data[key] || null;
    }
    write(key, ranges, meta = {}) {
      if (!key)
        return;
      if (!ranges)
        return;
      const intro = Array.isArray(ranges.intro) ? ranges.intro : [];
      const credits = Array.isArray(ranges.credits) ? ranges.credits : [];
      if (!intro.length && !credits.length)
        return;
      if (!this._loaded)
        this.load();
      this.data[key] = Object.assign({}, this.data[key] || {}, {
        intro: intro.slice(),
        credits: credits.slice(),
        ts: Date.now()
      }, meta || {});
      pruneOldest(this.data, this.maxEntries);
    }
    markValidated(key) {
      if (!key)
        return;
      if (!this._loaded)
        this.load();
      if (!this.data[key])
        return;
      this.data[key].validated = true;
      this.data[key].ts = Date.now();
    }
    scheduleSave(delayMs = 1500) {
      if (this._saveTimer)
        return;
      this._saveTimer = setTimeout(() => this.save(), delayMs);
    }
    save() {
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
      }
      if (!this._loaded)
        return;
      if (!writeLampa(this.data))
        writeLocal(this.data);
    }
  };

  // src/segments/contentId.js
  function getLampa4() {
    return typeof Lampa !== "undefined" ? Lampa : null;
  }
  function getPlayerData() {
    const lampa = getLampa4();
    if (!lampa || !lampa.Player)
      return null;
    try {
      if (typeof lampa.Player.data === "function")
        return lampa.Player.data();
      if (typeof lampa.Player.get === "function")
        return lampa.Player.get();
      if (lampa.Player.current)
        return lampa.Player.current;
      if (lampa.Player.item)
        return lampa.Player.item;
    } catch (e) {
    }
    return null;
  }
  function getActivityCard() {
    const lampa = getLampa4();
    try {
      if (lampa && lampa.Activity && typeof lampa.Activity.active === "function") {
        const activity = lampa.Activity.active();
        if (activity) {
          return activity.card || activity.movie || null;
        }
      }
    } catch (e) {
    }
    return null;
  }
  function pickFirstFinite(...values) {
    for (const value of values) {
      if (value === void 0 || value === null || value === "")
        continue;
      const num = Number(value);
      if (Number.isFinite(num) && num >= 0)
        return num;
    }
    return null;
  }
  function pickFirstString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value)
        return value;
      if (typeof value === "number" && Number.isFinite(value) && value !== 0)
        return String(value);
    }
    return null;
  }
  function detectAnime(card) {
    if (!card)
      return false;
    const lang = card.original_language;
    const genres = Array.isArray(card.genre_ids) ? card.genre_ids : [];
    const country = Array.isArray(card.origin_country) ? card.origin_country : [];
    if (lang === "ja" && genres.indexOf(16) !== -1)
      return true;
    if (country.indexOf("JP") !== -1 && genres.indexOf(16) !== -1)
      return true;
    return false;
  }
  function roundDuration(duration, bucketSec = 30) {
    if (!Number.isFinite(duration) || duration <= 0)
      return 0;
    return Math.round(duration / bucketSec) * bucketSec;
  }
  function legacyKey(video) {
    if (!video)
      return null;
    const src = video.currentSrc || video.src || "";
    const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : null;
    if (!src || duration === null)
      return null;
    return `${src}::${duration}`;
  }
  function getContentIds() {
    const data = getPlayerData() || {};
    const card = data.movie || data.card || getActivityCard() || {};
    const tmdb = pickFirstString(card.id, card.tmdb_id, data.id, data.tmdb_id);
    const imdb = pickFirstString(card.imdb_id, data.imdb_id);
    const kp = pickFirstString(card.kinopoisk_id, card.kp_id, data.kinopoisk_id);
    const season = pickFirstFinite(
      data.season_number,
      data.season,
      data.s,
      card.season_number,
      card.season
    );
    const episode = pickFirstFinite(
      data.episode_number,
      data.episode,
      data.e,
      card.episode_number,
      card.episode
    );
    return {
      tmdb_id: tmdb,
      imdb_id: imdb,
      kp_id: kp,
      season,
      episode,
      is_anime: detectAnime(card),
      original_language: card.original_language || null,
      genre_ids: Array.isArray(card.genre_ids) ? card.genre_ids.slice() : [],
      title: card.title || card.name || data.title || data.name || null
    };
  }
  function getContentId(video) {
    if (!video)
      return { primary: null, legacy: null };
    const ids = getContentIds();
    const duration = roundDuration(video.duration, 30);
    const legacy = legacyKey(video);
    if (ids.tmdb_id) {
      const s = ids.season === null ? 0 : ids.season;
      const e = ids.episode === null ? 0 : ids.episode;
      return { primary: `tmdb:${ids.tmdb_id}:s${s}:e${e}:d${duration}`, legacy };
    }
    if (ids.imdb_id) {
      const s = ids.season === null ? 0 : ids.season;
      const e = ids.episode === null ? 0 : ids.episode;
      return { primary: `imdb:${ids.imdb_id}:s${s}:e${e}:d${duration}`, legacy };
    }
    if (legacy)
      return { primary: `src:${legacy}`, legacy };
    return { primary: null, legacy };
  }

  // src/lampa/playerEvents.js
  function getListener() {
    if (typeof Lampa === "undefined")
      return null;
    if (!Lampa.Player || !Lampa.Player.listener)
      return null;
    if (typeof Lampa.Player.listener.follow !== "function")
      return null;
    return Lampa.Player.listener;
  }
  function followPlayer(events) {
    const listener = getListener();
    if (!listener)
      return false;
    Object.keys(events || {}).forEach((eventName) => {
      const handler = events[eventName];
      if (typeof handler !== "function")
        return;
      try {
        listener.follow(eventName, handler);
      } catch (e) {
      }
    });
    return true;
  }

  // src/lampa/waitForLampa.js
  function waitForLampa({
    predicate,
    onReady,
    onTimeout,
    checkInterval = 500,
    maxAttempts = 20,
    log = null
  }) {
    let attempts = 0;
    const check = () => {
      let ready = false;
      try {
        ready = predicate();
      } catch (err) {
        if (log)
          log("warn", "Lampa readiness check threw:", err);
      }
      if (ready) {
        onReady();
        return;
      }
      if (attempts++ < maxAttempts) {
        setTimeout(check, checkInterval);
        return;
      }
      if (onTimeout)
        onTimeout();
    };
    check();
  }

  // src/util/i18n.js
  var FALLBACK = {
    ru: {
      autoskip_name: "AutoSkip",
      autoskip_skip: "Пропустить",
      autoskip_cancel: "Отменить",
      autoskip_intro_skipped: "Пропущено вступление",
      autoskip_credits_skipped: "Пропущены титры",
      autoskip_setting_enabled: "Включить AutoSkip",
      autoskip_setting_autostart: "Автозапуск",
      autoskip_setting_skip_intro: "Пропускать вступление",
      autoskip_setting_skip_credits: "Пропускать титры",
      autoskip_setting_notifications: "Показывать уведомления",
      autoskip_setting_debug: "Debug-логи",
      autoskip_setting_disable: "Отключить плагин",
      autoskip_setting_aniskip: "Использовать AniSkip API для аниме",
      autoskip_setting_theintrodb: "Использовать TheIntroDB для сериалов",
      autoskip_settings_version: "Версия",
      autoskip_audio_cors: "AutoSkip: аудио-детект недоступен на этом источнике (CORS)"
    },
    en: {
      autoskip_name: "AutoSkip",
      autoskip_skip: "Skip",
      autoskip_cancel: "Cancel",
      autoskip_intro_skipped: "Intro skipped",
      autoskip_credits_skipped: "Credits skipped",
      autoskip_setting_enabled: "Enable AutoSkip",
      autoskip_setting_autostart: "Autostart",
      autoskip_setting_skip_intro: "Skip intro",
      autoskip_setting_skip_credits: "Skip credits",
      autoskip_setting_notifications: "Show notifications",
      autoskip_setting_debug: "Debug logs",
      autoskip_setting_disable: "Disable plugin",
      autoskip_setting_aniskip: "Use AniSkip API for anime",
      autoskip_setting_theintrodb: "Use TheIntroDB for TV shows",
      autoskip_settings_version: "Version",
      autoskip_audio_cors: "AutoSkip: audio detect unavailable on this source (CORS)"
    }
  };
  function getLampa5() {
    return typeof Lampa !== "undefined" ? Lampa : null;
  }
  function detectLang() {
    const lampa = getLampa5();
    if (lampa && lampa.Storage && typeof lampa.Storage.field === "function") {
      const fromStore = lampa.Storage.field("language");
      if (fromStore && FALLBACK[fromStore])
        return fromStore;
    }
    return "ru";
  }
  function t(key) {
    const lampa = getLampa5();
    if (lampa && lampa.Lang && typeof lampa.Lang.translate === "function") {
      try {
        const v = lampa.Lang.translate(key);
        if (v && v !== key)
          return v;
      } catch (e) {
      }
    }
    const lang = detectLang();
    return FALLBACK[lang] && FALLBACK[lang][key] || FALLBACK.ru[key] || key;
  }
  function registerTranslations() {
    const lampa = getLampa5();
    if (!lampa || !lampa.Lang)
      return false;
    const langs = Object.keys(FALLBACK);
    if (typeof lampa.Lang.add === "function") {
      const dict = {};
      for (const key of Object.keys(FALLBACK.ru)) {
        dict[key] = {};
        for (const lang of langs) {
          dict[key][lang] = FALLBACK[lang][key];
        }
      }
      try {
        lampa.Lang.add(dict);
        return true;
      } catch (e) {
      }
    }
    return false;
  }

  // src/lampa/settingsUi.js
  var STORAGE_KEY_PREFIX2 = "autoskip_";
  var GLOBAL_DISABLE_KEY = "autoskip_disabled";
  var PARAM_DEFINITIONS = [
    { key: "enabled", label: "autoskip_setting_enabled" },
    { key: "autoStart", label: "autoskip_setting_autostart" },
    { key: "skipIntro", label: "autoskip_setting_skip_intro" },
    { key: "skipCredits", label: "autoskip_setting_skip_credits" },
    { key: "showNotifications", label: "autoskip_setting_notifications" },
    { key: "useTheIntroDB", label: "autoskip_setting_theintrodb" },
    { key: "useAniSkip", label: "autoskip_setting_aniskip" },
    { key: "debug", label: "autoskip_setting_debug" }
  ];
  function getLampa6() {
    return typeof Lampa !== "undefined" ? Lampa : null;
  }
  function getSettingsApi() {
    const lampa = getLampa6();
    if (!lampa)
      return null;
    if (lampa.SettingsApi && typeof lampa.SettingsApi.addComponent === "function")
      return lampa.SettingsApi;
    return null;
  }
  function storageKeyFor(key) {
    return key === "_global_disable" ? GLOBAL_DISABLE_KEY : `${STORAGE_KEY_PREFIX2}${key}`;
  }
  function readStoredValue(key, fallback) {
    const lampa = getLampa6();
    if (!lampa || !lampa.Storage || typeof lampa.Storage.field !== "function")
      return fallback;
    try {
      const value = lampa.Storage.field(storageKeyFor(key));
      if (value === void 0 || value === null || value === "")
        return fallback;
      return value;
    } catch (e) {
      return fallback;
    }
  }
  function writeStoredValue(key, value) {
    const lampa = getLampa6();
    if (!lampa || !lampa.Storage || typeof lampa.Storage.set !== "function")
      return;
    try {
      lampa.Storage.set(storageKeyFor(key), value);
    } catch (e) {
    }
  }
  function isSettingsApiReady() {
    return !!getSettingsApi();
  }
  function registerSettingsComponent({ component, name, icon, log, defaults, onChange, quiet = false }) {
    const api = getSettingsApi();
    if (!api) {
      if (!quiet && log)
        log("warn", "Lampa.SettingsApi unavailable, skipping settings registration.");
      return false;
    }
    try {
      api.addComponent({ component, name, icon });
    } catch (e) {
      if (!quiet && log)
        log("warn", "SettingsApi.addComponent threw:", e);
      return false;
    }
    if (typeof api.removeParams === "function") {
      try {
        api.removeParams(component);
      } catch (e) {
      }
    }
    PARAM_DEFINITIONS.forEach(({ key, label }) => {
      const fallback = defaults && key in defaults ? defaults[key] : false;
      const stored = readStoredValue(key, fallback);
      const initial = typeof stored === "boolean" ? stored : !!stored;
      try {
        api.addParam({
          component,
          param: {
            name: storageKeyFor(key),
            type: "trigger",
            default: !!fallback
          },
          field: { name: t(label) },
          onChange: (value) => {
            const normalized = value === true || value === "true" || value === 1 || value === "1";
            writeStoredValue(key, normalized);
            if (onChange) {
              try {
                onChange(key, normalized);
              } catch (err) {
                if (log)
                  log("warn", "settings onChange threw", err);
              }
            }
          }
        });
      } catch (e) {
        if (log)
          log("warn", `SettingsApi.addParam(${key}) threw:`, e);
      }
      if (stored === void 0 || stored === null) {
        writeStoredValue(key, initial);
      }
    });
    try {
      api.addParam({
        component,
        param: {
          name: GLOBAL_DISABLE_KEY,
          type: "trigger",
          default: false
        },
        field: { name: t("autoskip_setting_disable") },
        onChange: (value) => {
          const normalized = value === true || value === "true" || value === 1 || value === "1";
          writeStoredValue("_global_disable", normalized);
        }
      });
    } catch (e) {
      if (log)
        log("warn", "SettingsApi.addParam(global disable) threw:", e);
    }
    return true;
  }

  // src/segments/constants.js
  var INTRO_REGEX = /(op|opening|intro|вступ|застав)/i;
  var CREDITS_REGEX = /(ed|ending|outro|credits|титр)/i;
  var SEGMENT_KINDS = ["intro", "credits"];
  function getSegmentKindFromKey(key) {
    if (!key)
      return null;
    if (INTRO_REGEX.test(key))
      return "intro";
    if (CREDITS_REGEX.test(key))
      return "credits";
    return null;
  }

  // src/segments/ranges.js
  function isTimeInRanges(time, ranges) {
    return ranges.some((range) => time >= range.start && time <= range.end);
  }
  function mergeSegments(segments, gapSec) {
    if (!segments.length)
      return [];
    const sorted = segments.slice().sort((a, b) => a.start - b.start);
    const merged = [Object.assign({}, sorted[0])];
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = merged[merged.length - 1];
      const cur = sorted[i];
      if (cur.start - prev.end <= gapSec) {
        prev.end = Math.max(prev.end, cur.end);
      } else {
        merged.push(Object.assign({}, cur));
      }
    }
    return merged;
  }
  function computeMedian(arr) {
    if (!arr.length)
      return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0)
      return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function normalizeRange(range, duration = null) {
    if (!range || typeof range !== "object")
      return null;
    const start = Number(range.start);
    const end = Number(range.end);
    if (!Number.isFinite(start) || !Number.isFinite(end))
      return null;
    let normalizedStart = start;
    let normalizedEnd = end;
    if (Number.isFinite(duration) && duration > 0) {
      normalizedStart = clamp(normalizedStart, 0, duration);
      normalizedEnd = clamp(normalizedEnd, 0, duration);
    }
    if (normalizedEnd <= normalizedStart)
      return null;
    return { start: normalizedStart, end: normalizedEnd };
  }
  function normalizeRanges(ranges, duration = null) {
    const out = { intro: [], credits: [] };
    if (!ranges || typeof ranges !== "object")
      return out;
    for (const kind of SEGMENT_KINDS) {
      const list = Array.isArray(ranges[kind]) ? ranges[kind] : [];
      const normalized = list.map((r) => normalizeRange(r, duration)).filter(Boolean).sort((a, b) => a.start - b.start);
      out[kind] = mergeSegments(normalized, 0);
    }
    return out;
  }
  function rangesEqual(a, b) {
    if (a === b)
      return true;
    if (!Array.isArray(a) || !Array.isArray(b))
      return false;
    if (a.length !== b.length)
      return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].start !== b[i].start || a[i].end !== b[i].end)
        return false;
    }
    return true;
  }

  // src/segments/SegmentResolver.js
  var SOURCE_PRIORITY = {
    cache: 0,
    audio: 1,
    visual: 2,
    prefetch_audio: 3,
    subtitle: 4,
    chapters: 5,
    metadata: 6,
    theintrodb: 7,
    aniskip: 8
  };
  var SOURCE_CONFIDENCE = {
    cache: "medium",
    audio: "low",
    visual: "medium",
    prefetch_audio: "medium",
    subtitle: "medium",
    chapters: "high",
    metadata: "high",
    theintrodb: "high",
    aniskip: "high"
  };
  var VALIDATION_BONUS = 100;
  var VALIDATION_TOLERANCE_SEC = 2;
  function priorityOf(source, validated) {
    const base = SOURCE_PRIORITY[source];
    const value = base === void 0 ? 0 : base;
    return validated ? value + VALIDATION_BONUS : value;
  }
  function rangesOverlapWithin(a, b, tolerance) {
    if (!a || !b || !a.length || !b.length)
      return false;
    const ra = a[0];
    const rb = b[0];
    return Math.abs(ra.start - rb.start) <= tolerance && Math.abs(ra.end - rb.end) <= tolerance;
  }
  var SegmentResolver = class {
    constructor() {
      this.ranges = { intro: [], credits: [] };
      this.sources = { intro: null, credits: null };
      this.validated = { intro: false, credits: false };
    }
    reset() {
      this.ranges = { intro: [], credits: [] };
      this.sources = { intro: null, credits: null };
      this.validated = { intro: false, credits: false };
    }
    apply(source, normalized) {
      const introUpdated = this._applyKind(source, "intro", normalized.intro);
      const creditsUpdated = this._applyKind(source, "credits", normalized.credits);
      return introUpdated || creditsUpdated;
    }
    _applyKind(source, kind, incoming) {
      if (!incoming || !incoming.length)
        return false;
      const incomingPriority = priorityOf(source, false);
      const currentSource = this.sources[kind];
      const currentValidated = this.validated[kind];
      const currentPriority = currentSource ? priorityOf(currentSource, currentValidated) : -1;
      if (this.ranges[kind].length && rangesOverlapWithin(this.ranges[kind], incoming, VALIDATION_TOLERANCE_SEC)) {
        if (currentSource && currentSource !== source && source !== "cache") {
          this.validated[kind] = true;
        }
        return false;
      }
      const shouldReplace = !this.ranges[kind].length || incomingPriority >= currentPriority;
      if (!shouldReplace)
        return false;
      if (rangesEqual(this.ranges[kind], incoming))
        return false;
      this.ranges[kind] = incoming;
      this.sources[kind] = source;
      this.validated[kind] = source === "cache" ? currentValidated : false;
      return true;
    }
    getRanges() {
      return this.ranges;
    }
    getSources() {
      return this.sources;
    }
    isValidated(kind) {
      return !!this.validated[kind];
    }
    confidenceFor(kind) {
      const source = this.sources[kind];
      if (!source)
        return "none";
      if (this.validated[kind])
        return "high";
      return SOURCE_CONFIDENCE[source] || "low";
    }
    hasHighConfidence(kind) {
      return this.confidenceFor(kind) === "high";
    }
  };

  // src/segments/providers/ProviderBase.js
  var ProviderBase = class {
    constructor({ name, log }) {
      this.name = name;
      this.log = log || (() => {
      });
      this.cancelled = false;
    }
    isApplicable() {
      return true;
    }
    async run() {
      throw new Error(`${this.name}: run() not implemented`);
    }
    cancel() {
      this.cancelled = true;
    }
    reset() {
      this.cancelled = false;
    }
  };

  // src/segments/providers/MetadataProvider.js
  function getLampa7() {
    return typeof Lampa !== "undefined" ? Lampa : null;
  }
  function getPlayerData2() {
    const lampa = getLampa7();
    if (!lampa || !lampa.Player)
      return null;
    try {
      if (typeof lampa.Player.get === "function")
        return lampa.Player.get();
      if (typeof lampa.Player.data === "function")
        return lampa.Player.data();
      if (lampa.Player.current)
        return lampa.Player.current;
      if (lampa.Player.item)
        return lampa.Player.item;
    } catch (e) {
    }
    return null;
  }
  function normalizeRangeValue(value) {
    if (Array.isArray(value) && value.length >= 2) {
      const start = Number(value[0]);
      const end = Number(value[1]);
      if (Number.isFinite(start) && Number.isFinite(end))
        return { start, end };
    }
    if (typeof value === "object" && value) {
      const start = Number(value.start !== void 0 ? value.start : value.begin !== void 0 ? value.begin : value.from);
      const end = Number(value.end !== void 0 ? value.end : value.finish !== void 0 ? value.finish : value.to);
      if (Number.isFinite(start) && Number.isFinite(end))
        return { start, end };
    }
    return null;
  }
  function extractRangesFromObject(data, ranges, depth) {
    if (!data || depth > 3)
      return;
    if (Array.isArray(data)) {
      data.forEach((item) => extractRangesFromObject(item, ranges, depth + 1));
      return;
    }
    if (typeof data !== "object")
      return;
    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (!value || typeof value !== "object")
        return;
      const kind = getSegmentKindFromKey(String(key).toLowerCase());
      const range = normalizeRangeValue(value);
      if (kind && range) {
        ranges[kind].push(range);
      } else {
        extractRangesFromObject(value, ranges, depth + 1);
      }
    });
  }
  var MetadataProvider = class extends ProviderBase {
    constructor({ log }) {
      super({ name: "metadata", log });
    }
    isApplicable() {
      return !!getLampa7();
    }
    async run(ctx, onUpdate) {
      const ranges = { intro: [], credits: [] };
      const data = getPlayerData2();
      if (!data)
        return;
      extractRangesFromObject(data, ranges, 0);
      if (!ranges.intro.length && !ranges.credits.length)
        return;
      if (this.cancelled)
        return;
      onUpdate(ranges, { passive: true });
    }
  };

  // src/segments/providers/ChaptersProvider.js
  var ChaptersProvider = class extends ProviderBase {
    constructor({ log }) {
      super({ name: "chapters", log });
    }
    isApplicable(ctx) {
      return !!(ctx && ctx.video && ctx.video.textTracks && ctx.video.textTracks.length);
    }
    async run(ctx, onUpdate) {
      const video = ctx && ctx.video;
      if (!video || !video.textTracks)
        return;
      const ranges = { intro: [], credits: [] };
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i += 1) {
        const track = tracks[i];
        const kind = track.kind || "";
        if (!["chapters", "metadata", "subtitles"].includes(kind))
          continue;
        const cues = track.cues || [];
        for (let j = 0; j < cues.length; j += 1) {
          const cue = cues[j];
          const text = `${cue.id || ""} ${cue.text || ""}`.trim();
          if (INTRO_REGEX.test(text)) {
            ranges.intro.push({ start: cue.startTime, end: cue.endTime });
          } else if (CREDITS_REGEX.test(text)) {
            ranges.credits.push({ start: cue.startTime, end: cue.endTime });
          }
        }
      }
      if (!ranges.intro.length && !ranges.credits.length)
        return;
      if (this.cancelled)
        return;
      onUpdate(ranges, { passive: true });
    }
  };

  // src/segments/providers/AudioProvider.js
  var DEFAULT_CONFIG = {
    windowSec: 0.5,
    baselineWindows: 30,
    warmupWindows: 24,
    zThreshold: 1.4,
    minSegmentSec: 5,
    mergeGapSec: 3,
    introMaxFraction: 0.3,
    introMinStartSec: 20,
    introMinDurationSec: 25,
    creditsMinFraction: 0.7,
    creditsMinDurationSec: 12,
    fftSize: 2048,
    voiceMusicMaxRatio: 0.45,
    silenceProbeWindows: 6,
    silenceProbeRmsThreshold: 1e-6,
    minBaselineRms: 0.01,
    minThreshold: 8e-3,
    absoluteRmsFloor: 0.04
  };
  var VOICE_BAND_LO = 200;
  var VOICE_BAND_HI = 3e3;
  var FULL_BAND_HI = 12e3;
  function clampFreqIndex(freqHz, sampleRate, binCount) {
    if (!Number.isFinite(freqHz) || sampleRate <= 0 || binCount <= 0)
      return 0;
    const idx = Math.round(freqHz / (sampleRate / 2) * binCount);
    return Math.max(0, Math.min(binCount - 1, idx));
  }
  var AudioProvider = class extends ProviderBase {
    constructor({ log, config = {}, onUpdate, onTainted }) {
      super({ name: "audio", log });
      this.config = Object.assign({}, DEFAULT_CONFIG, config);
      this.onUpdate = onUpdate || (() => {
      });
      this.onTainted = onTainted || (() => {
      });
      this.video = null;
      this.audioContext = null;
      this.sourceNode = null;
      this.processorNode = null;
      this.analyserNode = null;
      this.silentGainNode = null;
      this.state = null;
      this.spectralBuffer = null;
      this._onSeeking = null;
      this._onPlay = null;
      this._lastEmitted = null;
      this._silenceProbeRemaining = 0;
      this._taintedDetected = false;
      this._lastProgressLogAt = 0;
    }
    isApplicable(ctx) {
      if (!ctx || !ctx.video)
        return false;
      if (ctx.capabilities && ctx.capabilities.audioContext === false)
        return false;
      return true;
    }
    async run(ctx) {
      this.start(ctx.video);
    }
    start(video) {
      if (!video)
        return;
      if (this.audioContext)
        return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        this.log("warn", "AudioContext not available, audio-based skip disabled.");
        return;
      }
      this.video = video;
      try {
        this.audioContext = new AudioCtx({ latencyHint: "interactive" });
      } catch (e) {
        this.log("warn", "Failed to start AudioContext:", e);
        this.audioContext = null;
        return;
      }
      this.state = {
        currentSumSq: 0,
        currentSamples: 0,
        windows: [],
        windowSamples: Math.max(1, Math.floor(this.config.windowSec * this.audioContext.sampleRate))
      };
      this._lastEmitted = null;
      this._silenceProbeRemaining = this.config.silenceProbeWindows;
      this._taintedDetected = false;
      try {
        this.sourceNode = this.audioContext.createMediaElementSource(video);
      } catch (e) {
        this.log("warn", "Cannot create media source:", e);
        this.stop();
        return;
      }
      const inputChannels = Math.max(1, this.sourceNode.channelCount || 2);
      this.processorNode = this.audioContext.createScriptProcessor(2048, inputChannels, inputChannels);
      this.processorNode.onaudioprocess = (event) => this._handleProcess(event);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = this.config.fftSize;
      this.analyserNode.smoothingTimeConstant = 0.5;
      this.spectralBuffer = new Float32Array(this.analyserNode.frequencyBinCount);
      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.value = 0;
      try {
        this.sourceNode.connect(this.audioContext.destination);
        this.sourceNode.connect(this.analyserNode);
        this.sourceNode.connect(this.processorNode);
        this.processorNode.connect(this.silentGainNode);
        this.silentGainNode.connect(this.audioContext.destination);
      } catch (e) {
        this.log("warn", "Cannot wire audio nodes:", e);
        this.stop();
        return;
      }
      if (this.audioContext.state === "suspended") {
        this.audioContext.resume().catch(() => {
        });
      }
      this._onPlay = () => {
        if (this.audioContext && this.audioContext.state === "suspended") {
          this.audioContext.resume().catch(() => {
          });
        }
      };
      this._onSeeking = () => this.resetWindowAccumulator();
      video.addEventListener("play", this._onPlay);
      video.addEventListener("seeking", this._onSeeking);
      this.log("log", "audio analysis started", {
        sampleRate: this.audioContext.sampleRate,
        windowSec: this.config.windowSec
      });
    }
    stop() {
      [this.processorNode, this.sourceNode, this.silentGainNode, this.analyserNode].forEach((node) => {
        if (!node)
          return;
        try {
          node.disconnect();
        } catch (e) {
        }
      });
      if (this.audioContext) {
        try {
          this.audioContext.close();
        } catch (e) {
        }
      }
      if (this.video && this._onPlay) {
        try {
          this.video.removeEventListener("play", this._onPlay);
        } catch (e) {
        }
      }
      if (this.video && this._onSeeking) {
        try {
          this.video.removeEventListener("seeking", this._onSeeking);
        } catch (e) {
        }
      }
      this.video = null;
      this.audioContext = null;
      this.sourceNode = null;
      this.processorNode = null;
      this.analyserNode = null;
      this.silentGainNode = null;
      this.state = null;
      this.spectralBuffer = null;
      this._onPlay = null;
      this._onSeeking = null;
      this._lastEmitted = null;
    }
    cancel() {
      super.cancel();
      this.stop();
    }
    resetWindowAccumulator() {
      if (!this.state)
        return;
      this.state.currentSamples = 0;
      this.state.currentSumSq = 0;
    }
    resetSession() {
      if (!this.state)
        return;
      this.state.currentSamples = 0;
      this.state.currentSumSq = 0;
      this.state.windows = [];
      this._lastEmitted = null;
      this._silenceProbeRemaining = this.config.silenceProbeWindows;
    }
    _handleProcess(event) {
      if (!this.state || !this.video)
        return;
      const inputBuffer = event.inputBuffer;
      if (!inputBuffer)
        return;
      const channelCount = inputBuffer.numberOfChannels;
      if (!channelCount)
        return;
      const length = inputBuffer.length;
      const channels = [];
      for (let c = 0; c < channelCount; c += 1) {
        channels.push(inputBuffer.getChannelData(c));
      }
      const state = this.state;
      const windowSamples = state.windowSamples;
      for (let i = 0; i < length; i += 1) {
        let sample = 0;
        for (let c = 0; c < channelCount; c += 1)
          sample += channels[c][i];
        sample /= channelCount;
        state.currentSumSq += sample * sample;
        state.currentSamples += 1;
        if (state.currentSamples >= windowSamples) {
          const rms = Math.sqrt(state.currentSumSq / state.currentSamples);
          const endTime = this.video.currentTime;
          const startTime = Math.max(0, endTime - this.config.windowSec);
          const voiceRatio = this._computeVoiceRatio();
          state.windows.push({ start: startTime, end: endTime, rms, voiceRatio });
          this._trimWindows();
          this._handleSilenceProbe(rms);
          if (!this._taintedDetected)
            this._updateSegments();
          state.currentSumSq = 0;
          state.currentSamples = 0;
        }
      }
    }
    _handleSilenceProbe(rms) {
      if (this._silenceProbeRemaining <= 0)
        return;
      this._silenceProbeRemaining -= 1;
      if (rms > this.config.silenceProbeRmsThreshold) {
        this._silenceProbeRemaining = 0;
        return;
      }
      if (this._silenceProbeRemaining === 0) {
        this._taintedDetected = true;
        this.log("warn", "audio tainted (CORS) or silent stream — provider disabled.");
        try {
          this.onTainted();
        } catch (e) {
        }
        this.cancel();
      }
    }
    _computeVoiceRatio() {
      if (!this.analyserNode || !this.spectralBuffer)
        return null;
      try {
        this.analyserNode.getFloatFrequencyData(this.spectralBuffer);
      } catch (e) {
        return null;
      }
      const sampleRate = this.audioContext ? this.audioContext.sampleRate : 48e3;
      const binCount = this.spectralBuffer.length;
      const loIdx = clampFreqIndex(VOICE_BAND_LO, sampleRate, binCount);
      const hiIdx = clampFreqIndex(VOICE_BAND_HI, sampleRate, binCount);
      const fullHiIdx = clampFreqIndex(FULL_BAND_HI, sampleRate, binCount);
      let voiceEnergy = 0;
      let fullEnergy = 0;
      for (let i = 1; i < fullHiIdx; i += 1) {
        const dB = this.spectralBuffer[i];
        if (!Number.isFinite(dB))
          continue;
        const linear = Math.pow(10, dB / 20);
        fullEnergy += linear;
        if (i >= loIdx && i <= hiIdx)
          voiceEnergy += linear;
      }
      if (fullEnergy <= 0)
        return null;
      return voiceEnergy / fullEnergy;
    }
    _maybeLogProgress(info) {
      const now = Date.now();
      if (now - this._lastProgressLogAt < 1e4)
        return;
      this._lastProgressLogAt = now;
      this.log("log", "audio progress", info);
    }
    _trimWindows() {
      if (!this.state)
        return;
      const maxWindows = 3600;
      if (this.state.windows.length > maxWindows) {
        const excess = this.state.windows.length - maxWindows;
        this.state.windows.splice(0, excess);
      }
    }
    _updateSegments() {
      if (!this.state || !this.video)
        return;
      const duration = this.video.duration;
      if (!Number.isFinite(duration) || duration <= 0)
        return;
      const windows = this.state.windows;
      if (!windows.length)
        return;
      if (windows.length < this.config.warmupWindows) {
        this._maybeLogProgress({ phase: "warmup", windows: windows.length });
        return;
      }
      const baselineSize = Math.min(this.config.baselineWindows, windows.length);
      const baselineSlice = windows.slice(-baselineSize);
      const values = baselineSlice.map((w) => w.rms);
      const rawMedian = computeMedian(values);
      const median = Math.max(rawMedian, this.config.minBaselineRms);
      let mad = computeMedian(values.map((v) => Math.abs(v - median)));
      if (!Number.isFinite(mad) || mad < 1e-7) {
        const variance = values.reduce((s, v) => s + (v - median) * (v - median), 0) / Math.max(values.length, 1);
        mad = Math.sqrt(Math.max(variance, 0)) / 1.4826 || 1e-6;
      }
      const thresh = Math.max(this.config.zThreshold * mad * 1.4826, this.config.minThreshold);
      const flagged = [];
      for (let i = 0; i < windows.length; i += 1) {
        const w = windows[i];
        const rmsOutlier = w.rms - median > thresh;
        const aboveFloor = w.rms >= this.config.absoluteRmsFloor;
        const voiceLow = w.voiceRatio === null || w.voiceRatio < this.config.voiceMusicMaxRatio;
        if (rmsOutlier && aboveFloor && voiceLow)
          flagged.push({ start: w.start, end: w.end });
      }
      const merged = mergeSegments(flagged, this.config.mergeGapSec);
      const filtered = merged.filter((seg) => seg.end - seg.start >= this.config.minSegmentSec);
      this._maybeLogProgress({
        phase: "analysing",
        windows: windows.length,
        median,
        threshold: thresh,
        flagged: flagged.length,
        candidates: filtered.length
      });
      if (!filtered.length)
        return;
      const introCutoff = duration * this.config.introMaxFraction;
      const creditsCutoff = duration * this.config.creditsMinFraction;
      const introCandidates = filtered.filter((seg) => seg.start <= introCutoff).filter((seg) => seg.start >= this.config.introMinStartSec).filter((seg) => seg.end - seg.start >= this.config.introMinDurationSec).sort((a, b) => a.start - b.start);
      const creditsCandidates = filtered.filter((seg) => seg.end >= creditsCutoff).filter((seg) => seg.end - seg.start >= this.config.creditsMinDurationSec).sort((a, b) => a.start - b.start);
      const newRanges = { intro: [], credits: [] };
      if (introCandidates.length)
        newRanges.intro.push(introCandidates[0]);
      if (creditsCandidates.length)
        newRanges.credits.push(creditsCandidates[creditsCandidates.length - 1]);
      if (!newRanges.intro.length && !newRanges.credits.length)
        return;
      if (this._lastEmitted) {
        const sameIntro = rangesEqual(this._lastEmitted.intro, newRanges.intro);
        const sameCredits = rangesEqual(this._lastEmitted.credits, newRanges.credits);
        if (sameIntro && sameCredits)
          return;
      }
      this._lastEmitted = newRanges;
      this.onUpdate(newRanges, {
        windows: windows.length,
        baseline: { size: baselineSize, median, mad, threshold: thresh },
        candidates: filtered.length
      });
    }
  };

  // src/segments/providers/aniskip/tmdbToMal.js
  var TMDB_TO_MAL = {
    1429: 16498,
    // Attack on Titan
    85937: 38e3,
    // Demon Slayer
    95479: 40748,
    // Jujutsu Kaisen
    65930: 31964,
    // My Hero Academia
    63926: 30276,
    // One Punch Man
    13916: 1535,
    // Death Note
    31910: 9253,
    // Steins;Gate
    16245: 1575,
    // Code Geass
    46260: 1735,
    // Naruto Shippuden
    46298: 20,
    // Naruto
    118646: 41467,
    // Bleach: TYBW
    30984: 269,
    // Bleach (original)
    120089: 50265,
    // Spy x Family
    114410: 44511,
    // Chainsaw Man
    65840: 31240,
    // Re:Zero
    65786: 32182,
    // Mob Psycho 100
    82684: 37521,
    // Vinland Saga
    72636: 34599,
    // Made in Abyss
    65754: 30831,
    // Konosuba
    104134: 39535,
    // Mushoku Tensei
    127532: 52299,
    // Solo Leveling
    209867: 52991,
    // Frieren
    105248: 42310,
    // Cyberpunk: Edgerunners
    37854: 21,
    // One Piece
    60863: 22319,
    // Tokyo Ghoul
    62741: 30694,
    // Tokyo Ghoul: Re
    106057: 40028,
    // Attack on Titan: Final Season
    60572: 11061,
    // Hunter x Hunter (2011)
    93685: 38161,
    // Dr. Stone
    95479: 40748,
    // Jujutsu Kaisen
    68552: 28977,
    // Gintama
    61374: 11757,
    // Sword Art Online
    77834: 31043,
    // Boku no Hero Academia (other split)
    60863: 22319,
    // Tokyo Ghoul
    101414: 44037,
    // Horimiya
    85688: 38040,
    // Kaguya-sama: Love is War
    93902: 39247,
    // Beastars
    114795: 44074,
    // Komi-san
    86031: 35790,
    // Tate no Yuusha
    124364: 51019,
    // Oshi no Ko
    221463: 56964,
    // Dandadan
    157084: 50796,
    // Hell's Paradise
    220150: 53924,
    // The Apothecary Diaries
    93684: 36474,
    // Yakusoku no Neverland
    80564: 31240,
    // (Re:Zero alt)
    207865: 56230,
    // Wind Breaker
    223225: 58460,
    // Suicide Squad Isekai
    240411: 60022,
    // Dan Da Dan (alt)
    73223: 33352,
    // Violet Evergarden
    82665: 37347,
    // Goblin Slayer
    138502: 50709,
    // Lycoris Recoil
    119495: 47917,
    // Ranking of Kings
    76669: 33486,
    // Boku no Hero Academia (split alt)
    79220: 35073,
    // Overlord III (split alt)
    31911: 9253,
    // Steins;Gate (alt)
    65930: 31964,
    // My Hero Academia
    46298: 20,
    // Naruto
    37854: 21,
    // One Piece
    74258: 34134
    // One Punch Man Season 2
  };

  // src/segments/providers/AniSkipProvider.js
  var API_BASE = "https://api.aniskip.com/v2/skip-times";
  var FETCH_TIMEOUT_MS = 8e3;
  function getLampa8() {
    return typeof Lampa !== "undefined" ? Lampa : null;
  }
  function getPlayerData3() {
    const lampa = getLampa8();
    if (!lampa || !lampa.Player)
      return null;
    try {
      if (typeof lampa.Player.data === "function")
        return lampa.Player.data();
      if (typeof lampa.Player.get === "function")
        return lampa.Player.get();
      if (lampa.Player.current)
        return lampa.Player.current;
    } catch (e) {
    }
    return null;
  }
  function getActivityCard2() {
    const lampa = getLampa8();
    try {
      if (lampa && lampa.Activity && typeof lampa.Activity.active === "function") {
        const activity = lampa.Activity.active();
        if (activity && activity.card)
          return activity.card;
      }
    } catch (e) {
    }
    return null;
  }
  function getCardSnapshot() {
    const data = getPlayerData3() || {};
    const card = data.movie || data.card || getActivityCard2() || {};
    const tmdb = Number(card.id || card.tmdb_id || data.id || NaN);
    const season = Number(data.season_number !== void 0 ? data.season_number : data.season);
    const episode = Number(data.episode_number !== void 0 ? data.episode_number : data.episode);
    return {
      tmdb: Number.isFinite(tmdb) && tmdb > 0 ? tmdb : null,
      season: Number.isFinite(season) ? season : null,
      episode: Number.isFinite(episode) ? episode : null,
      originalLanguage: card.original_language || null,
      genreIds: Array.isArray(card.genre_ids) ? card.genre_ids : [],
      title: card.original_name || card.name || card.title || ""
    };
  }
  function readUserMap() {
    const lampa = getLampa8();
    if (!lampa || !lampa.Storage || typeof lampa.Storage.get !== "function")
      return null;
    try {
      const raw = lampa.Storage.get("autoskip_aniskip_map", null);
      if (!raw)
        return null;
      if (typeof raw === "object")
        return raw;
      if (typeof raw === "string")
        return JSON.parse(raw);
    } catch (e) {
    }
    return null;
  }
  function resolveMalId(tmdbId) {
    if (!tmdbId)
      return null;
    const userMap = readUserMap();
    if (userMap && userMap[tmdbId] != null) {
      const num = Number(userMap[tmdbId]);
      if (Number.isFinite(num) && num > 0)
        return num;
    }
    if (TMDB_TO_MAL[tmdbId] != null)
      return TMDB_TO_MAL[tmdbId];
    return null;
  }
  function isLikelyAnime(card) {
    if (!card)
      return false;
    if (card.originalLanguage === "ja")
      return true;
    if (Array.isArray(card.genreIds) && card.genreIds.includes(16))
      return true;
    return false;
  }
  function fetchWithTimeout(url, timeoutMs) {
    if (typeof fetch !== "function")
      return Promise.reject(new Error("fetch unavailable"));
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const promise = fetch(url, ctrl ? { signal: ctrl.signal } : void 0);
    if (!ctrl)
      return promise;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    return promise.finally(() => clearTimeout(timer));
  }
  function classifySkipType(skipType) {
    if (!skipType)
      return null;
    const lowered = String(skipType).toLowerCase();
    if (lowered.includes("op") || lowered === "opening")
      return "intro";
    if (lowered.includes("ed") || lowered === "ending")
      return "credits";
    if (lowered === "recap" || lowered === "mixed-op")
      return "intro";
    return null;
  }
  var AniSkipProvider = class extends ProviderBase {
    constructor({ log, getSettings }) {
      super({ name: "aniskip", log });
      this.getSettings = getSettings || (() => ({}));
    }
    isApplicable(ctx) {
      const settings = this.getSettings();
      if (!settings || settings.useAniSkip === false)
        return false;
      const card = getCardSnapshot();
      if (!card.tmdb)
        return false;
      if (!isLikelyAnime(card))
        return false;
      if (!resolveMalId(card.tmdb))
        return false;
      if (card.episode === null)
        return false;
      if (!ctx || !ctx.video)
        return false;
      return true;
    }
    async run(ctx, onUpdate) {
      if (typeof fetch !== "function")
        return;
      const card = getCardSnapshot();
      const malId = resolveMalId(card.tmdb);
      if (!malId)
        return;
      const duration = Number.isFinite(ctx.video.duration) ? Math.round(ctx.video.duration) : 0;
      if (duration <= 0)
        return;
      const url = `${API_BASE}/${malId}/${card.episode}?types[]=op&types[]=ed&episodeLength=${duration}`;
      let response;
      try {
        response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      } catch (e) {
        this.log("warn", "aniskip fetch failed", e && e.message ? e.message : e);
        return;
      }
      if (this.cancelled)
        return;
      if (!response || !response.ok) {
        if (response)
          this.log("warn", `aniskip API responded ${response.status}`);
        return;
      }
      let body;
      try {
        body = await response.json();
      } catch (e) {
        this.log("warn", "aniskip response not JSON", e);
        return;
      }
      if (!body || body.found === false)
        return;
      const results = Array.isArray(body.results) ? body.results : [];
      if (!results.length)
        return;
      const ranges = { intro: [], credits: [] };
      for (const item of results) {
        const kind = classifySkipType(item && item.skipType);
        const interval = item && item.interval;
        if (!kind || !interval)
          continue;
        const start = Number(interval.startTime);
        const end = Number(interval.endTime);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
          continue;
        ranges[kind].push({ start, end });
      }
      if (!ranges.intro.length && !ranges.credits.length)
        return;
      if (this.cancelled)
        return;
      if (this.log) {
        this.log("log", "aniskip API hit", {
          malId,
          episode: card.episode,
          intro: ranges.intro,
          credits: ranges.credits
        });
      }
      onUpdate(ranges, { source: "aniskip", malId, episode: card.episode });
    }
  };

  // src/segments/providers/TheIntroDBProvider.js
  var API_BASE2 = "https://api.theintrodb.org/v2/media";
  var USER_AGENT = "AutoSkip Lampa Plugin";
  var REQUEST_TIMEOUT_MS = 6e3;
  var CACHE_KEY_PREFIX = "autoskip_tidb_";
  var CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
  var NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
  function getLampaStorage() {
    if (typeof Lampa === "undefined" || !Lampa.Storage)
      return null;
    return Lampa.Storage;
  }
  function readStorageField(key) {
    const storage = getLampaStorage();
    if (!storage || typeof storage.field !== "function")
      return null;
    try {
      const raw = storage.field(key);
      if (raw === "" || raw === void 0 || raw === null)
        return null;
      if (typeof raw === "string") {
        try {
          return JSON.parse(raw);
        } catch (e) {
          return null;
        }
      }
      return raw;
    } catch (e) {
      return null;
    }
  }
  function writeStorageField(key, value) {
    const storage = getLampaStorage();
    if (!storage || typeof storage.set !== "function")
      return;
    try {
      storage.set(key, value);
    } catch (e) {
    }
  }
  var TheIntroDBProvider = class extends ProviderBase {
    constructor({ log, getSettings, getContentIds: getContentIds2 }) {
      super({ name: "theintrodb", log });
      this.getSettings = getSettings || (() => ({}));
      this.getContentIds = getContentIds2 || (() => null);
      this.abortController = null;
    }
    isApplicable() {
      const settings = this.getSettings();
      if (settings.useTheIntroDB === false)
        return false;
      if (typeof fetch !== "function")
        return false;
      const ids = this.getContentIds();
      if (!ids)
        return false;
      return !!(ids.tmdb_id || ids.imdb_id);
    }
    async run(ctx, onUpdate) {
      const ids = this.getContentIds();
      if (!ids)
        return;
      const cacheKey = this._cacheKey(ids);
      const cached = readStorageField(cacheKey);
      if (cached && this._isFreshCache(cached)) {
        if (cached.empty) {
          if (this.getSettings().debug) {
            this.log("log", "TheIntroDB cache hit (empty), skipping fetch.");
          }
          return;
        }
        if (this.cancelled)
          return;
        const ranges2 = this._normalizeRanges(cached.ranges);
        if (ranges2.intro.length || ranges2.credits.length) {
          onUpdate(ranges2, { confidence: "high", source: "theintrodb_cache" });
        }
        return;
      }
      const queryString = this._buildQuery(ids);
      if (!queryString)
        return;
      const url = `${API_BASE2}?${queryString}`;
      const settings = this.getSettings();
      const headers = { "User-Agent": USER_AGENT };
      if (settings.theIntroDbApiKey)
        headers.Authorization = `Bearer ${settings.theIntroDbApiKey}`;
      let timeoutId = null;
      if (typeof AbortController === "function") {
        this.abortController = new AbortController();
        timeoutId = setTimeout(() => {
          if (this.abortController) {
            try {
              this.abortController.abort();
            } catch (e) {
            }
          }
        }, REQUEST_TIMEOUT_MS);
      }
      const fetchOptions = {
        method: "GET",
        headers,
        mode: "cors",
        credentials: "omit"
      };
      if (this.abortController)
        fetchOptions.signal = this.abortController.signal;
      let response;
      try {
        response = await fetch(url, fetchOptions);
      } catch (err) {
        if (timeoutId)
          clearTimeout(timeoutId);
        if (!this.cancelled)
          this.log("warn", "TheIntroDB fetch failed", err && err.message ? err.message : err);
        return;
      } finally {
        if (timeoutId)
          clearTimeout(timeoutId);
      }
      if (this.cancelled)
        return;
      if (response.status === 404) {
        writeStorageField(cacheKey, { ts: Date.now(), empty: true });
        if (settings.debug)
          this.log("log", "TheIntroDB: not in database (404), negative cache.");
        return;
      }
      if (!response.ok) {
        this.log("warn", `TheIntroDB HTTP ${response.status}`);
        return;
      }
      let json;
      try {
        json = await response.json();
      } catch (e) {
        this.log("warn", "TheIntroDB response not JSON", e);
        return;
      }
      if (this.cancelled)
        return;
      const ranges = this._parseResponse(json);
      if (!ranges.intro.length && !ranges.credits.length) {
        writeStorageField(cacheKey, { ts: Date.now(), empty: true });
        if (settings.debug)
          this.log("log", "TheIntroDB: empty payload, negative cache.", json);
        return;
      }
      writeStorageField(cacheKey, { ts: Date.now(), ranges });
      if (settings.debug) {
        this.log("log", "TheIntroDB segments fetched", {
          intro: ranges.intro,
          credits: ranges.credits,
          query: queryString
        });
      }
      onUpdate(ranges, { confidence: "high", source: "theintrodb", query: queryString });
    }
    cancel() {
      super.cancel();
      if (this.abortController) {
        try {
          this.abortController.abort();
        } catch (e) {
        }
        this.abortController = null;
      }
    }
    reset() {
      super.reset();
      this.abortController = null;
    }
    _isFreshCache(entry) {
      if (!entry || typeof entry !== "object" || !Number.isFinite(entry.ts))
        return false;
      const age = Date.now() - entry.ts;
      if (entry.empty)
        return age < NEGATIVE_CACHE_TTL_MS;
      return age < CACHE_TTL_MS;
    }
    _buildQuery(ids) {
      const parts = [];
      if (ids.tmdb_id)
        parts.push(`tmdb_id=${encodeURIComponent(ids.tmdb_id)}`);
      else if (ids.imdb_id)
        parts.push(`imdb_id=${encodeURIComponent(ids.imdb_id)}`);
      else
        return null;
      if (ids.season !== null && ids.season !== void 0)
        parts.push(`season=${encodeURIComponent(ids.season)}`);
      if (ids.episode !== null && ids.episode !== void 0)
        parts.push(`episode=${encodeURIComponent(ids.episode)}`);
      return parts.join("&");
    }
    _cacheKey(ids) {
      const idPart = ids.tmdb_id ? `tmdb_${ids.tmdb_id}` : `imdb_${ids.imdb_id}`;
      const s = ids.season === null || ids.season === void 0 ? 0 : ids.season;
      const e = ids.episode === null || ids.episode === void 0 ? 0 : ids.episode;
      return `${CACHE_KEY_PREFIX}${idPart}_s${s}_e${e}`;
    }
    _parseResponse(json) {
      const ranges = { intro: [], credits: [] };
      if (!json || typeof json !== "object")
        return ranges;
      const introList = Array.isArray(json.intro) ? json.intro : [];
      const recapList = Array.isArray(json.recap) ? json.recap : [];
      const creditsList = Array.isArray(json.credits) ? json.credits : [];
      introList.forEach((seg) => {
        const range = this._segToRange(seg);
        if (range)
          ranges.intro.push(range);
      });
      recapList.forEach((seg) => {
        const range = this._segToRange(seg);
        if (range)
          ranges.intro.push(range);
      });
      creditsList.forEach((seg) => {
        const range = this._segToRange(seg);
        if (range)
          ranges.credits.push(range);
      });
      return ranges;
    }
    _segToRange(seg) {
      if (!seg || typeof seg !== "object")
        return null;
      const startMs = Number(seg.start_ms !== void 0 ? seg.start_ms : seg.startMs);
      const endMs = Number(seg.end_ms !== void 0 ? seg.end_ms : seg.endMs);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs))
        return null;
      const start = startMs / 1e3;
      const end = endMs / 1e3;
      if (end <= start)
        return null;
      return { start, end };
    }
    _normalizeRanges(raw) {
      const result = { intro: [], credits: [] };
      if (!raw || typeof raw !== "object")
        return result;
      if (Array.isArray(raw.intro))
        raw.intro.forEach((r) => {
          const start = Number(r.start);
          const end = Number(r.end);
          if (Number.isFinite(start) && Number.isFinite(end) && end > start)
            result.intro.push({ start, end });
        });
      if (Array.isArray(raw.credits))
        raw.credits.forEach((r) => {
          const start = Number(r.start);
          const end = Number(r.end);
          if (Number.isFinite(start) && Number.isFinite(end) && end > start)
            result.credits.push({ start, end });
        });
      return result;
    }
  };

  // src/segments/providers/SubtitleProvider.js
  var MUSIC_MARKERS = /[♪♫♬♩]|\[(music|opening|theme|song|musical|opening theme|theme song|intro)\]|\((music|theme|opening|musical|opening theme|theme song)\)|♪|♫|♬|♩/i;
  var RECAP_MARKERS = /\bpreviously on\b|ранее в|в предыдущ|в прошлы(й|х) сери/i;
  var CREDITS_MARKERS_EN = /\b(directed by|created by|written by|produced by|executive producer|cast|music by|edited by|editor|cinematography|director of photography|costumes by|production designer|original music)\b/i;
  var CREDITS_MARKERS_RU = /\b(режиссёр|режиссер|сценар|продюсер|оператор|композитор|производство|в ролях|монтаж)\b/iu;
  var COLLECTION_RETRIES = 12;
  var COLLECTION_INTERVAL_MS = 600;
  var MIN_INTRO_LEN_SEC = 8;
  var MIN_RECAP_LEN_SEC = 10;
  var SILENCE_GAP_FOR_CREDITS_SEC = 75;
  function maybeFetchSubtitleUrl(url, timeoutMs = 6e3) {
    if (typeof fetch !== "function")
      return Promise.resolve(null);
    if (!url || typeof url !== "string")
      return Promise.resolve(null);
    let timer = null;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const opts = { method: "GET", mode: "cors", credentials: "omit" };
    if (ctrl) {
      opts.signal = ctrl.signal;
      timer = setTimeout(() => {
        try {
          ctrl.abort();
        } catch (e) {
        }
      }, timeoutMs);
    }
    return fetch(url, opts).then((res) => res.ok ? res.text() : null).catch(() => null).finally(() => {
      if (timer)
        clearTimeout(timer);
    });
  }
  function parseTimestamp(input) {
    if (!input)
      return NaN;
    const cleaned = String(input).trim().replace(",", ".");
    const m = cleaned.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!m)
      return NaN;
    const hours = m[1] ? Number(m[1]) : 0;
    const minutes = Number(m[2]);
    const seconds = Number(m[3]);
    const ms = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
    return hours * 3600 + minutes * 60 + seconds + ms / 1e3;
  }
  function parseSrtOrVtt(text) {
    if (!text || typeof text !== "string")
      return [];
    const cues = [];
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || line === "WEBVTT" || line.startsWith("NOTE") || line.startsWith("STYLE")) {
        i += 1;
        continue;
      }
      let timecode = line;
      if (!/-->/.test(timecode)) {
        i += 1;
        if (i >= lines.length)
          break;
        timecode = lines[i].trim();
        if (!/-->/.test(timecode))
          continue;
      }
      const parts = timecode.split("-->");
      if (parts.length < 2) {
        i += 1;
        continue;
      }
      const start = parseTimestamp(parts[0].trim());
      const end = parseTimestamp(parts[1].trim().split(" ")[0]);
      i += 1;
      const buf = [];
      while (i < lines.length && lines[i].trim() !== "") {
        buf.push(lines[i]);
        i += 1;
      }
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        cues.push({ start, end, text: buf.join("\n") });
      }
      while (i < lines.length && lines[i].trim() === "")
        i += 1;
    }
    return cues;
  }
  var SubtitleProvider = class extends ProviderBase {
    constructor({ log, getSettings }) {
      super({ name: "subtitle", log });
      this.getSettings = getSettings || (() => ({}));
      this._listenerRefs = [];
    }
    isApplicable(ctx) {
      if (!ctx || !ctx.video)
        return false;
      if (typeof document === "undefined")
        return false;
      return true;
    }
    async run(ctx, onUpdate) {
      const video = ctx.video;
      const debug = !!this.getSettings().debug;
      const cues = await this._collectCues(video);
      if (this.cancelled)
        return;
      if (!cues || !cues.length) {
        if (debug) {
          const reason = video && video.customSubs && video.customSubs.length ? "customSubs URL not fetchable / not parsed" : video && video.textTracks && video.textTracks.length ? "textTracks empty (no cues)" : "no subtitle tracks attached";
          this.log("log", `subtitle provider: no cues collected — ${reason}.`);
        }
        return;
      }
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration <= 0)
        return;
      const ranges = this._analyse(cues, duration);
      if (!ranges.intro.length && !ranges.credits.length) {
        if (debug)
          this.log("log", `subtitle provider: ${cues.length} cues collected, no intro/credits markers matched.`);
        return;
      }
      if (debug) {
        this.log("log", `subtitle provider: ${cues.length} cues, segments`, { intro: ranges.intro, credits: ranges.credits });
      }
      onUpdate(ranges, { confidence: "medium", source: "subtitle", cues: cues.length });
    }
    async _collectCues(video) {
      for (let attempt = 0; attempt < COLLECTION_RETRIES; attempt += 1) {
        if (this.cancelled)
          return null;
        const direct = this._extractTextTracksCues(video);
        if (direct && direct.length)
          return direct;
        const lampaCues = await this._extractLampaCues(video);
        if (this.cancelled)
          return null;
        if (lampaCues && lampaCues.length)
          return lampaCues;
        await new Promise((r) => setTimeout(r, COLLECTION_INTERVAL_MS));
      }
      return null;
    }
    _extractTextTracksCues(video) {
      if (!video || !video.textTracks)
        return null;
      const result = [];
      for (let i = 0; i < video.textTracks.length; i += 1) {
        const track = video.textTracks[i];
        if (!track)
          continue;
        if (track.kind && track.kind !== "subtitles" && track.kind !== "captions")
          continue;
        const cues = track.cues;
        if (!cues || !cues.length)
          continue;
        for (let j = 0; j < cues.length; j += 1) {
          const cue = cues[j];
          if (!cue)
            continue;
          const start = Number(cue.startTime);
          const end = Number(cue.endTime);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
            continue;
          result.push({ start, end, text: cue.text || "" });
        }
      }
      return result.length ? result : null;
    }
    async _extractLampaCues(video) {
      const customSubs = video && video.customSubs;
      if (!customSubs || !customSubs.length)
        return null;
      const active = customSubs.find((s) => s && (s.mode === "showing" || s.active === true)) || customSubs[0];
      if (!active || !active.url)
        return null;
      const text = await maybeFetchSubtitleUrl(active.url);
      if (!text)
        return null;
      const cues = parseSrtOrVtt(text);
      return cues.length ? cues : null;
    }
    _analyse(cues, duration) {
      const ranges = { intro: [], credits: [] };
      const introZone = duration * 0.3;
      const creditsZone = duration * 0.7;
      const introMusic = cues.filter((c) => c.start <= introZone && MUSIC_MARKERS.test(c.text));
      if (introMusic.length) {
        const start = Math.min.apply(null, introMusic.map((c) => c.start));
        const end = Math.max.apply(null, introMusic.map((c) => c.end));
        if (end - start >= MIN_INTRO_LEN_SEC)
          ranges.intro.push({ start, end });
      }
      if (!ranges.intro.length) {
        const recap = cues.filter((c) => c.start <= introZone && RECAP_MARKERS.test(c.text));
        if (recap.length) {
          const start = Math.min.apply(null, recap.map((c) => c.start));
          const end = Math.max.apply(null, recap.map((c) => c.end));
          if (end - start >= MIN_RECAP_LEN_SEC)
            ranges.intro.push({ start, end });
        }
      }
      const creditsCue = cues.filter((c) => c.start >= creditsZone && (CREDITS_MARKERS_EN.test(c.text) || CREDITS_MARKERS_RU.test(c.text)));
      if (creditsCue.length) {
        const start = Math.min.apply(null, creditsCue.map((c) => c.start));
        ranges.credits.push({ start, end: duration });
      } else {
        const lastBody = cues.filter((c) => c.end < creditsZone).pop();
        const tailCues = cues.filter((c) => c.start >= creditsZone);
        if (!tailCues.length && lastBody && duration - lastBody.end >= SILENCE_GAP_FOR_CREDITS_SEC) {
          ranges.credits.push({ start: lastBody.end + 5, end: duration });
        }
      }
      return ranges;
    }
  };

  // src/segments/providers/VisualProvider.js
  var SAMPLE_INTERVAL_MS = 1e3;
  var CANVAS_WIDTH = 64;
  var CANVAS_HEIGHT = 36;
  var BLACK_LUMA_THRESHOLD = 18;
  var BLACK_PIXEL_RATIO = 0.95;
  var STATIC_DIFF_THRESHOLD = 6;
  var MIN_BLACK_RUN_SEC = 4;
  var MIN_STATIC_RUN_SEC = 20;
  var MIN_INTRO_LEN_SEC2 = 8;
  var VisualProvider = class extends ProviderBase {
    constructor({ log, getSettings }) {
      super({ name: "visual", log });
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
      if (!ctx || !ctx.video)
        return false;
      if (typeof document === "undefined")
        return false;
      if (typeof OffscreenCanvas === "undefined" && typeof document.createElement !== "function")
        return false;
      return true;
    }
    async run(ctx, onUpdate) {
      this.video = ctx.video;
      this.onUpdate = onUpdate;
      this.canvas = document.createElement("canvas");
      this.canvas.width = CANVAS_WIDTH;
      this.canvas.height = CANVAS_HEIGHT;
      this.ctx2d = this.canvas.getContext("2d", { willReadFrequently: true });
      if (!this.ctx2d)
        return;
      if (!this._probeReadback()) {
        if (this.getSettings().debug)
          this.log("warn", "visual provider: video tainted, disabled.");
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
        try {
          clearInterval(this.timer);
        } catch (e) {
        }
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
      if (!this.video || !this.ctx2d)
        return false;
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
      if (this.timer)
        return;
      this.timer = setInterval(() => this._tick(), SAMPLE_INTERVAL_MS);
    }
    _tick() {
      if (this.cancelled || !this.video || !this.ctx2d)
        return;
      const duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
      if (duration <= 0)
        return;
      const t2 = Number(this.video.currentTime);
      if (!Number.isFinite(t2))
        return;
      const introZone = Math.min(360, duration * 0.3);
      const creditsZone = Math.max(duration - 300, duration * 0.7);
      const inIntro = t2 <= introZone;
      const inCredits = t2 >= creditsZone;
      if (!inIntro && !inCredits)
        return;
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
      sample.t = t2;
      sample.diff = this.lastFrameData ? this._diff(frameData, this.lastFrameData) : null;
      this.lastFrameData = frameData;
      this.samples.push(sample);
      while (this.samples.length > 600)
        this.samples.shift();
      this._evaluateSegments(duration);
    }
    _analyseFrame(imageData) {
      const data = imageData.data;
      const len = data.length;
      let sumLuma = 0;
      let blackPixels = 0;
      const total = len >> 2;
      for (let i = 0; i < len; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = (r * 299 + g * 587 + b * 114) / 1e3;
        sumLuma += luma;
        if (luma < BLACK_LUMA_THRESHOLD)
          blackPixels += 1;
      }
      const meanLuma = sumLuma / total;
      const blackRatio = blackPixels / total;
      return { meanLuma, blackRatio };
    }
    _diff(a, b) {
      if (!a || !b)
        return null;
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
      if (!this.samples.length)
        return;
      const ranges = { intro: [], credits: [] };
      const introSamples = this.samples.filter((s) => s.t <= Math.min(360, duration * 0.3));
      const intro = this._findIntroRange(introSamples);
      if (intro)
        ranges.intro.push(intro);
      const creditsSamples = this.samples.filter((s) => s.t >= Math.max(duration - 300, duration * 0.7));
      const credits = this._findCreditsRange(creditsSamples, duration);
      if (credits)
        ranges.credits.push(credits);
      if (!ranges.intro.length && !ranges.credits.length)
        return;
      const sig = JSON.stringify(ranges);
      if (sig === this._lastEmit)
        return;
      this._lastEmit = sig;
      if (this.onUpdate)
        this.onUpdate(ranges, { confidence: "medium", source: "visual", samples: this.samples.length });
    }
    _findIntroRange(samples) {
      if (samples.length < 8)
        return null;
      let runStart = null;
      let bestRun = null;
      for (let i = 0; i < samples.length; i += 1) {
        const s = samples[i];
        const isStatic = s.diff !== null && s.diff < STATIC_DIFF_THRESHOLD;
        const isDarkOrStatic = isStatic || s.blackRatio >= BLACK_PIXEL_RATIO || s.meanLuma < 40;
        if (isDarkOrStatic) {
          if (runStart === null)
            runStart = s.t;
          const length = s.t - runStart;
          if (length >= MIN_INTRO_LEN_SEC2 && (!bestRun || length > bestRun.end - bestRun.start)) {
            bestRun = { start: runStart, end: s.t };
          }
        } else {
          runStart = null;
        }
      }
      return bestRun;
    }
    _findCreditsRange(samples, duration) {
      if (samples.length < 8)
        return null;
      let runStart = null;
      for (let i = 0; i < samples.length; i += 1) {
        const s = samples[i];
        const isBlack = s.blackRatio >= BLACK_PIXEL_RATIO || s.meanLuma < 30;
        const isStatic = s.diff !== null && s.diff < STATIC_DIFF_THRESHOLD;
        if (isBlack || isStatic) {
          if (runStart === null)
            runStart = s.t;
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
  };

  // src/segments/providers/PrefetchAudioProvider.js
  var HEAD_TIMEOUT_MS = 4e3;
  var FETCH_TIMEOUT_MS2 = 3e4;
  var MAX_INTRO_BYTES = 8 * 1024 * 1024;
  var MAX_CREDITS_BYTES = 8 * 1024 * 1024;
  var RMS_WINDOW_SEC = 0.5;
  var BASELINE_WINDOWS = 30;
  var MIN_BASELINE_RMS = 0.012;
  var MIN_THRESHOLD = 0.01;
  var ABS_RMS_FLOOR = 0.04;
  var MIN_INTRO_SEG_SEC = 6;
  var MERGE_GAP_SEC = 3;
  var Z_THRESHOLD = 1.5;
  function fetchWithTimeout2(url, options, timeoutMs) {
    if (typeof fetch !== "function")
      return Promise.reject(new Error("fetch unavailable"));
    let timer = null;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const opts = Object.assign({}, options || {});
    if (ctrl) {
      opts.signal = ctrl.signal;
      timer = setTimeout(() => {
        try {
          ctrl.abort();
        } catch (e) {
        }
      }, timeoutMs);
    }
    return fetch(url, opts).finally(() => {
      if (timer)
        clearTimeout(timer);
    });
  }
  function isMp4ContentType(ct) {
    if (!ct)
      return false;
    const lowered = String(ct).toLowerCase();
    return lowered.indexOf("mp4") !== -1 || lowered.indexOf("m4a") !== -1;
  }
  function urlLooksLikeMp4(url) {
    if (!url || typeof url !== "string")
      return false;
    return /\.(mp4|m4v|m4a)(\?|#|$)/i.test(url);
  }
  var PrefetchAudioProvider = class extends ProviderBase {
    constructor({ log, getSettings }) {
      super({ name: "prefetch_audio", log });
      this.getSettings = getSettings || (() => ({}));
      this._abort = null;
    }
    isApplicable(ctx) {
      if (!ctx || !ctx.video)
        return false;
      if (typeof fetch !== "function")
        return false;
      const AudioCtx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
      if (!AudioCtx)
        return false;
      const src = ctx.video.currentSrc || ctx.video.src;
      if (!src)
        return false;
      if (!urlLooksLikeMp4(src)) {
        if (this.getSettings().debug)
          this.log("log", `prefetch_audio: src is not mp4-like (${src.slice(0, 80)}...), skipping.`);
        return false;
      }
      return true;
    }
    async run(ctx, onUpdate) {
      const video = ctx.video;
      const src = video.currentSrc || video.src;
      if (!src)
        return;
      const head = await this._head(src);
      if (this.cancelled)
        return;
      if (!head || !head.acceptRanges || !head.contentLength || !head.isMp4) {
        if (this.getSettings().debug)
          this.log("log", "prefetch_audio: source not eligible", head);
        return;
      }
      const introBlob = await this._fetchRange(src, 0, Math.min(MAX_INTRO_BYTES - 1, head.contentLength - 1));
      if (this.cancelled || !introBlob)
        return;
      const introResult = await this._analyseSegment(introBlob, "intro");
      if (this.cancelled)
        return;
      let creditsResult = null;
      if (head.contentLength > MAX_INTRO_BYTES + MAX_CREDITS_BYTES) {
        const tailStart = Math.max(0, head.contentLength - MAX_CREDITS_BYTES);
        const tailBlob = await this._fetchRange(src, tailStart, head.contentLength - 1);
        if (this.cancelled)
          return;
        if (tailBlob)
          creditsResult = await this._analyseSegment(tailBlob, "credits", { tailStart, totalBytes: head.contentLength, duration: video.duration });
        if (this.cancelled)
          return;
      }
      const ranges = { intro: [], credits: [] };
      if (introResult && introResult.intro)
        ranges.intro.push(introResult.intro);
      if (creditsResult && creditsResult.credits)
        ranges.credits.push(creditsResult.credits);
      if (!ranges.intro.length && !ranges.credits.length) {
        if (this.getSettings().debug)
          this.log("log", "prefetch_audio: no segments found in prefetch windows.");
        return;
      }
      if (this.getSettings().debug)
        this.log("log", "prefetch_audio: segments found", ranges);
      onUpdate(ranges, { confidence: "medium", source: "prefetch_audio" });
    }
    cancel() {
      super.cancel();
      if (this._abort) {
        try {
          this._abort.abort();
        } catch (e) {
        }
        this._abort = null;
      }
    }
    async _head(url) {
      let response;
      try {
        response = await fetchWithTimeout2(url, { method: "HEAD", mode: "cors", credentials: "omit" }, HEAD_TIMEOUT_MS);
      } catch (e) {
        this.log("warn", "prefetch_audio: HEAD failed", e && e.message ? e.message : e);
        return null;
      }
      if (!response || !response.ok)
        return null;
      const accept = (response.headers.get("accept-ranges") || "").toLowerCase();
      const ct = response.headers.get("content-type") || "";
      const len = Number(response.headers.get("content-length"));
      return {
        acceptRanges: accept === "bytes",
        contentLength: Number.isFinite(len) && len > 0 ? len : 0,
        contentType: ct,
        isMp4: isMp4ContentType(ct) || urlLooksLikeMp4(url)
      };
    }
    async _fetchRange(url, start, end) {
      const headers = { Range: `bytes=${start}-${end}` };
      let response;
      try {
        response = await fetchWithTimeout2(url, { method: "GET", headers, mode: "cors", credentials: "omit" }, FETCH_TIMEOUT_MS2);
      } catch (e) {
        this.log("warn", "prefetch_audio: range fetch failed", e && e.message ? e.message : e);
        return null;
      }
      if (!response.ok && response.status !== 206) {
        this.log("warn", `prefetch_audio: range ${start}-${end} HTTP ${response.status}`);
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
      try {
        audioCtx = new AudioCtx({ latencyHint: "interactive" });
      } catch (e) {
        return null;
      }
      let audioBuffer;
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      } catch (e) {
        try {
          audioCtx.close();
        } catch (err) {
        }
        if (this.getSettings().debug)
          this.log("log", `prefetch_audio: decode failed for ${kind}`, e && e.message ? e.message : e);
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
        const t2 = offset / sampleRate;
        windows.push({ start: t2, end: t2 + RMS_WINDOW_SEC, rms });
      }
      try {
        audioCtx.close();
      } catch (e) {
      }
      if (!windows.length)
        return null;
      const baselineSize = Math.min(BASELINE_WINDOWS, windows.length);
      const baseline = windows.slice(0, baselineSize).map((w) => w.rms);
      const rawMedian = computeMedian(baseline);
      const median = Math.max(rawMedian, MIN_BASELINE_RMS);
      let mad = computeMedian(baseline.map((v) => Math.abs(v - median)));
      if (!Number.isFinite(mad) || mad < 1e-6)
        mad = 1e-5;
      const threshold = Math.max(Z_THRESHOLD * mad * 1.4826, MIN_THRESHOLD);
      const flagged = [];
      for (let i = 0; i < windows.length; i += 1) {
        const w = windows[i];
        const outlier = w.rms - median > threshold;
        const aboveFloor = w.rms >= ABS_RMS_FLOOR;
        if (outlier && aboveFloor)
          flagged.push({ start: w.start, end: w.end });
      }
      const merged = mergeSegments(flagged, MERGE_GAP_SEC);
      const filtered = merged.filter((seg) => seg.end - seg.start >= MIN_INTRO_SEG_SEC);
      if (!filtered.length)
        return null;
      const result = {};
      if (kind === "intro") {
        filtered.sort((a, b) => a.start - b.start);
        result.intro = filtered[0];
      } else if (kind === "credits" && tailMeta && Number.isFinite(tailMeta.duration)) {
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
  };

  // src/playback/PlaybackController.js
  var PlaybackController = class {
    constructor({ resolver, getSettings, onSegmentEnter, onSegmentLeave, log }) {
      this.resolver = resolver;
      this.getSettings = getSettings;
      this.onSegmentEnter = onSegmentEnter;
      this.onSegmentLeave = onSegmentLeave;
      this.log = log || (() => {
      });
      this.video = null;
      this.timeHandler = null;
      this.activeSegment = null;
      this.activeRange = null;
      this.skipped = { intro: false, credits: false };
      this.dismissed = { intro: false, credits: false };
    }
    attach(video) {
      if (this.video === video)
        return;
      this.detach();
      this.video = video;
      if (!video)
        return;
      this.timeHandler = () => this._tick();
      video.addEventListener("timeupdate", this.timeHandler);
    }
    detach() {
      if (this.video && this.timeHandler) {
        try {
          this.video.removeEventListener("timeupdate", this.timeHandler);
        } catch (e) {
        }
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
      if (kind in this.skipped)
        this.skipped[kind] = true;
    }
    markDismissed(kind) {
      if (kind in this.dismissed)
        this.dismissed[kind] = true;
    }
    getActiveSegment() {
      return this.activeSegment;
    }
    getActiveRange() {
      return this.activeRange;
    }
    _tick() {
      if (!this.video)
        return;
      const t2 = this.video.currentTime;
      const d = this.video.duration;
      if (!Number.isFinite(d) || d <= 0)
        return;
      const detected = this._detect(t2);
      if (detected) {
        const ranges = this.resolver.getRanges()[detected];
        const firstRange = ranges && ranges.length ? ranges[0] : null;
        const isSame = this.activeSegment === detected;
        this.activeSegment = detected;
        this.activeRange = firstRange ? Object.assign({}, firstRange) : null;
        if (this.onSegmentEnter)
          this.onSegmentEnter(detected, this.activeRange, isSame);
      } else if (this.activeSegment) {
        const prev = this.activeSegment;
        this.activeSegment = null;
        this.activeRange = null;
        if (this.onSegmentLeave)
          this.onSegmentLeave(prev);
      }
    }
    _detect(time) {
      const settings = this.getSettings();
      const ranges = this.resolver.getRanges();
      if (settings.skipIntro && !this.skipped.intro && !this.dismissed.intro) {
        if (isTimeInRanges(time, ranges.intro || []))
          return "intro";
      }
      if (settings.skipCredits && !this.skipped.credits && !this.dismissed.credits) {
        if (isTimeInRanges(time, ranges.credits || []))
          return "credits";
      }
      return null;
    }
  };

  // src/playback/visibilityGuard.js
  var VisibilityGuard = class {
    constructor({ onResume, log }) {
      this.onResume = onResume || (() => {
      });
      this.log = log || (() => {
      });
      this._onVisibility = null;
      this._onPageShow = null;
      this._wasHidden = false;
      this._attached = false;
    }
    attach() {
      if (this._attached)
        return;
      this._attached = true;
      this._onVisibility = () => {
        if (typeof document === "undefined")
          return;
        if (document.hidden) {
          this._wasHidden = true;
        } else if (this._wasHidden) {
          this._wasHidden = false;
          try {
            this.onResume("visibilitychange");
          } catch (e) {
            this.log("warn", "visibility resume threw", e);
          }
        }
      };
      this._onPageShow = (event) => {
        if (event && event.persisted) {
          this._wasHidden = false;
          try {
            this.onResume("pageshow");
          } catch (e) {
            this.log("warn", "pageshow resume threw", e);
          }
        }
      };
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", this._onVisibility);
      }
      if (typeof window !== "undefined") {
        window.addEventListener("pageshow", this._onPageShow);
      }
    }
    detach() {
      if (!this._attached)
        return;
      if (typeof document !== "undefined" && this._onVisibility) {
        try {
          document.removeEventListener("visibilitychange", this._onVisibility);
        } catch (e) {
        }
      }
      if (typeof window !== "undefined" && this._onPageShow) {
        try {
          window.removeEventListener("pageshow", this._onPageShow);
        } catch (e) {
        }
      }
      this._onVisibility = null;
      this._onPageShow = null;
      this._wasHidden = false;
      this._attached = false;
    }
  };

  // src/playback/nativeSkipDetect.js
  function getLampa9() {
    return typeof Lampa !== "undefined" ? Lampa : null;
  }
  function getActivityCard3() {
    const lampa = getLampa9();
    try {
      if (lampa && lampa.Activity && typeof lampa.Activity.active === "function") {
        const activity = lampa.Activity.active();
        if (activity && activity.card)
          return activity.card;
      }
    } catch (e) {
    }
    return null;
  }
  function getPlayerData4() {
    const lampa = getLampa9();
    try {
      if (lampa && lampa.Player && typeof lampa.Player.data === "function")
        return lampa.Player.data();
      if (lampa && lampa.Player && typeof lampa.Player.get === "function")
        return lampa.Player.get();
    } catch (e) {
    }
    return null;
  }
  function hasUsableTimestamps(value) {
    if (Array.isArray(value))
      return value.length > 0;
    if (value && typeof value === "object")
      return Object.keys(value).length > 0;
    return false;
  }
  function hasNativeSkip() {
    const card = getActivityCard3();
    if (card && (hasUsableTimestamps(card.skip_timestamps) || hasUsableTimestamps(card.skip))) {
      return true;
    }
    const data = getPlayerData4();
    if (data && (hasUsableTimestamps(data.skip_timestamps) || hasUsableTimestamps(data.skip))) {
      return true;
    }
    return false;
  }

  // src/ui/SkipPrompt/styles.js
  var SKIP_PROMPT_STYLE_ID = "al-autoskip-prompt-style";
  function ensureSkipPromptStyles() {
    if (typeof document === "undefined")
      return;
    if (document.getElementById(SKIP_PROMPT_STYLE_ID))
      return;
    const style = document.createElement("style");
    style.id = SKIP_PROMPT_STYLE_ID;
    style.textContent = `
    .autoskip-prompt {
      --autoskip-accent: #FF8A00;
      --autoskip-progress-duration: 5000ms;
      --autoskip-ease: cubic-bezier(0.22, 0.9, 0.3, 1);

      position: fixed;
      right: 2.4em;
      bottom: 7.2em;
      z-index: 60;

      display: flex;
      align-items: center;
      gap: 0.7em;

      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translate3d(0, 1.1em, 0);
      transition:
        opacity 200ms linear,
        transform 280ms var(--autoskip-ease),
        visibility 0s linear 280ms;
      will-change: transform, opacity;
    }
    .autoskip-prompt.is-visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translate3d(0, 0, 0);
      transition-delay: 0s;
    }

    .autoskip-prompt .selector {
      position: relative;
      overflow: hidden;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.62em 1.25em;
      border-radius: 0.6em;
      background: rgba(28, 28, 30, 0.86);
      color: #fff;
      font-weight: 500;
      white-space: nowrap;
      transform: translate3d(0, 0, 0);
      transition:
        transform 180ms var(--autoskip-ease),
        background-color 180ms linear,
        color 180ms linear;
    }
    .autoskip-prompt .selector.focus {
      background: #fff;
      color: #101010;
      transform: translate3d(0, 0, 0) scale(1.06);
      box-shadow: 0 0 0 0.16em rgba(255, 255, 255, 0.22);
    }

    .autoskip-prompt__cancel {
      opacity: 0;
      transition:
        opacity 200ms linear 90ms,
        transform 180ms var(--autoskip-ease),
        background-color 180ms linear,
        color 180ms linear;
    }
    .autoskip-prompt.is-visible .autoskip-prompt__cancel {
      opacity: 1;
    }

    .autoskip-prompt__skip-label {
      position: relative;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      gap: 0.45em;
    }

    .autoskip-prompt__confidence-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.55em;
      height: 1.55em;
      padding: 0 0.35em;
      border-radius: 0.8em;
      font-size: 0.78em;
      font-weight: 700;
      line-height: 1;
      background: rgba(0, 0, 0, 0.22);
      color: inherit;
      opacity: 0.9;
    }
    .autoskip-prompt .selector:not(.focus) .autoskip-prompt__confidence-mark {
      background: rgba(255, 255, 255, 0.2);
    }

    .autoskip-prompt__skip::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 45%;
      height: 100%;
      background: linear-gradient(
        100deg,
        rgba(255, 138, 0, 0) 0%,
        rgba(255, 138, 0, 0.45) 50%,
        rgba(255, 138, 0, 0) 100%
      );
      transform: translate3d(-170%, 0, 0);
      opacity: 0;
      pointer-events: none;
      z-index: 1;
    }
    .autoskip-prompt.is-visible .autoskip-prompt__skip::before {
      animation: autoskip-shine 780ms var(--autoskip-ease) 160ms 1;
    }
    @keyframes autoskip-shine {
      0%   { transform: translate3d(-170%, 0, 0); opacity: 0; }
      35%  { opacity: 1; }
      100% { transform: translate3d(330%, 0, 0); opacity: 0; }
    }

    .autoskip-prompt__progress {
      /* Мягкий хвост справа — иначе граница заливки читается как артефакт. */
      --autoskip-fill: rgba(255, 138, 0, 0.34);
      --autoskip-fill-edge: rgba(255, 138, 0, 0.10);
      --autoskip-bar: var(--autoskip-accent);

      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(
        to right,
        var(--autoskip-fill) 0%,
        var(--autoskip-fill) 86%,
        var(--autoskip-fill-edge) 100%
      );
      transform: scaleX(0);
      transform-origin: left center;
      will-change: transform;
      pointer-events: none;
      z-index: 0;
    }
    .autoskip-prompt__progress::after {
      content: '';
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 0.26em;
      background: var(--autoskip-bar);
    }
    .autoskip-prompt.is-counting .autoskip-prompt__progress {
      animation: autoskip-progress var(--autoskip-progress-duration) linear forwards;
    }
    .autoskip-prompt.is-counting.is-paused .autoskip-prompt__progress {
      animation-play-state: paused;
    }
    @keyframes autoskip-progress {
      from { transform: scaleX(0); }
      to   { transform: scaleX(1); }
    }

    .autoskip-prompt--confidence-low .autoskip-prompt__progress {
      --autoskip-fill: rgba(255, 138, 0, 0.18);
      --autoskip-fill-edge: rgba(255, 138, 0, 0.06);
      --autoskip-bar: rgba(255, 138, 0, 0.6);
    }
    .autoskip-prompt--confidence-medium .autoskip-prompt__progress {
      --autoskip-fill: rgba(255, 138, 0, 0.28);
      --autoskip-fill-edge: rgba(255, 138, 0, 0.08);
    }
    /* На несфокусированной кнопке плотная оранжевая заливка выглядит грязно. */
    .autoskip-prompt .selector:not(.focus) .autoskip-prompt__progress {
      --autoskip-fill: rgba(255, 165, 60, 0.16);
      --autoskip-fill-edge: rgba(255, 165, 60, 0.05);
    }

    @media (prefers-reduced-motion: reduce) {
      .autoskip-prompt {
        transform: none;
        transition: opacity 120ms linear, visibility 0s linear 120ms;
      }
      .autoskip-prompt.is-visible {
        transform: none;
      }
      .autoskip-prompt.is-visible .autoskip-prompt__skip::before {
        animation: none;
      }
      .autoskip-prompt .selector.focus {
        transform: none;
      }
    }
  `;
    document.head.appendChild(style);
  }

  // src/ui/SkipPrompt/progressTimer.js
  var ProgressTimer = class {
    constructor({ duration = 5e3, onDone }) {
      this.duration = duration;
      this.onDone = onDone || (() => {
      });
      this._timeout = null;
      this._startedAt = 0;
      this._elapsed = 0;
      this._running = false;
      this._cancelled = false;
      this._completed = false;
    }
    start() {
      this._cancelled = false;
      this._completed = false;
      this._elapsed = 0;
      this._arm();
    }
    pause() {
      if (!this._running)
        return;
      this._elapsed += this._now() - this._startedAt;
      this._running = false;
      this._clearTimeout();
    }
    resume() {
      if (this._running || this._cancelled || this._completed)
        return;
      this._arm();
    }
    /** Сброс на ноль без запуска: отсчёт считается отменённым. */
    reset() {
      this.cancel();
      this._elapsed = 0;
      this._completed = false;
    }
    cancel() {
      this._cancelled = true;
      this._running = false;
      this._clearTimeout();
    }
    isRunning() {
      return this._running;
    }
    isCompleted() {
      return this._completed;
    }
    remaining() {
      const spent = this._running ? this._elapsed + (this._now() - this._startedAt) : this._elapsed;
      return Math.max(0, this.duration - spent);
    }
    _arm() {
      this._startedAt = this._now();
      this._running = true;
      this._clearTimeout();
      this._timeout = setTimeout(() => {
        this._timeout = null;
        if (this._cancelled)
          return;
        this._running = false;
        this._completed = true;
        try {
          this.onDone();
        } catch (e) {
        }
      }, this.remaining());
    }
    _clearTimeout() {
      if (this._timeout === null)
        return;
      try {
        clearTimeout(this._timeout);
      } catch (e) {
      }
      this._timeout = null;
    }
    _now() {
      if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
      }
      return Date.now();
    }
  };

  // src/ui/SkipPrompt/controller.js
  var CONTROLLER_NAME = "autoskip_prompt";
  function getLampa10() {
    return typeof Lampa !== "undefined" ? Lampa : null;
  }
  function getNavigator() {
    if (typeof window === "undefined")
      return null;
    return window.Navigator || null;
  }
  function fallbackMove(direction, root) {
    if (!root || !direction)
      return;
    const list = Array.from(root.querySelectorAll(".selector"));
    if (!list.length)
      return;
    const current = list.findIndex((el) => el.classList.contains("focus"));
    if (current === -1) {
      list[0].classList.add("focus");
      return;
    }
    let next = current;
    if (direction === "left")
      next = Math.max(0, current - 1);
    else if (direction === "right")
      next = Math.min(list.length - 1, current + 1);
    if (next === current)
      return;
    list[current].classList.remove("focus");
    list[next].classList.add("focus");
  }
  function focusElement(el, root) {
    if (!el)
      return;
    const lampa = getLampa10();
    if (lampa && lampa.Controller && typeof lampa.Controller.collectionFocus === "function") {
      try {
        lampa.Controller.collectionFocus(el, root);
        return;
      } catch (e) {
      }
    }
    Array.from(root.querySelectorAll(".selector")).forEach((node) => node.classList.remove("focus"));
    el.classList.add("focus");
  }
  function setCollection(html) {
    const lampa = getLampa10();
    if (!lampa || !lampa.Controller)
      return false;
    if (typeof lampa.Controller.collectionSet !== "function")
      return false;
    try {
      lampa.Controller.collectionSet(html);
      return true;
    } catch (e) {
      return false;
    }
  }
  function moveDirection(direction, root) {
    const navigator = getNavigator();
    if (navigator && typeof navigator.move === "function") {
      try {
        navigator.move(direction);
        return;
      } catch (e) {
      }
    }
    const lampa = getLampa10();
    if (lampa && lampa.Controller && typeof lampa.Controller.move === "function") {
      try {
        lampa.Controller.move(direction);
        return;
      } catch (e) {
      }
    }
    fallbackMove(direction, root);
  }
  var PromptController = class {
    constructor({ root, log, onSkip, onCancel, onLeft, onRight }) {
      this.root = root;
      this.log = log || (() => {
      });
      this.onSkip = onSkip || (() => {
      });
      this.onCancel = onCancel || (() => {
      });
      this.onLeft = onLeft || null;
      this.onRight = onRight || null;
      this.previousController = "";
      this._registered = false;
      this._active = false;
    }
    takeover(initialFocusEl) {
      const lampa = getLampa10();
      if (!lampa || !lampa.Controller || typeof lampa.Controller.add !== "function") {
        focusElement(initialFocusEl, this.root);
        return;
      }
      try {
        const enabled = typeof lampa.Controller.enabled === "function" ? lampa.Controller.enabled() : null;
        this.previousController = enabled && enabled.name || "";
      } catch (e) {
        this.previousController = "";
      }
      if (!this._registered) {
        lampa.Controller.add(CONTROLLER_NAME, {
          toggle: () => {
            if (!setCollection(this.root)) {
            }
            focusElement(initialFocusEl, this.root);
          },
          left: () => {
            if (this.onLeft)
              this.onLeft();
            else
              moveDirection("left", this.root);
          },
          right: () => {
            if (this.onRight)
              this.onRight();
            else
              moveDirection("right", this.root);
          },
          up: () => moveDirection("up", this.root),
          down: () => moveDirection("down", this.root),
          enter: () => {
            const focused = this.root.querySelector(".selector.focus");
            const isCancel = focused && focused.classList.contains("autoskip-prompt__cancel");
            if (isCancel) {
              try {
                this.onCancel();
              } finally {
                this.release();
              }
            } else {
              try {
                this.onSkip();
              } finally {
                this.release();
              }
            }
          },
          back: () => {
            try {
              this.onCancel();
            } finally {
              this.release();
            }
          },
          gone: () => {
            this._active = false;
          }
        });
        this._registered = true;
      }
      try {
        lampa.Controller.toggle(CONTROLLER_NAME);
        this._active = true;
      } catch (e) {
        focusElement(initialFocusEl, this.root);
      }
    }
    release() {
      if (!this._active) {
        return;
      }
      this._active = false;
      const lampa = getLampa10();
      if (!lampa || !lampa.Controller || typeof lampa.Controller.toggle !== "function")
        return;
      try {
        const target = this.previousController || "player";
        lampa.Controller.toggle(target);
      } catch (e) {
      }
    }
    isActive() {
      return this._active;
    }
  };

  // src/ui/SkipPrompt/SkipPrompt.js
  var PLAYER_SELECTORS = [".player", ".player-video", "#app .player"];
  function findMountTarget() {
    if (typeof document === "undefined")
      return null;
    for (const selector of PLAYER_SELECTORS) {
      const el = document.querySelector(selector);
      if (el)
        return el;
    }
    return document.body || null;
  }
  function buildElement() {
    const root = document.createElement("div");
    root.className = "autoskip-prompt";
    const cancel = document.createElement("div");
    cancel.className = "simple-button selector autoskip-prompt__cancel";
    const cancelLabel = document.createElement("span");
    cancelLabel.textContent = t("autoskip_cancel");
    cancel.appendChild(cancelLabel);
    const skip = document.createElement("div");
    skip.className = "simple-button selector autoskip-prompt__skip";
    const progress = document.createElement("div");
    progress.className = "autoskip-prompt__progress";
    skip.appendChild(progress);
    const labelWrap = document.createElement("span");
    labelWrap.className = "autoskip-prompt__skip-label";
    const skipLabel = document.createElement("span");
    skipLabel.textContent = t("autoskip_skip");
    labelWrap.appendChild(skipLabel);
    const confidenceMark = document.createElement("span");
    confidenceMark.className = "autoskip-prompt__confidence-mark";
    confidenceMark.style.display = "none";
    labelWrap.appendChild(confidenceMark);
    skip.appendChild(labelWrap);
    root.appendChild(cancel);
    root.appendChild(skip);
    return { root, cancel, skip, progress, confidenceMark };
  }
  var SkipPrompt = class {
    constructor({ log, durationMs = 5e3, onSkip, onCancel } = {}) {
      this.log = log || (() => {
      });
      this.durationMs = durationMs;
      this.onSkip = onSkip || (() => {
      });
      this.onCancel = onCancel || (() => {
      });
      this.parts = null;
      this.controller = null;
      this.timer = null;
      this._video = null;
      this._videoEvents = null;
      this._visible = false;
      this._activeSegment = null;
      this._activeConfidence = null;
    }
    attachToVideo(video) {
      this._detachVideo();
      this._video = video;
      if (!video)
        return;
      const onPause = () => this._pauseCountdown();
      const onPlaying = () => {
        if (this._visible)
          this._resumeCountdown();
      };
      const onSeeking = () => this._stopCountdown();
      video.addEventListener("pause", onPause);
      video.addEventListener("playing", onPlaying);
      video.addEventListener("seeking", onSeeking);
      this._videoEvents = { onPause, onPlaying, onSeeking };
    }
    _detachVideo() {
      if (this._video && this._videoEvents) {
        try {
          this._video.removeEventListener("pause", this._videoEvents.onPause);
        } catch (e) {
        }
        try {
          this._video.removeEventListener("playing", this._videoEvents.onPlaying);
        } catch (e) {
        }
        try {
          this._video.removeEventListener("seeking", this._videoEvents.onSeeking);
        } catch (e) {
        }
      }
      this._video = null;
      this._videoEvents = null;
    }
    _ensure() {
      ensureSkipPromptStyles();
      if (this.parts && this.parts.root.isConnected)
        return this.parts;
      if (this.parts) {
        try {
          this.parts.root.remove();
        } catch (e) {
        }
      }
      this.parts = buildElement();
      const target = findMountTarget();
      if (!target)
        return this.parts;
      target.appendChild(this.parts.root);
      void this.parts.root.offsetWidth;
      this.parts.cancel.addEventListener("click", () => this._handleCancel());
      this.parts.skip.addEventListener("click", () => this._handleSkip());
      return this.parts;
    }
    show(segment, options) {
      const parts = this._ensure();
      if (!parts.root.isConnected)
        return;
      this._activeSegment = segment;
      const opts = options || {};
      const confidence = opts.confidence || "high";
      this._activeConfidence = confidence;
      const autoSkipAllowed = opts.autoSkip !== false;
      parts.root.classList.remove(
        "autoskip-prompt--confidence-low",
        "autoskip-prompt--confidence-medium",
        "autoskip-prompt--confidence-high"
      );
      parts.root.classList.add(`autoskip-prompt--confidence-${confidence}`);
      if (parts.confidenceMark) {
        const mark = confidence === "low" ? "?" : confidence === "medium" ? "~" : "";
        parts.confidenceMark.textContent = mark;
        parts.confidenceMark.style.display = mark ? "" : "none";
      }
      parts.cancel.classList.remove("focus");
      parts.skip.classList.add("focus");
      parts.root.style.setProperty("--autoskip-progress-duration", `${this.durationMs}ms`);
      parts.root.classList.add("is-visible");
      if (!this.controller) {
        this.controller = new PromptController({
          root: parts.root,
          log: this.log,
          onSkip: () => this._handleSkip(),
          onCancel: () => this._handleCancel()
        });
      }
      if (!this._visible)
        this.controller.takeover(parts.skip);
      this._visible = true;
      if (autoSkipAllowed && confidence !== "low")
        this._startCountdown();
      else
        this._stopCountdown();
    }
    _startCountdown() {
      this._stopCountdown();
      if (!this.parts)
        return;
      const { root } = this.parts;
      root.classList.remove("is-counting", "is-paused");
      void root.offsetWidth;
      root.classList.add("is-counting");
      this.timer = new ProgressTimer({
        duration: this.durationMs,
        onDone: () => this._handleTimeout()
      });
      this.timer.start();
      if (this._video && this._video.paused)
        this._pauseCountdown();
    }
    _pauseCountdown() {
      if (!this.timer)
        return;
      this.timer.pause();
      if (this.parts)
        this.parts.root.classList.add("is-paused");
    }
    _resumeCountdown() {
      if (!this.timer)
        return;
      this.timer.resume();
      if (this.parts && this.timer.isRunning())
        this.parts.root.classList.remove("is-paused");
    }
    _stopCountdown() {
      if (this.timer) {
        this.timer.cancel();
        this.timer = null;
      }
      if (this.parts)
        this.parts.root.classList.remove("is-counting", "is-paused");
    }
    /**
     * Автопропуск разрешён, только если промпт реально отрисован. Страховка от
     * повторения бага, когда кнопка была скрыта, а пропуск всё равно срабатывал.
     */
    _isReallyVisible() {
      if (!this.parts || !this.parts.root.isConnected)
        return false;
      if (typeof window === "undefined" || typeof window.getComputedStyle !== "function")
        return true;
      const root = this.parts.root;
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0)
        return false;
      let node = root;
      let depth = 0;
      while (node && node !== document.documentElement && depth < 24) {
        const cs = window.getComputedStyle(node);
        if (cs.display === "none" || cs.visibility === "hidden")
          return false;
        if (Number(cs.opacity) < 0.05)
          return false;
        node = node.parentElement;
        depth += 1;
      }
      return true;
    }
    _handleTimeout() {
      if (!this._isReallyVisible()) {
        this.log("warn", "auto-skip suppressed: prompt is not visible on screen.");
        this._stopCountdown();
        return;
      }
      this._handleSkip();
    }
    hide() {
      this._stopCountdown();
      if (this.parts) {
        this.parts.root.classList.remove("is-visible");
        this.parts.skip.classList.remove("focus");
        this.parts.cancel.classList.remove("focus");
      }
      if (this.controller && this._visible)
        this.controller.release();
      this._visible = false;
      this._activeSegment = null;
    }
    destroy() {
      this.hide();
      this._detachVideo();
      if (this.parts) {
        try {
          this.parts.root.remove();
        } catch (e) {
        }
        this.parts = null;
      }
      this.controller = null;
    }
    isVisible() {
      return this._visible;
    }
    _handleSkip() {
      const segment = this._activeSegment;
      this.hide();
      try {
        this.onSkip(segment);
      } catch (e) {
        this.log("warn", "onSkip threw", e);
      }
    }
    _handleCancel() {
      const segment = this._activeSegment;
      this.hide();
      try {
        this.onCancel(segment);
      } catch (e) {
        this.log("warn", "onCancel threw", e);
      }
    }
  };

  // src/ui/TimelineMarkers/styles.js
  var TIMELINE_MARKERS_STYLE_ID = "al-autoskip-timeline-style";
  function ensureTimelineMarkerStyles() {
    if (typeof document === "undefined")
      return;
    if (document.getElementById(TIMELINE_MARKERS_STYLE_ID))
      return;
    const style = document.createElement("style");
    style.id = TIMELINE_MARKERS_STYLE_ID;
    style.textContent = `
    .player-panel__timeline-segment--autoskip {
      background-color: rgba(255, 138, 0, 0.55);
      pointer-events: none;
      transition: background-color 0.2s linear;
    }
    .player-panel__timeline-segment--autoskip-credits {
      background-color: rgba(255, 138, 0, 0.45);
    }
    .player-panel__timeline-segment--autoskip-low {
      background-color: rgba(255, 138, 0, 0.28);
    }
    .player-panel__timeline-segment--autoskip-medium {
      background-color: rgba(255, 138, 0, 0.45);
    }
    .player-panel__timeline-segment--autoskip-high {
      background-color: rgba(255, 138, 0, 0.65);
    }
  `;
    document.head.appendChild(style);
  }

  // src/ui/TimelineMarkers/TimelineMarkers.js
  var TIMELINE_SELECTORS = [
    ".player .player-panel__timeline",
    ".player-panel__timeline"
  ];
  var TimelineMarkers = class {
    constructor({ log } = {}) {
      this.log = log || (() => {
      });
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
    setRanges(ranges, duration, confidence) {
      this.ranges = {
        intro: Array.isArray(ranges && ranges.intro) ? ranges.intro : [],
        credits: Array.isArray(ranges && ranges.credits) ? ranges.credits : []
      };
      if (Number.isFinite(duration) && duration > 0)
        this.duration = duration;
      this.confidence = confidence || { intro: "high", credits: "high" };
      this._render();
    }
    _mount() {
      if (this.timeline && document.body.contains(this.timeline))
        return true;
      if (typeof document === "undefined")
        return false;
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
      if (typeof MutationObserver === "undefined")
        return;
      if (this._domObserver)
        return;
      this._domObserver = new MutationObserver(() => {
        const stillThere = this.timeline && document.body.contains(this.timeline);
        if (stillThere)
          return;
        if (this._mount())
          this._render();
      });
      try {
        this._domObserver.observe(document.body, { childList: true, subtree: true });
      } catch (e) {
        this._domObserver = null;
      }
    }
    _stopObserve() {
      if (this._domObserver) {
        try {
          this._domObserver.disconnect();
        } catch (e) {
        }
        this._domObserver = null;
      }
    }
    _snapshot() {
      return JSON.stringify({ ranges: this.ranges, duration: this.duration, confidence: this.confidence });
    }
    _render() {
      if (!this._mount())
        return;
      if (!this.duration || this.duration <= 0) {
        const liveDuration = this.video && Number.isFinite(this.video.duration) ? this.video.duration : 0;
        if (liveDuration > 0)
          this.duration = liveDuration;
        else {
          this.clear();
          return;
        }
      }
      const snapshot = this._snapshot();
      if (snapshot === this._lastSnapshot && this.elements.length)
        return;
      this._lastSnapshot = snapshot;
      this.clear();
      ["intro", "credits"].forEach((kind) => {
        const ranges = this.ranges[kind] || [];
        const confidence = this.confidence && this.confidence[kind] || "high";
        ranges.forEach((range) => {
          const start = Math.max(0, Number(range.start));
          const end = Math.max(start, Number(range.end));
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
            return;
          const left = Math.min(100, Math.max(0, start / this.duration * 100));
          const right = Math.min(100, Math.max(0, end / this.duration * 100));
          const width = Math.max(0, right - left);
          if (width <= 0)
            return;
          const seg = document.createElement("div");
          seg.className = `player-panel__timeline-segment player-panel__timeline-segment--autoskip player-panel__timeline-segment--autoskip-${kind} player-panel__timeline-segment--autoskip-${confidence}`;
          seg.style.left = `${left}%`;
          seg.style.width = `${width}%`;
          this.timeline.appendChild(seg);
          this.elements.push({ kind, el: seg });
        });
      });
    }
    clear() {
      this.elements.forEach(({ el }) => {
        try {
          el.remove();
        } catch (e) {
        }
      });
      this.elements = [];
    }
  };

  // src/core/AutoSkipPlugin.js
  var AutoSkipPlugin = class {
    constructor() {
      this.version = "3.1.3";
      this.component = "autoskip";
      this.name = "AutoSkip";
      this.logTag = "[AutoSkip]";
      this.log = createLogger({ tag: this.logTag });
      this.capabilities = probe();
      this.settingsStore = new SettingsStore({ log: this.log });
      this.settings = Object.assign({}, SETTINGS_DEFAULTS, this.settingsStore.load());
      this.settingsStore.update(this.settings);
      this.segmentCache = new SegmentCache({ log: this.log });
      this.segmentCache.load();
      this.resolver = new SegmentResolver();
      this.playback = new PlaybackController({
        resolver: this.resolver,
        getSettings: () => this.settings,
        onSegmentEnter: (segment, range, isSame) => this._handleSegmentEnter(segment, range, isSame),
        onSegmentLeave: () => this._handleSegmentLeave(),
        log: this.log
      });
      this.metadataProvider = new MetadataProvider({ log: this.log });
      this.chaptersProvider = new ChaptersProvider({ log: this.log });
      this.audioProvider = new AudioProvider({
        log: this.log,
        onUpdate: (ranges, meta) => this._onProviderUpdate("audio", ranges, meta),
        onTainted: () => {
          if (this.settings.debug)
            this._notify(t("autoskip_audio_cors"));
        }
      });
      this.aniSkipProvider = new AniSkipProvider({
        log: this.log,
        getSettings: () => this.settings
      });
      this.theIntroDbProvider = new TheIntroDBProvider({
        log: this.log,
        getSettings: () => this.settings,
        getContentIds: () => getContentIds()
      });
      this.subtitleProvider = new SubtitleProvider({
        log: this.log,
        getSettings: () => this.settings
      });
      this.visualProvider = new VisualProvider({
        log: this.log,
        getSettings: () => this.settings
      });
      this.prefetchAudioProvider = new PrefetchAudioProvider({
        log: this.log,
        getSettings: () => this.settings
      });
      this.visibilityGuard = new VisibilityGuard({
        log: this.log,
        onResume: () => {
          if (this.audioProvider)
            this.audioProvider.resetSession();
          if (this.settings.debug)
            this.log("log", "audio buffer reset on visibility resume");
        }
      });
      this.skipPrompt = new SkipPrompt({
        log: this.log,
        durationMs: 5e3,
        onSkip: (segment) => {
          const target = segment || this.playback.getActiveSegment();
          if (!target)
            return;
          this.performSkip(target);
        },
        onCancel: (segment) => {
          const target = segment || this.playback.getActiveSegment();
          if (target)
            this.playback.markDismissed(target);
        }
      });
      this.timelineMarkers = new TimelineMarkers({ log: this.log });
      this.isRunning = false;
      this.video = null;
      this._bindedOnLoadedMeta = null;
      this._bindedOnPlaying = null;
      this._settingsRegistered = false;
      this._cacheSaveTimer = null;
      this._cachePendingKey = null;
      this._cachePendingRanges = null;
      this.init();
    }
    init() {
      waitForLampa({
        predicate: () => typeof Lampa !== "undefined" && Lampa.Player && Lampa.Player.listener,
        onReady: () => {
          registerTranslations();
          this.addSettingsToLampa();
          this.listenPlayer();
          if (this.settings.autoStart && this.settings.enabled)
            this.start();
          if (this.settings.debug)
            this.log("log", "capabilities", this.capabilities);
          this.log("log", `initialized (${this.version}).`);
        },
        onTimeout: () => {
          this.log("error", "Lampa not found (incompatible environment?).");
        },
        log: this.log
      });
    }
    addSettingsToLampa() {
      const icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
      const maxAttempts = 30;
      const retryDelayMs = 500;
      const tryRegister = (attempt) => {
        if (this._settingsRegistered)
          return;
        const isLastAttempt = attempt >= maxAttempts - 1;
        if (!isSettingsApiReady()) {
          if (isLastAttempt) {
            this.log("warn", "Lampa.SettingsApi not ready, skipping settings registration.");
            return;
          }
          setTimeout(() => tryRegister(attempt + 1), retryDelayMs);
          return;
        }
        const ok = registerSettingsComponent({
          component: this.component,
          name: this.name,
          icon,
          defaults: SETTINGS_DEFAULTS,
          onChange: (key, value) => {
            this.settings[key] = value;
            this.settingsStore.set(key, value);
          },
          log: this.log,
          quiet: !isLastAttempt
        });
        if (ok) {
          this._settingsRegistered = true;
          this.settingsStore.ensureDefaultsPersisted();
          return;
        }
        if (isLastAttempt)
          return;
        setTimeout(() => tryRegister(attempt + 1), retryDelayMs);
      };
      tryRegister(0);
    }
    listenPlayer() {
      followPlayer({
        start: () => this.onPlayerStart(),
        stop: () => this.onPlayerStop()
      });
    }
    start() {
      this.isRunning = true;
      this.log("log", "auto-skip started.");
    }
    stop() {
      this.isRunning = false;
      this.log("log", "auto-skip stopped.");
    }
    onPlayerStart() {
      if (!this.settings.enabled)
        return;
      if (hasNativeSkip()) {
        if (this.settings.debug)
          this.log("log", "native skip metadata detected; plugin yields.");
        return;
      }
      this.resolver.reset();
      this.playback.resetSession();
      this.visibilityGuard.attach();
      this._hideSkipButton();
      const attach = () => {
        const video = this._getVideo();
        if (!video)
          return false;
        this.video = video;
        const onReady = () => this._onVideoReady();
        if (!Number.isFinite(video.duration)) {
          this._bindedOnLoadedMeta = onReady;
          video.addEventListener("loadedmetadata", this._bindedOnLoadedMeta, { once: true });
        } else {
          onReady();
        }
        this._bindedOnPlaying = () => this.playback.attach(this.video);
        video.addEventListener("playing", this._bindedOnPlaying);
        return true;
      };
      if (attach())
        return;
      const startedAt = Date.now();
      const poll = () => {
        if (attach())
          return;
        if (Date.now() - startedAt < 2e3)
          requestAnimationFrame(poll);
      };
      poll();
    }
    _onVideoReady() {
      this._applyCachedSegments();
      this._runProvider(this.metadataProvider);
      this._runProvider(this.chaptersProvider);
      this._runProvider(this.aniSkipProvider);
      this._runProvider(this.theIntroDbProvider);
      this._runProvider(this.subtitleProvider);
      this.playback.attach(this.video);
      this.skipPrompt.attachToVideo(this.video);
      this.timelineMarkers.attach(this.video);
      this._refreshTimelineMarkers();
      this._maybeRunFallbackProviders();
    }
    _maybeRunFallbackProviders() {
      setTimeout(() => {
        if (!this.video)
          return;
        const introHigh = this.resolver.hasHighConfidence("intro");
        const creditsHigh = this.resolver.hasHighConfidence("credits");
        if (introHigh && creditsHigh) {
          if (this.settings.debug)
            this.log("log", "fallback providers skipped — both segments resolved by high-confidence sources.");
          return;
        }
        this._runProvider(this.prefetchAudioProvider);
        this._runProvider(this.visualProvider);
        setTimeout(() => {
          if (!this.video)
            return;
          if (this.resolver.hasHighConfidence("intro") && this.resolver.hasHighConfidence("credits"))
            return;
          this._runProvider(this.audioProvider);
        }, 4e3);
        this._scheduleEmptyResultNotice();
      }, 1200);
    }
    _scheduleEmptyResultNotice() {
      if (this._emptyResultTimer)
        clearTimeout(this._emptyResultTimer);
      this._emptyResultTimer = setTimeout(() => {
        if (!this.video)
          return;
        const ranges = this.resolver.getRanges();
        const hasAny = ranges.intro && ranges.intro.length || ranges.credits && ranges.credits.length;
        if (hasAny)
          return;
        if (!this.settings.debug)
          return;
        this.log("log", "AutoSkip: no segments found by any provider — content not covered.");
      }, 9e4);
    }
    onPlayerStop() {
      if (this.video && this._bindedOnLoadedMeta) {
        try {
          this.video.removeEventListener("loadedmetadata", this._bindedOnLoadedMeta);
        } catch (e) {
        }
      }
      if (this.video && this._bindedOnPlaying) {
        try {
          this.video.removeEventListener("playing", this._bindedOnPlaying);
        } catch (e) {
        }
      }
      this.playback.detach();
      this.audioProvider.cancel();
      this.audioProvider.reset();
      [this.theIntroDbProvider, this.aniSkipProvider, this.subtitleProvider, this.visualProvider, this.prefetchAudioProvider].forEach((provider) => {
        if (!provider)
          return;
        try {
          provider.cancel();
        } catch (e) {
        }
        try {
          provider.reset();
        } catch (e) {
        }
      });
      if (this._emptyResultTimer) {
        try {
          clearTimeout(this._emptyResultTimer);
        } catch (e) {
        }
        this._emptyResultTimer = null;
      }
      this.visibilityGuard.detach();
      this.timelineMarkers.detach();
      this._flushPendingCacheSave();
      this.video = null;
      this._bindedOnLoadedMeta = null;
      this._bindedOnPlaying = null;
      this.resolver.reset();
      this.playback.resetSession();
      this._hideSkipButton(true);
    }
    _runProvider(provider) {
      if (!provider)
        return;
      try {
        if (!provider.isApplicable({ video: this.video, capabilities: this.capabilities })) {
          if (this.settings.debug)
            this.log("log", `provider ${provider.name} skipped (not applicable).`);
          return;
        }
        if (this.settings.debug)
          this.log("log", `provider ${provider.name} starting.`);
        const result = provider.run(
          { video: this.video, capabilities: this.capabilities },
          (ranges, meta) => this._onProviderUpdate(provider.name, ranges, meta)
        );
        if (result && typeof result.catch === "function") {
          result.catch((err) => this.log("warn", `${provider.name} provider failed`, err));
        }
      } catch (err) {
        this.log("warn", `${provider.name} provider threw`, err);
      }
    }
    _onProviderUpdate(source, rawRanges, meta) {
      if (!this.video)
        return;
      const normalized = normalizeRanges(rawRanges, this.video.duration);
      const updated = this.resolver.apply(source, normalized);
      if (!updated)
        return;
      if (this.settings.debug)
        this._logSegmentRanges(source, this.resolver.getRanges(), meta);
      if (source !== "cache")
        this._scheduleCacheSave(this.resolver.getRanges());
      this._refreshTimelineMarkers();
      this._noteRetroactiveDetection(source, normalized);
    }
    _noteRetroactiveDetection(source, normalized) {
      if (source === "cache")
        return;
      if (!this.video)
        return;
      const t2 = Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0;
      ["intro", "credits"].forEach((kind) => {
        const ranges = normalized[kind] || [];
        if (!ranges.length)
          return;
        const last = ranges[ranges.length - 1];
        if (last.end < t2) {
          this.log("log", `${kind} detected retroactively (${last.start.toFixed(1)}-${last.end.toFixed(1)}s, now ${t2.toFixed(1)}s) — cached for next playthrough.`);
        }
      });
    }
    _refreshTimelineMarkers() {
      if (!this.timelineMarkers)
        return;
      if (!this.video)
        return;
      const duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
      const confidence = {
        intro: this.resolver.confidenceFor("intro"),
        credits: this.resolver.confidenceFor("credits")
      };
      this.timelineMarkers.setRanges(this.resolver.getRanges(), duration, confidence);
    }
    _handleSegmentEnter(segment, range, isSame) {
      if (!isSame || !this.skipPrompt.isVisible()) {
        const confidence = this.resolver.confidenceFor(segment);
        this.skipPrompt.show(segment, { confidence, autoSkip: confidence !== "low" });
        const t2 = this.video && Number.isFinite(this.video.currentTime) ? this.video.currentTime.toFixed(2) : "n/a";
        if (this.settings.debug) {
          this.log("log", `segment detected -> ${segment} at ${t2}s (confidence: ${confidence})`, {
            range,
            duration: this.video ? this.video.duration : void 0,
            sources: this.resolver.getSources()
          });
        }
      }
    }
    _handleSegmentLeave() {
      this._hideSkipButton();
    }
    performSkip(segment) {
      if (!this.video)
        return;
      const duration = this.video.duration;
      if (!Number.isFinite(duration) || duration <= 0)
        return;
      const ranges = this.resolver.getRanges();
      if (segment === "intro") {
        const range = this.playback.getActiveRange() && this.playback.getActiveSegment() === "intro" ? this.playback.getActiveRange() : ranges.intro && ranges.intro.length ? ranges.intro[0] : null;
        if (!range)
          return;
        this.playback.markSkipped("intro");
        this._safeSeek(range.end);
        this._notify(t("autoskip_intro_skipped"));
      }
      if (segment === "credits") {
        const range = this.playback.getActiveRange() && this.playback.getActiveSegment() === "credits" ? this.playback.getActiveRange() : ranges.credits && ranges.credits.length ? ranges.credits[0] : null;
        if (!range)
          return;
        this.playback.markSkipped("credits");
        this._safeSeek(Math.min(duration - 1, Math.max(0, range.end)));
        this._notify(t("autoskip_credits_skipped"));
      }
      this._hideSkipButton();
    }
    _safeSeek(target) {
      try {
        if (Number.isFinite(target))
          this.video.currentTime = target;
      } catch (e) {
        this.log("warn", "Failed to seek:", e);
      }
    }
    _notify(msg) {
      if (!this.settings.showNotifications)
        return;
      if (typeof Lampa !== "undefined" && Lampa.Noty)
        Lampa.Noty.show(msg);
      else
        this.log("log", msg);
    }
    _hideSkipButton(destroy = false) {
      this.skipPrompt.hide();
      if (destroy)
        this.skipPrompt.destroy();
    }
    _applyCachedSegments() {
      const ids = getContentId(this.video);
      if (!ids || !ids.primary)
        return;
      let cached = this.segmentCache.read(ids.primary);
      let key = ids.primary;
      if (!cached && ids.legacy) {
        cached = this.segmentCache.read(ids.legacy);
        if (cached) {
          this.segmentCache.write(ids.primary, cached);
          this.segmentCache.scheduleSave();
        }
      }
      if (!cached)
        return;
      const normalized = normalizeRanges(cached, this.video.duration);
      if (!normalized.intro.length && !normalized.credits.length)
        return;
      const updated = this.resolver.apply("cache", normalized);
      if (updated && this.settings.debug) {
        this._logSegmentRanges("cache", this.resolver.getRanges(), { key });
      }
    }
    _scheduleCacheSave(ranges) {
      const ids = getContentId(this.video);
      if (!ids || !ids.primary)
        return;
      if (!ranges)
        return;
      if ((!ranges.intro || !ranges.intro.length) && (!ranges.credits || !ranges.credits.length))
        return;
      this._cachePendingKey = ids.primary;
      this._cachePendingRanges = {
        intro: (ranges.intro || []).slice(),
        credits: (ranges.credits || []).slice()
      };
      if (this._cacheSaveTimer)
        return;
      this._cacheSaveTimer = setTimeout(() => this._flushPendingCacheSave(), 1500);
    }
    _flushPendingCacheSave() {
      if (!this._cacheSaveTimer && !this._cachePendingKey)
        return;
      if (this._cacheSaveTimer) {
        clearTimeout(this._cacheSaveTimer);
        this._cacheSaveTimer = null;
      }
      const key = this._cachePendingKey;
      const ranges = this._cachePendingRanges;
      this._cachePendingKey = null;
      this._cachePendingRanges = null;
      if (!key || !ranges)
        return;
      try {
        this.segmentCache.write(key, ranges);
        this.segmentCache.save();
        if (this.settings.debug)
          this.log("log", "segments cached", { key, intro: ranges.intro, credits: ranges.credits });
      } catch (e) {
        this.log("warn", "Failed to save cache:", e);
      }
    }
    _logSegmentRanges(source, ranges, meta = null) {
      const format = (seg) => seg.map((r) => `${r.start.toFixed(1)}-${r.end.toFixed(1)}s`).join(", ") || "none";
      const intro = ranges.intro || [];
      const credits = ranges.credits || [];
      this.log("log", `segments from ${source}: intro=${format(intro)}; credits=${format(credits)}`, meta);
    }
    _getVideo() {
      return document.querySelector("video");
    }
  };

  // src/entry.js
  var PLUGIN_ID = "autoskip";
  function isDisabledByUrl() {
    try {
      return /[?&]autoskip=off\b/i.test(window.location.search || "");
    } catch (e) {
      return false;
    }
  }
  function isDisabledByStorage() {
    try {
      if (typeof Lampa !== "undefined" && Lampa.Storage && typeof Lampa.Storage.field === "function") {
        return Lampa.Storage.field("autoskip_disabled") === true;
      }
    } catch (e) {
    }
    return false;
  }
  if (!window[PLUGIN_ID]) {
    window[PLUGIN_ID] = true;
    if (isDisabledByUrl() || isDisabledByStorage()) {
      console.warn("[AutoSkip] disabled by user (URL flag or stored preference).");
    } else {
      new AutoSkipPlugin();
    }
  }
})();
