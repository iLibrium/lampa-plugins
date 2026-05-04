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
      transition: background-color 0.2s linear;
    }
    .player-panel__timeline-segment--autoskip-credits {
      background-color: rgba(255, 138, 0, 0.45);
    }
    .player-panel__timeline-segment--autoskip-low {
      background-color: rgba(255, 138, 0, 0.28);
    }
    .player-panel__timeline-segment--autoskip-medium {
      background-color: rgba(255, 138, 0, 0.45);
    }
    .player-panel__timeline-segment--autoskip-high {
      background-color: rgba(255, 138, 0, 0.65);
    }
  `;

  document.head.appendChild(style);
}
