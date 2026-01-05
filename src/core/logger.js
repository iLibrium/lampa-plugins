export function createLogger({ tag }) {
  return function log(level, message, extra = undefined) {
    const fn = console[level] || console.log;
    const prefix = `${tag} `;
    if (extra !== undefined) fn.call(console, `${prefix}${message}`, extra);
    else fn.call(console, `${prefix}${message}`);
  };
}

