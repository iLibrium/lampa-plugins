const CONTROLLER_NAME = 'autoskip_prompt';

function getLampa() {
  return typeof Lampa !== 'undefined' ? Lampa : null;
}

function getNavigator() {
  if (typeof window === 'undefined') return null;
  return window.Navigator || null;
}

function fallbackMove(direction, root) {
  if (!root || !direction) return;
  const list = Array.from(root.querySelectorAll('.selector'));
  if (!list.length) return;
  const current = list.findIndex((el) => el.classList.contains('focus'));
  if (current === -1) {
    list[0].classList.add('focus');
    return;
  }
  let next = current;
  if (direction === 'left') next = Math.max(0, current - 1);
  else if (direction === 'right') next = Math.min(list.length - 1, current + 1);
  if (next === current) return;
  list[current].classList.remove('focus');
  list[next].classList.add('focus');
}

function focusElement(el, root) {
  if (!el) return;
  const lampa = getLampa();
  if (lampa && lampa.Controller && typeof lampa.Controller.collectionFocus === 'function') {
    try {
      lampa.Controller.collectionFocus(el, root);
      return;
    } catch (e) { /* noop */ }
  }
  Array.from(root.querySelectorAll('.selector')).forEach((node) => node.classList.remove('focus'));
  el.classList.add('focus');
}

function setCollection(html) {
  const lampa = getLampa();
  if (!lampa || !lampa.Controller) return false;
  if (typeof lampa.Controller.collectionSet !== 'function') return false;
  try { lampa.Controller.collectionSet(html); return true; } catch (e) { return false; }
}

function moveDirection(direction, root) {
  const navigator = getNavigator();
  if (navigator && typeof navigator.move === 'function') {
    try { navigator.move(direction); return; } catch (e) { /* noop */ }
  }
  const lampa = getLampa();
  if (lampa && lampa.Controller && typeof lampa.Controller.move === 'function') {
    try { lampa.Controller.move(direction); return; } catch (e) { /* noop */ }
  }
  fallbackMove(direction, root);
}

export class PromptController {
  constructor({ root, log, onSkip, onCancel, onLeft, onRight }) {
    this.root = root;
    this.log = log || (() => {});
    this.onSkip = onSkip || (() => {});
    this.onCancel = onCancel || (() => {});
    this.onLeft = onLeft || null;
    this.onRight = onRight || null;
    this.previousController = '';
    this._registered = false;
    this._active = false;
  }

  takeover(initialFocusEl) {
    const lampa = getLampa();
    if (!lampa || !lampa.Controller || typeof lampa.Controller.add !== 'function') {
      // Без Lampa.Controller — напрямую фокусируем элемент.
      focusElement(initialFocusEl, this.root);
      return;
    }

    try {
      const enabled = typeof lampa.Controller.enabled === 'function' ? lampa.Controller.enabled() : null;
      this.previousController = (enabled && enabled.name) || '';
    } catch (e) {
      this.previousController = '';
    }

    if (!this._registered) {
      lampa.Controller.add(CONTROLLER_NAME, {
        toggle: () => {
          if (!setCollection(this.root)) {
            // Если collectionSet не сработал — хотя бы фокус на нужный элемент.
          }
          focusElement(initialFocusEl, this.root);
        },
        left: () => {
          if (this.onLeft) this.onLeft();
          else moveDirection('left', this.root);
        },
        right: () => {
          if (this.onRight) this.onRight();
          else moveDirection('right', this.root);
        },
        up: () => moveDirection('up', this.root),
        down: () => moveDirection('down', this.root),
        enter: () => {
          const focused = this.root.querySelector('.selector.focus');
          const isCancel = focused && focused.classList.contains('autoskip-prompt__cancel');
          if (isCancel) {
            try { this.onCancel(); } finally { this.release(); }
          } else {
            try { this.onSkip(); } finally { this.release(); }
          }
        },
        back: () => {
          try { this.onCancel(); } finally { this.release(); }
        },
        gone: () => {
          // Кто-то снаружи переключил контроллер — отменяем без действий.
          this._active = false;
        }
      });
      this._registered = true;
    }

    try { lampa.Controller.toggle(CONTROLLER_NAME); this._active = true; }
    catch (e) { focusElement(initialFocusEl, this.root); }
  }

  release() {
    if (!this._active) {
      // Лампа уже переключила — ничего не делаем.
      return;
    }
    this._active = false;
    const lampa = getLampa();
    if (!lampa || !lampa.Controller || typeof lampa.Controller.toggle !== 'function') return;
    try {
      const target = this.previousController || 'player';
      lampa.Controller.toggle(target);
    } catch (e) { /* noop */ }
  }

  isActive() {
    return this._active;
  }
}
