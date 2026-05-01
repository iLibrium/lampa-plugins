import { ProviderBase } from './ProviderBase.js';
import { getSegmentKindFromKey } from '../constants.js';

function getLampa() {
  return typeof Lampa !== 'undefined' ? Lampa : null;
}

function getPlayerData() {
  const lampa = getLampa();
  if (!lampa || !lampa.Player) return null;
  try {
    if (typeof lampa.Player.get === 'function') return lampa.Player.get();
    if (typeof lampa.Player.data === 'function') return lampa.Player.data();
    if (lampa.Player.current) return lampa.Player.current;
    if (lampa.Player.item) return lampa.Player.item;
  } catch (e) { /* noop */ }
  return null;
}

function normalizeRangeValue(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const start = Number(value[0]);
    const end = Number(value[1]);
    if (Number.isFinite(start) && Number.isFinite(end)) return { start, end };
  }
  if (typeof value === 'object' && value) {
    const start = Number(value.start !== undefined ? value.start : value.begin !== undefined ? value.begin : value.from);
    const end = Number(value.end !== undefined ? value.end : value.finish !== undefined ? value.finish : value.to);
    if (Number.isFinite(start) && Number.isFinite(end)) return { start, end };
  }
  return null;
}

function extractRangesFromObject(data, ranges, depth) {
  if (!data || depth > 3) return;
  if (Array.isArray(data)) {
    data.forEach((item) => extractRangesFromObject(item, ranges, depth + 1));
    return;
  }
  if (typeof data !== 'object') return;

  Object.keys(data).forEach((key) => {
    const value = data[key];
    if (!value || typeof value !== 'object') return;

    const kind = getSegmentKindFromKey(String(key).toLowerCase());
    const range = normalizeRangeValue(value);

    if (kind && range) {
      ranges[kind].push(range);
    } else {
      extractRangesFromObject(value, ranges, depth + 1);
    }
  });
}

export class MetadataProvider extends ProviderBase {
  constructor({ log }) {
    super({ name: 'metadata', log });
  }

  isApplicable() {
    return !!getLampa();
  }

  async run(ctx, onUpdate) {
    const ranges = { intro: [], credits: [] };
    const data = getPlayerData();
    if (!data) return;
    extractRangesFromObject(data, ranges, 0);
    if (!ranges.intro.length && !ranges.credits.length) return;
    if (this.cancelled) return;
    onUpdate(ranges, { passive: true });
  }
}
