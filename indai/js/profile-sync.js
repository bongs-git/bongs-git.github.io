import { relay } from './relay.js';

// Serialize each device's edits and merge the server copy before publishing them.
// Unknown profile keys remain local until the backend enables the agreed contract.
export function profileSync(app, key, read, merge) {
  const storageKey = `indai.web.${key}.pending`;
  let pending = false, generation = 0;
  try { pending = localStorage.getItem(storageKey) === '1'; } catch {}
  let timer = 0, busy = false, retryAt = 0;
  const state = { note: '', syncedAt: 0 };
  const show = (note) => { state.note = note; app.markDirty('settings'); app.markDirty('ideas'); app.markDirty('chart'); };
  async function refresh() {
    clearTimeout(timer);
    if (busy || app.locked || app.feed.status.mode === 'demo' || !app.settings.researchPass || Date.now() < retryAt) return;
    if (read() === null) return;
    busy = true;
    const before = generation;
    try {
      const remote = await relay.brain({ mode: 'profile', op: 'get', key }, app.settings.researchPass);
      merge(remote.value);
      if (pending) {
        const value = read();
        if (value === null) return;
        const saved = await relay.brain({ mode: 'profile', op: 'put', key, value }, app.settings.researchPass);
        merge(saved.value);
        if (before === generation) {
          pending = false;
          localStorage.removeItem(storageKey);
        }
      }
      retryAt = 0;
      state.syncedAt = Date.now();
      show('Saved to your account.');
    } catch (error) {
      retryAt = Date.now() + 60000;
      show(error.code === 'bad_key' ? 'Saved on this device. Account sync is waiting for backend support.'
        : 'Saved on this device. Account sync will retry when connected.');
    } finally {
      busy = false;
      if (before !== generation) queue();
    }
  }
  function queue() {
    pending = true;
    generation++;
    try { localStorage.setItem(storageKey, '1'); } catch { /* still retained for this visit */ }
    show('Saved on this device. Waiting to sync.');
    clearTimeout(timer);
    timer = setTimeout(refresh, Math.max(600, retryAt - Date.now()));
  }
  window.addEventListener('online', () => { retryAt = 0; refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  setTimeout(refresh, 2000);
  return { state, queue, refresh };
}
