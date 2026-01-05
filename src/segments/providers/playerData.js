import { getSegmentKindFromKey } from '../constants.js';

export function getPlayerData(lampa = null) {
  const resolved = lampa || (typeof Lampa !== 'undefined' ? Lampa : null);
  const player = resolved && resolved.Player ? resolved.Player : null;
  if (!player) return null;

  if (typeof player.get === 'function') return player.get();
  if (typeof player.data === 'function') return player.data();
  if (player.current) return player.current;
  if (player.item) return player.item;
  return null;
}

export function getRangesFromPlayerData(lampa = null) {
  const ranges = { intro: [], credits: [] };
  const data = getPlayerData(lampa);
  if (!data) return ranges;
  extractRangesFromObject(data, ranges, 0);
  return ranges;
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

function normalizeRangeValue(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const start = Number(value[0]);
    const end = Number(value[1]);
    if (Number.isFinite(start) && Number.isFinite(end)) return { start, end };
  }

  if (typeof value === 'object') {
    const start = Number(value.start ?? value.begin ?? value.from);
    const end = Number(value.end ?? value.finish ?? value.to);
    if (Number.isFinite(start) && Number.isFinite(end)) return { start, end };
  }

  return null;
}

