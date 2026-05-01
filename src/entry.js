import { AutoSkipPlugin } from './core/AutoSkipPlugin.js';

const PLUGIN_ID = 'autoskip';

function isDisabledByUrl() {
  try {
    return /[?&]autoskip=off\b/i.test(window.location.search || '');
  } catch (e) {
    return false;
  }
}

function isDisabledByStorage() {
  try {
    if (typeof Lampa !== 'undefined' && Lampa.Storage && typeof Lampa.Storage.field === 'function') {
      return Lampa.Storage.field('autoskip_disabled') === true;
    }
  } catch (e) { /* noop */ }
  return false;
}

if (!window[PLUGIN_ID]) {
  window[PLUGIN_ID] = true;
  if (isDisabledByUrl() || isDisabledByStorage()) {
    console.warn('[AutoSkip] disabled by user (URL flag or stored preference).');
  } else {
    new AutoSkipPlugin();
  }
}
