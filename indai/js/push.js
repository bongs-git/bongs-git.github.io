// Push notifications: setup alerts that reach this device when INDAI is closed or the phone is locked.
// The backend does the watching (the indai-push function and its once-a-minute scan of the TradingView bridge candles).
// This file does the website's two jobs:
//   1. register this browser with the backend (and take it off again)
//   2. keep the backend's copy of today's plan, risk state and watchlist current, because that is what it scans with:
//      no plan dated today, a tripped breaker or a cooldown means no pushes, exactly as in the app
// The service worker (sw.js) shows the notification and opens the idea when it is tapped.
import { relay, RELAY_URL, RELAY_ANON } from './relay.js';
import { etParts } from './market.js';

const PUSH_URL = `${RELAY_URL}/functions/v1/indai-push`;
const KEY = 'indai.web.push.v1';
const b64ToBytes = (s) => { const pad = '='.repeat((4 - s.length % 4) % 4), raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };

export function initPush(app) {
  let mem = { endpoint: '', syncedAt: 0, day: '' };
  try { Object.assign(mem, JSON.parse(localStorage.getItem(KEY)) || {}); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch {} };
  const state = { status: 'checking', note: '', busy: false };
  const set = (status, note = '') => { state.status = status; state.note = note; app.markDirty('settings'); app.markDirty('more'); };
  const headers = () => ({ Authorization: `Bearer ${RELAY_ANON}`, apikey: RELAY_ANON, 'Content-Type': 'application/json', ...(app.settings.researchPass ? { 'x-indai-pass': app.settings.researchPass } : {}) });
  async function call(body) {
    const r = await fetch(PUSH_URL, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.message || j.error || `HTTP ${r.status}`); e.code = j.error; e.status = r.status; throw e; }
    return j;
  }
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const needsInstall = () => app.platform?.iOS && !app.platform.standalone;
  async function registration() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 4000))]); } catch { return null; }
  }
  const why = (e) => e.code === 'not_configured' ? ['backend', 'Push is not switched on in the backend yet. It needs its push keys.']
    : e.code === 'passcode' || e.code === 'sign_in_required' || e.code === 'unauthorized' ? ['token', 'Push needs your access token. Set one in the backend, then enter it under Research in Settings.']
    : e.code === 'subscription_in_use' ? ['off', 'This browser is registered to another account. Turn notifications off for this site in the browser, then try again.']
    : ['off', `Could not reach the push service (${e.message}).`];

  // What is true right now, without changing anything.
  async function refresh() {
    if (!supported()) return set(needsInstall() ? 'install' : 'unsupported');
    if (needsInstall()) return set('install');
    if (Notification.permission === 'denied') return set('blocked');
    const reg = await registration();
    if (!reg) return set('unsupported', 'The app is still setting itself up. Reload once and try again.');
    const sub = await reg.pushManager.getSubscription().catch(() => null);
    if (sub && mem.endpoint === sub.endpoint) { set('on'); syncSoon(1500); } else set('off');
  }
  async function enable() {
    if (state.busy) return;
    if (!supported() || needsInstall()) { await refresh(); return; }
    state.busy = true; app.markDirty('settings');
    try {
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm !== 'granted') { set('blocked'); return; }
      const reg = await registration();
      if (!reg) { set('unsupported', 'The app is still setting itself up. Reload once and try again.'); return; }
      let key;
      try { const r = await fetch(PUSH_URL, { headers: headers() }); const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.message || `HTTP ${r.status}`); e.code = j.error; throw e; } key = j.publicKey; }
      catch (e) { set(...why(e)); return; }
      let sub = await reg.pushManager.getSubscription().catch(() => null);
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      try { await call({ op: 'subscribe', subscription: sub.toJSON() }); }
      catch (e) { set(...why(e)); return; }
      mem.endpoint = sub.endpoint; save();
      set('on');
      await sync();
      app.toast('Push notifications are on for this device');
    } catch (e) { set('off', `Could not turn push on (${e.message || e.name}).`); }
    finally { state.busy = false; app.markDirty('settings'); }
  }
  async function disable() {
    if (state.busy) return;
    state.busy = true;
    try {
      const reg = await registration(), sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
      const endpoint = sub?.endpoint || mem.endpoint;
      if (endpoint) await call({ op: 'unsubscribe', endpoint }).catch(() => {});
      if (sub) await sub.unsubscribe().catch(() => {});
      mem.endpoint = ''; save(); set('off');
      app.toast('Push notifications are off for this device');
    } finally { state.busy = false; app.markDirty('settings'); }
  }
  async function test() {
    try { const j = await call({ op: 'test', endpoint: mem.endpoint || undefined }); app.toast(`Test sent to ${j.accepted} device${j.accepted === 1 ? '' : 's'}. It should arrive in a few seconds.`); }
    catch (e) { if (e.code === 'no_subscription' || e.code === 'subscription_expired') { mem.endpoint = ''; save(); set('off', 'This device needs to be registered again.'); } app.toast(e.code === 'rate_limited' ? 'Too many tests in an hour. Try again later.' : `The test did not go out (${e.message}).`); }
  }

  // ---------------------------------------------------------------- the backend's copy of today's plan
  let syncTimer = 0, lastBody = '';
  async function sync() {
    clearTimeout(syncTimer); syncTimer = 0;
    if (state.status !== 'on' || app.locked || app.feed.status.mode === 'demo') return;
    const p = app.activePlan(), d = app.day, r = app.riskState();
    const levels = Object.fromEntries(Object.entries(app.levels || {}).filter(([, v]) => v && (v.cw != null || v.pw != null || v.zg != null)));
    const plan = { date: etParts().ymd, at: Date.now(), aggr: p.aggr, capital: p.capital, goal: p.goal || 0, strategies: p.strategies, pnl: d.pnl || 0, goalHit: !!d.goalHit, tripped: r.state === 'tripped', cooldownUntil: d.cooldownUntil || 0, symbols: app.settings.symbols, ...(Object.keys(levels).length ? { levels } : {}) };
    const body = JSON.stringify({ ...plan, at: 0 });
    if (body === lastBody && Date.now() - mem.syncedAt < 10 * 60e3) return;      // nothing changed and it is fresh
    try {
      await relay.brain({ mode: 'profile', op: 'put', key: 'plan', value: plan }, app.settings.researchPass);
      await relay.brain({ mode: 'profile', op: 'put', key: 'watchlist', value: { symbols: app.settings.symbols } }, app.settings.researchPass);
      lastBody = body; mem.syncedAt = Date.now(); mem.day = plan.date; save();
      if (state.note) set('on');
    } catch (e) { if (e.code === 'passcode' || e.code === 'sign_in_required') set(...why(e)); else state.note = "Couldn't update the backend's copy of your plan just now; it will try again."; app.markDirty('settings'); }
  }
  function syncSoon(ms = 2500) { if (state.status !== 'on') return; clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); }
  setInterval(() => { if (state.status === 'on' && !document.hidden) sync(); }, 5 * 60e3);
  // a logged trade, a tripped breaker, a new plan or a changed watchlist goes to the backend within seconds
  let lastSig = '';
  setInterval(() => {
    if (state.status !== 'on') return;
    const d = app.day, sig = [d.pnl, d.tripped, d.cooldownUntil, d.goalHit, d.plan && [d.plan.aggr, d.plan.capital, d.plan.goal, d.plan.strategies], app.settings.symbols, app.settings.levelsText].join('|');
    if (sig !== lastSig) { const first = !lastSig; lastSig = sig; if (!first) syncSoon(); }
  }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(4000); });

  // a tapped notification brings its ticker up
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (ev) => {
    const m = ev.data || {};
    if (m.type !== 'indai-open' || app.locked) return;
    if (m.symbol && app.settings.symbols.includes(m.symbol)) app.selectSymbol(m.symbol);
    app.catchUpIdeas?.();
    const idea = app.signals.find(x => x.sym === m.symbol && (!m.barT || x.barT === m.barT)) || app.signals.find(x => x.sym === m.symbol);
    app.openIdeas(idea ? idea.id : null);
  });

  app.push = { state, enable, disable, test, refresh, sync: syncSoon, supported, needsInstall };
  setTimeout(refresh, 1500);
}
