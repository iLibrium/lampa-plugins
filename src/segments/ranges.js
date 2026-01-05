import { SEGMENT_KINDS } from './constants.js';

export function isTimeInRanges(time, ranges) {
  return ranges.some((range) => time >= range.start && time <= range.end);
}

export function mergeSegments(segments, gapSec) {
  if (!segments.length) return [];
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

export function computeMedian(arr) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeRange(range, duration = null) {
  if (!range || typeof range !== 'object') return null;
  const start = Number(range.start);
  const end = Number(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  let normalizedStart = start;
  let normalizedEnd = end;
  if (Number.isFinite(duration) && duration > 0) {
    normalizedStart = clamp(normalizedStart, 0, duration);
    normalizedEnd = clamp(normalizedEnd, 0, duration);
  }

  if (normalizedEnd <= normalizedStart) return null;
  return { start: normalizedStart, end: normalizedEnd };
}

export function normalizeRanges(ranges, duration = null) {
  const out = { intro: [], credits: [] };
  if (!ranges || typeof ranges !== 'object') return out;

  for (const kind of SEGMENT_KINDS) {
    const list = Array.isArray(ranges[kind]) ? ranges[kind] : [];
    const normalized = list
      .map((r) => normalizeRange(r, duration))
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);

    out[kind] = mergeSegments(normalized, 0);
  }

  return out;
}

export function rangesEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].start !== b[i].start || a[i].end !== b[i].end) return false;
  }
  return true;
}

