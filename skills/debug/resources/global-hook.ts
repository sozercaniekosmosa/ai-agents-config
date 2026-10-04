// === START DEBUG AGENT ===
/* eslint-disable */
/* [DEBUG-HOOK] Safe log, error, promise, & SVG snapshot collector */
if (typeof window !== 'undefined' && !Reflect.get(window, '__DEBUG_HOOK__')) {
  Reflect.set(window, '__DEBUG_HOOK__', true);
  
  const safeStringify = (val: any, depth = 0): string => {
    if (depth > 2) return '"[Object]"';
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'bigint') return `"${val.toString()}"`;
    if (typeof val === 'function') return '"[Function]"';
    if (typeof Node !== 'undefined' && val instanceof Node) return `"[DOMNode: ${val.nodeName}]"`;
    if (typeof val !== 'object') return JSON.stringify(val);
    
    if (Array.isArray(val)) {
      return '[' + val.map(x => safeStringify(x, depth + 1)).join(',') + ']';
    }
    
    try {
      const keys = Object.keys(val);
      const parts = keys.map(k => `${JSON.stringify(k)}:${safeStringify(val[k], depth + 1)}`);
      return '{' + parts.join(',') + '}';
    } catch (e) {
      return '"[Unserializable]"';
    }
  };

  const send = (tag: string, args: any[]) => {
    try {
      const body = `[${tag}] ` + args.map(obj => safeStringify(obj)).join(' ');
      fetch('http://127.0.0.1:9998/log', { method: 'POST', body }).catch(() => {});
    } catch (e) { /* ignore */ }
  };

  const takeSnapshot = () => {
    try {
      const svgEl = document.querySelector('svg');
      if (svgEl) {
        fetch('http://127.0.0.1:9998/snapshot', { method: 'POST', body: svgEl.outerHTML }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  };

  // Console logs override
  const _log = console.log;
  const _err = console.error;
  console.log = (...args: any[]) => {
    _log(...args);
    if (typeof args[0] === 'string' && args[0].includes('[DEBUG')) {
      send('LOG', args);
    }
  };
  console.error = (...args: any[]) => {
    _err(...args);
    send('ERROR', args);
  };

  // Global errors & Promise rejections
  window.addEventListener('error', (e) => {
    const cleanFile = (e.filename || '').replace(/(\.tsx?|\.jsx?)\?t=\d+/, '$1');
    send('UNCAUGHT_ERROR', [e.message, `${cleanFile}:${e.lineno}`]);
    takeSnapshot(); // Авто-снимок при ошибке
  });
  window.addEventListener('unhandledrejection', (e) => {
    send('UNHANDLED_PROMISE', [e.reason?.message || e.reason, e.reason?.stack]);
    takeSnapshot(); // Авто-снимок при ошибке
  });
}
/* eslint-enable */
// === END DEBUG AGENT ===
