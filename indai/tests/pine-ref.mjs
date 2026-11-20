// A bar-by-bar version of the scanner, written the way a TradingView script has to work (one bar at a time, running
// state, no look-back over the whole day), checked here against the app's real scanner on thousands of candles.
// The TradingView script (indai/tradingview/indai-backtest.pine) is this file translated line for line.
import { scanSetups } from '../js/signals.js';

export class BarByBar {
  constructor(levels = {}) { this.lv = levels; this.si = -1; }
  // b: { t, o, h, l, c, v } five-minute candle; mins: minutes since midnight New York of the candle's open; lead: SPY/QQQ direction
  step(b, mins, lead = 0) {
    const first = this.si < 0; this.si++;
    const n = this.si, k = (p) => 2 / (p + 1);
    const prev = { c: this.pC, vw: this.vw, e5: this.e5, e12: this.e12, line: this.line, sig: this.sigState };
    // moving averages start again every session, from the first candle
    for (const p of [5, 12, 26, 34, 50]) this['e' + p] = first ? b.c : b.c * k(p) + this['e' + p] * (1 - k(p));
    const fastNow = this.e5 >= this.e12 ? 1 : -1, slowNow = this.e34 >= this.e50 ? 1 : -1;
    const fastPrev = n >= 1 ? (prev.e5 >= prev.e12 ? 1 : -1) : 0;
    // VWAP
    const vol = b.v > 0 ? b.v : 1;
    this.pv = (first ? 0 : this.pv) + (b.h + b.l + b.c) / 3 * vol; this.vv = (first ? 0 : this.vv) + vol;
    this.vw = this.pv / this.vv;
    // MACD the way the app computes it on the session so far
    this.line = this.e12 - this.e26;
    const sigNow = n === 0 ? this.line : this.line * 0.2 + (prev.sig || 0) * 0.8;
    this.sigState = n < 25 ? 0 : sigNow;
    const hist = this.line - sigNow;
    const histPrevKnown = n >= 26, histPrev = histPrevKnown ? prev.line - prev.sig : null;
    const histRising = histPrevKnown && hist > histPrev;
    // RSI the way the app computes it (sums for the first 14 changes, then smoothed from those sums)
    let rsi = null;
    if (first) { this.g = 0; this.l = 0; }
    else {
      const d = b.c - prev.c, up = Math.max(0, d), dn = Math.max(0, -d);
      if (n <= 14) { this.g += up; this.l += dn; if (n === 14) rsi = 100 - 100 / (1 + (this.g / 14) / ((this.l / 14) || 1e-9)); }
      else { this.g = (this.g * 13 + up) / 14; this.l = (this.l * 13 + dn) / 14; rsi = 100 - 100 / (1 + this.g / (this.l || 1e-9)); }
    }
    // volume against the average of up to 20 candles before this one
    if (first) this.vols = [];
    const avgV = this.vols.reduce((a, x) => a + x, 0) / Math.max(1, Math.min(20, n));
    const volR = avgV ? (b.v || 0) / avgV : 1;
    this.vols.push(b.v || 0); if (this.vols.length > 20) this.vols.shift();
    // last four candles, the day's range, the opening range
    if (first) { this.hi4 = []; this.lo4 = []; this.dayHi = b.h; this.dayLo = b.l; this.orHi = b.h; this.orLo = b.l; this.priorAbove = false; this.priorBelow = false; }
    this.hi4.push(b.h); this.lo4.push(b.l); if (this.hi4.length > 4) { this.hi4.shift(); this.lo4.shift(); }
    this.dayHi = Math.max(this.dayHi, b.h); this.dayLo = Math.min(this.dayLo, b.l);
    if (n < 3) { this.orHi = Math.max(this.orHi, b.h); this.orLo = Math.min(this.orLo, b.l); }
    const swingHi = Math.max(...this.hi4), swingLo = Math.min(...this.lo4);
    const out = [], lv = this.lv, vw = this.vw, e5 = this.e5, e12 = this.e12;
    const confirm = mins + 5;                                        // the minute the candle closes
    const rate = (strat, d, title, base) => {
      let s = base; const against = [];
      const trend = slowNow * d;
      if (trend > 0) s += 8; else if (trend < 0 && strat !== 'gex') { s -= 10; against.push('against the 34/50 trend'); }
      if ((b.c >= vw ? 1 : -1) === d) s += 5; else if (strat !== 'vwap') { s -= 6; against.push(`${d > 0 ? 'below' : 'above'} VWAP`); }
      if (Math.sign(hist) === d && histRising === (d > 0)) s += 7; else if (Math.sign(hist) === -d && histRising !== (d > 0)) { s -= 7; against.push('MACD disagrees'); }
      if (rsi != null) { if ((d > 0 && rsi > 75) || (d < 0 && rsi < 25)) { s -= 9; against.push('RSI stretched'); } else if ((d > 0 && rsi > 50 && rsi < 68) || (d < 0 && rsi < 50 && rsi > 32)) s += 3; }
      if (volR >= 1.5) s += 6; else if (volR < 0.7) { s -= 5; against.push('light volume'); }
      if (lead === d) s += 6; else if (lead === -d) { s -= 6; against.push('SPY and QQQ moving the other way'); }
      const minGap = b.c * 0.0012, fastEdge = d > 0 ? Math.min(e5, e12) : Math.max(e5, e12);
      const prot = [d > 0 ? swingLo : swingHi, vw, fastEdge].filter(v => (d > 0 ? v <= b.c - minGap : v >= b.c + minGap));
      let stop = prot.length ? (d > 0 ? Math.max(...prot) : Math.min(...prot)) : b.c - d * b.c * 0.0015;
      stop -= d * b.c * 0.0003;
      const walls = [lv.cw, lv.cw2, lv.pw, lv.pw2, lv.zg].filter(v => v != null);
      const ahead = walls.filter(w => (d > 0 ? w > b.c * 1.0008 : w < b.c * 0.9992)).sort((p, q) => (d > 0 ? p - q : q - p));
      let target = ahead[0] ?? null;
      if (target == null) target = d > 0 ? Math.max(this.dayHi, b.c * 1.004) : Math.min(this.dayLo, b.c * 0.996);
      if (Math.abs(target - b.c) < b.c * 0.0015) target = ahead[1] ?? b.c + d * b.c * 0.003;
      const risk = Math.abs(b.c - stop), reward = Math.abs(target - b.c), rr = reward / (risk || 1e-9);
      if (rr >= 2) s += 5; else if (rr < 1) { s -= 10; against.push('low reward to risk'); }
      if (ahead[0] != null && Math.abs(ahead[0] - b.c) / b.c < 0.0015 && strat !== 'gex') { s -= 8; against.push('a GEX wall sits right in front'); }
      if (confirm >= 705 && confirm < 810) s -= 6;
      if (confirm >= 940) s -= 10;
      if ((confirm >= 585 && confirm < 690) || (confirm >= 840 && confirm < 930)) s += 3;
      out.push({ strat, dir: d, title, score: Math.max(0, Math.min(100, Math.round(s))), stop: +stop.toFixed(2), target: +target.toFixed(2), rr: +rr.toFixed(2), against });
    };
    if (n >= 5) {
      if (n >= 13) for (const d of [1, -1]) {
        const flip = fastNow === d && fastPrev === -d && slowNow === d;
        const lo = Math.min(e5, e12), hi = Math.max(e5, e12);
        const pull = fastNow === d && slowNow === d && (d > 0 ? (b.l <= hi && b.c > hi) : (b.h >= lo && b.c < lo)) && (d > 0 ? b.c > b.o : b.c < b.o);
        if (flip) rate('ema', d, `fast EMA cloud flipped ${d > 0 ? 'bullish' : 'bearish'}`, 58);
        else if (pull) rate('ema', d, 'pullback held the fast cloud', 60);
      }
      const v = vw, vp = prev.vw, pc = prev.c;
      if (pc < vp && b.c > v && volR >= 1.1) rate('vwap', 1, 'VWAP reclaim', 56);
      if (pc > vp && b.c < v && volR >= 1.1) rate('vwap', -1, 'lost VWAP', 56);
      if (b.h >= v && b.c < v && pc < vp && b.c < b.o && (b.h - Math.max(b.o, b.c)) > Math.abs(b.c - b.o)) rate('vwap', -1, 'VWAP rejection', 54);
      if (b.l <= v && b.c > v && pc > vp && b.c > b.o && (Math.min(b.o, b.c) - b.l) > Math.abs(b.c - b.o)) rate('vwap', 1, 'VWAP bounce', 54);
      const tol = b.c * 0.0012;
      if (lv.pw && b.l <= lv.pw + tol && b.c > lv.pw && b.c > b.o) rate('gex', 1, 'bounce off the put wall', 57);
      if (lv.cw && b.h >= lv.cw - tol && b.c < lv.cw && b.c < b.o) rate('gex', -1, 'rejected at the call wall', 57);
      if (lv.cw && pc <= lv.cw && b.c > lv.cw + tol * 0.5 && volR > 1.3) rate('gex', 1, 'broke the call wall', 55);
      if (lv.pw && pc >= lv.pw && b.c < lv.pw - tol * 0.5 && volR > 1.3) rate('gex', -1, 'broke the put wall', 55);
      if (lv.zg && (pc - lv.zg) * (b.c - lv.zg) < 0) rate('gex', b.c > lv.zg ? 1 : -1, 'crossed the gamma flip', 52);
      if (n >= 3 && mins >= 585 && mins <= 690) {
        if (b.c > this.orHi && pc <= this.orHi && !this.priorAbove && volR > 1.2) rate('orb', 1, 'broke the opening range high', 57);
        if (b.c < this.orLo && pc >= this.orLo && !this.priorBelow && volR > 1.2) rate('orb', -1, 'broke the opening range low', 57);
      }
    }
    if (n >= 3) { if (b.c > this.orHi) this.priorAbove = true; if (b.c < this.orLo) this.priorBelow = true; }
    this.pC = b.c;
    return out;
  }
}

// ---- check it against the app's scanner
if (process.argv[1] && process.argv[1].endsWith('pine-ref.mjs')) {
  let failed = 0, compared = 0, setups = 0; const kinds = new Set();
  const plain = (t) => t.replace(/\s*\d[\d.,]*\s*$/, '').replace(/\s+\d[\d.,]*/g, '').trim();
  const flag = (f) => /reward to risk/.test(f) ? 'low reward to risk' : f.replace(/\s*\(.*?\)\s*/g, '').trim();
  for (let seed = 1; seed <= 60; seed++) {
    let s = seed * 7919; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const open = Date.UTC(2026, 10, 19, 14, 30), base = 50 + rnd() * 700;        // 9:30 New York
    let p = base; const bars = [];
    const drift = (rnd() - 0.5) * 0.0012, vola = 0.0006 + rnd() * 0.002;
    for (let i = 0; i < 78; i++) {
      const o = p; p = p * (1 + drift + (rnd() - 0.5) * vola * 2 + Math.sin(i / (4 + seed % 9)) * vola * 0.6); const c = p;
      const h = Math.max(o, c) * (1 + rnd() * vola * 0.8), l = Math.min(o, c) * (1 - rnd() * vola * 0.8);
      bars.push({ t: open + i * 300e3, o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2), v: Math.round(20000 + rnd() * 90000 * (rnd() < 0.15 ? 4 : 1)) });
    }
    const round = (x) => Math.round(x);
    const levels = seed % 3 === 0 ? {} : { cw: round(base * 1.006), pw: round(base * 0.994), zg: round(base), ...(seed % 2 ? { cw2: round(base * 1.012), pw2: round(base * 0.988) } : {}) };
    const lead = seed % 4 === 0 ? 1 : seed % 4 === 1 ? -1 : 0;
    const bb = new BarByBar(levels);
    for (let i = 0; i < bars.length; i++) {
      const mine = bb.step(bars[i], 570 + i * 5, lead);
      const real = scanSetups('X', bars.slice(0, i + 1), { levels, leadDir: lead, now: bars[i].t + 300e3 });
      compared++;
      const a = JSON.stringify(mine.map(x => [x.strat, x.dir, plain(x.title), x.score, x.stop, x.target, x.rr, x.against]));
      const b2 = JSON.stringify(real.map(x => [x.strat, x.dir, plain(x.title), x.score, x.stop, x.target, x.rr, x.against.map(flag).filter(f => !/lunch chop|last 20/.test(f))]));
      if (a !== b2) { if (failed++ < 4) console.log(`MISMATCH seed ${seed} candle ${i}\n  bar-by-bar ${a}\n  app        ${b2}`); }
      setups += real.length; for (const r of real) kinds.add(r.strat + '|' + plain(r.title));
    }
  }
  console.log(`${compared} candles, ${setups} setups, ${kinds.size} kinds of setup seen: ${[...kinds].sort().join('; ')}`);
  console.log(failed ? `\n${failed} MISMATCHES` : '\nIDENTICAL to the app\'s scanner on every candle');
  process.exit(failed ? 1 : 0);
}
