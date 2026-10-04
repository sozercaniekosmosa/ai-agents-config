// === START DEBUG AGENT ===
/* eslint-disable */
if (typeof window !== 'undefined') {
  const store = Reflect.get(window, '__STORE__') || Reflect.get(globalThis, 'useEditorStore') || null;
  if (store && typeof store.subscribe === 'function') {
    store.subscribe((state: any, prevState: any) => {
      const diff: Record<string, any> = {};
      for (const key in state) {
        if (state[key] !== prevState[key]) {
          diff[key] = { from: prevState[key], to: state[key] };
        }
      }
      if (Object.keys(diff).length > 0) {
        console.log('[DEBUG_STATE_CHANGE] Zustand изменился:', JSON.stringify(diff));
      }
    });
  }
}
/* eslint-enable */
// === END DEBUG AGENT ===
