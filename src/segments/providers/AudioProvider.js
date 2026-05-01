import { ProviderBase } from './ProviderBase.js';
import { computeMedian, mergeSegments, rangesEqual } from '../ranges.js';

const DEFAULT_CONFIG = {
  windowSec: 0.5,
  baselineWindows: 30,
  warmupWindows: 24,
  zThreshold: 1.4,
  minSegmentSec: 6,
  mergeGapSec: 1,
  introMaxFraction: 0.3,
  creditsMinFraction: 0.7,
  fftSize: 2048,
  voiceMusicMaxRatio: 0.45,
  silenceProbeWindows: 6,
  silenceProbeRmsThreshold: 1e-6
};

const VOICE_BAND_LO = 200;
const VOICE_BAND_HI = 3000;
const FULL_BAND_HI = 12000;

function clampFreqIndex(freqHz, sampleRate, binCount) {
  if (!Number.isFinite(freqHz) || sampleRate <= 0 || binCount <= 0) return 0;
  const idx = Math.round((freqHz / (sampleRate / 2)) * binCount);
  return Math.max(0, Math.min(binCount - 1, idx));
}

export class AudioProvider extends ProviderBase {
  constructor({ log, config = {}, onUpdate, onTainted }) {
    super({ name: 'audio', log });
    this.config = Object.assign({}, DEFAULT_CONFIG, config);
    this.onUpdate = onUpdate || (() => {});
    this.onTainted = onTainted || (() => {});

    this.video = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.analyserNode = null;
    this.silentGainNode = null;

    this.state = null;
    this.spectralBuffer = null;

    this._onSeeking = null;
    this._onPlay = null;
    this._lastEmitted = null;
    this._silenceProbeRemaining = 0;
    this._taintedDetected = false;
  }

  isApplicable(ctx) {
    if (!ctx || !ctx.video) return false;
    if (ctx.capabilities && ctx.capabilities.audioContext === false) return false;
    return true;
  }

  async run(ctx /* , onUpdate */) {
    this.start(ctx.video);
  }

  start(video) {
    if (!video) return;
    if (this.audioContext) return;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      this.log('warn', 'AudioContext not available, audio-based skip disabled.');
      return;
    }

    this.video = video;

    try {
      this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
    } catch (e) {
      this.log('warn', 'Failed to start AudioContext:', e);
      this.audioContext = null;
      return;
    }

    this.state = {
      currentSumSq: 0,
      currentSamples: 0,
      windows: [],
      windowSamples: Math.max(1, Math.floor(this.config.windowSec * this.audioContext.sampleRate))
    };
    this._lastEmitted = null;
    this._silenceProbeRemaining = this.config.silenceProbeWindows;
    this._taintedDetected = false;

    try {
      this.sourceNode = this.audioContext.createMediaElementSource(video);
    } catch (e) {
      this.log('warn', 'Cannot create media source:', e);
      this.stop();
      return;
    }

    const inputChannels = Math.max(1, this.sourceNode.channelCount || 2);
    this.processorNode = this.audioContext.createScriptProcessor(2048, inputChannels, inputChannels);
    this.processorNode.onaudioprocess = (event) => this._handleProcess(event);

    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = this.config.fftSize;
    this.analyserNode.smoothingTimeConstant = 0.5;
    this.spectralBuffer = new Float32Array(this.analyserNode.frequencyBinCount);

    this.silentGainNode = this.audioContext.createGain();
    this.silentGainNode.gain.value = 0;

    try {
      this.sourceNode.connect(this.audioContext.destination);
      this.sourceNode.connect(this.analyserNode);
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.silentGainNode);
      this.silentGainNode.connect(this.audioContext.destination);
    } catch (e) {
      this.log('warn', 'Cannot wire audio nodes:', e);
      this.stop();
      return;
    }

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    this._onPlay = () => {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
    };
    this._onSeeking = () => this.resetWindowAccumulator();

    video.addEventListener('play', this._onPlay);
    video.addEventListener('seeking', this._onSeeking);

    this.log('log', 'audio analysis started', {
      sampleRate: this.audioContext.sampleRate,
      windowSec: this.config.windowSec
    });
  }

  stop() {
    [this.processorNode, this.sourceNode, this.silentGainNode, this.analyserNode].forEach((node) => {
      if (!node) return;
      try { node.disconnect(); } catch (e) { /* noop */ }
    });

    if (this.audioContext) {
      try { this.audioContext.close(); } catch (e) { /* noop */ }
    }

    if (this.video && this._onPlay) {
      try { this.video.removeEventListener('play', this._onPlay); } catch (e) { /* noop */ }
    }
    if (this.video && this._onSeeking) {
      try { this.video.removeEventListener('seeking', this._onSeeking); } catch (e) { /* noop */ }
    }

    this.video = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.analyserNode = null;
    this.silentGainNode = null;
    this.state = null;
    this.spectralBuffer = null;
    this._onPlay = null;
    this._onSeeking = null;
    this._lastEmitted = null;
  }

  cancel() {
    super.cancel();
    this.stop();
  }

  resetWindowAccumulator() {
    if (!this.state) return;
    this.state.currentSamples = 0;
    this.state.currentSumSq = 0;
  }

  resetSession() {
    if (!this.state) return;
    this.state.currentSamples = 0;
    this.state.currentSumSq = 0;
    this.state.windows = [];
    this._lastEmitted = null;
    this._silenceProbeRemaining = this.config.silenceProbeWindows;
  }

  _handleProcess(event) {
    if (!this.state || !this.video) return;
    const inputBuffer = event.inputBuffer;
    if (!inputBuffer) return;

    const channelCount = inputBuffer.numberOfChannels;
    if (!channelCount) return;
    const length = inputBuffer.length;
    const channels = [];
    for (let c = 0; c < channelCount; c += 1) {
      channels.push(inputBuffer.getChannelData(c));
    }

    const state = this.state;
    const windowSamples = state.windowSamples;

    for (let i = 0; i < length; i += 1) {
      let sample = 0;
      for (let c = 0; c < channelCount; c += 1) sample += channels[c][i];
      sample /= channelCount;

      state.currentSumSq += sample * sample;
      state.currentSamples += 1;

      if (state.currentSamples >= windowSamples) {
        const rms = Math.sqrt(state.currentSumSq / state.currentSamples);
        const endTime = this.video.currentTime;
        const startTime = Math.max(0, endTime - this.config.windowSec);
        const voiceRatio = this._computeVoiceRatio();
        state.windows.push({ start: startTime, end: endTime, rms, voiceRatio });
        this._trimWindows();
        this._handleSilenceProbe(rms);
        if (!this._taintedDetected) this._updateSegments();
        state.currentSumSq = 0;
        state.currentSamples = 0;
      }
    }
  }

  _handleSilenceProbe(rms) {
    if (this._silenceProbeRemaining <= 0) return;
    this._silenceProbeRemaining -= 1;
    if (rms > this.config.silenceProbeRmsThreshold) {
      this._silenceProbeRemaining = 0;
      return;
    }
    if (this._silenceProbeRemaining === 0) {
      this._taintedDetected = true;
      this.log('warn', 'audio tainted (CORS) or silent stream — provider disabled.');
      try { this.onTainted(); } catch (e) { /* noop */ }
      this.cancel();
    }
  }

  _computeVoiceRatio() {
    if (!this.analyserNode || !this.spectralBuffer) return null;
    try {
      this.analyserNode.getFloatFrequencyData(this.spectralBuffer);
    } catch (e) {
      return null;
    }
    const sampleRate = this.audioContext ? this.audioContext.sampleRate : 48000;
    const binCount = this.spectralBuffer.length;

    const loIdx = clampFreqIndex(VOICE_BAND_LO, sampleRate, binCount);
    const hiIdx = clampFreqIndex(VOICE_BAND_HI, sampleRate, binCount);
    const fullHiIdx = clampFreqIndex(FULL_BAND_HI, sampleRate, binCount);

    let voiceEnergy = 0;
    let fullEnergy = 0;
    for (let i = 1; i < fullHiIdx; i += 1) {
      const dB = this.spectralBuffer[i];
      if (!Number.isFinite(dB)) continue;
      const linear = Math.pow(10, dB / 20);
      fullEnergy += linear;
      if (i >= loIdx && i <= hiIdx) voiceEnergy += linear;
    }
    if (fullEnergy <= 0) return null;
    return voiceEnergy / fullEnergy;
  }

  _trimWindows() {
    if (!this.state) return;
    const maxWindows = 3600;
    if (this.state.windows.length > maxWindows) {
      const excess = this.state.windows.length - maxWindows;
      this.state.windows.splice(0, excess);
    }
  }

  _updateSegments() {
    if (!this.state || !this.video) return;
    const duration = this.video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const windows = this.state.windows;
    if (!windows.length) return;
    if (windows.length < this.config.warmupWindows) return;

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
      const rmsOutlier = Math.abs(w.rms - median) > thresh;
      const voiceLow = w.voiceRatio !== null && w.voiceRatio < this.config.voiceMusicMaxRatio;
      if (rmsOutlier && voiceLow) flagged.push({ start: w.start, end: w.end });
    }

    const merged = mergeSegments(flagged, this.config.mergeGapSec);
    const filtered = merged.filter((seg) => (seg.end - seg.start) >= this.config.minSegmentSec);
    if (!filtered.length) return;

    const introCutoff = duration * this.config.introMaxFraction;
    const creditsCutoff = duration * this.config.creditsMinFraction;

    const introCandidates = filtered
      .filter((seg) => seg.start <= introCutoff)
      .sort((a, b) => a.start - b.start);
    const creditsCandidates = filtered
      .filter((seg) => seg.end >= creditsCutoff)
      .sort((a, b) => a.start - b.start);

    const newRanges = { intro: [], credits: [] };
    if (introCandidates.length) newRanges.intro.push(introCandidates[0]);
    if (creditsCandidates.length) newRanges.credits.push(creditsCandidates[creditsCandidates.length - 1]);
    if (!newRanges.intro.length && !newRanges.credits.length) return;

    if (this._lastEmitted) {
      const sameIntro = rangesEqual(this._lastEmitted.intro, newRanges.intro);
      const sameCredits = rangesEqual(this._lastEmitted.credits, newRanges.credits);
      if (sameIntro && sameCredits) return;
    }

    this._lastEmitted = newRanges;
    this.onUpdate(newRanges, {
      windows: windows.length,
      baseline: { size: baselineSize, median, mad, threshold: thresh },
      candidates: filtered.length
    });
  }
}
