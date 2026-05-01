import { t as translate } from '../util/i18n.js';

const STORAGE_KEY_PREFIX = 'autoskip_';
const GLOBAL_DISABLE_KEY = 'autoskip_disabled';

const PARAM_DEFINITIONS = [
  { key: 'enabled', label: 'autoskip_setting_enabled' },
  { key: 'autoStart', label: 'autoskip_setting_autostart' },
  { key: 'skipIntro', label: 'autoskip_setting_skip_intro' },
  { key: 'skipCredits', label: 'autoskip_setting_skip_credits' },
  { key: 'showNotifications', label: 'autoskip_setting_notifications' },
  { key: 'useAniSkip', label: 'autoskip_setting_aniskip' },
  { key: 'debug', label: 'autoskip_setting_debug' }
];

function getLampa() {
  return typeof Lampa !== 'undefined' ? Lampa : null;
}

function getSettingsApi() {
  const lampa = getLampa();
  if (!lampa) return null;
  if (lampa.SettingsApi && typeof lampa.SettingsApi.addComponent === 'function') return lampa.SettingsApi;
  return null;
}

function storageKeyFor(key) {
  return key === '_global_disable' ? GLOBAL_DISABLE_KEY : `${STORAGE_KEY_PREFIX}${key}`;
}

function readStoredValue(key, fallback) {
  const lampa = getLampa();
  if (!lampa || !lampa.Storage || typeof lampa.Storage.field !== 'function') return fallback;
  try {
    const value = lampa.Storage.field(storageKeyFor(key));
    if (value === undefined || value === null || value === '') return fallback;
    return value;
  } catch (e) {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  const lampa = getLampa();
  if (!lampa || !lampa.Storage || typeof lampa.Storage.set !== 'function') return;
  try { lampa.Storage.set(storageKeyFor(key), value); } catch (e) { /* noop */ }
}

export function isSettingsApiReady() {
  return !!getSettingsApi();
}

export function registerSettingsComponent({ component, name, icon, log, defaults, onChange, quiet = false }) {
  const api = getSettingsApi();
  if (!api) {
    if (!quiet && log) log('warn', 'Lampa.SettingsApi unavailable, skipping settings registration.');
    return false;
  }

  try {
    api.addComponent({ component, name, icon });
  } catch (e) {
    if (!quiet && log) log('warn', 'SettingsApi.addComponent threw:', e);
    return false;
  }

  if (typeof api.removeParams === 'function') {
    try { api.removeParams(component); } catch (e) { /* noop */ }
  }

  PARAM_DEFINITIONS.forEach(({ key, label }) => {
    const fallback = defaults && key in defaults ? defaults[key] : false;
    const stored = readStoredValue(key, fallback);
    const initial = typeof stored === 'boolean' ? stored : !!stored;
    try {
      api.addParam({
        component,
        param: {
          name: storageKeyFor(key),
          type: 'trigger',
          default: !!fallback
        },
        field: { name: translate(label) },
        onChange: (value) => {
          const normalized = value === true || value === 'true' || value === 1 || value === '1';
          writeStoredValue(key, normalized);
          if (onChange) {
            try { onChange(key, normalized); } catch (err) { if (log) log('warn', 'settings onChange threw', err); }
          }
        }
      });
    } catch (e) {
      if (log) log('warn', `SettingsApi.addParam(${key}) threw:`, e);
    }

    if (stored === undefined || stored === null) {
      writeStoredValue(key, initial);
    }
  });

  try {
    api.addParam({
      component,
      param: {
        name: GLOBAL_DISABLE_KEY,
        type: 'trigger',
        default: false
      },
      field: { name: translate('autoskip_setting_disable') },
      onChange: (value) => {
        const normalized = value === true || value === 'true' || value === 1 || value === '1';
        writeStoredValue('_global_disable', normalized);
      }
    });
  } catch (e) {
    if (log) log('warn', 'SettingsApi.addParam(global disable) threw:', e);
  }

  return true;
}

export function readSettingsFromStorage(defaults) {
  const result = Object.assign({}, defaults || {});
  PARAM_DEFINITIONS.forEach(({ key }) => {
    const stored = readStoredValue(key, undefined);
    if (stored !== undefined) result[key] = !!stored;
  });
  return result;
}

export function showSettingsModal(/* legacy */) {
  // Kept for backward compatibility — Lampa renders settings page automatically.
}
