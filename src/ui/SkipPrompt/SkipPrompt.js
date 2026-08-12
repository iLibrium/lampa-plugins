import { ensureSkipPromptStyles } from './styles.js';
import { ProgressTimer } from './progressTimer.js';
import { PromptController } from './controller.js';
import { t as translate } from '../../util/i18n.js';

// Промпт монтируется в корень плеера, а НЕ в .player-panel: панель Lampa
// автоскрывается по таймауту, и вместе с ней пропадала кнопка — при этом
// отсчёт продолжался и пропуск срабатывал вслепую.
const PLAYER_SELECTORS = ['.player', '.player-video', '#app .player'];

function findMountTarget() {
  if (typeof document === 'undefined') return null;
  for (const selector of PLAYER_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return document.body || null;
}

function buildElement() {
  const root = document.createElement('div');
  root.className = 'autoskip-prompt';

  const cancel = document.createElement('div');
  cancel.className = 'simple-button selector autoskip-prompt__cancel';
  const cancelLabel = document.createElement('span');
  cancelLabel.textContent = translate('autoskip_cancel');
  cancel.appendChild(cancelLabel);

  const skip = document.createElement('div');
  skip.className = 'simple-button selector autoskip-prompt__skip';

  const progress = document.createElement('div');
  progress.className = 'autoskip-prompt__progress';
  skip.appendChild(progress);

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
    this._video = null;
    this._videoEvents = null;
    this._visible = false;
    this._activeSegment = null;
    this._activeConfidence = null;
  }

  attachToVideo(video) {
    this._detachVideo();
    this._video = video;
    if (!video) return;

    const onPause = () => this._pauseCountdown();
    const onPlaying = () => { if (this._visible) this._resumeCountdown(); };
    const onSeeking = () => this._stopCountdown();

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
    if (this.parts && this.parts.root.isConnected) return this.parts;

    if (this.parts) {
      try { this.parts.root.remove(); } catch (e) { /* noop */ }
    }

    this.parts = buildElement();
    const target = findMountTarget();
    if (!target) return this.parts;
    target.appendChild(this.parts.root);

    // Форсируем расчёт стилей, иначе браузер схлопнет начальное и конечное
    // состояние в один кадр и появление пройдёт без анимации.
    void this.parts.root.offsetWidth;

    this.parts.cancel.addEventListener('click', () => this._handleCancel());
    this.parts.skip.addEventListener('click', () => this._handleSkip());
    return this.parts;
  }

  show(segment, options) {
    const parts = this._ensure();
    if (!parts.root.isConnected) return;

    this._activeSegment = segment;
    const opts = options || {};
    const confidence = opts.confidence || 'high';
    this._activeConfidence = confidence;
    const autoSkipAllowed = opts.autoSkip !== false;

    parts.root.classList.remove(
      'autoskip-prompt--confidence-low',
      'autoskip-prompt--confidence-medium',
      'autoskip-prompt--confidence-high'
    );
    parts.root.classList.add(`autoskip-prompt--confidence-${confidence}`);

    if (parts.confidenceMark) {
      const mark = confidence === 'low' ? '?' : (confidence === 'medium' ? '~' : '');
      parts.confidenceMark.textContent = mark;
      parts.confidenceMark.style.display = mark ? '' : 'none';
    }

    parts.cancel.classList.remove('focus');
    parts.skip.classList.add('focus');

    parts.root.style.setProperty('--autoskip-progress-duration', `${this.durationMs}ms`);
    parts.root.classList.add('is-visible');

    if (!this.controller) {
      this.controller = new PromptController({
        root: parts.root,
        log: this.log,
        onSkip: () => this._handleSkip(),
        onCancel: () => this._handleCancel()
      });
    }

    if (!this._visible) this.controller.takeover(parts.skip);
    this._visible = true;

    if (autoSkipAllowed && confidence !== 'low') this._startCountdown();
    else this._stopCountdown();
  }

  _startCountdown() {
    this._stopCountdown();
    if (!this.parts) return;
    const { root } = this.parts;

    // Перезапуск CSS-анимации: снять класс, форсировать reflow, вернуть.
    root.classList.remove('is-counting', 'is-paused');
    void root.offsetWidth;
    root.classList.add('is-counting');

    this.timer = new ProgressTimer({
      duration: this.durationMs,
      onDone: () => this._handleTimeout()
    });
    this.timer.start();

    if (this._video && this._video.paused) this._pauseCountdown();
  }

  _pauseCountdown() {
    if (!this.timer) return;
    this.timer.pause();
    if (this.parts) this.parts.root.classList.add('is-paused');
  }

  _resumeCountdown() {
    if (!this.timer) return;
    this.timer.resume();
    if (this.parts && this.timer.isRunning()) this.parts.root.classList.remove('is-paused');
  }

  _stopCountdown() {
    if (this.timer) {
      this.timer.cancel();
      this.timer = null;
    }
    if (this.parts) this.parts.root.classList.remove('is-counting', 'is-paused');
  }

  /**
   * Автопропуск разрешён, только если промпт реально отрисован. Страховка от
   * повторения бага, когда кнопка была скрыта, а пропуск всё равно срабатывал.
   */
  _isReallyVisible() {
    if (!this.parts || !this.parts.root.isConnected) return false;
    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return true;

    const root = this.parts.root;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    let node = root;
    let depth = 0;
    while (node && node !== document.documentElement && depth < 24) {
      const cs = window.getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (Number(cs.opacity) < 0.05) return false;
      node = node.parentElement;
      depth += 1;
    }
    return true;
  }

  _handleTimeout() {
    if (!this._isReallyVisible()) {
      this.log('warn', 'auto-skip suppressed: prompt is not visible on screen.');
      this._stopCountdown();
      return;
    }
    this._handleSkip();
  }

  hide() {
    this._stopCountdown();
    if (this.parts) {
      this.parts.root.classList.remove('is-visible');
      this.parts.skip.classList.remove('focus');
      this.parts.cancel.classList.remove('focus');
    }
    if (this.controller && this._visible) this.controller.release();
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

  _handleSkip() {
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
