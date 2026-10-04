// === START DEBUG AGENT ===
/* eslint-disable */
if (typeof window !== 'undefined' && !Reflect.get(window, '__EVENT_MONITOR__')) {
  Reflect.set(window, '__EVENT_MONITOR__', true);
  const _add = window.addEventListener;
  const _remove = window.removeEventListener;
  const activeListeners = new Map();

  window.addEventListener = function() {
    const type = arguments[0];
    const stack = new Error().stack?.split('\n')[2]?.trim() || '';
    const key = `${type} @ ${stack}`;
    activeListeners.set(key, (activeListeners.get(key) || 0) + 1);
    console.log(`[DEBUG_EVENT_LEAK] addEventListener: ${type} (Active count: ${activeListeners.get(key)})`);
    return Reflect.apply(_add, this, arguments);
  };
}
/* eslint-enable */
// === END DEBUG AGENT ===
