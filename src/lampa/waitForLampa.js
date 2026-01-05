export function waitForLampa({
  predicate,
  onReady,
  onTimeout,
  checkInterval = 500,
  maxAttempts = 20,
  log = null
}) {
  let attempts = 0;

  const check = () => {
    let ready = false;
    try {
      ready = predicate();
    } catch (err) {
      if (log) log('warn', 'Lampa readiness check threw:', err);
    }

    if (ready) {
      onReady();
      return;
    }

    if (attempts++ < maxAttempts) {
      setTimeout(check, checkInterval);
      return;
    }

    if (onTimeout) onTimeout();
  };

  check();
}

