function getLampa() {
  return typeof Lampa !== 'undefined' ? Lampa : null;
}

function getActivityCard() {
  const lampa = getLampa();
  try {
    if (lampa && lampa.Activity && typeof lampa.Activity.active === 'function') {
      const activity = lampa.Activity.active();
      if (activity && activity.card) return activity.card;
    }
  } catch (e) { /* noop */ }
  return null;
}

function getPlayerData() {
  const lampa = getLampa();
  try {
    if (lampa && lampa.Player && typeof lampa.Player.data === 'function') return lampa.Player.data();
    if (lampa && lampa.Player && typeof lampa.Player.get === 'function') return lampa.Player.get();
  } catch (e) { /* noop */ }
  return null;
}

function hasUsableTimestamps(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

export function hasNativeSkip() {
  const card = getActivityCard();
  if (card && (hasUsableTimestamps(card.skip_timestamps) || hasUsableTimestamps(card.skip))) {
    return true;
  }
  const data = getPlayerData();
  if (data && (hasUsableTimestamps(data.skip_timestamps) || hasUsableTimestamps(data.skip))) {
    return true;
  }
  return false;
}
