# Lampa Plugins

Набор самодельных плагинов для приложения [Lampa](https://lampatv.github.io/).

## AniLibria AutoSkip

Плагин автоматически пропускает стандартные промежутки опенингов и эндингов на релизах AniLibria.

### Возможности

- Автоматический запуск вместе с плеером Lampa.
- Пропуск опенингов (85–105 секунда).
- Пропуск эндингов (последние 90–30 секунд эпизода).
- Сохранение пользовательских настроек в `localStorage`.
- Уведомления о пропуске сегментов через Lampa Noty (если доступно).

### Установка

1. Скачайте файл [`plugins/anilibria-autoskip/plugin.js`](plugins/anilibria-autoskip/plugin.js). Если хотите подключить скрипт напрямую из сети, используйте «сырую» ссылку вида `https://raw.githubusercontent.com/iLibrium/lampa-plugins/main/plugins/anilibria-autoskip/plugin.js` или CDN `https://cdn.jsdelivr.net/gh/iLibrium/lampa-plugins@main/plugins/anilibria-autoskip/plugin.js`. Прямая ссылка на страницу GitHub (`https://github.com/.../blob/...`) возвращает HTML и из-за этого Lampa сообщает об ошибке загрузки.
2. Импортируйте файл в Lampa через меню настроек плагинов или поместите его в каталог пользовательских плагинов.
3. Активируйте плагин и при необходимости настройте параметры в разделе «AniLibria AutoSkip».

### Проверка

Код проверен через `node --check` для исключения синтаксических ошибок.
