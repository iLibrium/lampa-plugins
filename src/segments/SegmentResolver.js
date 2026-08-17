import { normalizeRanges, rangesEqual } from './ranges.js';

const SOURCE_PRIORITY = {
  cache: 0,
  audio: 1,
  visual: 2,
  prefetch_audio: 3,
  lookahead_audio: 4,
  subtitle_gap: 5,
  subtitle: 6,
  chapters: 7,
  metadata: 8,
  theintrodb: 9,
  aniskip: 10
};

const SOURCE_CONFIDENCE = {
  cache: 'medium',
  audio: 'low',
  visual: 'medium',
  prefetch_audio: 'medium',
  // Настоящий звук потока, разобранный до того, как зритель до него дошёл.
  // Надёжнее prefetch: данные не обрезаны и принадлежат именно этой дорожке.
  lookahead_audio: 'medium',
  // Провал реплик — догадка: так же выглядит долгая тихая сцена. Показываем
  // кнопку, но автопропуск не разрешаем, пока догадку не подтвердит кто-то ещё.
  subtitle_gap: 'low',
  subtitle: 'medium',
  chapters: 'high',
  metadata: 'high',
  theintrodb: 'high',
  aniskip: 'high'
};

const VALIDATION_BONUS = 100;
const VALIDATION_TOLERANCE_SEC = 2;

function priorityOf(source, validated) {
  const base = SOURCE_PRIORITY[source];
  const value = base === undefined ? 0 : base;
  return validated ? value + VALIDATION_BONUS : value;
}

function rangesOverlapWithin(a, b, tolerance) {
  if (!a || !b || !a.length || !b.length) return false;
  const ra = a[0];
  const rb = b[0];
  return Math.abs(ra.start - rb.start) <= tolerance && Math.abs(ra.end - rb.end) <= tolerance;
}

export class SegmentResolver {
  constructor() {
    this.ranges = { intro: [], credits: [] };
    this.sources = { intro: null, credits: null };
    this.validated = { intro: false, credits: false };
  }

  reset() {
    this.ranges = { intro: [], credits: [] };
    this.sources = { intro: null, credits: null };
    this.validated = { intro: false, credits: false };
  }

  apply(source, normalized) {
    const introUpdated = this._applyKind(source, 'intro', normalized.intro);
    const creditsUpdated = this._applyKind(source, 'credits', normalized.credits);
    return introUpdated || creditsUpdated;
  }

  _applyKind(source, kind, incoming) {
    if (!incoming || !incoming.length) return false;

    const incomingPriority = priorityOf(source, false);
    const currentSource = this.sources[kind];
    const currentValidated = this.validated[kind];
    const currentPriority = currentSource
      ? priorityOf(currentSource, currentValidated)
      : -1;

    if (this.ranges[kind].length && rangesOverlapWithin(this.ranges[kind], incoming, VALIDATION_TOLERANCE_SEC)) {
      if (currentSource && currentSource !== source && source !== 'cache') {
        this.validated[kind] = true;
      }
      return false;
    }

    const shouldReplace = !this.ranges[kind].length || incomingPriority >= currentPriority;
    if (!shouldReplace) return false;
    if (rangesEqual(this.ranges[kind], incoming)) return false;

    this.ranges[kind] = incoming;
    this.sources[kind] = source;
    this.validated[kind] = source === 'cache' ? currentValidated : false;
    return true;
  }

  getRanges() {
    return this.ranges;
  }

  getSources() {
    return this.sources;
  }

  isValidated(kind) {
    return !!this.validated[kind];
  }

  confidenceFor(kind) {
    const source = this.sources[kind];
    if (!source) return 'none';
    if (this.validated[kind]) return 'high';
    return SOURCE_CONFIDENCE[source] || 'low';
  }

  hasHighConfidence(kind) {
    return this.confidenceFor(kind) === 'high';
  }
}

export function normalizeForResolver(raw, duration) {
  return normalizeRanges(raw, duration);
}

export { SOURCE_PRIORITY, SOURCE_CONFIDENCE };
