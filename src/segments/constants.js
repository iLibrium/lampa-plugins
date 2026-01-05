export const INTRO_REGEX = /(op|opening|intro|вступ|застав)/i;
export const CREDITS_REGEX = /(ed|ending|outro|credits|титр)/i;

export const SEGMENT_KINDS = ['intro', 'credits'];

export function getSegmentKindFromKey(key) {
  if (!key) return null;
  if (INTRO_REGEX.test(key)) return 'intro';
  if (CREDITS_REGEX.test(key)) return 'credits';
  return null;
}

