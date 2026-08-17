/**
 * Минимальный разбор фрагментированного MP4 — ровно столько, сколько нужно,
 * чтобы привязать перехваченный сегмент к времени на шкале ролика.
 *
 * hls.js отдаёт в MSE сначала init-сегмент (ftyp + moov), потом медиа-сегменты
 * (moof + mdat). Шкалу времени дорожки берём из mdhd в init, а положение
 * конкретного сегмента — из tfdt в его moof.
 */

const CONTAINERS = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf'];
const MAX_DEPTH = 6;

function typeAt(u8, p) {
  return String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
}

/** Ищет первый бокс указанного типа, спускаясь только в контейнеры. */
export function findBox(u8, want, start = 0, end = u8.length, depth = 0) {
  let p = start;
  while (p + 8 <= end) {
    const size = ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
    const type = typeAt(u8, p);
    if (size < 8 || p + size > end) return null;
    if (type === want) return { at: p, size };
    if (CONTAINERS.indexOf(type) !== -1 && depth < MAX_DEPTH) {
      const inner = findBox(u8, want, p + 8, p + size, depth + 1);
      if (inner) return inner;
    }
    p += size;
  }
  return null;
}

/** Тип первого верхнеуровневого бокса: по нему отличаем init от медиа-сегмента. */
export function firstBoxType(u8) {
  if (!u8 || u8.length < 8) return null;
  const t = typeAt(u8, 0);
  return /^[a-zA-Z0-9]{4}$/.test(t) ? t : null;
}

export function isInitSegment(u8) {
  const t = firstBoxType(u8);
  return t === 'ftyp' || t === 'styp' || t === 'moov';
}

export function isMediaSegment(u8) {
  return firstBoxType(u8) === 'moof';
}

/** Шкала времени дорожки из mdhd init-сегмента. */
export function readTimescale(init) {
  const box = findBox(init, 'mdhd');
  if (!box) return null;
  const version = init[box.at + 8];
  const offset = box.at + 8 + (version === 1 ? 20 : 12);
  if (offset + 4 > init.length) return null;
  const view = new DataView(init.buffer, init.byteOffset, init.byteLength);
  const value = view.getUint32(offset);
  return value > 0 ? value : null;
}

/** Положение медиа-сегмента на шкале дорожки (baseMediaDecodeTime из tfdt). */
export function readBaseMediaDecodeTime(media) {
  const box = findBox(media, 'tfdt');
  if (!box) return null;
  const version = media[box.at + 8];
  const view = new DataView(media.buffer, media.byteOffset, media.byteLength);
  try {
    if (version === 1) {
      if (box.at + 20 > media.length) return null;
      return Number(view.getBigUint64(box.at + 12));
    }
    if (box.at + 16 > media.length) return null;
    return view.getUint32(box.at + 12);
  } catch (e) {
    return null;
  }
}

/** Время начала сегмента в секундах, или null, если разметку прочитать не вышло. */
export function segmentStartSec(media, timescale) {
  if (!timescale) return null;
  const base = readBaseMediaDecodeTime(media);
  if (base === null || !Number.isFinite(base)) return null;
  return base / timescale;
}
