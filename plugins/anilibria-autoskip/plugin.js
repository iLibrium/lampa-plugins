(function () {
  'use strict';

  const PLUGIN_ID = 'anilibria_autoskip';
  if (window[PLUGIN_ID]) return;

  class AniLibriaAutoSkip {
    constructor() {
      this.version = '1.0.3';
      this.component = 'anilibria_autoskip';
      this.name = 'AniLibria AutoSkip';
      this.settings = Object.assign({
        enabled: true,
        autoStart: true,
        skipOpenings: true,
        skipEndings: true,
        showNotifications: true
      }, this.loadSettings());

      this.isRunning = false;
      this.video = null;
      this.timeHandler = null;
      this.openingSkipped = false;
      this.endingSkipped = false;
      this._bindedOnLoadedMeta = null;
      this._bindedOnPlaying = null;

      this.init();
    }

    init() {
      this.waitForLampa(() => {
        this.addSettingsToLampa();
        this.listenPlayer();
        if (this.settings.autoStart && this.settings.enabled) this.start();
        window[PLUGIN_ID] = true;
        console.log(`[${this.name}] Инициализировано (${this.version}).`);
      });
    }

    waitForLampa(cb) {
      const checkInterval = 500;
      const maxAttempts = 20;
      let attempts = 0;
      const check = () => {
        if (typeof Lampa !== 'undefined' && Lampa.Settings && Lampa.Player) cb();
        else if (attempts++ < maxAttempts) setTimeout(check, checkInterval);
        else console.error(`[${this.name}] Lampa не найдена (совместимость?).`);
      };
      check();
    }

    addSettingsToLampa() {
      if (typeof Lampa !== 'undefined' && Lampa.Settings && Lampa.Settings.component) {
        Lampa.Settings.component({
          component: this.component,
          name: this.name,
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
        });
        Lampa.Settings.listener.follow('open', (e) => {
          if (e.name === this.component) this.openSettingsModal();
        });
      } else {
        console.error(`[${this.name}] Не удалось добавить настройки.`);
      }
    }

    openSettingsModal() {
      const html = `
        <div id="al-autoskip-settings" style="padding:20px;max-width:400px;color:#fff">
          <h2 style="color:#4CAF50">${this.name}</h2>
          <label><input type="checkbox" data-setting="enabled" ${this.settings.enabled ? 'checked' : ''}/> Включить AutoSkip</label><br>
          <label><input type="checkbox" data-setting="autoStart" ${this.settings.autoStart ? 'checked' : ''}/> Автозапуск</label><br>
          <label><input type="checkbox" data-setting="skipOpenings" ${this.settings.skipOpenings ? 'checked' : ''}/> Пропускать опенинги</label><br>
          <label><input type="checkbox" data-setting="skipEndings" ${this.settings.skipEndings ? 'checked' : ''}/> Пропускать эндинги</label><br>
          <label><input type="checkbox" data-setting="showNotifications" ${this.settings.showNotifications ? 'checked' : ''}/> Показывать уведомления</label><br>
          <div style="margin-top:10px;font-size:13px;color:#aaa">Версия: ${this.version}</div>
        </div>
      `;
      if (typeof Lampa !== 'undefined' && Lampa.Modal) {
        Lampa.Modal.open({
          title: this.name,
          html,
          onBack: () => { Lampa.Modal.close(); }
        });
        setTimeout(() => {
          const box = document.querySelector('#al-autoskip-settings');
          if (!box) return;
          box.querySelectorAll('[data-setting]').forEach(el => {
            el.onchange = (e) => {
              this.settings[e.target.dataset.setting] = e.target.checked;
              this.saveSettings();
            };
          });
        }, 100);
      } else {
        console.warn(`[${this.name}] Настройки доступны только внутри Lampa.`);
      }
    }

    listenPlayer() {
      if (typeof Lampa !== 'undefined' && Lampa.Player && Lampa.Player.listener) {
        Lampa.Player.listener.follow('start', () => this.onPlayerStart());
        Lampa.Player.listener.follow('stop', () => this.onPlayerStop());
      }
    }

    onPlayerStart() {
      if (!this.settings.enabled) return;
      this.openingSkipped = false;
      this.endingSkipped = false;

      const attach = () => {
        this.video = this.getVideo();
        if (!this.video) return false;

        if (!Number.isFinite(this.video.duration)) {
          this._bindedOnLoadedMeta = () => {
            this.attachTimeHandler();
          };
          this.video.addEventListener('loadedmetadata', this._bindedOnLoadedMeta, { once: true });
        } else {
          this.attachTimeHandler();
        }

        this._bindedOnPlaying = () => {
          if (!this.timeHandler) this.attachTimeHandler();
        };
        this.video.addEventListener('playing', this._bindedOnPlaying);
        return true;
      };

      if (attach()) return;
      const startedAt = Date.now();
      const poll = () => {
        if (attach()) return;
        if (Date.now() - startedAt < 2000) requestAnimationFrame(poll);
      };
      poll();
    }

    attachTimeHandler() {
      if (!this.video) return;
      if (this.timeHandler) return;
      this.timeHandler = () => this.checkSkip();
      this.video.addEventListener('timeupdate', this.timeHandler);
    }

    onPlayerStop() {
      if (this.video && this.timeHandler) {
        this.video.removeEventListener('timeupdate', this.timeHandler);
      }
      if (this.video && this._bindedOnLoadedMeta) {
        this.video.removeEventListener('loadedmetadata', this._bindedOnLoadedMeta);
      }
      if (this.video && this._bindedOnPlaying) {
        this.video.removeEventListener('playing', this._bindedOnPlaying);
      }
      this.video = null;
      this.timeHandler = null;
      this._bindedOnLoadedMeta = null;
      this._bindedOnPlaying = null;
    }

    getVideo() {
      return document.querySelector('video');
    }

    checkSkip() {
      if (!this.video) return;
      const t = this.video.currentTime;
      const d = this.video.duration;
      if (!Number.isFinite(d) || d <= 0) return;

      const opening = { start: 85, end: 105 };
      let ending = { start: Math.max(0, d - 90), end: Math.max(0, d - 30) };
      if (ending.end <= ending.start) {
        ending = { start: Infinity, end: Infinity };
      }

      if (this.settings.skipOpenings && !this.openingSkipped &&
          t >= opening.start && t <= opening.end) {
        this.openingSkipped = true;
        this.safeSeek(opening.end);
        this.notify('Опенинг пропущен');
        return;
      }

      if (this.settings.skipEndings && !this.endingSkipped &&
          t >= ending.start && t <= ending.end) {
        this.endingSkipped = true;
        this.safeSeek(Math.min(d - 1, Math.max(0, ending.end)));
        this.notify('Эндинг пропущен');
      }
    }

    safeSeek(target) {
      try {
        if (Number.isFinite(target)) this.video.currentTime = target;
      } catch (e) {
        console.warn(`[${this.name}] Не удалось перемотать:`, e);
      }
    }

    notify(msg) {
      if (!this.settings.showNotifications) return;
      if (typeof Lampa !== 'undefined' && Lampa.Noty) {
        Lampa.Noty.show(msg);
      } else {
        console.log(`[${this.name}] ${msg}`);
      }
    }

    loadSettings() {
      try {
        return JSON.parse(localStorage.getItem('anilibria_autoskip_settings') || '{}');
      } catch (e) {
        return {};
      }
    }

    saveSettings() {
      localStorage.setItem('anilibria_autoskip_settings', JSON.stringify(this.settings));
    }

    start() {
      this.isRunning = true;
      console.log(`[${this.name}] Автоскип запущен.`);
    }

    stop() {
      this.isRunning = false;
      console.log(`[${this.name}] Автоскип остановлен.`);
    }
  }

  new AniLibriaAutoSkip();
})();
