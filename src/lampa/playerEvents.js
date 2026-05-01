function getListener() {
  if (typeof Lampa === 'undefined') return null;
  if (!Lampa.Player || !Lampa.Player.listener) return null;
  if (typeof Lampa.Player.listener.follow !== 'function') return null;
  return Lampa.Player.listener;
}

export function followPlayer(events) {
  const listener = getListener();
  if (!listener) return false;
  Object.keys(events || {}).forEach((eventName) => {
    const handler = events[eventName];
    if (typeof handler !== 'function') return;
    try {
      listener.follow(eventName, handler);
    } catch (e) { /* noop */ }
  });
  return true;
}
