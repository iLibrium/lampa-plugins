const PROBE_SIZE = 2;

/**
 * Отвечает на вопрос «сможем ли мы вообще прочитать содержимое этого потока».
 *
 * Тейнт canvas и молчание MediaElementAudioSourceNode управляются одним и тем же
 * флагом CORS-cross-origin, поэтому дешёвая проба одного пикселя отвечает сразу и
 * за картинку, и за звук. Важно спросить это ДО createMediaElementSource: тот
 * необратимо уводит звук элемента в аудиограф, и на закрытом потоке пользователь
 * остаётся в тишине, пока провайдер не сдастся.
 */
export function describeMediaAccess(video) {
  if (!video) return { readable: false, reason: 'нет video-элемента' };

  const src = video.currentSrc || video.src || '';
  if (!src) return { readable: false, retryable: true, reason: 'источник ещё не назначен' };

  // MSE отдаёт blob: собственного origin — байты уже в странице, тейнта нет.
  if (src.indexOf('blob:') === 0) {
    return { readable: true, reason: 'blob (MSE) — данные уже в странице' };
  }

  if (typeof location !== 'undefined') {
    try {
      if (new URL(src, location.href).origin === location.origin) {
        return { readable: true, reason: 'источник того же origin' };
      }
    } catch (e) { /* невалидный URL — падаем в пробу ниже */ }
  }

  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return { readable: false, reason: 'нет document для пробы' };
  }

  // Без декодированного кадра drawImage не бросит исключение и проба соврёт.
  if (video.readyState < 2 || !video.videoWidth) {
    return { readable: false, retryable: true, reason: 'кадр ещё не декодирован' };
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = PROBE_SIZE;
    canvas.height = PROBE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { readable: false, reason: 'нет 2d-контекста' };
    ctx.drawImage(video, 0, 0, PROBE_SIZE, PROBE_SIZE);
    ctx.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE);
    return { readable: true, reason: 'проба чтения прошла' };
  } catch (e) {
    return { readable: false, reason: 'cross-origin без CORS-заголовков' };
  }
}
