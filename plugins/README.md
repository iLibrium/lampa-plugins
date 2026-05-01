# AutoSkip 2.0

Плагин для Lampa, который находит вступление и финальные титры в видео и предлагает их пропустить кнопкой `[Пропустить]` рядом с `[Отменить]`. Работает полностью на клиенте, без серверной части.

## Подключение

URL плагина:
- `https://raw.githubusercontent.com/iLibrium/lampa-plugins/main/plugins/plugin.js`
- `https://cdn.jsdelivr.net/gh/iLibrium/lampa-plugins@main/plugins/plugin.js`

В Lampa: **Настройки → Расширения → Добавить плагин** → вставить URL → перезапустить.

## Что нового в 2.0

- Двухкнопочный промпт `[Отменить] [Пропустить]` внутри панели плеера, навигация пультом ДУ через `Lampa.Controller`.
- Бегущий оранжевый прогресс-бордер 5 секунд под кнопкой Skip; пауза/возобновление синхронизированы с воспроизведением (без дрейфа на seek).
- Несколько источников детекции с приоритетами: AniSkip API → metadata → chapters → cache → audio.
- Аудио-провайдер: спектральный признак voice/music, окно поиска 25%/25%, авто-отключение на cross-origin потоках.
- Кэш сегментов на `Lampa.Storage`, ключи на TMDB id+season+episode (не зависит от signed URL).
- Поддержка i18n (ru/en) через `Lampa.Lang`.
- Kill-switch: `?autoskip=off` в URL или чекбокс в настройках.
- AniSkip API для аниме (требует совпадения TMDB id с встроенной картой; пользователь может расширить через `Lampa.Storage.set('autoskip_aniskip_map', { tmdbId: malId })`).
- Не дублирует UI на форках Lampa со встроенным skip (Lampa Premium и т.п.).

## Разработка

`plugins/plugin.js` собирается из исходников в `src/`.

- `npm install`
- `npm run build`
- `npm run watch`

Архитектура:

```
src/
  entry.js                 # bootstrap + kill-switch
  core/
    AutoSkipPlugin.js      # тонкий оркестратор
    capabilities.js        # пробы окружения (TV, AudioContext, Lampa.Storage)
    logger.js
  segments/
    SegmentResolver.js     # приоритеты + cache validation bonus
    contentId.js           # TMDB-based ключ кэша
    ranges.js, constants.js
    providers/
      ProviderBase.js
      MetadataProvider.js  # из Lampa.Player.data()
      ChaptersProvider.js  # из video.textTracks
      AudioProvider.js     # ScriptProcessor + AnalyserNode (FFT)
      AniSkipProvider.js   # api.aniskip.com (опц.)
      aniskip/tmdbToMal.js # bundled-mapping
  playback/
    PlaybackController.js  # timeupdate-цикл, dismiss/skip state
    visibilityGuard.js     # сброс аудио-буфера на возврате из фона
    nativeSkipDetect.js    # детект встроенного skip в форках
  storage/
    SettingsStore.js       # Lampa.Storage с миграцией localStorage
    SegmentCache.js        # Lampa.Storage с миграцией localStorage
  ui/
    SkipPrompt/
      SkipPrompt.js        # mount в .player-panel
      controller.js        # Lampa.Controller integration
      progressTimer.js     # performance.now-based 5s
      styles.js
  lampa/
    waitForLampa.js
    settingsUi.js          # модал настроек с i18n
    playerEvents.js
  util/
    i18n.js                # ru/en словарь + Lampa.Lang
```
