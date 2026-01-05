'use strict';
(() => {
  // src/core/logger.js
  function createLogger({ tag }) {
    return function log(level, message, extra = void 0) {
      const fn = console[level] || console.log;
      const prefix = `${tag} `;
      if (extra !== void 0)
        fn.call(console, `${prefix}${message}`, extra);
      else
        fn.call(console, `${prefix}${message}`);
    };
  }

  // src/core/storage.js
  var SETTINGS_KEY = "autoskip_settings";
  var LEGACY_SETTINGS_KEY = "anilibria_autoskip_settings";
  var SEGMENT_CACHE_KEY = "autoskip_segment_cache";
  function safeParseJson(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object")
        return parsed;
      return fallback;
    } catch (e) {
      return fallback;
    }
  }
  function loadSettings(storage = localStorage) {
    const stored = safeParseJson(storage.getItem(SETTINGS_KEY) || "{}", {});
    if (stored && typeof stored === "object") {
      if (stored.skipOpenings !== void 0 && stored.skipIntro === void 0) {
        stored.skipIntro = stored.skipOpenings;
      }
      if (stored.skipEndings !== void 0 && stored.skipCredits === void 0) {
        stored.skipCredits = stored.skipEndings;
      }
      if (Object.keys(stored).length)
        return stored;
    }
    const legacy = safeParseJson(storage.getItem(LEGACY_SETTINGS_KEY) || "{}", {});
    if (legacy && typeof legacy === "object") {
      if (legacy.skipOpenings !== void 0 && legacy.skipIntro === void 0) {
        legacy.skipIntro = legacy.skipOpenings;
      }
      if (legacy.skipEndings !== void 0 && legacy.skipCredits === void 0) {
        legacy.skipCredits = legacy.skipEndings;
      }
      return legacy;
    }
    return {};
  }
  function saveSettings(settings, storage = localStorage) {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  function loadSegmentCache(storage = localStorage) {
    return safeParseJson(storage.getItem(SEGMENT_CACHE_KEY) || "{}", {});
  }
  function saveSegmentCache(cache, storage = localStorage) {
    storage.setItem(SEGMENT_CACHE_KEY, JSON.stringify(cache));
  }

  // src/lampa/waitForLampa.js
  function waitForLampa({
    predicate,
    onReady,
    onTimeout,
    checkInterval = 500,
    maxAttempts = 20,
    log = null
  }) {
    let attempts = 0;
    const check = () => {
      let ready = false;
      try {
        ready = predicate();
      } catch (err) {
        if (log)
          log("warn", "Lampa readiness check threw:", err);
      }
      if (ready) {
        onReady();
        return;
      }
      if (attempts++ < maxAttempts) {
        setTimeout(check, checkInterval);
        return;
      }
      if (onTimeout)
        onTimeout();
    };
    check();
  }

  // src/lampa/settingsUi.js
  function getLampaSettings() {
    if (typeof Lampa === "undefined" || !Lampa.Settings)
      return null;
    return Lampa.Settings;
  }
  function isSettingsApiReady(settings) {
    if (!settings)
      return false;
    const registerMethods = ["addComponent", "register", "registerComponent", "add", "addItem", "component"];
    const hasMethod = registerMethods.some((method) => typeof settings[method] === "function");
    const hasArray = Array.isArray(settings.components) || Array.isArray(settings.items);
    return hasMethod || hasArray;
  }
  function registerSettingsComponent({ component, name, icon, onSelect, log, quiet = false }) {
    const settings = getLampaSettings();
    if (!settings) {
      if (!quiet) {
        log("warn", "Settings UI unavailable (Lampa.Settings missing), plugin continues without menu.");
      }
      return false;
    }
    const config = {
      component,
      name,
      icon,
      onSelect
    };
    const registerMethods = ["addComponent", "register", "registerComponent", "add", "addItem", "component"];
    let registered = false;
    for (const method of registerMethods) {
      if (typeof settings[method] === "function") {
        try {
          settings[method](config);
          registered = true;
          break;
        } catch (err) {
          log("warn", `Settings.${method} threw:`, err);
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
        log("warn", "Settings API not recognized, skipping settings registration.");
      }
      return false;
    }
    if (settings.listener && typeof settings.listener.follow === "function") {
      settings.listener.follow("open", (e) => {
        if (e.name === component)
          onSelect();
      });
    }
    return true;
  }
  function showSettingsModal({ name, version, settings, onChange, log }) {
    const html = `
    <div id="al-autoskip-settings" style="padding:20px;max-width:400px;color:#fff">
      <h2 style="color:#4CAF50">${name}</h2>
      <label><input type="checkbox" data-setting="enabled" ${settings.enabled ? "checked" : ""}/> Включить AutoSkip</label><br>
      <label><input type="checkbox" data-setting="autoStart" ${settings.autoStart ? "checked" : ""}/> Автозапуск</label><br>
      <label><input type="checkbox" data-setting="skipIntro" ${settings.skipIntro ? "checked" : ""}/> Пропускать вступление</label><br>
      <label><input type="checkbox" data-setting="skipCredits" ${settings.skipCredits ? "checked" : ""}/> Пропускать титры</label><br>
      <label><input type="checkbox" data-setting="showNotifications" ${settings.showNotifications ? "checked" : ""}/> Показывать уведомления</label><br>
      <label><input type="checkbox" data-setting="debug" ${settings.debug ? "checked" : ""}/> Debug-логи</label><br>
      <div style="margin-top:10px;font-size:13px;color:#aaa">Версия: ${version}</div>
    </div>
  `;
    if (typeof Lampa === "undefined" || !Lampa.Modal) {
      log("warn", "Settings modal works only inside Lampa.");
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
      const box = document.querySelector("#al-autoskip-settings");
      if (!box)
        return;
      box.querySelectorAll("[data-setting]").forEach((el) => {
        el.onchange = (e) => {
          const key = e.target.dataset.setting;
          const value = e.target.checked;
          onChange(key, value);
        };
      });
    }, 100);
  }

  // src/segments/cache.js
  function getCacheKey(video) {
    if (!video)
      return null;
    const src = video.currentSrc || video.src || "";
    const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : null;
    if (!src || duration === null)
      return null;
    return `${src}::${duration}`;
  }
  function readCachedRanges(cache, key) {
    if (!cache || !key)
      return null;
    return cache[key] || null;
  }
  function writeCachedRanges(cache, key, ranges, { maxEntries = 50 } = {}) {
    if (!cache || !key)
      return;
    if (!ranges || (!ranges.intro || !ranges.intro.length) && (!ranges.credits || !ranges.credits.length))
      return;
    cache[key] = {
      intro: ranges.intro.slice(),
      credits: ranges.credits.slice(),
      ts: Date.now()
    };
    const keys = Object.keys(cache);
    if (keys.length <= maxEntries)
      return;
    keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
    for (let i = 0; i < keys.length - maxEntries; i += 1) {
      delete cache[keys[i]];
    }
  }

  // src/segments/constants.js
  var INTRO_REGEX = /(op|opening|intro|вступ|застав)/i;
  var CREDITS_REGEX = /(ed|ending|outro|credits|титр)/i;
  var SEGMENT_KINDS = ["intro", "credits"];
  function getSegmentKindFromKey(key) {
    if (!key)
      return null;
    if (INTRO_REGEX.test(key))
      return "intro";
    if (CREDITS_REGEX.test(key))
      return "credits";
    return null;
  }

  // src/segments/ranges.js
  function isTimeInRanges(time, ranges) {
    return ranges.some((range) => time >= range.start && time <= range.end);
  }
  function mergeSegments(segments, gapSec) {
    if (!segments.length)
      return [];
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
  function computeMedian(arr) {
    if (!arr.length)
      return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0)
      return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function normalizeRange(range, duration = null) {
    if (!range || typeof range !== "object")
      return null;
    const start = Number(range.start);
    const end = Number(range.end);
    if (!Number.isFinite(start) || !Number.isFinite(end))
      return null;
    let normalizedStart = start;
    let normalizedEnd = end;
    if (Number.isFinite(duration) && duration > 0) {
      normalizedStart = clamp(normalizedStart, 0, duration);
      normalizedEnd = clamp(normalizedEnd, 0, duration);
    }
    if (normalizedEnd <= normalizedStart)
      return null;
    return { start: normalizedStart, end: normalizedEnd };
  }
  function normalizeRanges(ranges, duration = null) {
    const out = { intro: [], credits: [] };
    if (!ranges || typeof ranges !== "object")
      return out;
    for (const kind of SEGMENT_KINDS) {
      const list = Array.isArray(ranges[kind]) ? ranges[kind] : [];
      const normalized = list.map((r) => normalizeRange(r, duration)).filter(Boolean).sort((a, b) => a.start - b.start);
      out[kind] = mergeSegments(normalized, 0);
    }
    return out;
  }
  function rangesEqual(a, b) {
    if (a === b)
      return true;
    if (!Array.isArray(a) || !Array.isArray(b))
      return false;
    if (a.length !== b.length)
      return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].start !== b[i].start || a[i].end !== b[i].end)
        return false;
    }
    return true;
  }

  // src/segments/providers/audioDetector.js
  var AudioSegmentDetector = class {
    constructor({ config, onUpdate, log }) {
      this.config = config;
      this.onUpdate = onUpdate;
      this.log = log;
      this.video = null;
      this.audioContext = null;
      this.audioSourceNode = null;
      this.audioProcessorNode = null;
      this.audioPassthroughNode = null;
      this.silentGainNode = null;
      this.audioAnalysisState = null;
      this._bindedOnPlayForAudio = null;
      this._bindedOnSeeking = null;
      this._lastRanges = null;
    }
    start(video) {
      if (!video)
        return;
      if (this.audioContext)
        return;
      this.video = video;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        this.log("warn", "AudioContext not available, audio-based skip disabled.");
        return;
      }
      try {
        this.audioContext = new AudioCtx({ latencyHint: "interactive" });
      } catch (e) {
        this.log("warn", "Failed to start AudioContext:", e);
        this.audioContext = null;
        return;
      }
      this.audioAnalysisState = {
        currentSumSq: 0,
        currentSamples: 0,
        windows: [],
        windowSamples: Math.max(1, Math.floor(this.config.windowSec * this.audioContext.sampleRate))
      };
      try {
        this.audioSourceNode = this.audioContext.createMediaElementSource(video);
      } catch (e) {
        this.log("warn", "Cannot create media source:", e);
        this.stop();
        return;
      }
      const bufferSize = 2048;
      const inputChannels = Math.max(1, this.audioSourceNode.channelCount || 2);
      this.audioProcessorNode = this.audioContext.createScriptProcessor(bufferSize, inputChannels, inputChannels);
      this.audioProcessorNode.onaudioprocess = (event) => this.handleAudioProcess(event);
      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.value = 0;
      this.audioPassthroughNode = this.audioContext.createGain();
      this.audioPassthroughNode.gain.value = 1;
      try {
        this.audioSourceNode.connect(this.audioProcessorNode);
        this.audioProcessorNode.connect(this.silentGainNode);
        this.silentGainNode.connect(this.audioContext.destination);
        this.audioSourceNode.connect(this.audioPassthroughNode);
        this.audioPassthroughNode.connect(this.audioContext.destination);
      } catch (e) {
        this.log("warn", "Cannot wire audio nodes:", e);
        this.stop();
        return;
      }
      this.log("log", "audio analysis started", {
        sampleRate: this.audioContext.sampleRate,
        bufferSize,
        windowSec: this.config.windowSec
      });
      const resumeContext = () => {
        if (!this.audioContext)
          return;
        if (this.audioContext.state === "suspended") {
          this.audioContext.resume().catch(() => {
          });
        }
      };
      resumeContext();
      this._bindedOnPlayForAudio = resumeContext;
      video.addEventListener("play", this._bindedOnPlayForAudio);
      this._bindedOnSeeking = () => this.resetAudioWindowAccumulator();
      video.addEventListener("seeking", this._bindedOnSeeking);
    }
    stop() {
      if (this.audioProcessorNode) {
        try {
          this.audioProcessorNode.disconnect();
        } catch (e) {
        }
      }
      if (this.audioSourceNode) {
        try {
          this.audioSourceNode.disconnect();
        } catch (e) {
        }
      }
      if (this.silentGainNode) {
        try {
          this.silentGainNode.disconnect();
        } catch (e) {
        }
      }
      if (this.audioPassthroughNode) {
        try {
          this.audioPassthroughNode.disconnect();
        } catch (e) {
        }
      }
      if (this.audioContext) {
        try {
          this.audioContext.close();
        } catch (e) {
        }
      }
      if (this.video && this._bindedOnPlayForAudio) {
        this.video.removeEventListener("play", this._bindedOnPlayForAudio);
      }
      if (this.video && this._bindedOnSeeking) {
        this.video.removeEventListener("seeking", this._bindedOnSeeking);
      }
      this.video = null;
      this.audioContext = null;
      this.audioSourceNode = null;
      this.audioProcessorNode = null;
      this.audioPassthroughNode = null;
      this.silentGainNode = null;
      this.audioAnalysisState = null;
      this._bindedOnPlayForAudio = null;
      this._bindedOnSeeking = null;
      this._lastRanges = null;
    }
    resetAudioWindowAccumulator() {
      if (!this.audioAnalysisState)
        return;
      this.audioAnalysisState.currentSamples = 0;
      this.audioAnalysisState.currentSumSq = 0;
    }
    handleAudioProcess(event) {
      if (!this.audioAnalysisState || !this.video)
        return;
      const inputBuffer = event.inputBuffer;
      if (!inputBuffer)
        return;
      const channelCount = inputBuffer.numberOfChannels;
      if (!channelCount)
        return;
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
          const startTime = Math.max(0, endTime - this.config.windowSec);
          state.windows.push({ start: startTime, end: endTime, rms });
          this.trimAudioWindows();
          this.updateSegmentsFromAudio();
          state.currentSumSq = 0;
          state.currentSamples = 0;
        }
      }
    }
    trimAudioWindows() {
      if (!this.audioAnalysisState)
        return;
      const maxWindows = 3600;
      if (this.audioAnalysisState.windows.length > maxWindows) {
        const excess = this.audioAnalysisState.windows.length - maxWindows;
        this.audioAnalysisState.windows.splice(0, excess);
      }
    }
    updateSegmentsFromAudio() {
      if (!this.audioAnalysisState || !this.video)
        return;
      const duration = this.video.duration;
      if (!Number.isFinite(duration) || duration <= 0)
        return;
      const windows = this.audioAnalysisState.windows;
      if (!windows.length)
        return;
      const baselineSize = Math.min(this.config.baselineWindows, windows.length);
      const baselineSlice = windows.slice(-baselineSize);
      const values = baselineSlice.map((w) => w.rms);
      const median = computeMedian(values);
      let mad = computeMedian(values.map((v) => Math.abs(v - median)));
      if (!Number.isFinite(mad) || mad < 1e-7) {
        const variance = values.reduce((s, v) => s + (v - median) * (v - median), 0) / Math.max(values.length, 1);
        mad = Math.sqrt(Math.max(variance, 0)) / 1.4826 || 1e-6;
      }
      const thresh = this.config.zThreshold * mad * 1.4826;
      const flagged = [];
      for (let i = 0; i < windows.length; i += 1) {
        const w = windows[i];
        const outlier = Math.abs(w.rms - median) > thresh;
        if (outlier)
          flagged.push({ start: w.start, end: w.end });
      }
      const merged = mergeSegments(flagged, this.config.mergeGapSec);
      const filtered = merged.filter((seg) => seg.end - seg.start >= this.config.minSegmentSec);
      if (!filtered.length)
        return;
      const introCandidates = filtered.filter((seg) => seg.start <= duration * 0.35).sort((a, b) => a.start - b.start);
      const creditsCandidates = filtered.filter((seg) => seg.end >= duration * 0.65).sort((a, b) => a.start - b.start);
      const newRanges = { intro: [], credits: [] };
      if (introCandidates.length)
        newRanges.intro.push(introCandidates[0]);
      if (creditsCandidates.length)
        newRanges.credits.push(creditsCandidates[creditsCandidates.length - 1]);
      if (!newRanges.intro.length && !newRanges.credits.length)
        return;
      if (this._lastRanges) {
        const sameIntro = rangesEqual(this._lastRanges.intro, newRanges.intro);
        const sameCredits = rangesEqual(this._lastRanges.credits, newRanges.credits);
        if (sameIntro && sameCredits)
          return;
      }
      this._lastRanges = newRanges;
      this.onUpdate(newRanges, {
        windows: windows.length,
        baseline: {
          size: baselineSize,
          median,
          mad,
          threshold: thresh,
          windowSec: this.config.windowSec,
          minSegmentSec: this.config.minSegmentSec,
          mergeGapSec: this.config.mergeGapSec
        },
        candidates: filtered.length
      });
    }
  };

  // src/segments/providers/playerData.js
  function getPlayerData(lampa = null) {
    const resolved = lampa || (typeof Lampa !== "undefined" ? Lampa : null);
    const player = resolved && resolved.Player ? resolved.Player : null;
    if (!player)
      return null;
    if (typeof player.get === "function")
      return player.get();
    if (typeof player.data === "function")
      return player.data();
    if (player.current)
      return player.current;
    if (player.item)
      return player.item;
    return null;
  }
  function getRangesFromPlayerData(lampa = null) {
    const ranges = { intro: [], credits: [] };
    const data = getPlayerData(lampa);
    if (!data)
      return ranges;
    extractRangesFromObject(data, ranges, 0);
    return ranges;
  }
  function extractRangesFromObject(data, ranges, depth) {
    if (!data || depth > 3)
      return;
    if (Array.isArray(data)) {
      data.forEach((item) => extractRangesFromObject(item, ranges, depth + 1));
      return;
    }
    if (typeof data !== "object")
      return;
    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (!value || typeof value !== "object")
        return;
      const kind = getSegmentKindFromKey(String(key).toLowerCase());
      const range = normalizeRangeValue(value);
      if (kind && range) {
        ranges[kind].push(range);
      } else {
        extractRangesFromObject(value, ranges, depth + 1);
      }
    });
  }
  function normalizeRangeValue(value) {
    var _a, _b, _c, _d;
    if (Array.isArray(value) && value.length >= 2) {
      const start = Number(value[0]);
      const end = Number(value[1]);
      if (Number.isFinite(start) && Number.isFinite(end))
        return { start, end };
    }
    if (typeof value === "object") {
      const start = Number((_b = (_a = value.start) != null ? _a : value.begin) != null ? _b : value.from);
      const end = Number((_d = (_c = value.end) != null ? _c : value.finish) != null ? _d : value.to);
      if (Number.isFinite(start) && Number.isFinite(end))
        return { start, end };
    }
    return null;
  }

  // src/segments/providers/textTracks.js
  function getRangesFromTextTracks(video) {
    const ranges = { intro: [], credits: [] };
    if (!video || !video.textTracks)
      return ranges;
    for (let i = 0; i < video.textTracks.length; i += 1) {
      const track = video.textTracks[i];
      const kind = track.kind || "";
      if (!["chapters", "metadata", "subtitles"].includes(kind))
        continue;
      const cues = track.cues || [];
      for (let j = 0; j < cues.length; j += 1) {
        const cue = cues[j];
        const text = `${cue.id || ""} ${cue.text || ""}`.trim();
        if (INTRO_REGEX.test(text)) {
          ranges.intro.push({ start: cue.startTime, end: cue.endTime });
        } else if (CREDITS_REGEX.test(text)) {
          ranges.credits.push({ start: cue.startTime, end: cue.endTime });
        }
      }
    }
    return ranges;
  }

  // src/ui/skipButton/styles.js
  var SKIP_BUTTON_STYLE_ID = "al-autoskip-style";
  function ensureSkipButtonStyles() {
    if (document.getElementById(SKIP_BUTTON_STYLE_ID))
      return;
    const style = document.createElement("style");
    style.id = SKIP_BUTTON_STYLE_ID;
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

  // src/ui/skipButton/SkipButton.js
  var SkipButton = class {
    constructor({ text = "Пропустить", onClick }) {
      this.text = text;
      this.onClick = onClick;
      this.el = null;
      this._handleClick = () => {
        if (this.onClick)
          this.onClick();
      };
    }
    ensure() {
      if (this.el)
        return this.el;
      ensureSkipButtonStyles();
      const button = document.createElement("div");
      button.className = "al-autoskip-btn";
      button.textContent = this.text;
      button.addEventListener("click", this._handleClick);
      document.body.appendChild(button);
      this.el = button;
      return button;
    }
    isVisible() {
      return !!this.el && this.el.classList.contains("is-visible");
    }
    show() {
      const el = this.ensure();
      el.style.display = "";
      el.classList.add("is-visible");
    }
    hide() {
      if (!this.el)
        return;
      this.el.classList.remove("is-visible", "is-animating");
    }
    restartAnimation() {
      if (!this.el)
        return;
      this.el.classList.remove("is-animating");
      void this.el.offsetWidth;
      this.el.classList.add("is-animating");
    }
    destroy() {
      if (!this.el)
        return;
      this.el.removeEventListener("click", this._handleClick);
      this.el.remove();
      this.el = null;
    }
  };

  // src/core/AutoSkipPlugin.js
  var SOURCE_PRIORITY = {
    cache: 0,
    audio: 1,
    textTracks: 2,
    playerData: 3
  };
  var AutoSkipPlugin = class {
    constructor() {
      this.version = "1.0.6";
      this.component = "autoskip";
      this.name = "AutoSkip";
      this.logTag = "[AutoSkip]";
      this.log = createLogger({ tag: this.logTag });
      this.settings = Object.assign({
        enabled: true,
        autoStart: true,
        skipIntro: true,
        skipCredits: true,
        showNotifications: true,
        debug: false
      }, loadSettings());
      this.segmentCache = loadSegmentCache();
      this.isRunning = false;
      this.video = null;
      this.timeHandler = null;
      this.introSkipped = false;
      this.creditsSkipped = false;
      this.activeSegment = null;
      this.activeSegmentRange = null;
      this.segmentRanges = { intro: [], credits: [] };
      this.segmentSources = { intro: null, credits: null };
      this._bindedOnLoadedMeta = null;
      this._bindedOnPlaying = null;
      this._settingsRegistered = false;
      this._cacheSaveTimer = null;
      this._cachePendingKey = null;
      this._cachePendingRanges = null;
      this.rmsConfig = {
        windowSec: 0.5,
        baselineWindows: 120,
        zThreshold: 1.4,
        minSegmentSec: 8,
        mergeGapSec: 1
      };
      this.audioDetector = new AudioSegmentDetector({
        config: this.rmsConfig,
        log: this.log,
        onUpdate: (ranges, meta) => this.onRangesDetected("audio", ranges, meta)
      });
      this.skipButton = new SkipButton({
        onClick: () => {
          if (!this.activeSegment)
            return;
          this.performSkip(this.activeSegment);
        }
      });
      this.init();
    }
    init() {
      waitForLampa({
        predicate: () => typeof Lampa !== "undefined" && Lampa.Player && Lampa.Player.listener,
        onReady: () => {
          this.addSettingsToLampa();
          this.listenPlayer();
          if (this.settings.autoStart && this.settings.enabled)
            this.start();
          this.log("log", `initialized (${this.version}).`);
        },
        onTimeout: () => {
          this.log("error", "Lampa not found (incompatible environment?).");
        },
        log: this.log
      });
    }
    addSettingsToLampa() {
      const icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      const maxAttempts = 30;
      const retryDelayMs = 500;
      const tryRegister = (attempt) => {
        if (this._settingsRegistered)
          return;
        const isLastAttempt = attempt >= maxAttempts - 1;
        if (typeof Lampa === "undefined" || !Lampa.Settings || !isSettingsApiReady(Lampa.Settings)) {
          if (isLastAttempt) {
            this.log("warn", "Settings API not ready, skipping settings registration.");
            return;
          }
          setTimeout(() => tryRegister(attempt + 1), retryDelayMs);
          return;
        }
        const ok = registerSettingsComponent({
          component: this.component,
          name: this.name,
          icon,
          onSelect: () => this.openSettingsModal(),
          log: this.log,
          quiet: !isLastAttempt
        });
        if (ok) {
          this._settingsRegistered = true;
          return;
        }
        if (isLastAttempt)
          return;
        setTimeout(() => tryRegister(attempt + 1), retryDelayMs);
      };
      tryRegister(0);
    }
    openSettingsModal() {
      showSettingsModal({
        name: this.name,
        version: this.version,
        settings: this.settings,
        onChange: (key, value) => {
          this.settings[key] = value;
          saveSettings(this.settings);
        },
        log: this.log
      });
    }
    listenPlayer() {
      if (typeof Lampa !== "undefined" && Lampa.Player && Lampa.Player.listener) {
        Lampa.Player.listener.follow("start", () => this.onPlayerStart());
        Lampa.Player.listener.follow("stop", () => this.onPlayerStop());
      }
    }
    onPlayerStart() {
      if (!this.settings.enabled)
        return;
      this.resetSession();
      this.hideSkipButton();
      const attach = () => {
        const video = this.getVideo();
        if (!video)
          return false;
        this.video = video;
        const onReady = () => this.onVideoReady();
        if (!Number.isFinite(video.duration)) {
          this._bindedOnLoadedMeta = onReady;
          video.addEventListener("loadedmetadata", this._bindedOnLoadedMeta, { once: true });
        } else {
          onReady();
        }
        this._bindedOnPlaying = () => {
          if (!this.timeHandler)
            this.attachTimeHandler();
        };
        video.addEventListener("playing", this._bindedOnPlaying);
        return true;
      };
      if (attach())
        return;
      const startedAt = Date.now();
      const poll = () => {
        if (attach())
          return;
        if (Date.now() - startedAt < 2e3)
          requestAnimationFrame(poll);
      };
      poll();
    }
    onVideoReady() {
      this.applyCachedSegments();
      this.onRangesDetected("playerData", getRangesFromPlayerData(), { passive: true });
      this.onRangesDetected("textTracks", getRangesFromTextTracks(this.video), { passive: true });
      this.attachTimeHandler();
      this.audioDetector.start(this.video);
    }
    attachTimeHandler() {
      if (!this.video)
        return;
      if (this.timeHandler)
        return;
      this.timeHandler = () => this.checkSkip();
      this.video.addEventListener("timeupdate", this.timeHandler);
    }
    onPlayerStop() {
      if (this.video && this.timeHandler) {
        this.video.removeEventListener("timeupdate", this.timeHandler);
      }
      if (this.video && this._bindedOnLoadedMeta) {
        this.video.removeEventListener("loadedmetadata", this._bindedOnLoadedMeta);
      }
      if (this.video && this._bindedOnPlaying) {
        this.video.removeEventListener("playing", this._bindedOnPlaying);
      }
      this.audioDetector.stop();
      this.flushPendingCacheSave();
      this.video = null;
      this.timeHandler = null;
      this._bindedOnLoadedMeta = null;
      this._bindedOnPlaying = null;
      this.activeSegment = null;
      this.activeSegmentRange = null;
      this.segmentRanges = { intro: [], credits: [] };
      this.segmentSources = { intro: null, credits: null };
      this.hideSkipButton(true);
    }
    resetSession() {
      this.introSkipped = false;
      this.creditsSkipped = false;
      this.activeSegment = null;
      this.activeSegmentRange = null;
      this.segmentRanges = { intro: [], credits: [] };
      this.segmentSources = { intro: null, credits: null };
    }
    start() {
      this.isRunning = true;
      this.log("log", "auto-skip started.");
    }
    stop() {
      this.isRunning = false;
      this.log("log", "auto-skip stopped.");
    }
    checkSkip() {
      if (!this.video)
        return;
      const t = this.video.currentTime;
      const d = this.video.duration;
      if (!Number.isFinite(d) || d <= 0)
        return;
      const segment = this.detectSegment(t);
      if (segment) {
        this.showSkipButton(segment);
      } else if (this.activeSegment) {
        this.hideSkipButton();
      }
    }
    detectSegment(time) {
      return this.detectSegmentFromRanges(time);
    }
    detectSegmentFromRanges(time) {
      if (this.settings.skipIntro && !this.introSkipped) {
        if (isTimeInRanges(time, this.segmentRanges.intro))
          return "intro";
      }
      if (this.settings.skipCredits && !this.creditsSkipped) {
        if (isTimeInRanges(time, this.segmentRanges.credits))
          return "credits";
      }
      return null;
    }
    showSkipButton(segment) {
      var _a;
      const isSame = this.activeSegment === segment;
      const wasVisible = this.skipButton.isVisible();
      this.activeSegment = segment;
      this.skipButton.show();
      if (!isSame || !wasVisible) {
        this.activeSegmentRange = ((_a = this.segmentRanges[segment]) == null ? void 0 : _a.length) ? Object.assign({}, this.segmentRanges[segment][0]) : null;
        const t = this.video && Number.isFinite(this.video.currentTime) ? this.video.currentTime.toFixed(2) : "n/a";
        this.log("log", `segment detected -> ${segment} at ${t}s`, {
          ranges: this.segmentRanges[segment] || [],
          duration: this.video ? this.video.duration : void 0,
          sources: this.segmentSources
        });
        this.skipButton.restartAnimation();
      }
    }
    hideSkipButton(destroy = false) {
      this.skipButton.hide();
      if (destroy)
        this.skipButton.destroy();
      this.activeSegment = null;
      this.activeSegmentRange = null;
    }
    performSkip(segment) {
      if (!this.video)
        return;
      const duration = this.video.duration;
      if (!Number.isFinite(duration) || duration <= 0)
        return;
      if (segment === "intro") {
        const intro = this.activeSegmentRange && this.activeSegment === "intro" ? this.activeSegmentRange : this.segmentRanges.intro.length ? this.segmentRanges.intro[0] : null;
        if (!intro)
          return;
        this.introSkipped = true;
        this.safeSeek(intro.end);
        this.notify("Пропущено вступление");
      }
      if (segment === "credits") {
        const credits = this.activeSegmentRange && this.activeSegment === "credits" ? this.activeSegmentRange : this.segmentRanges.credits.length ? this.segmentRanges.credits[0] : null;
        if (!credits)
          return;
        this.creditsSkipped = true;
        this.safeSeek(Math.min(duration - 1, Math.max(0, credits.end)));
        this.notify("Пропущены титры");
      }
      this.hideSkipButton();
    }
    safeSeek(target) {
      try {
        if (Number.isFinite(target))
          this.video.currentTime = target;
      } catch (e) {
        this.log("warn", "Failed to seek:", e);
      }
    }
    notify(msg) {
      if (!this.settings.showNotifications)
        return;
      if (typeof Lampa !== "undefined" && Lampa.Noty)
        Lampa.Noty.show(msg);
      else
        this.log("log", msg);
    }
    applyCachedSegments() {
      const key = getCacheKey(this.video);
      if (!key)
        return;
      const cached = readCachedRanges(this.segmentCache, key);
      if (!cached)
        return;
      const normalized = normalizeRanges(cached, this.video.duration);
      if (!normalized.intro.length && !normalized.credits.length)
        return;
      const updated = this.applyRangesWithPriority("cache", normalized);
      if (updated) {
        this.logSegmentRanges("cache", this.segmentRanges, { key });
      }
    }
    onRangesDetected(source, ranges, meta = null) {
      if (!this.video)
        return;
      const normalized = normalizeRanges(ranges, this.video.duration);
      const updated = this.applyRangesWithPriority(source, normalized);
      if (!updated)
        return;
      this.logSegmentRanges(source, this.segmentRanges, meta);
      if (source !== "cache") {
        this.saveSegmentsToCache(this.segmentRanges);
      }
    }
    applyRangesWithPriority(source, normalizedRanges) {
      const introUpdated = this.applyKindWithPriority(source, "intro", normalizedRanges.intro);
      const creditsUpdated = this.applyKindWithPriority(source, "credits", normalizedRanges.credits);
      return introUpdated || creditsUpdated;
    }
    applyKindWithPriority(source, kind, incomingRanges) {
      var _a, _b;
      if (!incomingRanges.length)
        return false;
      const incomingPriority = (_a = SOURCE_PRIORITY[source]) != null ? _a : 0;
      const currentSource = this.segmentSources[kind];
      const currentPriority = currentSource ? (_b = SOURCE_PRIORITY[currentSource]) != null ? _b : 0 : -1;
      const shouldReplace = !this.segmentRanges[kind].length || incomingPriority >= currentPriority;
      if (!shouldReplace)
        return false;
      if (rangesEqual(this.segmentRanges[kind], incomingRanges))
        return false;
      this.segmentRanges[kind] = incomingRanges;
      this.segmentSources[kind] = source;
      return true;
    }
    saveSegmentsToCache(ranges) {
      const key = getCacheKey(this.video);
      if (!key)
        return;
      if (!ranges || (!ranges.intro || !ranges.intro.length) && (!ranges.credits || !ranges.credits.length))
        return;
      this._cachePendingKey = key;
      this._cachePendingRanges = {
        intro: (ranges.intro || []).slice(),
        credits: (ranges.credits || []).slice()
      };
      if (this._cacheSaveTimer)
        return;
      this._cacheSaveTimer = setTimeout(() => this.flushPendingCacheSave(), 1500);
    }
    flushPendingCacheSave() {
      if (!this._cacheSaveTimer && !this._cachePendingKey)
        return;
      if (this._cacheSaveTimer) {
        clearTimeout(this._cacheSaveTimer);
        this._cacheSaveTimer = null;
      }
      const key = this._cachePendingKey;
      const ranges = this._cachePendingRanges;
      this._cachePendingKey = null;
      this._cachePendingRanges = null;
      if (!key || !ranges)
        return;
      writeCachedRanges(this.segmentCache, key, ranges);
      try {
        saveSegmentCache(this.segmentCache);
        if (this.settings.debug) {
          this.log("log", "segments cached", { key, intro: ranges.intro, credits: ranges.credits });
        }
      } catch (e) {
        this.log("warn", "Failed to save cache:", e);
      }
    }
    logSegmentRanges(source, ranges, meta = null) {
      if (!this.settings.debug)
        return;
      const format = (seg) => seg.map((r) => `${r.start.toFixed(1)}-${r.end.toFixed(1)}s`).join(", ") || "none";
      const intro = ranges.intro || [];
      const credits = ranges.credits || [];
      this.log("log", `segments from ${source}: intro=${format(intro)}; credits=${format(credits)}`, meta);
    }
    getVideo() {
      return document.querySelector("video");
    }
  };

  // src/entry.js
  var PLUGIN_ID = "autoskip";
  if (!window[PLUGIN_ID]) {
    window[PLUGIN_ID] = true;
    new AutoSkipPlugin();
  }
})();
