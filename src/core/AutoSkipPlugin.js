import { createLogger } from './logger.js';
import { loadSegmentCache, loadSettings, saveSegmentCache, saveSettings } from './storage.js';
import { waitForLampa } from '../lampa/waitForLampa.js';
import { registerSettingsComponent, showSettingsModal } from '../lampa/settingsUi.js';
import { getCacheKey, readCachedRanges, writeCachedRanges } from '../segments/cache.js';
import { isTimeInRanges, normalizeRanges, rangesEqual } from '../segments/ranges.js';
import { AudioSegmentDetector } from '../segments/providers/audioDetector.js';
import { getRangesFromPlayerData } from '../segments/providers/playerData.js';
import { getRangesFromTextTracks } from '../segments/providers/textTracks.js';
import { SkipButton } from '../ui/skipButton/SkipButton.js';

const SOURCE_PRIORITY = {
  cache: 0,
  audio: 1,
  textTracks: 2,
  playerData: 3
};

export class AutoSkipPlugin {
  constructor() {
    this.version = '1.0.6';
    this.component = 'autoskip';
    this.name = 'AutoSkip';
    this.logTag = '[AutoSkip]';
    this.log = createLogger({ tag: this.logTag });

    this.settings = Object.assign({
      enabled: true,
      autoStart: true,
      skipIntro: true,
      skipCredits: true,
      showNotifications: true
    }, loadSettings());

    this.segmentCache = loadSegmentCache();

    this.isRunning = false;
    this.video = null;
    this.timeHandler = null;

    this.introSkipped = false;
    this.creditsSkipped = false;
    this.activeSegment = null;
    this.segmentRanges = { intro: [], credits: [] };
    this.segmentSources = { intro: null, credits: null };

    this._bindedOnLoadedMeta = null;
    this._bindedOnPlaying = null;

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
      onUpdate: (ranges, meta) => this.onRangesDetected('audio', ranges, meta)
    });

    this.skipButton = new SkipButton({
      onClick: () => {
        if (!this.activeSegment) return;
        this.performSkip(this.activeSegment);
      }
    });

    this.init();
  }

  init() {
    waitForLampa({
      predicate: () => typeof Lampa !== 'undefined' && Lampa.Settings && Lampa.Player,
      onReady: () => {
        this.addSettingsToLampa();
        this.listenPlayer();
        if (this.settings.autoStart && this.settings.enabled) this.start();
        this.log('log', `initialized (${this.version}).`);
      },
      onTimeout: () => {
        this.log('error', 'Lampa not found (incompatible environment?).');
      },
      log: this.log
    });
  }

  addSettingsToLampa() {
    const icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    registerSettingsComponent({
      component: this.component,
      name: this.name,
      icon,
      onSelect: () => this.openSettingsModal(),
      log: this.log
    });
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
    if (typeof Lampa !== 'undefined' && Lampa.Player && Lampa.Player.listener) {
      Lampa.Player.listener.follow('start', () => this.onPlayerStart());
      Lampa.Player.listener.follow('stop', () => this.onPlayerStop());
    }
  }

  onPlayerStart() {
    if (!this.settings.enabled) return;

    this.resetSession();
    this.hideSkipButton();

    const attach = () => {
      const video = this.getVideo();
      if (!video) return false;

      this.video = video;
      const onReady = () => this.onVideoReady();

      if (!Number.isFinite(video.duration)) {
        this._bindedOnLoadedMeta = onReady;
        video.addEventListener('loadedmetadata', this._bindedOnLoadedMeta, { once: true });
      } else {
        onReady();
      }

      this._bindedOnPlaying = () => {
        if (!this.timeHandler) this.attachTimeHandler();
      };
      video.addEventListener('playing', this._bindedOnPlaying);

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

  onVideoReady() {
    this.applyCachedSegments();
    this.onRangesDetected('playerData', getRangesFromPlayerData(), { passive: true });
    this.onRangesDetected('textTracks', getRangesFromTextTracks(this.video), { passive: true });

    this.attachTimeHandler();
    this.audioDetector.start(this.video);
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

    this.audioDetector.stop();

    this.video = null;
    this.timeHandler = null;
    this._bindedOnLoadedMeta = null;
    this._bindedOnPlaying = null;
    this.activeSegment = null;
    this.segmentRanges = { intro: [], credits: [] };
    this.segmentSources = { intro: null, credits: null };

    this.hideSkipButton(true);
  }

  resetSession() {
    this.introSkipped = false;
    this.creditsSkipped = false;
    this.activeSegment = null;
    this.segmentRanges = { intro: [], credits: [] };
    this.segmentSources = { intro: null, credits: null };
  }

  start() {
    this.isRunning = true;
    this.log('log', 'auto-skip started.');
  }

  stop() {
    this.isRunning = false;
    this.log('log', 'auto-skip stopped.');
  }

  checkSkip() {
    if (!this.video) return;
    const t = this.video.currentTime;
    const d = this.video.duration;
    if (!Number.isFinite(d) || d <= 0) return;

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
      if (isTimeInRanges(time, this.segmentRanges.intro)) return 'intro';
    }
    if (this.settings.skipCredits && !this.creditsSkipped) {
      if (isTimeInRanges(time, this.segmentRanges.credits)) return 'credits';
    }
    return null;
  }

  showSkipButton(segment) {
    const isSame = this.activeSegment === segment;
    const wasVisible = this.skipButton.isVisible();
    this.activeSegment = segment;
    this.skipButton.show();

    if (!isSame || !wasVisible) {
      const t = this.video && Number.isFinite(this.video.currentTime) ? this.video.currentTime.toFixed(2) : 'n/a';
      this.log('log', `segment detected -> ${segment} at ${t}s`, {
        ranges: this.segmentRanges[segment] || [],
        duration: this.video ? this.video.duration : undefined,
        sources: this.segmentSources
      });
      this.skipButton.restartAnimation();
    }
  }

  hideSkipButton(destroy = false) {
    this.skipButton.hide();
    if (destroy) this.skipButton.destroy();
    this.activeSegment = null;
  }

  performSkip(segment) {
    if (!this.video) return;
    const duration = this.video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    if (segment === 'intro') {
      const intro = this.segmentRanges.intro.length ? this.segmentRanges.intro[0] : null;
      if (!intro) return;
      this.introSkipped = true;
      this.safeSeek(intro.end);
      this.notify('Пропущено вступление');
    }

    if (segment === 'credits') {
      const credits = this.segmentRanges.credits.length ? this.segmentRanges.credits[0] : null;
      if (!credits) return;
      this.creditsSkipped = true;
      this.safeSeek(Math.min(duration - 1, Math.max(0, credits.end)));
      this.notify('Пропущены титры');
    }

    this.hideSkipButton();
  }

  safeSeek(target) {
    try {
      if (Number.isFinite(target)) this.video.currentTime = target;
    } catch (e) {
      this.log('warn', 'Failed to seek:', e);
    }
  }

  notify(msg) {
    if (!this.settings.showNotifications) return;
    if (typeof Lampa !== 'undefined' && Lampa.Noty) Lampa.Noty.show(msg);
    else this.log('log', msg);
  }

  applyCachedSegments() {
    const key = getCacheKey(this.video);
    if (!key) return;
    const cached = readCachedRanges(this.segmentCache, key);
    if (!cached) return;

    const normalized = normalizeRanges(cached, this.video.duration);
    if (!normalized.intro.length && !normalized.credits.length) return;

    const updated = this.applyRangesWithPriority('cache', normalized);
    if (updated) {
      this.logSegmentRanges('cache', this.segmentRanges, { key });
    }
  }

  onRangesDetected(source, ranges, meta = null) {
    if (!this.video) return;
    const normalized = normalizeRanges(ranges, this.video.duration);
    const updated = this.applyRangesWithPriority(source, normalized);
    if (!updated) return;

    this.logSegmentRanges(source, this.segmentRanges, meta);

    if (source !== 'cache') {
      this.saveSegmentsToCache(this.segmentRanges);
    }
  }

  applyRangesWithPriority(source, normalizedRanges) {
    const introUpdated = this.applyKindWithPriority(source, 'intro', normalizedRanges.intro);
    const creditsUpdated = this.applyKindWithPriority(source, 'credits', normalizedRanges.credits);
    return introUpdated || creditsUpdated;
  }

  applyKindWithPriority(source, kind, incomingRanges) {
    if (!incomingRanges.length) return false;

    const incomingPriority = SOURCE_PRIORITY[source] ?? 0;
    const currentSource = this.segmentSources[kind];
    const currentPriority = currentSource ? (SOURCE_PRIORITY[currentSource] ?? 0) : -1;

    const shouldReplace = !this.segmentRanges[kind].length || incomingPriority >= currentPriority;
    if (!shouldReplace) return false;
    if (rangesEqual(this.segmentRanges[kind], incomingRanges)) return false;

    this.segmentRanges[kind] = incomingRanges;
    this.segmentSources[kind] = source;
    return true;
  }

  saveSegmentsToCache(ranges) {
    const key = getCacheKey(this.video);
    if (!key) return;
    writeCachedRanges(this.segmentCache, key, ranges);
    try {
      saveSegmentCache(this.segmentCache);
      this.log('log', 'segments cached', { key, intro: ranges.intro, credits: ranges.credits });
    } catch (e) {
      this.log('warn', 'Failed to save cache:', e);
    }
  }

  logSegmentRanges(source, ranges, meta = null) {
    const format = (seg) => seg.map((r) => `${r.start.toFixed(1)}-${r.end.toFixed(1)}s`).join(', ') || 'none';
    const intro = ranges.intro || [];
    const credits = ranges.credits || [];
    this.log('log', `segments from ${source}: intro=${format(intro)}; credits=${format(credits)}`, meta);
  }

  getVideo() {
    return document.querySelector('video');
  }
}

