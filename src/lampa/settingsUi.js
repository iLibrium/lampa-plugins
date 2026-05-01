import { t as translate } from '../util/i18n.js';

function getLampaSettings() {
  if (typeof Lampa === 'undefined' || !Lampa.Settings) return null;
  return Lampa.Settings;
}

export function isSettingsApiReady(settings) {
  if (!settings) return false;
  const registerMethods = ['addComponent', 'register', 'registerComponent', 'add', 'addItem', 'component'];
  const hasMethod = registerMethods.some((method) => typeof settings[method] === 'function');
  const hasArray = Array.isArray(settings.components) || Array.isArray(settings.items);
  return hasMethod || hasArray;
}

export function registerSettingsComponent({ component, name, icon, onSelect, log, quiet = false }) {
  const settings = getLampaSettings();
  if (!settings) {
    if (!quiet) {
      log('warn', 'Settings UI unavailable (Lampa.Settings missing), plugin continues without menu.');
    }
    return false;
  }

  const config = { component, name, icon, onSelect };

  const registerMethods = ['addComponent', 'register', 'registerComponent', 'add', 'addItem', 'component'];
  let registered = false;
  for (const method of registerMethods) {
    if (typeof settings[method] === 'function') {
      try {
        settings[method](config);
        registered = true;
        break;
      } catch (err) {
        log('warn', `Settings.${method} threw:`, err);
      }
    }
  }

  if (!registered && Array.isArray(settings.components)) {
    settings.components.push(config);
    registered = true;
  }

  if (!registered && Array.isArray(settings.items)) {
    settings.items.push(config);
    registered = true;
  }

  if (!registered) {
    if (!quiet) {
      log('warn', 'Settings API not recognized, skipping settings registration.');
    }
    return false;
  }

  if (settings.listener && typeof settings.listener.follow === 'function') {
    try {
      settings.listener.follow('open', (e) => {
        if (e && e.name === component) onSelect();
      });
    } catch (e) { /* noop */ }
  }

  return true;
}

function persistGlobalDisable(value) {
  try {
    if (typeof Lampa !== 'undefined' && Lampa.Storage && typeof Lampa.Storage.set === 'function') {
      Lampa.Storage.set('autoskip_disabled', !!value);
    }
  } catch (e) { /* noop */ }
}

const SETTING_DEFINITIONS = [
  { key: 'enabled', label: 'autoskip_setting_enabled' },
  { key: 'autoStart', label: 'autoskip_setting_autostart' },
  { key: 'skipIntro', label: 'autoskip_setting_skip_intro' },
  { key: 'skipCredits', label: 'autoskip_setting_skip_credits' },
  { key: 'showNotifications', label: 'autoskip_setting_notifications' },
  { key: 'useAniSkip', label: 'autoskip_setting_aniskip' },
  { key: 'debug', label: 'autoskip_setting_debug' }
];

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function buildSettingsHtml({ name, version, settings }) {
  const rows = SETTING_DEFINITIONS.map(({ key, label }) => {
    const checked = settings[key] ? 'checked' : '';
    return `
      <label style="display:block;margin:6px 0">
        <input type="checkbox" data-setting="${escapeAttr(key)}" ${checked}/>
        <span style="margin-left:6px">${escapeAttr(translate(label))}</span>
      </label>
    `;
  }).join('');

  const disableLabel = escapeAttr(translate('autoskip_setting_disable'));

  return `
    <div id="al-autoskip-settings" style="padding:20px;max-width:420px;color:#fff">
      <h2 style="color:#FF8A00;margin-top:0">${escapeAttr(name)}</h2>
      ${rows}
      <hr style="margin:12px 0;border:0;border-top:1px solid rgba(255,255,255,0.15)"/>
      <label style="display:block;margin:6px 0">
        <input type="checkbox" data-global-disable />
        <span style="margin-left:6px">${disableLabel}</span>
      </label>
      <div style="margin-top:10px;font-size:13px;color:#aaa">
        ${escapeAttr(translate('autoskip_settings_version'))}: ${escapeAttr(version)}
      </div>
    </div>
  `;
}

export function showSettingsModal({ name, version, settings, onChange, log }) {
  const html = buildSettingsHtml({ name, version, settings });

  if (typeof Lampa === 'undefined' || !Lampa.Modal) {
    log('warn', 'Settings modal works only inside Lampa.');
    return;
  }

  Lampa.Modal.open({
    title: name,
    html,
    onBack: () => {
      Lampa.Modal.close();
    }
  });

  setTimeout(() => {
    const box = document.querySelector('#al-autoskip-settings');
    if (!box) return;

    box.querySelectorAll('[data-setting]').forEach((el) => {
      el.onchange = (e) => {
        const key = e.target.dataset.setting;
        const value = e.target.checked;
        onChange(key, value);
      };
    });

    const globalDisable = box.querySelector('[data-global-disable]');
    if (globalDisable) {
      try {
        if (typeof Lampa !== 'undefined' && Lampa.Storage && typeof Lampa.Storage.field === 'function') {
          globalDisable.checked = Lampa.Storage.field('autoskip_disabled') === true;
        }
      } catch (e) { /* noop */ }
      globalDisable.onchange = (e) => persistGlobalDisable(e.target.checked);
    }
  }, 100);
}
