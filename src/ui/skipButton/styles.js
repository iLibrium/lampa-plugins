export const SKIP_BUTTON_STYLE_ID = 'al-autoskip-style';

export function ensureSkipButtonStyles() {
  if (document.getElementById(SKIP_BUTTON_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = SKIP_BUTTON_STYLE_ID;
  style.textContent = `
    .al-autoskip-btn {
      position: fixed;
      right: 40px;
      bottom: 120px;
      width: 132px;
      height: 132px;
      border-radius: 50%;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.65);
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      text-align: center;
      z-index: 9999;
      border: 2px solid rgba(255, 255, 255, 0.2);
      box-sizing: border-box;
      cursor: pointer;
    }
    .al-autoskip-btn.is-visible {
      display: flex;
    }
    .al-autoskip-btn::before {
      content: "";
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      background: conic-gradient(#4CAF50 0deg, rgba(76, 175, 80, 0.25) 0deg);
      mask: radial-gradient(farthest-side, transparent calc(100% - 10px), #000 calc(100% - 9px));
      opacity: 0;
    }
    .al-autoskip-btn.is-animating::before {
      opacity: 1;
      animation: al-autoskip-progress 5s linear forwards;
    }
    @keyframes al-autoskip-progress {
      from {
        background: conic-gradient(#4CAF50 0deg, rgba(76, 175, 80, 0.25) 0deg);
      }
      to {
        background: conic-gradient(#4CAF50 360deg, rgba(76, 175, 80, 0.25) 360deg);
      }
    }
  `;

  document.head.appendChild(style);
}

