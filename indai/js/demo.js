// Website-only helpers that sit in front of the shared relay.js without changing it:
//   1. a fail-fast switch for demo mode only: once INDAI has fallen back to demo prices because the backend
//      could not be reached, nothing waits 20 to 30 seconds per request. On real data every request always goes
//      out: a request that dies (weak signal, Safari sent to the background) must never hold back the next one.
//   2. a simulated options chain for demo mode, so trade analysis, the deep dive and the calculator
//      can still be used (and tested) with no connection. Everything it produces is flagged as demo data.
import { relay } from './relay.js';
import { bs, yearsTo } from './options.js';
import { etParts, etToMs, isTradingDay, nextTradingDay } from './market.js';

const net = { fails: 0, downUntil: 0, lastOk: 0, resumedAt: 0 };
const isNetworkError = (e) => e instanceof TypeError || e?.name === 'AbortError';
let demoMode = () => false;
export const relayDown = () => demoMode() && Date.now() < net.downUntil;
export function relayReset() { net.fails = 0; net.downUntil = 0; net.resumedAt = Date.now(); }

function guard(fn) {
  return async (...args) => {
    if (relayDown()) { const e = new Error('offline'); e.offline = true; throw e; }
    try { const v = await fn(...args); net.fails = 0; net.lastOk = Date.now(); return v; }
    catch (e) {
      // Requests that die while the page is hidden, or just after it comes back, say nothing about the backend.
      if (isNetworkError(e) && !document.hidden && Date.now() - net.resumedAt > 5000) { net.fails++; if (net.fails >= 2) net.downUntil = Date.now() + 25e3; }
      throw e;
    }
  };
}

const ETFS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'XLF', 'XLE', 'SMH', 'TLT', 'GLD']);
const DEMO_IV = { SPY: 0.14, QQQ: 0.18, IWM: 0.2, TSLA: 0.52, AMZN: 0.3, MSFT: 0.24, NVDA: 0.45, AAPL: 0.26, META: 0.34, AMD: 0.46 };
const fmtYMD = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

function demoExpirations() {
  const p = etParts();
  let cur = isTradingDay(p.y, p.m, p.d) && Date.now() < etToMs(p.y, p.m, p.d, 16, 0) ? [p.y, p.m, p.d] : nextTradingDay(p.y, p.m, p.d);
  const out = [];
  for (let i = 0; i < 8; i++) { out.push(fmtYMD(...cur)); cur = nextTradingDay(...cur); }
  // then the next few Fridays
  let d = new Date(Date.UTC(cur[0], cur[1] - 1, cur[2]));
  for (let i = 0; i < 35 && out.length < 13; i++) {
    d = new Date(d.getTime() + 864e5);
    if (d.getUTCDay() === 5 && isTradingDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())) out.push(fmtYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
  }
  return [...new Set(out)].sort();
}

export function demoChain(app, sym, wantExp = '', range = 0.05) {
  sym = String(sym || '').toUpperCase();
  const q = app.feed.quote(sym);
  if (!q) throw new Error(`there is no demo data for ${sym}; add it to the watchlist first`);
  const spot = q.last, r = app.settings.rate ?? 0.04;
  const expirations = demoExpirations();
  const expiry = (wantExp && expirations.find(e => e >= wantExp)) || expirations[0];
  const T = Math.max(1 / (365 * 6.5 * 4), yearsTo(expiry));
  const step = ETFS.has(sym) ? 1 : spot < 30 ? 0.5 : spot < 100 ? 1 : spot < 300 ? 2.5 : 5;
  const baseIv = DEMO_IV[sym] ?? 0.32;
  const lv = app.feed.demoLevels[sym] || {};
  const rows = [];
  const lo = Math.ceil(spot * (1 - range) / step) * step, hi = Math.floor(spot * (1 + range) / step) * step;
  for (let K = lo; K <= hi + 1e-9; K = +(K + step).toFixed(2)) {
    const m = K / spot - 1;
    const iv = baseIv * (1 + 2.2 * Math.abs(m) + (m < 0 ? 0.6 * Math.abs(m) : 0));
    for (const type of ['C', 'P']) {
      const b = bs(spot, K, T, r, iv, type);
      const mid = Math.max(0.01, +b.price.toFixed(2));
      const half = Math.max(0.01, +(mid * 0.015).toFixed(2));
      const near = Math.exp(-Math.pow(m / 0.012, 2));
      const wall = (type === 'C' && K === lv.cw) || (type === 'P' && K === lv.pw) ? 4 : 1;
      const round = K % (step * 5) === 0 ? 1.8 : 1;
      const h = hash(sym + K + type + expiry);
      const oi = Math.round((400 + 9000 * near) * round * wall * (0.6 + h));
      const vol = Math.round(oi * (0.25 + 1.3 * near * hash(type + K + sym)));
      rows.push({ type, strike: K, bid: +Math.max(0, mid - half).toFixed(2), ask: +(mid + half).toFixed(2), mid, last: mid, iv: +iv.toFixed(4), delta: +b.delta.toFixed(3), gamma: +b.gamma.toFixed(4), theta: +b.theta.toFixed(3), vega: +b.vega.toFixed(3), oi, vol });
    }
  }
  const ratios = (list) => {
    const c = list.filter(o => o.type === 'C'), p = list.filter(o => o.type === 'P');
    const sum = (a, f) => a.reduce((s, o) => s + f(o), 0);
    const cv = sum(c, o => o.vol), pv = sum(p, o => o.vol), coi = sum(c, o => o.oi), poi = sum(p, o => o.oi);
    return { callVol: cv, putVol: pv, pcVolume: cv ? +(pv / cv).toFixed(2) : null, callOI: coi, putOI: poi, pcOI: coi ? +(poi / coi).toFixed(2) : null, callPremium: Math.round(sum(c, o => o.vol * o.mid * 100)), putPremium: Math.round(sum(p, o => o.vol * o.mid * 100)) };
  };
  const stats = ratios(rows);
  const unusual = rows.filter(o => o.vol > o.oi * 1.2 && o.vol >= 500 && Math.abs(o.strike - spot) / spot <= 0.06)
    .map(o => ({ exp: expiry, type: o.type, strike: o.strike, vol: o.vol, oi: o.oi, mid: o.mid, premium: Math.round(o.vol * o.mid * 100), iv: o.iv }))
    .sort((a, b) => b.premium - a.premium).slice(0, 6);
  const gex = { callWall: lv.cw ?? null, putWall: lv.pw ?? null, callWall2: null, putWall2: null, zeroGamma: lv.zg ?? null, regime: lv.zg != null ? (spot >= lv.zg ? 'positive' : 'negative') : 'positive' };
  return {
    symbol: sym, spot, timestamp: new Date().toISOString(), delayed: false, demo: true, source: 'Simulated options chain (demo)',
    meta: { iv30: +(baseIv * 100).toFixed(1) }, expirations, expiry,
    all: stats, expiryStats: stats, gex, gexNear: { expiry: expirations[0], callWall: lv.cw ?? null, putWall: lv.pw ?? null, zeroGamma: lv.zg ?? null },
    unusual, chain: rows,
  };
}

export function installRelayGuards(app) {
  demoMode = () => app.feed.status.mode === 'demo';
  document.addEventListener('visibilitychange', relayReset);
  window.addEventListener('online', relayReset);
  window.addEventListener('pageshow', relayReset);
  for (const k of ['snapshot', 'bars', 'daily', 'news', 'tvAlerts', 'tvBars', 'morningGex']) relay[k] = guard(relay[k].bind(relay));
  const realChain = guard(relay.chain.bind(relay));
  let told = false;
  relay.chain = async (sym, expiry = '', range = 0.05) => {
    if (app.feed.status.mode !== 'demo') return realChain(sym, expiry, range);
    // Demo mode: the chart prices are simulated, so the chain is simulated from the same prices to match them.
    const c = demoChain(app, sym, expiry, range);
    if (!told) { told = true; app.indai?.say('Demo mode: option prices, flow and levels here are simulated, so treat any rating as practice only.', 'alert', { speak: false }); }
    return c;
  };
  const realStatus = relay.brainStatus.bind(relay);
  relay.brainStatus = async () => relayDown() ? { configured: false, error: true } : realStatus();
  const realBrain = relay.brain.bind(relay);
  relay.brain = async (body, pass) => {
    if (relayDown()) { const e = new Error("I can't reach the INDAI backend right now"); e.code = 'offline'; throw e; }
    return realBrain(body, pass);
  };
}
