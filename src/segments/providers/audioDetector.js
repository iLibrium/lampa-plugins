import { computeMedian, mergeSegments, rangesEqual } from '../ranges.js';

export class AudioSegmentDetector {
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
    if (!video) return;
    if (this.audioContext) return;
    this.video = video;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      this.log('warn', 'AudioContext not available, audio-based skip disabled.');
      return;
    }

    try {
      this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
    } catch (e) {
      this.log('warn', 'Failed to start AudioContext:', e);
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
      this.log('warn', 'Cannot create media source:', e);
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
      this.log('warn', 'Cannot wire audio nodes:', e);
      this.stop();
      return;
    }

    this.log('log', 'audio analysis started', {
      sampleRate: this.audioContext.sampleRate,
      bufferSize,
      windowSec: this.config.windowSec
    });

    const resumeContext = () => {
      if (!this.audioContext) return;
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
    };
    resumeContext();

    this._bindedOnPlayForAudio = resumeContext;
    video.addEventListener('play', this._bindedOnPlayForAudio);

    this._bindedOnSeeking = () => this.resetAudioWindowAccumulator();
    video.addEventListener('seeking', this._bindedOnSeeking);
  }

  stop() {
    if (this.audioProcessorNode) {
      try { this.audioProcessorNode.disconnect(); } catch (e) { /* noop */ }
    }
    if (this.audioSourceNode) {
      try { this.audioSourceNode.disconnect(); } catch (e) { /* noop */ }
    }
    if (this.silentGainNode) {
      try { this.silentGainNode.disconnect(); } catch (e) { /* noop */ }
    }
    if (this.audioPassthroughNode) {
      try { this.audioPassthroughNode.disconnect(); } catch (e) { /* noop */ }
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
      if (outlier) flagged.push({ start: w.start, end: w.end });
    }

    const merged = mergeSegments(flagged, this.config.mergeGapSec);
    const filtered = merged.filter((seg) => (seg.end - seg.start) >= this.config.minSegmentSec);
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
    if (!newRanges.intro.length && !newRanges.credits.length) return;

    if (this._lastRanges) {
      const sameIntro = rangesEqual(this._lastRanges.intro, newRanges.intro);
      const sameCredits = rangesEqual(this._lastRanges.credits, newRanges.credits);
      if (sameIntro && sameCredits) return;
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
}

