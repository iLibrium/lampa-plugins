import { createLogger } from './logger.js';
import { probe as probeCapabilities } from './capabilities.js';
import { SettingsStore, SETTINGS_DEFAULTS } from '../storage/SettingsStore.js';
import { SegmentCache } from '../storage/SegmentCache.js';
import { getContentId, getContentIds } from '../segments/contentId.js';
import { followPlayer } from '../lampa/playerEvents.js';
import { waitForLampa } from '../lampa/waitForLampa.js';
import { isSettingsApiReady, registerSettingsComponent } from '../lampa/settingsUi.js';
import { normalizeRanges } from '../segments/ranges.js';
import { SegmentResolver } from '../segments/SegmentResolver.js';
import { MetadataProvider } from '../segments/providers/MetadataProvider.js';
import { ChaptersProvider } from '../segments/providers/ChaptersProvider.js';
import { AudioProvider } from '../segments/providers/AudioProvider.js';
import { AniSkipProvider } from '../segments/providers/AniSkipProvider.js';
import { TheIntroDBProvider } from '../segments/providers/TheIntroDBProvider.js';
import { SubtitleProvider } from '../segments/providers/SubtitleProvider.js';
import { VisualProvider } from '../segments/providers/VisualProvider.js';
import { PrefetchAudioProvider } from '../segments/providers/PrefetchAudioProvider.js';
import { PlaybackController } from '../playback/PlaybackController.js';
import { VisibilityGuard } from '../playback/visibilityGuard.js';
import { hasNativeSkip } from '../playback/nativeSkipDetect.js';
import { SkipPrompt } from '../ui/SkipPrompt/SkipPrompt.js';
import { TimelineMarkers } from '../ui/TimelineMarkers/TimelineMarkers.js';
import { t as translate, registerTranslations } from '../util/i18n.js';

export class AutoSkipPlugin {
  constructor() {
    this.version = '3.1.2';
    this.component = 'autoskip';
    this.name = 'AutoSkip';
    this.logTag = '[AutoSkip]';
    this.log = createLogger({ tag: this.logTag });

    this.capabilities = probeCapabilities();

    this.settingsStore = new SettingsStore({ log: this.log });
    this.settings = Object.assign({}, SETTINGS_DEFAULTS, this.settingsStore.load());
    this.settingsStore.update(this.settings);

    this.segmentCache = new SegmentCache({ log: this.log });
    this.segmentCache.load();

    this.resolver = new SegmentResolver();
    this.playback = new PlaybackController({
      resolver: this.resolver,
      getSettings: () => this.settings,
      onSegmentEnter: (segment, range, isSame) => this._handleSegmentEnter(segment, range, isSame),
      onSegmentLeave: () => this._handleSegmentLeave(),
      log: this.log
    });

    this.metadataProvider = new MetadataProvider({ log: this.log });
    this.chaptersProvider = new ChaptersProvider({ log: this.log });
    this.audioProvider = new AudioProvider({
      log: this.log,
      onUpdate: (ranges, meta) => this._onProviderUpdate('audio', ranges, meta),
      onTainted: () => {
        if (this.settings.debug) this._notify(translate('autoskip_audio_cors'));
      }
    });
    this.aniSkipProvider = new AniSkipProvider({
      log: this.log,
      getSettings: () => this.settings
    });
    this.theIntroDbProvider = new TheIntroDBProvider({
      log: this.log,
      getSettings: () => this.settings,
      getContentIds: () => getContentIds()
    });
    this.subtitleProvider = new SubtitleProvider({
      log: this.log,
      getSettings: () => this.settings
    });
    this.visualProvider = new VisualProvider({
      log: this.log,
      getSettings: () => this.settings
    });
    this.prefetchAudioProvider = new PrefetchAudioProvider({
      log: this.log,
      getSettings: () => this.settings
    });

    this.visibilityGuard = new VisibilityGuard({
      log: this.log,
      onResume: () => {
        if (this.audioProvider) this.audioProvider.resetSession();
        if (this.settings.debug) this.log('log', 'audio buffer reset on visibility resume');
      }
    });

    this.skipPrompt = new SkipPrompt({
      log: this.log,
      durationMs: 5000,
      onSkip: (segment) => {
        const target = segment || this.playback.getActiveSegment();
        if (!target) return;
        this.performSkip(target);
      },
      onCancel: (segment) => {
        const target = segment || this.playback.getActiveSegment();
        if (target) this.playback.markDismissed(target);
      }
    });

    this.timelineMarkers = new TimelineMarkers({ log: this.log });

    this.isRunning = false;
    this.video = null;
    this._bindedOnLoadedMeta = null;
    this._bindedOnPlaying = null;
    this._settingsRegistered = false;
    this._cacheSaveTimer = null;
    this._cachePendingKey = null;
    this._cachePendingRanges = null;

    this.init();
  }

  init() {
    waitForLampa({
      predicate: () => typeof Lampa !== 'undefined' && Lampa.Player && Lampa.Player.listener,
      onReady: () => {
        registerTranslations();
        this.addSettingsToLampa();
        this.listenPlayer();
        if (this.settings.autoStart && this.settings.enabled) this.start();
        if (this.settings.debug) this.log('log', 'capabilities', this.capabilities);
        this.log('log', `initialized (${this.version}).`);
      },
      onTimeout: () => {
        this.log('error', 'Lampa not found (incompatible environment?).');
      },
      log: this.log
    });
  }

  addSettingsToLampa() {
    const icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
    const maxAttempts = 30;
    const retryDelayMs = 500;

    const tryRegister = (attempt) => {
      if (this._settingsRegistered) return;
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (!isSettingsApiReady()) {
        if (isLastAttempt) {
          this.log('warn', 'Lampa.SettingsApi not ready, skipping settings registration.');
          return;
        }
        setTimeout(() => tryRegister(attempt + 1), retryDelayMs);
        return;
      }

      const ok = registerSettingsComponent({
        component: this.component,
        name: this.name,
        icon,
        defaults: SETTINGS_DEFAULTS,
        onChange: (key, value) => {
          this.settings[key] = value;
          this.settingsStore.set(key, value);
        },
        log: this.log,
        quiet: !isLastAttempt
      });

      if (ok) {
        this._settingsRegistered = true;
        this.settingsStore.ensureDefaultsPersisted();
        return;
      }

      if (isLastAttempt) return;
      setTimeout(() => tryRegister(attempt + 1), retryDelayMs);
    };

    tryRegister(0);
  }

  listenPlayer() {
    followPlayer({
      start: () => this.onPlayerStart(),
      stop: () => this.onPlayerStop()
    });
  }

  start() {
    this.isRunning = true;
    this.log('log', 'auto-skip started.');
  }

  stop() {
    this.isRunning = false;
    this.log('log', 'auto-skip stopped.');
  }

  onPlayerStart() {
    if (!this.settings.enabled) return;
    if (hasNativeSkip()) {
      if (this.settings.debug) this.log('log', 'native skip metadata detected; plugin yields.');
      return;
    }

    this.resolver.reset();
    this.playback.resetSession();
    this.visibilityGuard.attach();
    this._hideSkipButton();

    const attach = () => {
      const video = this._getVideo();
      if (!video) return false;

      this.video = video;
      const onReady = () => this._onVideoReady();

      if (!Number.isFinite(video.duration)) {
        this._bindedOnLoadedMeta = onReady;
        video.addEventListener('loadedmetadata', this._bindedOnLoadedMeta, { once: true });
      } else {
        onReady();
      }

      this._bindedOnPlaying = () => this.playback.attach(this.video);
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

  _onVideoReady() {
    this._applyCachedSegments();
    this._runProvider(this.metadataProvider);
    this._runProvider(this.chaptersProvider);
    this._runProvider(this.aniSkipProvider);
    this._runProvider(this.theIntroDbProvider);
    this._runProvider(this.subtitleProvider);

    this.playback.attach(this.video);
    this.skipPrompt.attachToVideo(this.video);
    this.timelineMarkers.attach(this.video);
    this._refreshTimelineMarkers();
    this._maybeRunFallbackProviders();
  }

  _maybeRunFallbackProviders() {
    setTimeout(() => {
      if (!this.video) return;
      const introHigh = this.resolver.hasHighConfidence('intro');
      const creditsHigh = this.resolver.hasHighConfidence('credits');

      if (introHigh && creditsHigh) {
        if (this.settings.debug) this.log('log', 'fallback providers skipped — both segments resolved by high-confidence sources.');
        return;
      }

      this._runProvider(this.prefetchAudioProvider);
      this._runProvider(this.visualProvider);

      setTimeout(() => {
        if (!this.video) return;
        if (this.resolver.hasHighConfidence('intro') && this.resolver.hasHighConfidence('credits')) return;
        this._runProvider(this.audioProvider);
      }, 4000);

      this._scheduleEmptyResultNotice();
    }, 1200);
  }

  _scheduleEmptyResultNotice() {
    if (this._emptyResultTimer) clearTimeout(this._emptyResultTimer);
    this._emptyResultTimer = setTimeout(() => {
      if (!this.video) return;
      const ranges = this.resolver.getRanges();
      const hasAny = (ranges.intro && ranges.intro.length) || (ranges.credits && ranges.credits.length);
      if (hasAny) return;
      if (!this.settings.debug) return;
      this.log('log', 'AutoSkip: no segments found by any provider — content not covered.');
    }, 90000);
  }

  onPlayerStop() {
    if (this.video && this._bindedOnLoadedMeta) {
      try { this.video.removeEventListener('loadedmetadata', this._bindedOnLoadedMeta); } catch (e) { /* noop */ }
    }
    if (this.video && this._bindedOnPlaying) {
      try { this.video.removeEventListener('playing', this._bindedOnPlaying); } catch (e) { /* noop */ }
    }

    this.playback.detach();
    this.audioProvider.cancel();
    this.audioProvider.reset();
    [this.theIntroDbProvider, this.aniSkipProvider, this.subtitleProvider, this.visualProvider, this.prefetchAudioProvider].forEach((provider) => {
      if (!provider) return;
      try { provider.cancel(); } catch (e) { /* noop */ }
      try { provider.reset(); } catch (e) { /* noop */ }
    });
    if (this._emptyResultTimer) {
      try { clearTimeout(this._emptyResultTimer); } catch (e) { /* noop */ }
      this._emptyResultTimer = null;
    }
    this.visibilityGuard.detach();
    this.timelineMarkers.detach();
    this._flushPendingCacheSave();

    this.video = null;
    this._bindedOnLoadedMeta = null;
    this._bindedOnPlaying = null;

    this.resolver.reset();
    this.playback.resetSession();
    this._hideSkipButton(true);
  }

  _runProvider(provider) {
    if (!provider) return;
    try {
      if (!provider.isApplicable({ video: this.video, capabilities: this.capabilities })) {
        if (this.settings.debug) this.log('log', `provider ${provider.name} skipped (not applicable).`);
        return;
      }
      if (this.settings.debug) this.log('log', `provider ${provider.name} starting.`);
      const result = provider.run(
        { video: this.video, capabilities: this.capabilities },
        (ranges, meta) => this._onProviderUpdate(provider.name, ranges, meta)
      );
      if (result && typeof result.catch === 'function') {
        result.catch((err) => this.log('warn', `${provider.name} provider failed`, err));
      }
    } catch (err) {
      this.log('warn', `${provider.name} provider threw`, err);
    }
  }

  _onProviderUpdate(source, rawRanges, meta) {
    if (!this.video) return;
    const normalized = normalizeRanges(rawRanges, this.video.duration);
    const updated = this.resolver.apply(source, normalized);
    if (!updated) return;

    if (this.settings.debug) this._logSegmentRanges(source, this.resolver.getRanges(), meta);
    if (source !== 'cache') this._scheduleCacheSave(this.resolver.getRanges());
    this._refreshTimelineMarkers();
    this._noteRetroactiveDetection(source, normalized);
  }

  _noteRetroactiveDetection(source, normalized) {
    if (source === 'cache') return;
    if (!this.video) return;
    const t = Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0;
    ['intro', 'credits'].forEach((kind) => {
      const ranges = normalized[kind] || [];
      if (!ranges.length) return;
      const last = ranges[ranges.length - 1];
      if (last.end < t) {
        this.log('log', `${kind} detected retroactively (${last.start.toFixed(1)}-${last.end.toFixed(1)}s, now ${t.toFixed(1)}s) — cached for next playthrough.`);
      }
    });
  }

  _refreshTimelineMarkers() {
    if (!this.timelineMarkers) return;
    if (!this.video) return;
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    const confidence = {
      intro: this.resolver.confidenceFor('intro'),
      credits: this.resolver.confidenceFor('credits')
    };
    this.timelineMarkers.setRanges(this.resolver.getRanges(), duration, confidence);
  }

  _handleSegmentEnter(segment, range, isSame) {
    if (!isSame || !this.skipPrompt.isVisible()) {
      const confidence = this.resolver.confidenceFor(segment);
      this.skipPrompt.show(segment, { confidence, autoSkip: confidence !== 'low' });
      const t = this.video && Number.isFinite(this.video.currentTime) ? this.video.currentTime.toFixed(2) : 'n/a';
      if (this.settings.debug) {
        this.log('log', `segment detected -> ${segment} at ${t}s (confidence: ${confidence})`, {
          range,
          duration: this.video ? this.video.duration : undefined,
          sources: this.resolver.getSources()
        });
      }
    }
  }

  _handleSegmentLeave() {
    this._hideSkipButton();
  }

  performSkip(segment) {
    if (!this.video) return;
    const duration = this.video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    const ranges = this.resolver.getRanges();
    if (segment === 'intro') {
      const range = (this.playback.getActiveRange() && this.playback.getActiveSegment() === 'intro')
        ? this.playback.getActiveRange()
        : (ranges.intro && ranges.intro.length ? ranges.intro[0] : null);
      if (!range) return;
      this.playback.markSkipped('intro');
      this._safeSeek(range.end);
      this._notify(translate('autoskip_intro_skipped'));
    }

    if (segment === 'credits') {
      const range = (this.playback.getActiveRange() && this.playback.getActiveSegment() === 'credits')
        ? this.playback.getActiveRange()
        : (ranges.credits && ranges.credits.length ? ranges.credits[0] : null);
      if (!range) return;
      this.playback.markSkipped('credits');
      this._safeSeek(Math.min(duration - 1, Math.max(0, range.end)));
      this._notify(translate('autoskip_credits_skipped'));
    }

    this._hideSkipButton();
  }

  _safeSeek(target) {
    try {
      if (Number.isFinite(target)) this.video.currentTime = target;
    } catch (e) {
      this.log('warn', 'Failed to seek:', e);
    }
  }

  _notify(msg) {
    if (!this.settings.showNotifications) return;
    if (typeof Lampa !== 'undefined' && Lampa.Noty) Lampa.Noty.show(msg);
    else this.log('log', msg);
  }

  _hideSkipButton(destroy = false) {
    this.skipPrompt.hide();
    if (destroy) this.skipPrompt.destroy();
  }

  _applyCachedSegments() {
    const ids = getContentId(this.video);
    if (!ids || !ids.primary) return;

    let cached = this.segmentCache.read(ids.primary);
    let key = ids.primary;
    if (!cached && ids.legacy) {
      cached = this.segmentCache.read(ids.legacy);
      if (cached) {
        this.segmentCache.write(ids.primary, cached);
        this.segmentCache.scheduleSave();
      }
    }
    if (!cached) return;

    const normalized = normalizeRanges(cached, this.video.duration);
    if (!normalized.intro.length && !normalized.credits.length) return;

    const updated = this.resolver.apply('cache', normalized);
    if (updated && this.settings.debug) {
      this._logSegmentRanges('cache', this.resolver.getRanges(), { key });
    }
  }

  _scheduleCacheSave(ranges) {
    const ids = getContentId(this.video);
    if (!ids || !ids.primary) return;
    if (!ranges) return;
    if ((!ranges.intro || !ranges.intro.length) && (!ranges.credits || !ranges.credits.length)) return;

    this._cachePendingKey = ids.primary;
    this._cachePendingRanges = {
      intro: (ranges.intro || []).slice(),
      credits: (ranges.credits || []).slice()
    };

    if (this._cacheSaveTimer) return;
    this._cacheSaveTimer = setTimeout(() => this._flushPendingCacheSave(), 1500);
  }

  _flushPendingCacheSave() {
    if (!this._cacheSaveTimer && !this._cachePendingKey) return;
    if (this._cacheSaveTimer) {
      clearTimeout(this._cacheSaveTimer);
      this._cacheSaveTimer = null;
    }

    const key = this._cachePendingKey;
    const ranges = this._cachePendingRanges;
    this._cachePendingKey = null;
    this._cachePendingRanges = null;

    if (!key || !ranges) return;
    try {
      this.segmentCache.write(key, ranges);
      this.segmentCache.save();
      if (this.settings.debug) this.log('log', 'segments cached', { key, intro: ranges.intro, credits: ranges.credits });
    } catch (e) {
      this.log('warn', 'Failed to save cache:', e);
    }
  }

  _logSegmentRanges(source, ranges, meta = null) {
    const format = (seg) => seg.map((r) => `${r.start.toFixed(1)}-${r.end.toFixed(1)}s`).join(', ') || 'none';
    const intro = ranges.intro || [];
    const credits = ranges.credits || [];
    this.log('log', `segments from ${source}: intro=${format(intro)}; credits=${format(credits)}`, meta);
  }

  _getVideo() {
    return document.querySelector('video');
  }
}
