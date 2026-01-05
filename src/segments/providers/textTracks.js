import { INTRO_REGEX, CREDITS_REGEX } from '../constants.js';

export function getRangesFromTextTracks(video) {
  const ranges = { intro: [], credits: [] };
  if (!video || !video.textTracks) return ranges;

  for (let i = 0; i < video.textTracks.length; i += 1) {
    const track = video.textTracks[i];
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

  return ranges;
}

