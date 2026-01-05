export function getCacheKey(video) {
  if (!video) return null;
  const src = video.currentSrc || video.src || '';
  const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : null;
  if (!src || duration === null) return null;
  return `${src}::${duration}`;
}

export function readCachedRanges(cache, key) {
  if (!cache || !key) return null;
  return cache[key] || null;
}

export function writeCachedRanges(cache, key, ranges, { maxEntries = 50 } = {}) {
  if (!cache || !key) return;
  if (!ranges || (!ranges.intro || !ranges.intro.length) && (!ranges.credits || !ranges.credits.length)) return;

  cache[key] = {
    intro: ranges.intro.slice(),
    credits: ranges.credits.slice(),
    ts: Date.now()
  };

  const keys = Object.keys(cache);
  if (keys.length <= maxEntries) return;

  keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
  for (let i = 0; i < keys.length - maxEntries; i += 1) {
    delete cache[keys[i]];
  }
}

