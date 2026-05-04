const FALLBACK = {
  ru: {
    autoskip_name: 'AutoSkip',
    autoskip_skip: 'Пропустить',
    autoskip_cancel: 'Отменить',
    autoskip_intro_skipped: 'Пропущено вступление',
    autoskip_credits_skipped: 'Пропущены титры',
    autoskip_setting_enabled: 'Включить AutoSkip',
    autoskip_setting_autostart: 'Автозапуск',
    autoskip_setting_skip_intro: 'Пропускать вступление',
    autoskip_setting_skip_credits: 'Пропускать титры',
    autoskip_setting_notifications: 'Показывать уведомления',
    autoskip_setting_debug: 'Debug-логи',
    autoskip_setting_disable: 'Отключить плагин',
    autoskip_setting_aniskip: 'Использовать AniSkip API для аниме',
    autoskip_setting_theintrodb: 'Использовать TheIntroDB для сериалов',
    autoskip_settings_version: 'Версия',
    autoskip_audio_cors: 'AutoSkip: аудио-детект недоступен на этом источнике (CORS)'
  },
  en: {
    autoskip_name: 'AutoSkip',
    autoskip_skip: 'Skip',
    autoskip_cancel: 'Cancel',
    autoskip_intro_skipped: 'Intro skipped',
    autoskip_credits_skipped: 'Credits skipped',
    autoskip_setting_enabled: 'Enable AutoSkip',
    autoskip_setting_autostart: 'Autostart',
    autoskip_setting_skip_intro: 'Skip intro',
    autoskip_setting_skip_credits: 'Skip credits',
    autoskip_setting_notifications: 'Show notifications',
    autoskip_setting_debug: 'Debug logs',
    autoskip_setting_disable: 'Disable plugin',
    autoskip_setting_aniskip: 'Use AniSkip API for anime',
    autoskip_setting_theintrodb: 'Use TheIntroDB for TV shows',
    autoskip_settings_version: 'Version',
    autoskip_audio_cors: 'AutoSkip: audio detect unavailable on this source (CORS)'
  }
};

function getLampa() {
  return typeof Lampa !== 'undefined' ? Lampa : null;
}

function detectLang() {
  const lampa = getLampa();
  if (lampa && lampa.Storage && typeof lampa.Storage.field === 'function') {
    const fromStore = lampa.Storage.field('language');
    if (fromStore && FALLBACK[fromStore]) return fromStore;
  }
  return 'ru';
}

export function t(key) {
  const lampa = getLampa();
  if (lampa && lampa.Lang && typeof lampa.Lang.translate === 'function') {
    try {
      const v = lampa.Lang.translate(key);
      if (v && v !== key) return v;
    } catch (e) { /* noop */ }
  }
  const lang = detectLang();
  return (FALLBACK[lang] && FALLBACK[lang][key]) || FALLBACK.ru[key] || key;
}

export function registerTranslations() {
  const lampa = getLampa();
  if (!lampa || !lampa.Lang) return false;

  const langs = Object.keys(FALLBACK);

  if (typeof lampa.Lang.add === 'function') {
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
    } catch (e) { /* noop */ }
  }

  return false;
}
