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

  const config = {
    component,
    name,
    icon,
    onSelect
  };

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
    settings.listener.follow('open', (e) => {
      if (e.name === component) onSelect();
    });
  }

  return true;
}

export function showSettingsModal({ name, version, settings, onChange, log }) {
  const html = `
    <div id="al-autoskip-settings" style="padding:20px;max-width:400px;color:#fff">
      <h2 style="color:#4CAF50">${name}</h2>
      <label><input type="checkbox" data-setting="enabled" ${settings.enabled ? 'checked' : ''}/> Включить AutoSkip</label><br>
      <label><input type="checkbox" data-setting="autoStart" ${settings.autoStart ? 'checked' : ''}/> Автозапуск</label><br>
      <label><input type="checkbox" data-setting="skipIntro" ${settings.skipIntro ? 'checked' : ''}/> Пропускать вступление</label><br>
      <label><input type="checkbox" data-setting="skipCredits" ${settings.skipCredits ? 'checked' : ''}/> Пропускать титры</label><br>
      <label><input type="checkbox" data-setting="showNotifications" ${settings.showNotifications ? 'checked' : ''}/> Показывать уведомления</label><br>
      <label><input type="checkbox" data-setting="debug" ${settings.debug ? 'checked' : ''}/> Debug-логи</label><br>
      <div style="margin-top:10px;font-size:13px;color:#aaa">Версия: ${version}</div>
    </div>
  `;

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
  }, 100);
}
