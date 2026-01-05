import { ensureSkipButtonStyles } from './styles.js';

export class SkipButton {
  constructor({ text = 'Пропустить', onClick }) {
    this.text = text;
    this.onClick = onClick;

    this.el = null;
    this._handleClick = () => {
      if (this.onClick) this.onClick();
    };
  }

  ensure() {
    if (this.el) return this.el;
    ensureSkipButtonStyles();

    const button = document.createElement('div');
    button.className = 'al-autoskip-btn';
    button.textContent = this.text;
    button.addEventListener('click', this._handleClick);
    document.body.appendChild(button);

    this.el = button;
    return button;
  }

  isVisible() {
    return !!this.el && this.el.classList.contains('is-visible');
  }

  show() {
    const el = this.ensure();
    el.style.display = '';
    el.classList.add('is-visible');
  }

  hide() {
    if (!this.el) return;
    this.el.classList.remove('is-visible', 'is-animating');
  }

  restartAnimation() {
    if (!this.el) return;
    this.el.classList.remove('is-animating');
    void this.el.offsetWidth;
    this.el.classList.add('is-animating');
  }

  destroy() {
    if (!this.el) return;
    this.el.removeEventListener('click', this._handleClick);
    this.el.remove();
    this.el = null;
  }
}

