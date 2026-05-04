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
      if (activity) {
        return activity.card || activity.movie || null;
      }
    }
  } catch (e) { /* noop */ }
  return null;
}

function pickFirstFinite(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return null;
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) return String(value);
  }
  return null;
}

function detectAnime(card) {
  if (!card) return false;
  const lang = card.original_language;
  const genres = Array.isArray(card.genre_ids) ? card.genre_ids : [];
  const country = Array.isArray(card.origin_country) ? card.origin_country : [];
  if (lang === 'ja' && genres.indexOf(16) !== -1) return true;
  if (country.indexOf('JP') !== -1 && genres.indexOf(16) !== -1) return true;
  return false;
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

export function getContentIds() {
  const data = getPlayerData() || {};
  const card = data.movie || data.card || getActivityCard() || {};

  const tmdb = pickFirstString(card.id, card.tmdb_id, data.id, data.tmdb_id);
  const imdb = pickFirstString(card.imdb_id, data.imdb_id);
  const kp = pickFirstString(card.kinopoisk_id, card.kp_id, data.kinopoisk_id);

  const season = pickFirstFinite(
    data.season_number, data.season, data.s,
    card.season_number, card.season
  );
  const episode = pickFirstFinite(
    data.episode_number, data.episode, data.e,
    card.episode_number, card.episode
  );

  return {
    tmdb_id: tmdb,
    imdb_id: imdb,
    kp_id: kp,
    season,
    episode,
    is_anime: detectAnime(card),
    original_language: card.original_language || null,
    genre_ids: Array.isArray(card.genre_ids) ? card.genre_ids.slice() : [],
    title: card.title || card.name || data.title || data.name || null
  };
}

export function getContentId(video) {
  if (!video) return { primary: null, legacy: null };

  const ids = getContentIds();
  const duration = roundDuration(video.duration, 30);
  const legacy = legacyKey(video);

  if (ids.tmdb_id) {
    const s = ids.season === null ? 0 : ids.season;
    const e = ids.episode === null ? 0 : ids.episode;
    return { primary: `tmdb:${ids.tmdb_id}:s${s}:e${e}:d${duration}`, legacy };
  }
  if (ids.imdb_id) {
    const s = ids.season === null ? 0 : ids.season;
    const e = ids.episode === null ? 0 : ids.episode;
    return { primary: `imdb:${ids.imdb_id}:s${s}:e${e}:d${duration}`, legacy };
  }

  if (legacy) return { primary: `src:${legacy}`, legacy };
  return { primary: null, legacy };
}
