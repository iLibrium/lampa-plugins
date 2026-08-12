export const SKIP_PROMPT_STYLE_ID = 'al-autoskip-prompt-style';

export function ensureSkipPromptStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SKIP_PROMPT_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = SKIP_PROMPT_STYLE_ID;
  style.textContent = `
    .autoskip-prompt {
      --autoskip-accent: #FF8A00;
      --autoskip-progress-duration: 5000ms;
      --autoskip-ease: cubic-bezier(0.22, 0.9, 0.3, 1);

      position: fixed;
      right: 2.4em;
      bottom: 7.2em;
      z-index: 60;

      display: flex;
      align-items: center;
      gap: 0.7em;

      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translate3d(0, 1.1em, 0);
      transition:
        opacity 200ms linear,
        transform 280ms var(--autoskip-ease),
        visibility 0s linear 280ms;
      will-change: transform, opacity;
    }
    .autoskip-prompt.is-visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translate3d(0, 0, 0);
      transition-delay: 0s;
    }

    .autoskip-prompt .selector {
      position: relative;
      overflow: hidden;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.62em 1.25em;
      border-radius: 0.6em;
      background: rgba(28, 28, 30, 0.86);
      color: #fff;
      font-weight: 500;
      white-space: nowrap;
      transform: translate3d(0, 0, 0);
      transition:
        transform 180ms var(--autoskip-ease),
        background-color 180ms linear,
        color 180ms linear;
    }
    .autoskip-prompt .selector.focus {
      background: #fff;
      color: #101010;
      transform: translate3d(0, 0, 0) scale(1.06);
      box-shadow: 0 0 0 0.16em rgba(255, 255, 255, 0.22);
    }

    .autoskip-prompt__cancel {
      opacity: 0;
      transition:
        opacity 200ms linear 90ms,
        transform 180ms var(--autoskip-ease),
        background-color 180ms linear,
        color 180ms linear;
    }
    .autoskip-prompt.is-visible .autoskip-prompt__cancel {
      opacity: 1;
    }

    .autoskip-prompt__skip-label {
      position: relative;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      gap: 0.45em;
    }

    .autoskip-prompt__confidence-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.55em;
      height: 1.55em;
      padding: 0 0.35em;
      border-radius: 0.8em;
      font-size: 0.78em;
      font-weight: 700;
      line-height: 1;
      background: rgba(0, 0, 0, 0.22);
      color: inherit;
      opacity: 0.9;
    }
    .autoskip-prompt .selector:not(.focus) .autoskip-prompt__confidence-mark {
      background: rgba(255, 255, 255, 0.2);
    }

    .autoskip-prompt__skip::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 45%;
      height: 100%;
      background: linear-gradient(
        100deg,
        rgba(255, 138, 0, 0) 0%,
        rgba(255, 138, 0, 0.45) 50%,
        rgba(255, 138, 0, 0) 100%
      );
      transform: translate3d(-170%, 0, 0);
      opacity: 0;
      pointer-events: none;
      z-index: 1;
    }
    .autoskip-prompt.is-visible .autoskip-prompt__skip::before {
      animation: autoskip-shine 780ms var(--autoskip-ease) 160ms 1;
    }
    @keyframes autoskip-shine {
      0%   { transform: translate3d(-170%, 0, 0); opacity: 0; }
      35%  { opacity: 1; }
      100% { transform: translate3d(330%, 0, 0); opacity: 0; }
    }

    .autoskip-prompt__progress {
      /* Мягкий хвост справа — иначе граница заливки читается как артефакт. */
      --autoskip-fill: rgba(255, 138, 0, 0.34);
      --autoskip-fill-edge: rgba(255, 138, 0, 0.10);
      --autoskip-bar: var(--autoskip-accent);

      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(
        to right,
        var(--autoskip-fill) 0%,
        var(--autoskip-fill) 86%,
        var(--autoskip-fill-edge) 100%
      );
      transform: scaleX(0);
      transform-origin: left center;
      will-change: transform;
      pointer-events: none;
      z-index: 0;
    }
    .autoskip-prompt__progress::after {
      content: '';
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 0.26em;
      background: var(--autoskip-bar);
    }
    .autoskip-prompt.is-counting .autoskip-prompt__progress {
      animation: autoskip-progress var(--autoskip-progress-duration) linear forwards;
    }
    .autoskip-prompt.is-counting.is-paused .autoskip-prompt__progress {
      animation-play-state: paused;
    }
    @keyframes autoskip-progress {
      from { transform: scaleX(0); }
      to   { transform: scaleX(1); }
    }

    .autoskip-prompt--confidence-low .autoskip-prompt__progress {
      --autoskip-fill: rgba(255, 138, 0, 0.18);
      --autoskip-fill-edge: rgba(255, 138, 0, 0.06);
      --autoskip-bar: rgba(255, 138, 0, 0.6);
    }
    .autoskip-prompt--confidence-medium .autoskip-prompt__progress {
      --autoskip-fill: rgba(255, 138, 0, 0.28);
      --autoskip-fill-edge: rgba(255, 138, 0, 0.08);
    }
    /* На несфокусированной кнопке плотная оранжевая заливка выглядит грязно. */
    .autoskip-prompt .selector:not(.focus) .autoskip-prompt__progress {
      --autoskip-fill: rgba(255, 165, 60, 0.16);
      --autoskip-fill-edge: rgba(255, 165, 60, 0.05);
    }

    @media (prefers-reduced-motion: reduce) {
      .autoskip-prompt {
        transform: none;
        transition: opacity 120ms linear, visibility 0s linear 120ms;
      }
      .autoskip-prompt.is-visible {
        transform: none;
      }
      .autoskip-prompt.is-visible .autoskip-prompt__skip::before {
        animation: none;
      }
      .autoskip-prompt .selector.focus {
        transform: none;
      }
    }
  `;

  document.head.appendChild(style);
}
