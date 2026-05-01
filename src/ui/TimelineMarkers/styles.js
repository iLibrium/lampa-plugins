export const TIMELINE_MARKERS_STYLE_ID = 'al-autoskip-timeline-style';

export function ensureTimelineMarkerStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(TIMELINE_MARKERS_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = TIMELINE_MARKERS_STYLE_ID;
  style.textContent = `
    .player-panel__timeline-segment--autoskip {
      background-color: rgba(255, 138, 0, 0.55);
      pointer-events: none;
    }
    .player-panel__timeline-segment--autoskip-credits {
      background-color: rgba(255, 138, 0, 0.45);
    }
  `;

  document.head.appendChild(style);
}
