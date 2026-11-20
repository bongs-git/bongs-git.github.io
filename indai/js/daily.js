// Daily and weekly candles for the chart, going back years:
//   1. what this device has kept (candle-store.js), shown at once
//   2. INDAI's backend (`indai-market?kind=daily`, CBOE daily history; it sends about a year today and more
//      once the backend honours `days`)
//   3. Twelve Data, when a Twelve Data key is saved in Settings (up to 5,000 daily candles, about 20 years)
// Today's candle is built from today's one-minute candles (or the quote) so it moves with the market.
// In demo mode the history is made up, like everything else there.
import { RELAY_URL, RELAY_ANON } from './relay.js';
import { etParts, sessionTimes, chartSession, marketStatus } from './market.js';
import { emaSet } from './timeframes.js';
import { candleStore } from './candle-store.js';

const DAYS = 6000, DEMO_DAYS = 760;
const ymdOpen = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? sessionTimes(+m[1], +m[2], +m[3]).open : null;
};
// A key per week: the Monday of the candle's New York week, in days since 1970.
function weekKey(b) {
  if (b.wk != null) return b.wk;
  const p = etParts(b.t), day = Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 864e5), dow = (new Date(day * 864e5).getUTCDay() + 6) % 7;
  b.ym = p.y * 12 + p.m - 1;
  return (b.wk = day - dow);
}
function monthKey(b) { if (b.ym == null) weekKey(b); return b.ym; }
export function toWeeks(days) {
  const out = [];
  for (const b of days) {
    const k = weekKey(b), last = out[out.length - 1];
    if (last && last.wk === k) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v += b.v || 0; }
    else out.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, wk: k, ym: monthKey(b) });
  }
  return out;
}

export function initDaily(app) {
  const store = new Map(); // ticker -> { days, loaded, busy, done, failedAt, source, rev, cache }
  const entry = (sym) => { if (!store.has(sym)) store.set(sym, { days: [], loaded: false, busy: false, done: false, failedAt: 0, source: '', rev: 0, cache: {} }); return store.get(sym); };
  const demo = () => app.feed.status.mode === 'demo';
  function merge(e, rows) {
    if (!rows.length) return 0;
    const at = new Map(e.days.map(b => [b.t, b]));
    let n = 0;
    for (const r of rows) if (r && Number.isFinite(r.t) && r.c > 0 && r.o > 0) { if (!at.has(r.t)) n++; at.set(r.t, { t: r.t, o: +r.o, h: Math.max(+r.h, +r.o, +r.c), l: Math.min(+r.l, +r.o, +r.c), c: +r.c, v: +r.v || 0 }); }
    e.days = [...at.values()].sort((a, b) => a.t - b.t);
    e.rev++; e.cache = {};
    return n;
  }
  function demoDays(sym) {
    const today = chartSession().open, q = app.feed.quote(sym), end = q ? q.last : 100;
    let seed = [...sym].reduce((a, c) => a * 31 + c.charCodeAt(0), 11);
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const out = []; let price = end, t = today;
    for (let n = 0; n < DEMO_DAYS; n++) {
      // step back one trading day
      for (let k = 0; k < 6; k++) { t -= 864e5; const p = etParts(t + 6 * 3600e3), s = sessionTimes(p.y, p.m, p.d); if (p.dow !== 0 && p.dow !== 6) { t = s.open; break; } }
      const c = price, o = c * (1 - rnd() * 0.022 - 0.0004), hi = Math.max(o, c) * (1 + Math.abs(rnd()) * 0.012), lo = Math.min(o, c) * (1 - Math.abs(rnd()) * 0.012);
      out.push({ t, o: +o.toFixed(2), h: +hi.toFixed(2), l: +lo.toFixed(2), c: +c.toFixed(2), v: Math.round(4e7 + Math.abs(rnd()) * 6e7) });
      price = o;
    }
    return out.reverse();
  }
  async function fromBackend(sym) {
    const r = await fetch(`${RELAY_URL}/functions/v1/indai-market?kind=daily&symbols=${encodeURIComponent(sym)}&days=${DAYS}`, { headers: { apikey: RELAY_ANON, Authorization: `Bearer ${RELAY_ANON}` } });
    if (!r.ok) throw new Error('daily ' + r.status);
    const j = await r.json(), arr = j && j.daily && j.daily[sym];
    if (!Array.isArray(arr)) throw new Error('daily: none');
    return arr.map(x => Array.isArray(x) ? { t: ymdOpen(x[0]), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] || 0 } : null).filter(b => b && b.t);
  }
  async function fromTwelve(sym) {
    const key = app.settings.twelveKey;
    if (!key) return [];
    const r = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=5000&timezone=America/New_York&apikey=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error('Twelve Data ' + r.status);
    const j = await r.json();
    if (j.status === 'error' || !Array.isArray(j.values)) throw new Error(j.message || 'Twelve Data error');
    return j.values.map(v => ({ t: ymdOpen(v.datetime), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +v.volume || 0 })).filter(b => b.t);
  }
  async function load(sym) {
    const e = entry(sym);
    if (e.busy) return;
    e.busy = true; app.markDirty('chart');
    try {
      if (!e.loaded) { merge(e, await candleStore.daily(sym)); e.loaded = true; app.markDirty('chart'); }
      if (demo()) { merge(e, demoDays(sym)); e.source = 'demo'; e.done = true; }
      else {
        const sources = [];
        const got = await Promise.allSettled([fromBackend(sym), fromTwelve(sym)]);
        got.forEach((g, k) => { if (g.status === 'fulfilled' && g.value.length) { merge(e, g.value); sources.push(k ? 'Twelve Data' : 'CBOE via INDAI'); candleStore.putDaily(sym, g.value); } });
        if (!sources.length && !e.days.length) throw new Error('no daily candles');
        e.source = sources.join(' + ') || 'saved on this device';
        e.done = true; e.failedAt = 0;
      }
    } catch { e.failedAt = Date.now(); }
    e.busy = false; app.markDirty('chart');
  }
  // Today's daily candle from today's minutes (or the quote): the candle that is still forming.
  function today(sym) {
    const sess = chartSession(), mins = app.feed.getBars(sym, '1min'), five = mins.length ? mins : app.feed.getBars(sym, '5min');
    if (five.length) {
      let h = -Infinity, l = Infinity, v = 0;
      for (const b of five) { h = Math.max(h, b.h); l = Math.min(l, b.l); v += b.v || 0; }
      const q = app.feed.quote(sym), c = marketStatus().state === 'open' && q ? q.last : five[five.length - 1].c;
      return { t: sess.open, o: five[0].o, h: Math.max(h, c), l: Math.min(l, c), c, v };
    }
    const q = app.feed.quote(sym), s = app.feed.syms.get(sym);
    if (q && s && s.dayOpen && s.high && s.low) return { t: sess.open, o: s.dayOpen, h: s.high, l: s.low, c: q.last, v: 0 };
    return null;
  }
  function days(sym) {
    const e = entry(sym), now = today(sym);
    if (!now) return e.days;
    const out = e.days.filter(b => b.t < now.t);
    out.push(now);
    return out;
  }
  // Keeps a finished day's candle on the device once its session is over.
  let savedFor = '';
  function keepToday(sym) {
    const st = marketStatus().state, sess = chartSession(), key = sym + sess.open;
    if (st === 'open' || savedFor.includes(key)) return;
    const b = today(sym);
    if (b && b.t === sess.open) { candleStore.putDaily(sym, [b]); savedFor += key + ';'; }
  }

  app.daily = {
    // The candle still forming at this timeframe (today's, or this week's), alone.
    current(sym, tf) {
      const e = entry(sym);
      if (!e.loaded && !e.busy) load(sym);
      keepToday(sym);
      const all = days(sym);
      if (!all.length) return [];
      if (tf === '1W') { const w = toWeeks(all); return w.slice(-1); }
      return all.slice(-1);
    },
    // Earlier candles in the shape history.js gives the chart, with months marked for the time axis.
    series(sym, tf, before) {
      const e = entry(sym), key = tf + '|' + before + '|' + e.rev;
      if (e.cache[tf] && e.cache[tf].key === key) return e.cache[tf];
      const all = days(sym), src = tf === '1W' ? toWeeks(all) : all, bars = src.filter(b => b.t < before);
      const lines = emaSet(bars.map(b => b.c)), n = bars.length;
      const out = { key, bars, ...lines, vw: new Array(n).fill(null), day: new Array(n).fill(0), starts: [], x: new Array(n).fill(0), ym: bars.map(monthKey) };
      e.cache[tf] = out;
      return out;
    },
    want(sym) { const e = entry(sym); if (!e.busy && (!e.done || (e.failedAt && Date.now() - e.failedAt > 30e3))) load(sym); },
    state(sym) { const e = entry(sym); return { candles: e.days.length, done: e.done, busy: e.busy, failedAt: e.failedAt, source: e.source, daily: true }; },
    reload(sym) { const e = entry(sym); e.done = false; e.failedAt = 0; load(sym); },
  };
  return app.daily;
}
