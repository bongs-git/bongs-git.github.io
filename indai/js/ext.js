// Pre-market and after-hours for the website: the one-minute candles outside regular hours, for the chart, and
// the extended-hours price shown under the regular one, the way TradingView shows it.
// The candles come from three places: the TradingView bridge's stored candles (its newest page is fetched here,
// and history.js hands over the older pages as it fetches them), the bridge candles the feed receives while the
// page is open, and live trades when a Finnhub key is set. In demo mode they are made up, like everything there.
import { RELAY_URL } from './relay.js';
import { aggregate, etParts, sessionTimes, isTradingDay, chartSession, marketStatus, INTERVAL_MS } from './market.js';
import { fmtPrice, fmtPct } from './hud.js';

const KEEP = 9000; // one-minute candles per ticker, about nine days of extended hours
const days = new Map(); // UTC hour -> that New York day's session times, or null on a day without trading
function sessOf(t) {
  const k = Math.floor(t / 3600e3);
  if (!days.has(k)) {
    if (days.size > 5000) days.clear();
    const p = etParts(t);
    days.set(k, isTradingDay(p.y, p.m, p.d) ? sessionTimes(p.y, p.m, p.d) : null);
  }
  return days.get(k);
}
// 'pre' from 4:00 AM to the open and 'post' from the close to 8:00 PM, New York time, on trading days. Otherwise ''.
export function extKind(t) {
  const s = sessOf(t);
  return !s ? '' : t >= s.pre && t < s.open ? 'pre' : t >= s.close && t < s.post ? 'post' : '';
}
const regularAt = (t) => { const s = sessOf(t); return !!s && t >= s.open && t < s.close; };

export function initExtended(app) {
  if (app.settings.show.ext == null) app.settings.show.ext = true; // shown unless the trader turns it off
  const store = new Map(); // ticker -> { bars: one-minute candles oldest first, at: time -> candle, rev, ... }
  const entry = (sym) => {
    if (!store.has(sym)) store.set(sym, { bars: [], at: new Map(), rev: 0, sorted: true, fed: -1, asked: 0, busy: false, demoTo: 0, cache: {} });
    return store.get(sym);
  };
  const demo = () => app.feed.status.mode === 'demo';
  const on = () => app.settings.show.ext !== false;

  // Adds or corrects one candle. True when something changed.
  function put(e, b) {
    const t = +b.t, o = +b.o, h = +b.h, l = +b.l, c = +b.c, v = +b.v || 0, have = e.at.get(t);
    if (have) {
      if (have.o === o && have.h === h && have.l === l && have.c === c && have.v === v) return false;
      have.o = o; have.h = h; have.l = l; have.c = c; have.v = v;
      return true;
    }
    const bar = { t, o, h, l, c, v, k: extKind(t) };
    if (e.bars.length && e.bars[e.bars.length - 1].t > t) e.sorted = false;
    e.at.set(t, bar); e.bars.push(bar);
    return true;
  }
  function settle(e, changed, quiet) {
    if (!changed) return;
    if (!e.sorted) { e.bars.sort((a, b) => a.t - b.t); e.sorted = true; }
    if (e.bars.length > KEEP) for (const b of e.bars.splice(0, e.bars.length - KEEP)) e.at.delete(b.t);
    e.rev++;
    if (!quiet) app.markDirty('chart');
  }
  const usable = (b) => +b.t % 60e3 === 0 && +b.c > 0 && +b.o > 0 && !!extKind(+b.t);
  function take(sym, rows, quiet) {
    const e = entry(sym);
    let changed = false;
    for (const b of rows || []) if (usable(b)) changed = put(e, b) || changed;
    settle(e, changed, quiet);
  }
  // The newest stored bridge candles, once when a ticker is first shown and then now and again as a safety net:
  // candles that arrive while the page is open come through the feed.
  async function load(sym, e) {
    if (e.busy || Date.now() - e.asked < (e.loaded ? 20 * 60e3 : 45e3)) return;
    e.asked = Date.now(); e.busy = true;
    try {
      const r = await fetch(`${RELAY_URL}/functions/v1/indai-tv?bars=1&ticker=${encodeURIComponent(sym)}&limit=1000`);
      if (r.ok) { take(sym, (await r.json()).bars); e.loaded = true; }
    } catch { /* no extended hours on the chart until the next try */ }
    e.busy = false;
  }
  // Made-up extended hours after the demo session: after-hours until 8 PM, then the next trading day's pre-market.
  function pretend(sym, e, sess) {
    const now = Date.now();
    let from = Math.max(e.demoTo, sess.close); // the next minute to make up
    if (now < from + 60e3) return;
    const last = e.bars[e.bars.length - 1] || app.feed.getBars(sym, '1min').slice(-1)[0];
    if (!last) return;
    let next = null;
    for (let d = 1; d < 8 && !next; d++) { const s = sessOf(sess.open + d * 864e5); if (s) next = s; }
    let seed = [...sym].reduce((a, c) => a * 31 + c.charCodeAt(0), 11) + Math.floor(from / 60e3);
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    let price = last.c, changed = false;
    for (const [a, z] of [[sess.close, sess.post], next ? [next.pre, next.open] : [0, 0]]) {
      for (let t = Math.max(a, from); t < z && t + 60e3 <= now; t += 60e3) {
        const o = price, c = o * (1 + rnd() * 0.0009), hi = Math.max(o, c) * (1 + Math.abs(rnd()) * 0.0004), lo = Math.min(o, c) * (1 - Math.abs(rnd()) * 0.0004);
        changed = put(e, { t, o: +o.toFixed(2), h: +hi.toFixed(2), l: +lo.toFixed(2), c: +c.toFixed(2), v: Math.round(1500 + Math.abs(rnd()) * 9000) }) || changed;
        price = c; from = t + 60e3;
      }
    }
    e.demoTo = from;
    settle(e, changed);
  }
  // Brings a ticker's candles up to date from what the feed holds, and starts whatever fetch is due.
  function ready(sym) {
    const e = entry(sym);
    if (demo()) { pretend(sym, e, chartSession()); return e; }
    const fs = app.feed.syms.get(sym);
    if (fs && e.fed !== fs.rev) {
      e.fed = fs.rev;
      let changed = false;
      for (const b of fs.bars['1min']) if (usable(b)) changed = put(e, b) || changed;
      settle(e, changed); // a new candle asks for one redraw; the next look finds nothing new
    }
    load(sym, e);
    return e;
  }
  const before = (e, t) => { let lo = 0, hi = e.bars.length; while (lo < hi) { const m = (lo + hi) >> 1; if (e.bars[m].t < t) lo = m + 1; else hi = m; } return lo; };

  app.ext = {
    kind: extKind,
    on,
    take,
    // One-minute candles outside regular hours that ended before `t`, for history.js to weave between earlier
    // sessions, and a stamp that changes when that set does.
    rows(sym, t) { const e = ready(sym); return on() ? e.bars.slice(0, before(e, t)) : []; },
    stamp(sym, t) { if (!on()) return 'off'; const e = entry(sym), n = before(e, t); return n + ':' + (n ? e.bars[n - 1].t : 0); },
    // Candles of one size from the chart session's close onward: after-hours, then the next morning's pre-market.
    after(sym, iv, close) {
      const e = ready(sym);
      if (!on()) return [];
      const key = iv + '|' + close + '|' + e.rev;
      if (e.cache.key !== key) {
        const src = e.bars.slice(before(e, close));
        e.cache = { key, bars: iv === '1min' ? src : aggregate(src, INTERVAL_MS[iv]) };
      }
      return e.cache.bars;
    },
    // The newest extended-hours price since the chart session closed: { kind: 'pre' | 'post', price, t }, or null.
    last(sym) {
      const state = marketStatus().state;
      if (state === 'open') return null;
      const e = ready(sym), b = e.bars[e.bars.length - 1];
      if (b && b.t >= chartSession().close) return { kind: b.k, price: b.c, t: b.t };
      const q = app.feed.quote(sym);
      return q && q.ext != null ? { kind: state === 'pre' ? 'pre' : 'post', price: q.ext, t: 0 } : null;
    },
  };

  // Live trades (a Finnhub key in Settings). The shared feed files every trade as the last price, so a pre-market
  // trade would replace yesterday's close. Here a trade outside regular hours moves the extended-hours price and
  // its candle instead, and the regular close stays where it is. Regular-hours trades go on as before.
  const applyTrade = app.feed.applyTrade.bind(app.feed);
  app.feed.applyTrade = (sym, price, vol, t, opts) => {
    if (demo() || regularAt(t)) return applyTrade(sym, price, vol, t, opts);
    if (!(price > 0) || !extKind(t)) return;
    const e = entry(sym), minute = Math.floor(t / 60e3) * 60e3, have = e.at.get(minute);
    if (have) { have.h = Math.max(have.h, price); have.l = Math.min(have.l, price); have.c = price; have.v += vol || 0; e.rev++; }
    else {
      const prev = e.bars[e.bars.length - 1];
      settle(e, put(e, { t: minute, o: prev && minute - prev.t === 60e3 ? prev.c : price, h: price, l: price, c: price, v: vol || 0 }), true);
    }
    const s = app.feed.sym(sym);
    s.ext = price; s.lastTradeAt = Date.now(); s.tvAt = Date.now(); // tvAt: a fresher extended-hours price than the delayed snapshot's
    app.feed.bump(s);
    app.markDirty('chart');
  };

  // The line under the price. Outside regular hours: "Pre-market 635.43  -9.61  -1.49%", measured from the regular
  // close. Otherwise the day's high and low. The line is always there, so the chart never jumps when it changes.
  const el = document.getElementById('ch-ext');
  function paint() {
    if (!el || document.hidden) return;
    const sym = app.settings.main, q = app.feed.quote(sym), x = q && q.last > 0 ? app.ext.last(sym) : null;
    let text = '\u00a0', tone = 'day';
    if (x) {
      const chg = x.price - q.last, pct = (chg / q.last) * 100;
      text = `${x.kind === 'pre' ? 'Pre-market' : 'After hours'} ${fmtPrice(x.price)}  ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}  ${fmtPct(pct)}`;
      tone = chg > 0.004 ? 'up' : chg < -0.004 ? 'down' : 'flat';
    } else if (q && q.high != null && q.low != null) text = `H ${fmtPrice(q.high)}  L ${fmtPrice(q.low)}`;
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== 'mono ext ' + tone) el.className = 'mono ext ' + tone;
  }
  app.ext.paint = paint;
  setInterval(paint, 500);
}
