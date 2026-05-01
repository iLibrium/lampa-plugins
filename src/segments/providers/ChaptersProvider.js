import { ProviderBase } from './ProviderBase.js';
import { INTRO_REGEX, CREDITS_REGEX } from '../constants.js';

export class ChaptersProvider extends ProviderBase {
  constructor({ log }) {
    super({ name: 'chapters', log });
  }

  isApplicable(ctx) {
    return !!(ctx && ctx.video && ctx.video.textTracks && ctx.video.textTracks.length);
  }

  async run(ctx, onUpdate) {
    const video = ctx && ctx.video;
    if (!video || !video.textTracks) return;

    const ranges = { intro: [], credits: [] };
    const tracks = video.textTracks;

    for (let i = 0; i < tracks.length; i += 1) {
      const track = tracks[i];
      const kind = track.kind || '';
      if (!['chapters', 'metadata', 'subtitles'].includes(kind)) continue;
      const cues = track.cues || [];
      for (let j = 0; j < cues.length; j += 1) {
        const cue = cues[j];
        const text = `${cue.id || ''} ${cue.text || ''}`.trim();
        if (INTRO_REGEX.test(text)) {
          ranges.intro.push({ start: cue.startTime, end: cue.endTime });
        } else if (CREDITS_REGEX.test(text)) {
          ranges.credits.push({ start: cue.startTime, end: cue.endTime });
        }
      }
    }

    if (!ranges.intro.length && !ranges.credits.length) return;
    if (this.cancelled) return;
    onUpdate(ranges, { passive: true });
  }
}
