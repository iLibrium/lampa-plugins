(function () {
  'use strict';

  const PLUGIN_ID = 'autoskip';
  if (window[PLUGIN_ID]) return;

  class AutoSkipPlugin {
    constructor() {
      this.version = '1.0.6';
      this.component = 'autoskip';
      this.name = 'AutoSkip';
      this.settings = Object.assign({
        enabled: true,
        autoStart: true,
        skipIntro: true,
        skipCredits: true,
        showNotifications: true
      }, this.loadSettings());

      this.isRunning = false;
      this.video = null;
      this.timeHandler = null;
      this.introSkipped = false;
      this.creditsSkipped = false;
      this.activeSegment = null;
      this.segmentRanges = {
        intro: [],
        credits: []
      };
      this.skipButton = null;
      this.skipButtonTimeouts = {
        progress: null,
        hide: null
      };
      this._bindedOnLoadedMeta = null;
      this._bindedOnPlaying = null;
      this._bindedOnPlayForAudio = null;
      this._bindedOnSeeking = null;

      this.audioContext = null;
      this.audioSourceNode = null;
      this.audioProcessorNode = null;
      this.audioAnalysisState = null;
      this.rmsConfig = {
        windowSec: 0.5,
        baselineWindows: 120,
        zThreshold: 1.4,
        minSegmentSec: 8,
        mergeGapSec: 1
      };

      this.init();
    }

    init() {
      this.waitForLampa(() => {
        this.addSettingsToLampa();
        this.listenPlayer();
        if (this.settings.autoStart && this.settings.enabled) this.start();
        window[PLUGIN_ID] = true;
        console.log(`[${this.name}] initialized (${this.version}).`);
      });
    }

    waitForLampa(cb) {
      const checkInterval = 500;
      const maxAttempts = 20;
      let attempts = 0;
      const check = () => {
        if (typeof Lampa !== 'undefined' && Lampa.Settings && Lampa.Player) cb();
        else if (attempts++ < maxAttempts) setTimeout(check, checkInterval);
        else console.error(`[${this.name}] Lampa not found (incompatible environment?).`);
      };
      check();
    }

    addSettingsToLampa() {
      if (typeof Lampa === 'undefined' || !Lampa.Settings) {
        console.error(`[${this.name}] Failed to add settings (Settings missing).`);
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
            console.warn(`[${this.name}] Settings.${method} threw:`, err);
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
        console.error(`[${this.name}] Failed to add settings (unknown Settings API).`);
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
          <label><input type="checkbox" data-setting="enabled" ${this.settings.enabled ? 'checked' : ''}/> \u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c AutoSkip</label><br>
          <label><input type="checkbox" data-setting="autoStart" ${this.settings.autoStart ? 'checked' : ''}/> \u0410\u0432\u0442\u043e\u0437\u0430\u043f\u0443\u0441\u043a</label><br>
          <label><input type="checkbox" data-setting="skipIntro" ${this.settings.skipIntro ? 'checked' : ''}/> \u041f\u0440\u043e\u043f\u0443\u0441\u043a\u0430\u0442\u044c \u0432\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u0435</label><br>
          <label><input type="checkbox" data-setting="skipCredits" ${this.settings.skipCredits ? 'checked' : ''}/> \u041f\u0440\u043e\u043f\u0443\u0441\u043a\u0430\u0442\u044c \u0442\u0438\u0442\u0440\u044b</label><br>
          <label><input type="checkbox" data-setting="showNotifications" ${this.settings.showNotifications ? 'checked' : ''}/> \u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f</label><br>
          <div style="margin-top:10px;font-size:13px;color:#aaa">\u0412\u0435\u0440\u0441\u0438\u044f: ${this.version}</div>
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
        console.warn(`[${this.name}] Settings modal works only inside Lampa.`);
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
      this.introSkipped = false;
      this.creditsSkipped = false;
      this.activeSegment = null;
      this.segmentRanges = {
        intro: [],
        credits: []
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
            this.startAudioAnalysis();
          };
          this.video.addEventListener('loadedmetadata', this._bindedOnLoadedMeta, { once: true });
        } else {
          this.collectSegmentRanges();
          this.attachTimeHandler();
          this.startAudioAnalysis();
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
      this.teardownAudioAnalysis();
      this.video = null;
      this.timeHandler = null;
      this._bindedOnLoadedMeta = null;
      this._bindedOnPlaying = null;
      this.activeSegment = null;
      this.segmentRanges = {
        intro: [],
        credits: []
      };
      this.hideSkipButton(true);
    }

    collectSegmentRanges() {
      if (!this.video) return;
      const fromTracks = this.getRangesFromTextTracks(this.video);
      if (fromTracks.intro.length || fromTracks.credits.length) {
        this.segmentRanges = fromTracks;
        return;
      }
      const fromPlayer = this.getRangesFromPlayerData();
      if (fromPlayer.intro.length || fromPlayer.credits.length) {
        this.segmentRanges = fromPlayer;
      }
    }

    startAudioAnalysis() {
      if (!this.video) return;
      if (this.audioContext) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        console.warn(`[${this.name}] AudioContext not available, audio-based skip disabled.`);
        return;
      }
      try {
        this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
      } catch (e) {
        console.warn(`[${this.name}] Failed to start AudioContext:`, e);
        this.audioContext = null;
        return;
      }

      this.audioAnalysisState = {
        currentSumSq: 0,
        currentSamples: 0,
        windows: [],
        windowSamples: Math.max(1, Math.floor(this.rmsConfig.windowSec * this.audioContext.sampleRate))
      };

      try {
        this.audioSourceNode = this.audioContext.createMediaElementSource(this.video);
      } catch (e) {
        console.warn(`[${this.name}] Cannot create media source:`, e);
        this.teardownAudioAnalysis();
        return;
      }

      const bufferSize = 2048;
      const inputChannels = Math.max(1, this.audioSourceNode.channelCount || 2);
      this.audioProcessorNode = this.audioContext.createScriptProcessor(bufferSize, inputChannels, inputChannels);
      this.audioProcessorNode.onaudioprocess = (event) => this.handleAudioProcess(event);

      try {
        this.audioSourceNode.connect(this.audioProcessorNode);
        this.audioProcessorNode.connect(this.audioContext.destination);
      } catch (e) {
        console.warn(`[${this.name}] Cannot wire audio nodes:`, e);
        this.teardownAudioAnalysis();
        return;
      }

      const resumeContext = () => {
        if (!this.audioContext) return;
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
      };
      resumeContext();
      this._bindedOnPlayForAudio = resumeContext;
      this.video.addEventListener('play', this._bindedOnPlayForAudio);

      this._bindedOnSeeking = () => this.resetAudioWindowAccumulator();
      this.video.addEventListener('seeking', this._bindedOnSeeking);
    }

    resetAudioWindowAccumulator() {
      if (!this.audioAnalysisState) return;
      this.audioAnalysisState.currentSamples = 0;
      this.audioAnalysisState.currentSumSq = 0;
    }

    handleAudioProcess(event) {
      if (!this.audioAnalysisState || !this.video) return;
      const inputBuffer = event.inputBuffer;
      if (!inputBuffer) return;

      const channelCount = inputBuffer.numberOfChannels;
      if (!channelCount) return;
      const length = inputBuffer.length;
      const channels = [];
      for (let c = 0; c < channelCount; c += 1) {
        channels.push(inputBuffer.getChannelData(c));
      }

      const state = this.audioAnalysisState;
      const windowSamples = state.windowSamples;

      for (let i = 0; i < length; i += 1) {
        let sample = 0;
        for (let c = 0; c < channelCount; c += 1) {
          sample += channels[c][i];
        }
        sample /= channelCount;

        state.currentSumSq += sample * sample;
        state.currentSamples += 1;

        if (state.currentSamples >= windowSamples) {
          const rms = Math.sqrt(state.currentSumSq / state.currentSamples);
          const endTime = this.video.currentTime;
          const startTime = Math.max(0, endTime - this.rmsConfig.windowSec);
          state.windows.push({ start: startTime, end: endTime, rms });
          this.trimAudioWindows();
          this.updateSegmentsFromAudio();
          state.currentSumSq = 0;
          state.currentSamples = 0;
        }
      }
    }

    trimAudioWindows() {
      if (!this.audioAnalysisState) return;
      const maxWindows = 3600; // ~30 minutes if windowSec=0.5
      if (this.audioAnalysisState.windows.length > maxWindows) {
        const excess = this.audioAnalysisState.windows.length - maxWindows;
        this.audioAnalysisState.windows.splice(0, excess);
      }
    }

    updateSegmentsFromAudio() {
      if (!this.audioAnalysisState || !this.video) return;
      const duration = this.video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const windows = this.audioAnalysisState.windows;
      if (!windows.length) return;

      const baselineSize = Math.min(this.rmsConfig.baselineWindows, windows.length);
      const baselineSlice = windows.slice(-baselineSize);
      const values = baselineSlice.map((w) => w.rms);
      const median = this.computeMedian(values);
      let mad = this.computeMedian(values.map((v) => Math.abs(v - median)));
      if (!Number.isFinite(mad) || mad < 1e-7) {
        const variance = values.reduce((s, v) => s + (v - median) * (v - median), 0) / Math.max(values.length, 1);
        mad = Math.sqrt(Math.max(variance, 0)) / 1.4826 || 1e-6;
      }

      const thresh = this.rmsConfig.zThreshold * mad * 1.4826;
      const flagged = [];
      for (let i = 0; i < windows.length; i += 1) {
        const w = windows[i];
        const outlier = Math.abs(w.rms - median) > thresh;
        if (outlier) flagged.push({ start: w.start, end: w.end });
      }
      const merged = this.mergeSegments(flagged, this.rmsConfig.mergeGapSec);
      const filtered = merged.filter((seg) => (seg.end - seg.start) >= this.rmsConfig.minSegmentSec);
      if (!filtered.length) return;

      const introCandidates = filtered
        .filter((seg) => seg.start <= duration * 0.35)
        .sort((a, b) => a.start - b.start);
      const creditsCandidates = filtered
        .filter((seg) => seg.end >= duration * 0.65)
        .sort((a, b) => a.start - b.start);

      const newRanges = { intro: [], credits: [] };
      if (introCandidates.length) newRanges.intro.push(introCandidates[0]);
      if (creditsCandidates.length) newRanges.credits.push(creditsCandidates[creditsCandidates.length - 1]);
      if (newRanges.intro.length || newRanges.credits.length) {
        this.segmentRanges = newRanges;
      }
    }

    mergeSegments(segments, gapSec) {
      if (!segments.length) return [];
      const sorted = segments.slice().sort((a, b) => a.start - b.start);
      const merged = [Object.assign({}, sorted[0])];
      for (let i = 1; i < sorted.length; i += 1) {
        const prev = merged[merged.length - 1];
        const cur = sorted[i];
        if (cur.start - prev.end <= gapSec) {
          prev.end = Math.max(prev.end, cur.end);
        } else {
          merged.push(Object.assign({}, cur));
        }
      }
      return merged;
    }

    computeMedian(arr) {
      if (!arr.length) return 0;
      const sorted = arr.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
      return sorted[mid];
    }

    teardownAudioAnalysis() {
      if (this.audioProcessorNode) {
        try { this.audioProcessorNode.disconnect(); } catch (e) { /* noop */ }
      }
      if (this.audioSourceNode) {
        try { this.audioSourceNode.disconnect(); } catch (e) { /* noop */ }
      }
      if (this.audioContext) {
        try { this.audioContext.close(); } catch (e) { /* noop */ }
      }
      if (this.video && this._bindedOnPlayForAudio) {
        this.video.removeEventListener('play', this._bindedOnPlayForAudio);
      }
      if (this.video && this._bindedOnSeeking) {
        this.video.removeEventListener('seeking', this._bindedOnSeeking);
      }
      this.audioContext = null;
      this.audioSourceNode = null;
      this.audioProcessorNode = null;
      this.audioAnalysisState = null;
      this._bindedOnPlayForAudio = null;
      this._bindedOnSeeking = null;
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

    getIntroRange(duration) {
      const start = Math.min(90, Math.max(30, duration * 0.05));
      const end = Math.min(150, Math.max(start + 10, duration * 0.12));
      return { start, end };
    }

    getCreditsRange(duration) {
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
      const intro = this.getIntroRange(duration);
      const credits = this.getCreditsRange(duration);
      if (this.settings.skipIntro && !this.introSkipped &&
          time >= intro.start && time <= intro.end) {
        return 'intro';
      }
      if (this.settings.skipCredits && !this.creditsSkipped &&
          time >= credits.start && time <= credits.end) {
        return 'credits';
      }
      return null;
    }

    detectSegmentFromRanges(time) {
      if (this.settings.skipIntro && !this.introSkipped) {
        if (this.isTimeInRanges(time, this.segmentRanges.intro)) {
          return 'intro';
        }
      }
      if (this.settings.skipCredits && !this.creditsSkipped) {
        if (this.isTimeInRanges(time, this.segmentRanges.credits)) {
          return 'credits';
        }
      }
      return null;
    }

    isTimeInRanges(time, ranges) {
      return ranges.some((range) => time >= range.start && time <= range.end);
    }

    getRangesFromTextTracks(video) {
      const ranges = { intro: [], credits: [] };
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
            ranges.intro.push({ start: cue.startTime, end: cue.endTime });
          } else if (outroRegex.test(text)) {
            ranges.credits.push({ start: cue.startTime, end: cue.endTime });
          }
        }
      }
      return ranges;
    }

    getRangesFromPlayerData() {
      const ranges = { intro: [], credits: [] };
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
      if (/(opening|intro|op|вступ|застав)/i.test(key)) return 'intro';
      if (/(ending|outro|ed|credits|титр)/i.test(key)) return 'credits';
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
      button.textContent = '\u041f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c';
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

      if (segment === 'intro') {
        const intro = this.segmentRanges.intro.length
          ? this.segmentRanges.intro[0]
          : this.getIntroRange(duration);
        this.introSkipped = true;
        this.safeSeek(intro.end);
        this.notify('\u041f\u0440\u043e\u043f\u0443\u0449\u0435\u043d\u043e \u0432\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u0435');
      }
      if (segment === 'credits') {
        const credits = this.segmentRanges.credits.length
          ? this.segmentRanges.credits[0]
          : this.getCreditsRange(duration);
        this.creditsSkipped = true;
        this.safeSeek(Math.min(duration - 1, Math.max(0, credits.end)));
        this.notify('\u041f\u0440\u043e\u043f\u0443\u0449\u0435\u043d\u044b \u0442\u0438\u0442\u0440\u044b');
      }

      this.hideSkipButton();
    }


    safeSeek(target) {
      try {
        if (Number.isFinite(target)) this.video.currentTime = target;
      } catch (e) {
        console.warn(`[${this.name}] Failed to seek:`, e);
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
        const stored = JSON.parse(localStorage.getItem('autoskip_settings') || '{}');
        if (typeof stored === 'object' && stored !== null) {
          if (stored.skipOpenings !== undefined && stored.skipIntro === undefined) {
            stored.skipIntro = stored.skipOpenings;
          }
          if (stored.skipEndings !== undefined && stored.skipCredits === undefined) {
            stored.skipCredits = stored.skipEndings;
          }
          if (Object.keys(stored).length) return stored;
        }

        const legacy = JSON.parse(localStorage.getItem('anilibria_autoskip_settings') || '{}');
        if (typeof legacy === 'object' && legacy !== null) {
          if (legacy.skipOpenings !== undefined) legacy.skipIntro = legacy.skipOpenings;
          if (legacy.skipEndings !== undefined) legacy.skipCredits = legacy.skipEndings;
          return legacy;
        }
        return {};
      } catch (e) {
        return {};
      }
    }

    saveSettings() {
      localStorage.setItem('autoskip_settings', JSON.stringify(this.settings));
    }

    start() {
      this.isRunning = true;
      console.log(`[${this.name}] auto-skip started.`);
    }

    stop() {
      this.isRunning = false;
      console.log(`[${this.name}] auto-skip stopped.`);
    }
  }

  new AutoSkipPlugin();
})();



