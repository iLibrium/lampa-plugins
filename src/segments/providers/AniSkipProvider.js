import { ProviderBase } from './ProviderBase.js';
import { TMDB_TO_MAL } from './aniskip/tmdbToMal.js';

const API_BASE = 'https://api.aniskip.com/v2/skip-times';
const FETCH_TIMEOUT_MS = 8000;

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

function getCardSnapshot() {
  const data = getPlayerData() || {};
  const card = data.movie || data.card || getActivityCard() || {};
  const tmdb = Number(card.id || card.tmdb_id || data.id || NaN);
  const season = Number(data.season_number !== undefined ? data.season_number : data.season);
  const episode = Number(data.episode_number !== undefined ? data.episode_number : data.episode);
  return {
    tmdb: Number.isFinite(tmdb) && tmdb > 0 ? tmdb : null,
    season: Number.isFinite(season) ? season : null,
    episode: Number.isFinite(episode) ? episode : null,
    originalLanguage: card.original_language || null,
    genreIds: Array.isArray(card.genre_ids) ? card.genre_ids : [],
    title: card.original_name || card.name || card.title || ''
  };
}

function readUserMap() {
  const lampa = getLampa();
  if (!lampa || !lampa.Storage || typeof lampa.Storage.get !== 'function') return null;
  try {
    const raw = lampa.Storage.get('autoskip_aniskip_map', null);
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string') return JSON.parse(raw);
  } catch (e) { /* noop */ }
  return null;
}

function resolveMalId(tmdbId) {
  if (!tmdbId) return null;
  const userMap = readUserMap();
  if (userMap && userMap[tmdbId] != null) {
    const num = Number(userMap[tmdbId]);
    if (Number.isFinite(num) && num > 0) return num;
  }
  if (TMDB_TO_MAL[tmdbId] != null) return TMDB_TO_MAL[tmdbId];
  return null;
}

function isLikelyAnime(card) {
  if (!card) return false;
  if (card.originalLanguage === 'ja') return true;
  if (Array.isArray(card.genreIds) && card.genreIds.includes(16)) return true;
  return false;
}

function fetchWithTimeout(url, timeoutMs) {
  if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));

  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  const promise = fetch(url, ctrl ? { signal: ctrl.signal } : undefined);

  if (!ctrl) return promise;

  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return promise.finally(() => clearTimeout(timer));
}

function classifySkipType(skipType) {
  if (!skipType) return null;
  const lowered = String(skipType).toLowerCase();
  if (lowered.includes('op') || lowered === 'opening') return 'intro';
  if (lowered.includes('ed') || lowered === 'ending') return 'credits';
  if (lowered === 'recap' || lowered === 'mixed-op') return 'intro';
  return null;
}

export class AniSkipProvider extends ProviderBase {
  constructor({ log, getSettings }) {
    super({ name: 'aniskip', log });
    this.getSettings = getSettings || (() => ({}));
  }

  isApplicable(ctx) {
    const settings = this.getSettings();
    if (!settings || settings.useAniSkip === false) return false;
    const card = getCardSnapshot();
    if (!card.tmdb) return false;
    if (!isLikelyAnime(card)) return false;
    if (!resolveMalId(card.tmdb)) return false;
    if (card.episode === null) return false;
    if (!ctx || !ctx.video) return false;
    return true;
  }

  async run(ctx, onUpdate) {
    if (typeof fetch !== 'function') return;
    const card = getCardSnapshot();
    const malId = resolveMalId(card.tmdb);
    if (!malId) return;

    const duration = Number.isFinite(ctx.video.duration) ? Math.round(ctx.video.duration) : 0;
    if (duration <= 0) return;

    const url = `${API_BASE}/${malId}/${card.episode}?types[]=op&types[]=ed&episodeLength=${duration}`;

    let response;
    try {
      response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    } catch (e) {
      this.log('warn', 'aniskip fetch failed', e && e.message ? e.message : e);
      return;
    }

    if (this.cancelled) return;
    if (!response || !response.ok) {
      if (response) this.log('warn', `aniskip API responded ${response.status}`);
      return;
    }

    let body;
    try {
      body = await response.json();
    } catch (e) {
      this.log('warn', 'aniskip response not JSON', e);
      return;
    }

    if (!body || body.found === false) return;
    const results = Array.isArray(body.results) ? body.results : [];
    if (!results.length) return;

    const ranges = { intro: [], credits: [] };
    for (const item of results) {
      const kind = classifySkipType(item && item.skipType);
      const interval = item && item.interval;
      if (!kind || !interval) continue;
      const start = Number(interval.startTime);
      const end = Number(interval.endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      ranges[kind].push({ start, end });
    }

    if (!ranges.intro.length && !ranges.credits.length) return;
    if (this.cancelled) return;

    if (this.log) {
      this.log('log', 'aniskip API hit', {
        malId,
        episode: card.episode,
        intro: ranges.intro,
        credits: ranges.credits
      });
    }

    onUpdate(ranges, { source: 'aniskip', malId, episode: card.episode });
  }
}
