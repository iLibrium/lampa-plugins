function getLampa() {
  return typeof Lampa !== 'undefined' ? Lampa : null;
}

function getPlayerData() {
  const lampa = getLampa();
  if (!lampa || !lampa.Player) return null;
  try {
    if (typeof lampa.Player.data === 'function') return lampa.Player.data();
    if (typeof lampa.Player.get === 'function') return lampa.Player.get();
    if (lampa.Player.current) return lampa.Player.current;
    if (lampa.Player.item) return lampa.Player.item;
  } catch (e) { /* noop */ }
  return null;
}

function getActivityCard() {
  const lampa = getLampa();
  try {
    if (lampa && lampa.Activity && typeof lampa.Activity.active === 'function') {
      const activity = lampa.Activity.active();
      if (activity && activity.card) return activity.card;
    }
  } catch (e) { /* noop */ }
  return null;
}

function pickFirstFinite(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return null;
}

function roundDuration(duration, bucketSec = 30) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.round(duration / bucketSec) * bucketSec;
}

function legacyKey(video) {
  if (!video) return null;
  const src = video.currentSrc || video.src || '';
  const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : null;
  if (!src || duration === null) return null;
  return `${src}::${duration}`;
}

export function getContentId(video) {
  if (!video) return { primary: null, legacy: null };

  const data = getPlayerData() || {};
  const card = data.movie || data.card || getActivityCard() || {};
  const tmdb = card.id || card.tmdb_id || data.id || null;

  const season = pickFirstFinite(
    data.season_number, data.season, data.s,
    card.season_number, card.season
  );
  const episode = pickFirstFinite(
    data.episode_number, data.episode, data.e,
    card.episode_number, card.episode
  );

  const duration = roundDuration(video.duration, 30);
  const legacy = legacyKey(video);

  if (tmdb) {
    const s = season === null ? 0 : season;
    const e = episode === null ? 0 : episode;
    return { primary: `tmdb:${tmdb}:s${s}:e${e}:d${duration}`, legacy };
  }

  if (legacy) return { primary: `src:${legacy}`, legacy };
  return { primary: null, legacy };
}
