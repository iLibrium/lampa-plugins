export class VisibilityGuard {
  constructor({ onResume, log }) {
    this.onResume = onResume || (() => {});
    this.log = log || (() => {});
    this._onVisibility = null;
    this._onPageShow = null;
    this._wasHidden = false;
    this._attached = false;
  }

  attach() {
    if (this._attached) return;
    this._attached = true;

    this._onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        this._wasHidden = true;
      } else if (this._wasHidden) {
        this._wasHidden = false;
        try { this.onResume('visibilitychange'); } catch (e) { this.log('warn', 'visibility resume threw', e); }
      }
    };

    this._onPageShow = (event) => {
      if (event && event.persisted) {
        this._wasHidden = false;
        try { this.onResume('pageshow'); } catch (e) { this.log('warn', 'pageshow resume threw', e); }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibility);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pageshow', this._onPageShow);
    }
  }

  detach() {
    if (!this._attached) return;
    if (typeof document !== 'undefined' && this._onVisibility) {
      try { document.removeEventListener('visibilitychange', this._onVisibility); } catch (e) { /* noop */ }
    }
    if (typeof window !== 'undefined' && this._onPageShow) {
      try { window.removeEventListener('pageshow', this._onPageShow); } catch (e) { /* noop */ }
    }
    this._onVisibility = null;
    this._onPageShow = null;
    this._wasHidden = false;
    this._attached = false;
  }
}
