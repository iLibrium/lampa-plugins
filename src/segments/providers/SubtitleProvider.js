import { ProviderBase } from './ProviderBase.js';
import { computeMedian } from '../ranges.js';

const MUSIC_MARKERS = /[♪♫♬♩]|\[(music|opening|theme|song|musical|opening theme|theme song|intro)\]|\((music|theme|opening|musical|opening theme|theme song)\)|♪|♫|♬|♩/i;
const RECAP_MARKERS = /\bpreviously on\b|ранее в|в предыдущ|в прошлы(й|х) сери/i;
const CREDITS_MARKERS_EN = /\b(directed by|created by|written by|produced by|executive producer|cast|music by|edited by|editor|cinematography|director of photography|costumes by|production designer|original music)\b/i;
// Граница слова \b в JavaScript определена через ASCII-класс \w, поэтому перед
// кириллицей она не срабатывает никогда — даже под флагом u. С прежним \b(…)\b
// ни один русский маркер титров не мог совпасть в принципе.
const CREDITS_MARKERS_RU = /(?:^|[^\p{L}])(режиссёр|режиссер|сценар|продюсер|оператор|композитор|производство|в ролях|монтаж)/iu;

const COLLECTION_RETRIES = 12;
const COLLECTION_INTERVAL_MS = 600;
const MIN_INTRO_LEN_SEC = 8;
const MIN_RECAP_LEN_SEC = 10;
const SILENCE_GAP_FOR_CREDITS_SEC = 75;

// Детект вступления по провалу реплик. Заставка почти всегда выглядит в
// субтитрах как длинная тишина между репликами: маркеры «♪» есть далеко не
// везде, а вот провал есть практически всегда.
const INTRO_ZONE_MAX_SEC = 600;
// 45 с выбраны по замерам: провал короче почти всегда оказывается тихой сценой,
// а не заставкой. Короткие вступления на 30 с мы сознательно пропускаем — их
// обычно закрывают главы и внешние базы, и сидеть в них не так долго.
const MIN_GAP_INTRO_SEC = 45;
const MAX_GAP_INTRO_SEC = 180;
// Заставка идёт в начале серии. Без этого окна под определение попадала любая
// тихая сцена в первой трети хронометража.
const MAX_INTRO_START_SEC = 240;
// Заставка в самом начале, до первой реплики, — обычно опенинг на 60–90 с.
const MAX_LEADING_GAP_INTRO_SEC = 130;
// Провал должен резко выделяться на фоне обычных пауз дорожки, иначе
// разрежённые субтитры дадут ложное срабатывание на любой тихой сцене.
const GAP_MEDIAN_RATIO = 4;
const MIN_CUES_FOR_GAP = 3;

// Реплики с маркерами разбросаны по всей серии: «♪» стоит и у заставки, и у
// песни в середине, «продюсер» встречается и в диалоге. Схлопывать их в один
// диапазон нельзя — min..max давал бы пропуск на пол-эпизода, причём с правом
// на автопропуск. Поэтому совпадения сначала собираются в кластеры подряд
// идущих реплик, и выбор идёт между кластерами.
const MUSIC_CLUSTER_GAP_SEC = 12;
const RECAP_CLUSTER_GAP_SEC = 15;
const CREDITS_CLUSTER_GAP_SEC = 40;
// Титры обязаны доходить до конца серии, иначе это просто разговор про кино.
const CREDITS_TAIL_TOLERANCE_SEC = 90;
const CREDITS_LONE_CUE_TAIL_FRACTION = 0.85;

function clusterCues(cues, maxGapSec) {
  const sorted = cues.slice().sort((a, b) => a.start - b.start);
  const clusters = [];
  for (const cue of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && cue.start - last.end <= maxGapSec) {
      last.end = Math.max(last.end, cue.end);
      last.count += 1;
    } else {
      clusters.push({ start: cue.start, end: cue.end, count: 1 });
    }
  }
  return clusters;
}

function longestCluster(clusters) {
  if (!clusters.length) return null;
  return clusters.reduce((best, c) => {
    const len = c.end - c.start;
    const bestLen = best.end - best.start;
    if (len > bestLen) return c;
    if (len === bestLen && c.start < best.start) return c;
    return best;
  });
}

function getLampaPlayerListener() {
  if (typeof Lampa === 'undefined') return null;
  if (!Lampa.Player || !Lampa.Player.listener) return null;
  return Lampa.Player.listener;
}

function maybeFetchSubtitleUrl(url, timeoutMs = 6000) {
  if (typeof fetch !== 'function') return Promise.resolve(null);
  if (!url || typeof url !== 'string') return Promise.resolve(null);

  let timer = null;
  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  const opts = { method: 'GET', mode: 'cors', credentials: 'omit' };
  if (ctrl) {
    opts.signal = ctrl.signal;
    timer = setTimeout(() => { try { ctrl.abort(); } catch (e) { /* noop */ } }, timeoutMs);
  }

  return fetch(url, opts)
    .then((res) => res.ok ? res.text() : null)
    .catch(() => null)
    .finally(() => { if (timer) clearTimeout(timer); });
}

function parseTimestamp(input) {
  if (!input) return NaN;
  const cleaned = String(input).trim().replace(',', '.');
  const m = cleaned.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return NaN;
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

function parseSrtOrVtt(text) {
  if (!text || typeof text !== 'string') return [];
  const cues = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line === 'WEBVTT' || line.startsWith('NOTE') || line.startsWith('STYLE')) { i += 1; continue; }
    let timecode = line;
    if (!/-->/.test(timecode)) {
      i += 1;
      if (i >= lines.length) break;
      timecode = lines[i].trim();
      if (!/-->/.test(timecode)) continue;
    }
    const parts = timecode.split('-->');
    if (parts.length < 2) { i += 1; continue; }
    const start = parseTimestamp(parts[0].trim());
    const end = parseTimestamp(parts[1].trim().split(' ')[0]);
    i += 1;
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '') {
      buf.push(lines[i]);
      i += 1;
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      cues.push({ start, end, text: buf.join('\n') });
    }
    while (i < lines.length && lines[i].trim() === '') i += 1;
  }
  return cues;
}

export class SubtitleProvider extends ProviderBase {
  constructor({ log, getSettings }) {
    super({ name: 'subtitle', log });
    this.getSettings = getSettings || (() => ({}));
    this._listenerRefs = [];
  }

  isApplicable(ctx) {
    if (!ctx || !ctx.video) return false;
    if (typeof document === 'undefined') return false;
    return true;
  }

  async run(ctx, onUpdate) {
    const video = ctx.video;
    const debug = !!this.getSettings().debug;
    const cues = await this._collectCues(video);
    if (this.cancelled) return;
    if (!cues || !cues.length) {
      if (debug) {
        const reason = (video && video.customSubs && video.customSubs.length)
          ? 'customSubs URL not fetchable / not parsed'
          : (video && video.textTracks && video.textTracks.length)
            ? 'textTracks empty (no cues)'
            : 'no subtitle tracks attached';
        this.log('log', `subtitle provider: no cues collected — ${reason}.`);
      }
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) return;

    const { ranges, strategy } = this._analyse(cues, duration);
    if (!ranges.intro.length && !ranges.credits.length) {
      if (debug) this.log('log', `subtitle provider: ${cues.length} cues collected, no markers and no dialogue gap matched.`);
      return;
    }

    if (debug) {
      this.log('log', `subtitle provider: ${cues.length} cues, segments`, {
        intro: ranges.intro,
        credits: ranges.credits,
        strategy
      });
    }

    // Найденное по маркерам и выведенное из провала реплик уходят разными
    // источниками: у них разная надёжность и разное право на автопропуск.
    const byGap = strategy.intro === 'dialogue-gap';
    const marked = {
      intro: byGap ? [] : ranges.intro,
      credits: ranges.credits
    };

    if (marked.intro.length || marked.credits.length) {
      onUpdate(marked, { confidence: 'medium', source: 'subtitle', cues: cues.length, strategy });
    }
    if (byGap) {
      onUpdate({ intro: ranges.intro, credits: [] }, {
        confidence: 'low',
        source: 'subtitle_gap',
        cues: cues.length,
        strategy
      });
    }
  }

  async _collectCues(video) {
    for (let attempt = 0; attempt < COLLECTION_RETRIES; attempt += 1) {
      if (this.cancelled) return null;
      const direct = this._extractTextTracksCues(video);
      if (direct && direct.length) return direct;
      const lampaCues = await this._extractLampaCues(video);
      if (this.cancelled) return null;
      if (lampaCues && lampaCues.length) return lampaCues;
      await new Promise((r) => setTimeout(r, COLLECTION_INTERVAL_MS));
    }
    return null;
  }

  _extractTextTracksCues(video) {
    if (!video || !video.textTracks) return null;
    const result = [];
    for (let i = 0; i < video.textTracks.length; i += 1) {
      const track = video.textTracks[i];
      if (!track) continue;
      if (track.kind && track.kind !== 'subtitles' && track.kind !== 'captions') continue;
      const cues = track.cues;
      if (!cues || !cues.length) continue;
      for (let j = 0; j < cues.length; j += 1) {
        const cue = cues[j];
        if (!cue) continue;
        const start = Number(cue.startTime);
        const end = Number(cue.endTime);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        result.push({ start, end, text: cue.text || '' });
      }
    }
    return result.length ? result : null;
  }

  async _extractLampaCues(video) {
    const customSubs = video && video.customSubs;
    if (!customSubs || !customSubs.length) return null;
    const active = customSubs.find((s) => s && (s.mode === 'showing' || s.active === true)) || customSubs[0];
    if (!active || !active.url) return null;

    const text = await maybeFetchSubtitleUrl(active.url);
    if (!text) return null;
    const cues = parseSrtOrVtt(text);
    return cues.length ? cues : null;
  }

  _analyse(cues, duration) {
    const ranges = { intro: [], credits: [] };
    const strategy = { intro: null, credits: null };
    const introZone = duration * 0.30;
    const creditsZone = duration * 0.70;

    const introMusic = cues.filter((c) => c.start <= introZone && MUSIC_MARKERS.test(c.text));
    if (introMusic.length) {
      const inZone = clusterCues(introMusic, MUSIC_CLUSTER_GAP_SEC)
        // Заставка стоит в начале серии. Кластер «♪» на четвёртой минуте —
        // это песня в кадре, и пропускать её никто не просил.
        .filter((c) => c.start <= Math.min(introZone, MAX_INTRO_START_SEC))
        .filter((c) => (c.end - c.start) >= MIN_INTRO_LEN_SEC);
      const best = longestCluster(inZone);
      if (best) {
        ranges.intro.push({ start: best.start, end: best.end });
        strategy.intro = 'music-markers';
      }
    }

    if (!ranges.intro.length) {
      // Рекап — плотный блок реплик, начинающийся с маркера: сам маркер это
      // одна короткая строка, границей служит первый заметный перерыв.
      const recapMarker = cues
        .filter((c) => c.start <= introZone && RECAP_MARKERS.test(c.text))
        .sort((a, b) => a.start - b.start)[0];
      if (recapMarker) {
        const fromMarker = cues.filter((c) => c.start >= recapMarker.start && c.start <= introZone);
        const block = clusterCues(fromMarker, RECAP_CLUSTER_GAP_SEC)[0];
        if (block && (block.end - block.start) >= MIN_RECAP_LEN_SEC) {
          ranges.intro.push({ start: block.start, end: block.end });
          strategy.intro = 'recap-markers';
        }
      }
    }

    if (!ranges.intro.length) {
      const gap = this._findIntroByDialogueGap(cues, duration);
      if (gap) {
        ranges.intro.push({ start: gap.start, end: gap.end });
        strategy.intro = 'dialogue-gap';
      }
    }

    const creditsCue = cues.filter((c) => c.start >= creditsZone && (CREDITS_MARKERS_EN.test(c.text) || CREDITS_MARKERS_RU.test(c.text)));
    const creditsBlock = creditsCue.length
      ? clusterCues(creditsCue, CREDITS_CLUSTER_GAP_SEC)
        // Настоящие титры тянутся до конца файла. Одинокое «продюсер»,
        // сказанное в диалоге на 71-й минуте, титрами не является — иначе
        // пропуск съел бы почти треть серии.
        .filter((c) => (duration - c.end) <= CREDITS_TAIL_TOLERANCE_SEC)
        .filter((c) => c.count > 1 || c.start >= duration * CREDITS_LONE_CUE_TAIL_FRACTION)
        .sort((a, b) => a.start - b.start)[0]
      : null;

    if (creditsBlock) {
      ranges.credits.push({ start: creditsBlock.start, end: duration });
      strategy.credits = 'credits-markers';
    } else {
      const lastBody = cues.filter((c) => c.end < creditsZone).pop();
      const tailCues = cues.filter((c) => c.start >= creditsZone);
      if (!tailCues.length && lastBody && (duration - lastBody.end) >= SILENCE_GAP_FOR_CREDITS_SEC) {
        ranges.credits.push({ start: lastBody.end + 5, end: duration });
        strategy.credits = 'tail-silence';
      }
    }

    return { ranges, strategy };
  }

  /**
   * Ищет вступление как самый длинный провал между репликами в начале серии.
   * Границы провала — это конец последней реплики перед заставкой и начало
   * первой после неё, то есть пропуск попадает ровно на возобновление диалога.
   */
  _findIntroByDialogueGap(cues, duration) {
    const zoneEnd = Math.min(duration * 0.30, INTRO_ZONE_MAX_SEC);
    const zone = cues
      .filter((c) => c.start < zoneEnd)
      .slice()
      .sort((a, b) => a.start - b.start);
    if (zone.length < MIN_CUES_FOR_GAP) return null;

    // Виртуальная реплика в нуле: заставка часто идёт до первого диалога.
    const points = [{ start: 0, end: 0 }].concat(zone);

    const gaps = [];
    for (let i = 1; i < points.length; i += 1) {
      const len = points[i].start - points[i - 1].end;
      if (len > 0) gaps.push({ start: points[i - 1].end, end: points[i].start, len });
    }
    if (!gaps.length) return null;

    const median = computeMedian(gaps.map((g) => g.len));
    const best = gaps.reduce((a, b) => (b.len > a.len ? b : a));

    if (best.len < MIN_GAP_INTRO_SEC) return null;
    if (best.len > MAX_GAP_INTRO_SEC) return null;
    if (best.start > MAX_INTRO_START_SEC) return null;
    if (best.start <= 0 && best.len > MAX_LEADING_GAP_INTRO_SEC) return null;
    if (median > 0 && best.len < median * GAP_MEDIAN_RATIO) return null;

    return { start: best.start, end: best.end, median };
  }
}
