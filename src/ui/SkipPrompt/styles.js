export const SKIP_PROMPT_STYLE_ID = 'al-autoskip-prompt-style';

export function ensureSkipPromptStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SKIP_PROMPT_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = SKIP_PROMPT_STYLE_ID;
  style.textContent = `
    .player-panel__skip-prompt {
      position: absolute;
      bottom: 100%;
      right: 1.5em;
      margin-bottom: 0.8em;
      display: none;
      align-items: center;
      gap: 0.6em;
      pointer-events: auto;
      z-index: 5;
    }
    .player-panel__skip-prompt.is-visible {
      display: flex;
    }
    .autoskip-prompt__skip {
      position: relative;
      overflow: hidden;
    }
    .autoskip-prompt__progress {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 0.3em;
      background: #FF8A00;
      transform: scaleX(0);
      transform-origin: left center;
      will-change: transform;
      pointer-events: none;
      border-radius: 0 0 1em 1em;
    }
    .autoskip-prompt--standalone {
      position: fixed;
      right: 2em;
      bottom: 2em;
      z-index: 9999;
      margin-bottom: 0;
    }
  `;

  document.head.appendChild(style);
}
