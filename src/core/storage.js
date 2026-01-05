const SETTINGS_KEY = 'autoskip_settings';
const LEGACY_SETTINGS_KEY = 'anilibria_autoskip_settings';

const SEGMENT_CACHE_KEY = 'autoskip_segment_cache';

function safeParseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return parsed;
    return fallback;
  } catch (e) {
    return fallback;
  }
}

export function loadSettings(storage = localStorage) {
  const stored = safeParseJson(storage.getItem(SETTINGS_KEY) || '{}', {});
  if (stored && typeof stored === 'object') {
    if (stored.skipOpenings !== undefined && stored.skipIntro === undefined) {
      stored.skipIntro = stored.skipOpenings;
    }
    if (stored.skipEndings !== undefined && stored.skipCredits === undefined) {
      stored.skipCredits = stored.skipEndings;
    }
    if (Object.keys(stored).length) return stored;
  }

  const legacy = safeParseJson(storage.getItem(LEGACY_SETTINGS_KEY) || '{}', {});
  if (legacy && typeof legacy === 'object') {
    if (legacy.skipOpenings !== undefined && legacy.skipIntro === undefined) {
      legacy.skipIntro = legacy.skipOpenings;
    }
    if (legacy.skipEndings !== undefined && legacy.skipCredits === undefined) {
      legacy.skipCredits = legacy.skipEndings;
    }
    return legacy;
  }

  return {};
}

export function saveSettings(settings, storage = localStorage) {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSegmentCache(storage = localStorage) {
  return safeParseJson(storage.getItem(SEGMENT_CACHE_KEY) || '{}', {});
}

export function saveSegmentCache(cache, storage = localStorage) {
  storage.setItem(SEGMENT_CACHE_KEY, JSON.stringify(cache));
}
