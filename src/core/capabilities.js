function getLampa() {
  return typeof Lampa !== 'undefined' ? Lampa : null;
}

function probeAudioContext() {
  return typeof (window.AudioContext || window.webkitAudioContext) === 'function';
}

function probeAudioWorklet() {
  return typeof window.AudioWorkletNode !== 'undefined';
}

function probeIndexedDB() {
  if (typeof window.indexedDB === 'undefined') return false;
  try {
    const probe = window.indexedDB.open('autoskip_capability_probe', 1);
    probe.onsuccess = () => {
      try { probe.result && probe.result.close(); } catch (e) { /* noop */ }
      try { window.indexedDB.deleteDatabase('autoskip_capability_probe'); } catch (e) { /* noop */ }
    };
    probe.onerror = () => { /* noop */ };
    return true;
  } catch (e) {
    return false;
  }
}

function probeLocalStorage() {
  try {
    const k = '__autoskip_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

function probeIsTV() {
  const lampa = getLampa();
  try {
    if (lampa && lampa.Platform && typeof lampa.Platform.screen === 'function') {
      return lampa.Platform.screen('tv');
    }
  } catch (e) { /* noop */ }
  return false;
}

export function probe() {
  const lampa = getLampa();
  return {
    audioContext: probeAudioContext(),
    audioWorklet: probeAudioWorklet(),
    indexedDB: probeIndexedDB(),
    localStorage: probeLocalStorage(),
    lampaStorage: !!(lampa && lampa.Storage),
    lampaController: !!(lampa && lampa.Controller && typeof lampa.Controller.add === 'function'),
    lampaLang: !!(lampa && lampa.Lang),
    isTV: probeIsTV()
  };
}
