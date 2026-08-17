import { isInitSegment, isMediaSegment } from './fmp4.js';

/**
 * Подглядывание за тем, что плеер кладёт в MSE.
 *
 * На HLS-источниках hls.js разбирает поток на отдельные дорожки и отдаёт звук
 * собственным SourceBuffer — по ~20 КБ на секунду против мегабайт видео, и на
 * десятки секунд впереди позиции зрителя. Эти байты уже скачаны, поэтому
 * заглядывание вперёд достаётся без единого дополнительного запроса.
 *
 * Метод глобальный и лежит на пути воспроизведения, поэтому правила жёсткие:
 * оригинал вызывается всегда и с теми же аргументами, любая наша ошибка
 * гасится молча, ничего тяжёлого внутри не делается — только копирование
 * байтов в очередь, разбор идёт снаружи.
 */

const TAP_FLAG = '__autoskipTap';

export class MseTap {
  constructor({ log, wantsMore, onSegment, maxBytes = 24 * 1024 * 1024 } = {}) {
    this.log = log || (() => {});
    this.wantsMore = wantsMore || (() => false);
    this.onSegment = onSegment || (() => {});
    this.maxBytes = maxBytes;

    this._installed = false;
    this._origAppend = null;
    this._origAddSourceBuffer = null;
    this._init = null;
    this._bytes = 0;
    this._seenAudioBuffer = false;
  }

  isInstalled() { return this._installed; }
  hasInitSegment() { return !!this._init; }
  getInitSegment() { return this._init; }
  sawAudioBuffer() { return this._seenAudioBuffer; }

  install() {
    if (this._installed) return true;
    if (typeof window === 'undefined') return false;
    const SB = window.SourceBuffer;
    const MS = window.MediaSource;
    if (!SB || !SB.prototype || !SB.prototype.appendBuffer) return false;
    if (!MS || !MS.prototype || !MS.prototype.addSourceBuffer) return false;

    // Lampa вставляет тег плагина по нескольку раз. Второй перехват поверх
    // первого только удвоил бы работу на пути воспроизведения.
    if (SB.prototype.appendBuffer[TAP_FLAG]) return false;

    const self = this;
    this._origAppend = SB.prototype.appendBuffer;
    this._origAddSourceBuffer = MS.prototype.addSourceBuffer;

    const addOrig = this._origAddSourceBuffer;
    const patchedAdd = function (mime) {
      const sb = addOrig.apply(this, arguments);
      try { if (sb) sb.__autoskipMime = String(mime || ''); } catch (e) { /* noop */ }
      return sb;
    };
    patchedAdd[TAP_FLAG] = true;

    const appendOrig = this._origAppend;
    const patchedAppend = function (data) {
      try { self._observe(this, data); } catch (e) { /* никогда не мешаем плееру */ }
      return appendOrig.apply(this, arguments);
    };
    patchedAppend[TAP_FLAG] = true;

    MS.prototype.addSourceBuffer = patchedAdd;
    SB.prototype.appendBuffer = patchedAppend;
    this._installed = true;
    return true;
  }

  uninstall() {
    if (!this._installed) return;
    try {
      // Возвращаем оригинал только если сверху никто не встроился после нас:
      // иначе мы снесли бы чужой перехват вместе со своим.
      if (window.SourceBuffer.prototype.appendBuffer[TAP_FLAG]) {
        window.SourceBuffer.prototype.appendBuffer = this._origAppend;
      }
      if (window.MediaSource.prototype.addSourceBuffer[TAP_FLAG]) {
        window.MediaSource.prototype.addSourceBuffer = this._origAddSourceBuffer;
      }
    } catch (e) { /* noop */ }
    this._installed = false;
    this._origAppend = null;
    this._origAddSourceBuffer = null;
    this._init = null;
    this._bytes = 0;
  }

  _observe(sourceBuffer, data) {
    const mime = (sourceBuffer && sourceBuffer.__autoskipMime) || '';
    if (mime.indexOf('audio') !== 0) return;
    this._seenAudioBuffer = true;

    // Init нужен всегда — без него медиа-сегмент не самодостаточен. Остальное
    // копируем, только пока потребитель просит: дальше перехват бесплатный.
    const needInit = !this._init;
    if (!needInit && !this.wantsMore()) return;
    if (this._bytes >= this.maxBytes) return;

    const view = toUint8(data);
    if (!view || !view.length) return;

    if (isInitSegment(view)) {
      if (needInit) this._init = view.slice(0);
      return;
    }
    if (!needInit && isMediaSegment(view)) {
      const copy = view.slice(0);
      this._bytes += copy.length;
      this.onSegment(copy, mime);
    }
  }
}

function toUint8(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}
