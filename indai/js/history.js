// Earlier sessions for the main chart, so it can be scrolled back in time: the one-minute candles the TradingView
// bridge has stored on the backend, regular hours only, fetched a page at a time as the chart nears their start.
// In demo mode earlier sessions are made up, like everything else there.
import { RELAY_URL } from './relay.js';
import { aggregate, ema, vwap, etParts, sessionTimes, isTradingDay, chartSession, INTERVAL_MS } from './market.js';
import { initExtended } from './ext.js';
import { TF_MS, anchored } from './timeframes.js';
import { candleStore } from './candle-store.js';

const PAGE = 1000, DEMO_DAYS = 8;

export function initHistory(app) {
  initExtended(app); // pre-market and after-hours candles, woven between the sessions below
  const store = new Map(); // ticker -> { bars: one-minute candles oldest first, done, busy, failedAt, cache }
  const entry = (sym) => {
    if (!store.has(sym)) { store.set(sym, { bars: [], done: false, busy: false, failedAt: 0, cache: {} }); hydrate(sym); }
    return store.get(sym);
  };
  // Adds one-minute candles in time order, keeping the newest copy of a minute.
  function merge(e, rows) {
    if (!rows.length) return 0;
    const at = new Map(e.bars.map(b => [b.t, b]));
    let n = 0;
    for (const b of rows) { if (!at.has(b.t)) n++; at.set(b.t, b); }
    e.bars = [...at.values()].sort((a, b) => a.t - b.t); e.cache = {};
    return n;
  }
  // What this device kept from earlier days (regular and extended hours), shown before the backend answers and
  // still there when it cannot.
  async function hydrate(sym) {
    if (app.feed.status.mode === 'demo') return;
    const open = chartSession().open, rows = await candleStore.minutes(sym, Date.now() - 45 * 864e5, Date.now());
    if (!rows.length) return;
    const e = store.get(sym), reg = rows.filter(b => regular(b.t));
    const n = merge(e, reg.filter(b => b.t < open));
    app.ext.take(sym, rows, true);
    // The session on the chart, when the feed has nothing for it yet (backend down, market closed): from the device.
    const today = reg.filter(b => b.t >= open), fs = app.feed.sym(sym);
    if (today.length && !app.feed.getBars(sym, '1min').length && !app.feed.getBars(sym, '5min').length) {
      fs.bars['1min'] = today.map(b => ({ ...b }));
      if (fs.last == null) { fs.last = today[today.length - 1].c; fs.dayOpen = today[0].o; fs.high = Math.max(...today.map(b => b.h)); fs.low = Math.min(...today.map(b => b.l)); }
      app.feed.bump(fs);
    }
    if (n || today.length) app.markDirty('chart');
  }
  // Keeps the minutes the page has received on the device: the feed's candles and the extended hours.
  const savedTo = new Map();
  function keep() {
    if (app.feed.status.mode === 'demo') return;
    for (const sym of app.feed.trackedSymbols) {
      const fs = app.feed.syms.get(sym);
      if (!fs) continue;
      const from = (savedTo.get(sym) || 0) - 180e3;
      const rows = [...fs.bars['1min'], ...(app.ext ? app.ext.all(sym) : [])].filter(b => b.t >= from && b.t % 60e3 === 0);
      if (!rows.length) continue;
      savedTo.set(sym, rows.reduce((m, b) => Math.max(m, b.t), 0));
      candleStore.putMinutes(sym, rows);
    }
    candleStore.prune();
  }
  const regular = (t) => { const p = etParts(t); if (!isTradingDay(p.y, p.m, p.d)) return false; const s = sessionTimes(p.y, p.m, p.d); return t >= s.open && t < s.close; };

  // Made-up earlier sessions that end where the oldest known candle starts.
  function demoRows(sym, e) {
    const first = e.bars[0] || app.feed.getBars(sym, '1min')[0];
    if (!first) return [];
    let seed = [...sym].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) + Math.floor(first.t / 864e5);
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const out = []; let price = first.o, at = first.t;
    for (let d = 0; d < 2; d++) {
      const s = chartSession(chartSession(at).open - 1);
      for (let t = s.close - 60e3; t >= s.open; t -= 60e3) {
        const c = price, o = c * (1 + rnd() * 0.0014), hi = Math.max(o, c) * (1 + Math.abs(rnd()) * 0.0006), lo = Math.min(o, c) * (1 - Math.abs(rnd()) * 0.0006);
        out.push({ t, o: +o.toFixed(2), h: +hi.toFixed(2), l: +lo.toFixed(2), c: +c.toFixed(2), v: Math.round(20000 + Math.abs(rnd()) * 90000) });
        price = o;
      }
      at = s.open;
    }
    return out;
  }
  async function more(sym) {
    const e = entry(sym);
    if (e.busy || e.done) return;
    e.busy = true; app.markDirty('chart');
    try {
      let rows, last;
      if (app.feed.status.mode === 'demo') { rows = demoRows(sym, e); last = !rows.length || e.bars.length + rows.length >= DEMO_DAYS * 390; }
      else {
        const r = await fetch(`${RELAY_URL}/functions/v1/indai-tv?bars=1&ticker=${encodeURIComponent(sym)}&before=${e.oldest || Date.now()}&limit=${PAGE}`);
        if (!r.ok) throw new Error('history ' + r.status);
        rows = (await r.json()).bars || []; last = rows.length < PAGE;
        if (rows.length) e.oldest = Math.min(...rows.map(b => +b.t));
        app.ext.take(sym, rows); // the same page carries the candles outside regular hours
      }
      const clean = rows.map(b => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 })).filter(b => b.t % 60e3 === 0 && b.c > 0 && b.o > 0);
      if (app.feed.status.mode !== 'demo') candleStore.putMinutes(sym, clean); // kept on the device for later
      const add = clean.filter(b => regular(b.t));
      const n = merge(e, add); e.done = last; e.failedAt = 0;
      if (n) app.markDirty('chart');
    } catch { e.failedAt = Date.now(); }
    e.busy = false; app.markDirty('chart');
  }

  app.history = {
    // Candles of one size that ended before `before` (the open of the session on the chart), oldest first, with the
    // same session-by-session averages the chart draws for today. Pre-market and after-hours candles sit between the
    // sessions in time order, marked in `x`; the averages are the regular session's, so those candles carry none.
    series(sym, iv, before) {
      const e = entry(sym), key = iv + '|' + before + '|' + e.bars.length + '|' + app.ext.stamp(sym, before);
      if (e.cache.key === key) return e.cache;
      const reg = e.bars.filter(b => b.t < before), extra = app.ext.rows(sym, before);
      // five- and fifteen-minute candles never straddle 9:30 or 4:00, so a candle is wholly inside or outside the session
      // 30-minute, hourly and 4-hour candles are anchored to 9:30 (timeframes.js), so they do not straddle it either
      const ms = TF_MS[iv] || INTERVAL_MS[iv];
      const src = extra.length ? [...reg, ...extra].sort((a, b) => a.t - b.t) : reg, bars = iv === '1min' ? src : ms > 900e3 ? anchored(src, ms) : aggregate(src, ms);
      const out = { key, bars, e5: [], e12: [], e34: [], e50: [], vw: [], day: [], starts: [], x: [] };
      for (let a = 0, d = 0; a < bars.length; d++) {
        let z = a + 1;
        while (z < bars.length && bars[z].t - bars[z - 1].t < 3 * 3600e3) z++;
        const inside = [];
        for (let k = a; k < z; k++) { const x = extra.length && app.ext.kind(bars[k].t) ? 1 : 0; out.x.push(x); if (!x) inside.push(k); }
        const part = inside.map(k => bars[k]), closes = part.map(b => b.c);
        const lines = { e5: ema(closes, 5), e12: ema(closes, 12), e34: ema(closes, 34), e50: ema(closes, 50), vw: vwap(part) };
        for (const name in lines) { const col = new Array(z - a).fill(null); inside.forEach((k, n) => { col[k - a] = lines[name][n]; }); out[name].push(...col); }
        // this morning's pre-market runs straight into the open, which the chart already marks with the date
        if (inside.length || z < bars.length || before - bars[z - 1].t > 3 * 3600e3) out.starts.push(a);
        for (let k = a; k < z; k++) out.day.push(d);
        a = z;
      }
      return (e.cache = out);
    },
    // Asks for the next older page unless one is on its way, there is no more, or the last try just failed.
    want(sym) { const e = entry(sym); if (!e.busy && !e.done && Date.now() - e.failedAt > 30e3) more(sym); },
    state(sym) { const e = entry(sym); return { candles: e.bars.length, done: e.done, busy: e.busy, failedAt: e.failedAt }; },
    keep,
  };
}
