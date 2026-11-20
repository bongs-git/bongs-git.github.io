// Chart timeframes for the website: 1, 5, 15 and 30 minutes, 1 and 4 hours, daily and weekly.
// The feed (shared with the Quest app) only knows 1, 5 and 15 minutes; everything longer is built here.
//   - 30 minutes, 1 hour and 4 hours: from the one-minute and five-minute candles (today from the feed, earlier
//     sessions from history.js), anchored to each session's 9:30 open the way TradingView draws US stocks
//     (9:30, 10:30, 11:30 … for hourly). Pre-market candles end at 9:30 and after-hours candles start at 4:00.
//   - Daily and weekly: from daily.js (years of daily candles).
// `app.tf` is what the chart, the views and the capture analysis ask for candles.
import { etParts, sessionTimes, isTradingDay, chartSession, ema } from './market.js';

export const TFS = ['1min', '5min', '15min', '30min', '1h', '4h', '1D', '1W'];
export const TF_MS = { '1min': 60e3, '5min': 300e3, '15min': 900e3, '30min': 1800e3, '1h': 3600e3, '4h': 14400e3, '1D': 864e5, '1W': 6048e5 };
export const TF_LABEL = { '1min': '1m', '5min': '5m', '15min': '15m', '30min': '30m', '1h': '1h', '4h': '4h', '1D': 'D', '1W': 'W' };
export const TF_WORDS = { '1min': 'one-minute', '5min': 'five-minute', '15min': 'fifteen-minute', '30min': 'thirty-minute', '1h': 'hourly', '4h': 'four-hour', '1D': 'daily', '1W': 'weekly' };
export const isLong = (tf) => tf === '1D' || tf === '1W';
export const isFeedTf = (tf) => tf === '1min' || tf === '5min' || tf === '15min';
// The candle size the shared feed should fetch for a chart timeframe.
export const feedInterval = (tf) => (isFeedTf(tf) ? tf : '5min');
// Spoken names the voice commands can use ("hourly chart", "daily chart").
export function tfFromWords(text) {
  const t = String(text).toLowerCase();
  if (/\b(weekly|1 ?w|one week)\b/.test(t)) return '1W';
  if (/\b(daily|1 ?d|one day|day chart)\b/.test(t)) return '1D';
  if (/\b(4 ?h|four[- ]hour|240)\b/.test(t)) return '4h';
  if (/\b(1 ?h|one[- ]hour|hourly|60 ?min)\b/.test(t)) return '1h';
  if (/\b(30 ?m|thirty[- ]minute|half[- ]hour)\b/.test(t)) return '30min';
  return null;
}

// The regular session of the New York day a time falls on: { open, close } in ms, or null on a closed day.
// The key changes once per New York day (UTC-5 is right all year from 1 AM New York time on, and nothing trades
// between midnight and 1 AM), so the slow date formatting runs once per day instead of once per candle.
const dayCache = new Map();
export function sessionOf(t) {
  const k = Math.floor((t - 5 * 3600e3) / 864e5);
  if (dayCache.has(k)) return dayCache.get(k);
  const p = etParts(t), s = isTradingDay(p.y, p.m, p.d) ? sessionTimes(p.y, p.m, p.d) : null;
  if (p.h >= 1) { if (dayCache.size > 6000) dayCache.clear(); dayCache.set(k, s); }
  return s;
}

// Longer candles from shorter ones, anchored to each day's session: regular hours from 9:30, pre-market so its last
// candle ends at 9:30, after-hours from 4:00. Input oldest first; output oldest first.
export function anchored(bars, ms) {
  const out = [];
  let last = null;
  for (const b of bars) {
    const s = sessionOf(b.t);
    let t0;
    if (!s) t0 = Math.floor(b.t / ms) * ms;
    else if (b.t < s.open) t0 = s.open - Math.ceil((s.open - b.t) / ms) * ms;
    else if (b.t >= s.close) t0 = s.close + Math.floor((b.t - s.close) / ms) * ms;
    else t0 = Math.min(s.open + Math.floor((b.t - s.open) / ms) * ms, s.close - 1);
    if (last && last.t === t0) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v += b.v || 0; }
    else { last = { t: t0, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }; out.push(last); }
  }
  return out;
}

// Exponential averages over a whole run of candles (daily and weekly charts carry them across days).
export function emaSet(closes) { return { e5: ema(closes, 5), e12: ema(closes, 12), e34: ema(closes, 34), e50: ema(closes, 50) }; }

export function initTimeframes(app) {
  const s = app.settings;
  if (!TF_MS[s.chartTf]) s.chartTf = isFeedTf(s.interval) ? s.interval : '5min';
  const current = () => (TF_MS[s.chartTf] ? s.chartTf : s.interval);
  // This session's candles at a timeframe (for daily and weekly: the candle that is still forming, alone).
  function bars(sym, tf = current()) {
    if (isFeedTf(tf)) return app.feed.getBars(sym, tf);
    if (isLong(tf)) return app.daily ? app.daily.current(sym, tf) : [];
    // five-minute candles fold into 30 minutes, 1 hour and 4 hours without crossing 9:30 or 4:00
    return anchored(app.feed.getBars(sym, '5min'), TF_MS[tf]);
  }
  // Earlier candles, in the shape history.js gives the chart.
  function hist(sym, tf, before) {
    if (isLong(tf)) return app.daily ? app.daily.series(sym, tf, before) : null;
    return app.history ? app.history.series(sym, tf, before) : null;
  }
  // Candles after the session's close (after-hours, then the next pre-market) at a timeframe.
  function after(sym, tf, close) {
    if (!app.ext || isLong(tf) || tf === '4h') return [];
    if (isFeedTf(tf)) return app.ext.after(sym, tf, close);
    return anchored(app.ext.after(sym, '1min', close), TF_MS[tf]);
  }
  // Everything the chart can show at a timeframe, oldest first: for the capture analysis.
  function all(sym, tf = current()) {
    const now = bars(sym, tf);
    const open = isLong(tf) ? (now.length ? now[now.length - 1].t : chartSession().open) : chartSession().open;
    const h = hist(sym, tf, open), xa = isLong(tf) ? [] : after(sym, tf, chartSession().close);
    const out = [...(h ? h.bars : []), ...now, ...xa];
    out.sort((a, b) => a.t - b.t);
    for (let i = out.length - 1; i > 0; i--) if (out[i].t === out[i - 1].t) out.splice(i - 1, 1);
    return out;
  }
  function want(sym, tf = current()) { if (isLong(tf)) app.daily && app.daily.want(sym); else app.history && app.history.want(sym); }
  function state(sym, tf = current()) { return isLong(tf) ? (app.daily ? app.daily.state(sym) : null) : (app.history ? app.history.state(sym) : null); }
  app.tf = { current, bars, hist, after, all, want, state, ms: (tf = current()) => TF_MS[tf], long: (tf = current()) => isLong(tf) };
  return app.tf;
}
