import { ensureSkipPromptStyles } from './styles.js';
import { ProgressTimer } from './progressTimer.js';
import { PromptController } from './controller.js';
import { t as translate } from '../../util/i18n.js';

const PANEL_SELECTORS = ['.player .player-panel__body', '.player .player-panel', '.player-panel__body', '.player-panel'];

function findMountTarget() {
  if (typeof document === 'undefined') return null;
  for (const selector of PANEL_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function buildElement() {
  const root = document.createElement('div');
  root.className = 'player-panel__skip-prompt autoskip-prompt';

  const cancel = document.createElement('div');
  cancel.className = 'simple-button selector autoskip-prompt__cancel';
  const cancelLabel = document.createElement('span');
  cancelLabel.textContent = translate('autoskip_cancel');
  cancel.appendChild(cancelLabel);

  const skip = document.createElement('div');
  skip.className = 'simple-button selector autoskip-prompt__skip';
  const labelWrap = document.createElement('span');
  labelWrap.className = 'autoskip-prompt__skip-label';
  const skipLabel = document.createElement('span');
  skipLabel.textContent = translate('autoskip_skip');
  labelWrap.appendChild(skipLabel);
  const confidenceMark = document.createElement('span');
  confidenceMark.className = 'autoskip-prompt__confidence-mark';
  confidenceMark.style.display = 'none';
  labelWrap.appendChild(confidenceMark);
  skip.appendChild(labelWrap);

  const progress = document.createElement('div');
  progress.className = 'autoskip-prompt__progress';
  skip.appendChild(progress);

  root.appendChild(cancel);
  root.appendChild(skip);

  return { root, cancel, skip, progress, confidenceMark };
}

export class SkipPrompt {
  constructor({ log, durationMs = 5000, onSkip, onCancel } = {}) {
    this.log = log || (() => {});
    this.durationMs = durationMs;
    this.onSkip = onSkip || (() => {});
    this.onCancel = onCancel || (() => {});

    this.parts = null;
    this.controller = null;
    this.timer = null;
    this._mountedAs = null;
    this._video = null;
    this._videoEvents = null;
    this._visible = false;
  }

  attachToVideo(video) {
    this._detachVideo();
    this._video = video;
    if (!video) return;

    const onPause = () => { if (this.timer) this.timer.pause(); };
    const onPlaying = () => { if (this.timer && this._visible) this.timer.resume(); };
    const onSeeking = () => { if (this.timer) this.timer.reset(); };

    video.addEventListener('pause', onPause);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('seeking', onSeeking);

    this._videoEvents = { onPause, onPlaying, onSeeking };
  }

  _detachVideo() {
    if (this._video && this._videoEvents) {
      try { this._video.removeEventListener('pause', this._videoEvents.onPause); } catch (e) { /* noop */ }
      try { this._video.removeEventListener('playing', this._videoEvents.onPlaying); } catch (e) { /* noop */ }
      try { this._video.removeEventListener('seeking', this._videoEvents.onSeeking); } catch (e) { /* noop */ }
    }
    this._video = null;
    this._videoEvents = null;
  }

  _ensure() {
    ensureSkipPromptStyles();
    if (this.parts && document.body.contains(this.parts.root)) return this.parts;

    if (this.parts) {
      try { this.parts.root.remove(); } catch (e) { /* noop */ }
    }

    this.parts = buildElement();
    const target = findMountTarget();
    if (target) {
      target.appendChild(this.parts.root);
      this._mountedAs = 'panel';
    } else {
      this.parts.root.classList.add('autoskip-prompt--standalone');
      document.body.appendChild(this.parts.root);
      this._mountedAs = 'standalone';
    }

    this.parts.cancel.addEventListener('click', () => this._handleCancel());
    this.parts.skip.addEventListener('click', () => this._handleSkip());
    return this.parts;
  }

  show(segment, options) {
    const parts = this._ensure();
    this._activeSegment = segment;
    const opts = options || {};
    const confidence = opts.confidence || 'high';
    this._activeConfidence = confidence;
    const autoSkipAllowed = opts.autoSkip !== false;

    parts.root.classList.add('is-visible');
    parts.root.classList.remove('autoskip-prompt--confidence-low', 'autoskip-prompt--confidence-medium', 'autoskip-prompt--confidence-high');
    parts.root.classList.add(`autoskip-prompt--confidence-${confidence}`);

    if (parts.confidenceMark) {
      if (confidence === 'low') {
        parts.confidenceMark.style.display = '';
        parts.confidenceMark.textContent = '?';
      } else if (confidence === 'medium') {
        parts.confidenceMark.style.display = '';
        parts.confidenceMark.textContent = '~';
      } else {
        parts.confidenceMark.style.display = 'none';
        parts.confidenceMark.textContent = '';
      }
    }

    parts.cancel.classList.remove('focus');
    parts.skip.classList.add('focus');
    parts.progress.style.transform = 'scaleX(0)';

    if (!this.controller) {
      this.controller = new PromptController({
        root: parts.root,
        log: this.log,
        onSkip: () => this._handleSkip(),
        onCancel: () => this._handleCancel()
      });
    }

    if (!this._visible) {
      this.controller.takeover(parts.skip);
    }
    this._visible = true;

    if (autoSkipAllowed && confidence !== 'low') this._restartTimer();
    else this._cancelTimer();
  }

  _cancelTimer() {
    if (this.timer) {
      this.timer.cancel();
      this.timer = null;
    }
  }

  _restartTimer() {
    this._cancelTimer();
    if (!this.parts) return;
    const { progress } = this.parts;
    this.timer = new ProgressTimer({
      duration: this.durationMs,
      onTick: (pct) => {
        progress.style.transform = `scaleX(${pct})`;
      },
      onDone: () => this._handleSkip(true)
    });
    this.timer.start();
  }

  hide() {
    if (this.timer) {
      this.timer.cancel();
      this.timer = null;
    }
    if (this.parts) {
      this.parts.root.classList.remove('is-visible');
      this.parts.skip.classList.remove('focus');
      this.parts.cancel.classList.remove('focus');
      this.parts.progress.style.transform = 'scaleX(0)';
    }
    if (this.controller && this._visible) {
      this.controller.release();
    }
    this._visible = false;
    this._activeSegment = null;
  }

  destroy() {
    this.hide();
    this._detachVideo();
    if (this.parts) {
      try { this.parts.root.remove(); } catch (e) { /* noop */ }
      this.parts = null;
    }
    this.controller = null;
  }

  isVisible() {
    return this._visible;
  }

  _handleSkip(/* fromTimer */) {
    const segment = this._activeSegment;
    this.hide();
    try { this.onSkip(segment); } catch (e) { this.log('warn', 'onSkip threw', e); }
  }

  _handleCancel() {
    const segment = this._activeSegment;
    this.hide();
    try { this.onCancel(segment); } catch (e) { this.log('warn', 'onCancel threw', e); }
  }
}
