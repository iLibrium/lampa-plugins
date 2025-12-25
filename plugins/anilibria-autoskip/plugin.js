(function () {
  'use strict';

  const PLUGIN_ID = 'anilibria_autoskip';
  if (window[PLUGIN_ID]) return;

  class AniLibriaAutoSkip {
    constructor() {
      this.version = '1.0.6';
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
      this.activeSegment = null;
      this.segmentRanges = {
        opening: [],
        ending: []
      };
      this.skipButton = null;
      this.skipButtonTimeouts = {
        progress: null,
        hide: null
      };
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
      if (typeof Lampa === 'undefined' || !Lampa.Settings) {
        console.error(`[${this.name}] Не удалось добавить настройки (Settings не найдены).`);
        return;
      }

      const settings = Lampa.Settings;
      const config = {
        component: this.component,
        name: this.name,
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
        onSelect: () => this.openSettingsModal()
      };

      const registerMethods = ['addComponent', 'register', 'registerComponent', 'add', 'component'];
      let registered = false;
      for (const method of registerMethods) {
        if (typeof settings[method] === 'function') {
          try {
            settings[method](config);
            registered = true;
            break;
          } catch (err) {
            console.warn(`[${this.name}] Settings.${method} завершился с ошибкой:`, err);
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
        console.error(`[${this.name}] Не удалось добавить настройки (неизвестный API Settings).`);
        return;
      }

      if (settings.listener && typeof settings.listener.follow === 'function') {
        settings.listener.follow('open', (e) => {
          if (e.name === this.component) this.openSettingsModal();
        });
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
      this.activeSegment = null;
      this.segmentRanges = {
        opening: [],
        ending: []
      };
      this.ensureSkipButton();
      this.hideSkipButton();

      const attach = () => {
        this.video = this.getVideo();
        if (!this.video) return false;

        if (!Number.isFinite(this.video.duration)) {
          this._bindedOnLoadedMeta = () => {
            this.collectSegmentRanges();
            this.attachTimeHandler();
          };
          this.video.addEventListener('loadedmetadata', this._bindedOnLoadedMeta, { once: true });
        } else {
          this.collectSegmentRanges();
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
      this.activeSegment = null;
      this.segmentRanges = {
        opening: [],
        ending: []
      };
      this.hideSkipButton(true);
    }

    collectSegmentRanges() {
      if (!this.video) return;
      const fromTracks = this.getRangesFromTextTracks(this.video);
      if (fromTracks.opening.length || fromTracks.ending.length) {
        this.segmentRanges = fromTracks;
        return;
      }
      const fromPlayer = this.getRangesFromPlayerData();
      if (fromPlayer.opening.length || fromPlayer.ending.length) {
        this.segmentRanges = fromPlayer;
      }
    }

    getVideo() {
      return document.querySelector('video');
    }

    checkSkip() {
      if (!this.video) return;
      const t = this.video.currentTime;
      const d = this.video.duration;
      if (!Number.isFinite(d) || d <= 0) return;

      const segment = this.detectSegment(t, d);

      if (segment) {
        this.showSkipButton(segment);
      } else if (this.activeSegment) {
        this.hideSkipButton();
      }
    }

    getOpeningRange(duration) {
      const start = Math.min(90, Math.max(30, duration * 0.05));
      const end = Math.min(150, Math.max(start + 10, duration * 0.12));
      return { start, end };
    }

    getEndingRange(duration) {
      const endOffset = Math.max(30, duration * 0.02);
      const startOffset = Math.max(90, duration * 0.08);
      const start = Math.max(0, duration - startOffset);
      const end = Math.max(0, duration - endOffset);
      if (end <= start) {
        return { start: Infinity, end: Infinity };
      }
      return { start, end };
    }

    detectSegment(time, duration) {
      const detected = this.detectSegmentFromRanges(time);
      if (detected) return detected;
      const opening = this.getOpeningRange(duration);
      const ending = this.getEndingRange(duration);
      if (this.settings.skipOpenings && !this.openingSkipped &&
          time >= opening.start && time <= opening.end) {
        return 'opening';
      }
      if (this.settings.skipEndings && !this.endingSkipped &&
          time >= ending.start && time <= ending.end) {
        return 'ending';
      }
      return null;
    }

    detectSegmentFromRanges(time) {
      if (this.settings.skipOpenings && !this.openingSkipped) {
        if (this.isTimeInRanges(time, this.segmentRanges.opening)) {
          return 'opening';
        }
      }
      if (this.settings.skipEndings && !this.endingSkipped) {
        if (this.isTimeInRanges(time, this.segmentRanges.ending)) {
          return 'ending';
        }
      }
      return null;
    }

    isTimeInRanges(time, ranges) {
      return ranges.some((range) => time >= range.start && time <= range.end);
    }

    getRangesFromTextTracks(video) {
      const ranges = { opening: [], ending: [] };
      if (!video.textTracks) return ranges;
      const introRegex = /(op|opening|intro|вступ|застав)/i;
      const outroRegex = /(ed|ending|outro|credits|титр)/i;
      for (let i = 0; i < video.textTracks.length; i += 1) {
        const track = video.textTracks[i];
        const kind = track.kind || '';
        if (!['chapters', 'metadata', 'subtitles'].includes(kind)) continue;
        const cues = track.cues || [];
        for (let j = 0; j < cues.length; j += 1) {
          const cue = cues[j];
          const text = `${cue.id || ''} ${cue.text || ''}`.trim();
          if (introRegex.test(text)) {
            ranges.opening.push({ start: cue.startTime, end: cue.endTime });
          } else if (outroRegex.test(text)) {
            ranges.ending.push({ start: cue.startTime, end: cue.endTime });
          }
        }
      }
      return ranges;
    }

    getRangesFromPlayerData() {
      const ranges = { opening: [], ending: [] };
      if (typeof Lampa === 'undefined' || !Lampa.Player) return ranges;
      const data = this.getPlayerData();
      if (!data) return ranges;
      this.extractRangesFromObject(data, ranges, 0);
      return ranges;
    }

    getPlayerData() {
      const player = Lampa.Player;
      if (player && typeof player.get === 'function') return player.get();
      if (player && typeof player.data === 'function') return player.data();
      if (player && player.current) return player.current;
      if (player && player.item) return player.item;
      return null;
    }

    extractRangesFromObject(data, ranges, depth) {
      if (!data || depth > 3) return;
      if (Array.isArray(data)) {
        data.forEach((item) => this.extractRangesFromObject(item, ranges, depth + 1));
        return;
      }
      if (typeof data !== 'object') return;

      Object.keys(data).forEach((key) => {
        const value = data[key];
        if (!value || typeof value !== 'object') {
          return;
        }
        const lower = key.toLowerCase();
        const kind = this.getSegmentKindFromKey(lower);
        const range = this.normalizeRange(value);
        if (kind && range) {
          ranges[kind].push(range);
        } else {
          this.extractRangesFromObject(value, ranges, depth + 1);
        }
      });
    }

    getSegmentKindFromKey(key) {
      if (/(opening|intro|op|вступ|застав)/i.test(key)) return 'opening';
      if (/(ending|outro|ed|credits|титр)/i.test(key)) return 'ending';
      return null;
    }

    normalizeRange(value) {
      if (Array.isArray(value) && value.length >= 2) {
        const start = Number(value[0]);
        const end = Number(value[1]);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          return { start, end };
        }
      }
      if (typeof value === 'object') {
        const start = Number(value.start ?? value.begin ?? value.from);
        const end = Number(value.end ?? value.finish ?? value.to);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          return { start, end };
        }
      }
      return null;
    }

    ensureSkipButton() {
      if (this.skipButton) return;

      const styleId = 'al-autoskip-style';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          .al-autoskip-btn {
            position: fixed;
            right: 40px;
            bottom: 120px;
            width: 132px;
            height: 132px;
            border-radius: 50%;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.65);
            color: #fff;
            font-size: 16px;
            font-weight: 600;
            text-align: center;
            z-index: 9999;
            border: 2px solid rgba(255, 255, 255, 0.2);
            box-sizing: border-box;
            cursor: pointer;
          }
          .al-autoskip-btn.is-visible {
            display: flex;
          }
          .al-autoskip-btn::before {
            content: "";
            position: absolute;
            inset: -8px;
            border-radius: 50%;
            background: conic-gradient(#4CAF50 0deg, rgba(76, 175, 80, 0.25) 0deg);
            mask: radial-gradient(farthest-side, transparent calc(100% - 10px), #000 calc(100% - 9px));
            opacity: 0;
          }
          .al-autoskip-btn.is-animating::before {
            opacity: 1;
            animation: al-autoskip-progress 5s linear forwards;
          }
          @keyframes al-autoskip-progress {
            from {
              background: conic-gradient(#4CAF50 0deg, rgba(76, 175, 80, 0.25) 0deg);
            }
            to {
              background: conic-gradient(#4CAF50 360deg, rgba(76, 175, 80, 0.25) 360deg);
            }
          }
        `;
        document.head.appendChild(style);
      }

      const button = document.createElement('div');
      button.className = 'al-autoskip-btn';
      button.textContent = 'Пропустить';
      button.addEventListener('click', () => {
        if (!this.activeSegment) return;
        this.performSkip(this.activeSegment);
      });
      document.body.appendChild(button);
      this.skipButton = button;
    }

    showSkipButton(segment) {
      this.ensureSkipButton();
      if (!this.skipButton) return;

      const isSame = this.activeSegment === segment;
      const wasVisible = this.skipButton.classList.contains('is-visible');
      this.activeSegment = segment;
      this.skipButton.classList.add('is-visible');

      if (!isSame || !wasVisible) {
        this.restartButtonAnimation();
        this.clearSkipButtonTimers();
        this.skipButtonTimeouts.progress = setTimeout(() => {
          if (this.activeSegment === segment) {
            this.performSkip(segment);
          }
        }, 5000);
        this.skipButtonTimeouts.hide = setTimeout(() => {
          if (this.activeSegment === segment) {
            this.hideSkipButton();
          }
        }, 10000);
      }
    }

    hideSkipButton(force = false) {
      if (!this.skipButton) return;
      this.clearSkipButtonTimers();
      this.skipButton.classList.remove('is-visible', 'is-animating');
      if (force) {
        this.skipButton.style.display = 'none';
      }
      this.activeSegment = null;
    }

    clearSkipButtonTimers() {
      if (this.skipButtonTimeouts.progress) {
        clearTimeout(this.skipButtonTimeouts.progress);
      }
      if (this.skipButtonTimeouts.hide) {
        clearTimeout(this.skipButtonTimeouts.hide);
      }
      this.skipButtonTimeouts.progress = null;
      this.skipButtonTimeouts.hide = null;
    }

    restartButtonAnimation() {
      if (!this.skipButton) return;
      this.skipButton.classList.remove('is-animating');
      void this.skipButton.offsetWidth;
      this.skipButton.classList.add('is-animating');
    }

    performSkip(segment) {
      if (!this.video) return;
      const duration = this.video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;

      if (segment === 'opening') {
        const opening = this.segmentRanges.opening.length
          ? this.segmentRanges.opening[0]
          : this.getOpeningRange(duration);
        this.openingSkipped = true;
        this.safeSeek(opening.end);
        this.notify('Опенинг пропущен');
      }
      if (segment === 'ending') {
        const ending = this.segmentRanges.ending.length
          ? this.segmentRanges.ending[0]
          : this.getEndingRange(duration);
        this.endingSkipped = true;
        this.safeSeek(Math.min(duration - 1, Math.max(0, ending.end)));
        this.notify('Эндинг пропущен');
      }

      this.hideSkipButton();
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
