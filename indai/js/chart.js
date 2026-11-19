// Canvas drawing for the website: the main candlestick chart (VWAP, EMA clouds, GEX levels),
// watchlist sparklines, the lead/lag lines and the calculator's payoff curve.
// Everything is drawn in CSS pixels on a canvas scaled for the screen's pixel density.
import { ema, vwap, fmtHM, chartSession, INTERVAL_MS } from './market.js';
import { LEADLAG } from './feeds.js';
import { positionPnl, expiryCloseMs } from './options.js';
import { C, F, fmtPrice, fmtPct, fmtVol, fmtMoney, hexA, colorFor } from './hud.js';
import { levelSourceLabel } from './panels.js';

const DPR = () => Math.min(3, window.devicePixelRatio || 1);

// Size a canvas to its CSS box. Returns the 2D context (already scaled) and the size in CSS px.
export function fit(canvas) {
  const w = Math.max(1, Math.round(canvas.clientWidth)), h = Math.max(1, Math.round(canvas.clientHeight)), d = DPR();
  if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
function txt(ctx, str, x, y, { size = 11, weight = 500, color = C.text, align = 'left', base = 'alphabetic', fam = F.sans } = {}) {
  ctx.font = `${weight} ${size}px ${fam}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillText(str, x, y);
  return ctx.measureText(str).width;
}
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

// ---------------------------------------------------------------- main chart
export class PriceChart {
  constructor(host, app) {
    this.host = host; this.app = app;
    this.base = host.querySelector('canvas.base'); this.over = host.querySelector('canvas.over');
    this.geo = null; this.hover = null;
    new ResizeObserver(() => { app.markDirty('chart'); }).observe(host);
    const pos = (ev) => { const r = host.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    host.addEventListener('pointermove', (ev) => { this.hover = pos(ev); this.drawOver(); });
    host.addEventListener('pointerdown', (ev) => { this.hover = pos(ev); this.drawOver(); });
    const clear = () => { this.hover = null; this.drawOver(); };
    host.addEventListener('pointerleave', clear);
    host.addEventListener('pointercancel', clear);
    host.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') setTimeout(clear, 1600); });
  }

  draw() {
    const { ctx, w: W, h: H } = fit(this.base);
    const app = this.app, s = app.settings, sym = s.main, iv = s.interval;
    const bars = app.feed.getBars(sym, iv), q = app.feed.quote(sym);
    this.geo = null;
    const axisW = W < 420 ? 50 : 58;
    const plot = { x: 4, y: 8, w: W - axisW - 6, h: H - 30 };
    if (bars.length < 2) {
      txt(ctx, 'Loading market data…', W / 2, H / 2 - 6, { size: 14, color: C.dim, align: 'center' });
      if (app.feed.status.note) txt(ctx, app.feed.status.note, W / 2, H / 2 + 16, { size: 11.5, color: C.faint, align: 'center' });
      this.drawOver();
      return;
    }
    const sess = chartSession(), ivMs = INTERVAL_MS[iv];
    const closes = bars.map(b => b.c);
    const e5 = ema(closes, 5), e12 = ema(closes, 12), e34 = ema(closes, 34), e50 = ema(closes, 50), vw = vwap(bars);
    const idxOf = (b) => Math.round((b.t - sess.open) / ivMs);
    // Fit the chart to the session so far, with room to the right, instead of leaving most of it empty in the morning.
    // On a narrow screen, show the most recent stretch at a readable candle width instead of squeezing the whole day in.
    const full = Math.max(bars.length, Math.ceil((sess.close - sess.open) / ivMs)), li = idxOf(bars[bars.length - 1]);
    const minSlots = { '1min': 45, '5min': 30, '15min': 14 }[iv] || 30;
    let slots = Math.min(full, Math.max(minSlots, Math.ceil((li + 1) * 1.3) + 1)), first = 0;
    const maxSlots = Math.max(30, Math.floor(plot.w / 3.4));
    if (slots > maxSlots) { first = Math.max(0, Math.min(full - maxSlots, li - Math.floor(maxSlots * 0.86))); slots = maxSlots; }
    const cw = plot.w / slots;
    const xi = (i) => plot.x + (i - first + 0.5) * cw;
    const pts = bars.map((b, k) => ({ b, k, i: idxOf(b) })).filter(p => p.i >= first && p.i < first + slots);
    if (!pts.length) return;
    let lo = Math.min(...pts.map(p => p.b.l)), hi = Math.max(...pts.map(p => p.b.h));
    const lv = s.show.gex ? app.levelsFor(sym) : null;
    const span0 = hi - lo || hi * 0.002;
    const lines = [], offscreen = [], offIdea = [];
    if (lv) {
      for (const [k, name, col, lw] of [['cw', 'Call wall', C.up, 1.5], ['zg', 'Gamma flip', C.amber, 1.5], ['pw', 'Put wall', C.down, 1.5], ['cw2', 'Call wall 2', hexA(C.up, 0.55), 1], ['pw2', 'Put wall 2', hexA(C.down, 0.55), 1]]) if (lv[k] != null) lines.push({ v: lv[k], name, col, w: lw, main: lw > 1 });
      if (lv.near) for (const [k, name, col] of [['cw', '0DTE call wall', C.up], ['pw', '0DTE put wall', C.down]]) if (lv.near[k] != null && lv.near[k] !== lv[k]) lines.push({ v: lv.near[k], name, col: hexA(col, 0.7), w: 1, dotted: true });
      for (const l of lines) { if (l.v > hi && l.v - hi < span0 * 0.6) hi = l.v; else if (l.v < lo && lo - l.v < span0 * 0.6) lo = l.v; }
    }
    // Today's trade ideas for this ticker. The one in focus gets its entry, stop and target drawn, so make room for them.
    const ideas = app.ideasFor ? app.ideasFor(sym) : [], focus = ideas.find(d => d.focus) || null;
    if (focus) for (const v of [focus.stop, focus.target]) { if (v > hi && v - hi < span0 * 1.5) hi = v; else if (v < lo && lo - v < span0 * 1.5) lo = v; }
    const pad = (hi - lo) * 0.08 || 0.1; lo -= pad; hi += pad;
    const yv = (v) => plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h;
    // grid + price axis
    ctx.lineWidth = 1;
    const step = niceStep((hi - lo) / Math.max(3, Math.round(plot.h / 56)));
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Math.round(yv(v)) + 0.5;
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
      txt(ctx, fmtPrice(v), plot.x + plot.w + 6, y + 4, { size: 10.5, fam: F.mono, color: C.faint });
    }
    // time axis
    const spanH = slots * ivMs / 3600e3, everyMin = spanH <= 2.2 ? 30 : spanH <= 4 ? 60 : W < 460 ? 120 : 60;
    for (let m = 600; m <= 960; m += 30) {
      if ((m - 600) % everyMin) continue;
      const t = sess.open + (m - 570) * 60e3;
      if (t > sess.close) break;
      const x = Math.round(plot.x + ((t - sess.open) / ivMs - first) * cw) + 0.5;
      if (x < plot.x + 8 || x > plot.x + plot.w - 4) continue;
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
      txt(ctx, fmtHM(t).replace(':00', '').replace(' ', '').toLowerCase(), x, plot.y + plot.h + 15, { size: 10.5, color: C.faint, align: 'center' });
    }
    ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y - 4, plot.w, plot.h + 8); ctx.clip();
    if (s.show.ema) {
      const cloud = (fa, fb, upCol, dnCol) => {
        for (let n = 0; n < pts.length - 1; n++) {
          const a = pts[n], b = pts[n + 1], A = fa[a.k], B = fb[a.k], A2 = fa[b.k], B2 = fb[b.k];
          if (A == null || B == null || A2 == null || B2 == null) continue;
          ctx.fillStyle = A >= B ? upCol : dnCol;
          ctx.beginPath(); ctx.moveTo(xi(a.i), yv(A)); ctx.lineTo(xi(b.i), yv(A2)); ctx.lineTo(xi(b.i), yv(B2)); ctx.lineTo(xi(a.i), yv(B)); ctx.closePath(); ctx.fill();
        }
      };
      cloud(e34, e50, 'rgba(110,195,242,0.13)', 'rgba(240,150,74,0.13)');
      cloud(e5, e12, 'rgba(62,207,142,0.22)', 'rgba(242,112,107,0.22)');
    }
    const bw = Math.max(1, Math.min(14, cw * 0.66));
    for (const p of pts) {
      const b = p.b, x = xi(p.i), up = b.c >= b.o;
      ctx.strokeStyle = ctx.fillStyle = up ? C.up : C.down;
      ctx.lineWidth = Math.max(1, Math.min(1.5, cw * 0.18));
      ctx.beginPath(); ctx.moveTo(x, yv(b.h)); ctx.lineTo(x, yv(b.l)); ctx.stroke();
      const y1 = yv(Math.max(b.o, b.c)), y2 = yv(Math.min(b.o, b.c));
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
    }
    if (s.show.vwap) {
      ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath();
      pts.forEach((p, n) => { const x = xi(p.i), y = yv(vw[p.k]); n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    // Labels go where they don't cover each other: each one tries its usual spot, then the other side, then under its line.
    const placed = [];
    const label = (str, side, y, { size = 11, color = C.text, spots = null } = {}) => {
      ctx.font = `600 ${size}px ${F.sans}`;
      const tw = ctx.measureText(str).width, other = side === 'left' ? 'right' : 'left';
      const tries = spots || [[side, y - 5], [other, y - 5], [side, y + size + 3], [other, y + size + 3]];
      let pick = null;
      for (const [sd, ty] of tries) {
        const x0 = typeof sd === 'number' ? sd : sd === 'left' ? plot.x + 6 : plot.x + plot.w - 6 - tw;
        const box = { x0: x0 - 3, x1: x0 + tw + 3, y0: ty - size, y1: ty + 3 };
        if (box.y0 < plot.y - 2 || box.y1 > plot.y + plot.h + 2 || box.x0 < plot.x || box.x1 > plot.x + plot.w) continue;
        if (!pick) pick = box;
        if (!placed.some(b => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) { pick = box; break; }
      }
      if (!pick) return;
      placed.push(pick);
      ctx.fillStyle = 'rgba(5,7,9,0.72)'; ctx.fillRect(pick.x0, pick.y0 - 1, pick.x1 - pick.x0, pick.y1 - pick.y0 + 1);
      txt(ctx, str, pick.x0 + 3, pick.y1 - 3, { size, weight: 600, color });
    };
    if (s.show.vwap) {
      // to the right of the last candle when there is room, otherwise just left of it, below the line
      const lp = pts[pts.length - 1], vx = xi(lp.i), vy = yv(vw[lp.k]);
      label('VWAP', 'right', vy, { size: 10, color: C.gold, spots: [[vx + 8, vy + 4], [vx + 8, vy - 8], [Math.max(plot.x + 4, vx - 40), vy + 15], [Math.max(plot.x + 4, vx - 40), vy - 8]] });
    }
    if (lv) {
      const shown = [];
      for (const l of lines) {
        if (l.v > hi || l.v < lo) { if (l.main) offscreen.push(`${l.name} ${fmtPrice(l.v)} ${l.v > hi ? '↑' : '↓'}`); continue; }
        const y = Math.round(yv(l.v)) + 0.5;
        ctx.strokeStyle = l.col; ctx.lineWidth = l.w; ctx.setLineDash(l.dotted ? [2, 5] : [9, 6]);
        ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke(); ctx.setLineDash([]);
        shown.push({ l, y });
      }
      // main walls and the flip get first pick of the label spots
      for (const { l, y } of shown.sort((a, b) => (b.l.main ? 1 : 0) - (a.l.main ? 1 : 0))) label(`${l.name} ${fmtPrice(l.v)}`, l.dotted ? 'right' : 'left', y, { size: l.main ? 11 : 10, color: l.col });
      if (offscreen.length) txt(ctx, offscreen.join('   '), plot.x + plot.w - 6, plot.y + 12, { size: 10.5, color: C.dim, align: 'right' });
      txt(ctx, levelSourceLabel(lv), plot.x + plot.w - 6, plot.y + plot.h - 6, { size: 10, color: lv.source === 'demo' ? C.amber : C.faint, align: 'right' });
    }
    // Ideas: a small arrow under (call) or over (put) the candle that confirmed each one. For the one in focus,
    // lines for the stop and the target from that candle onward, and a tick at the entry.
    for (const d of ideas) {
      const i = Math.floor(((d.forming ? d.barT : d.barT + 300e3 - 1) - sess.open) / ivMs), p = pts.find(k => k.i === i) || (d.forming ? pts[pts.length - 1] : null);
      if (!p) continue;
      const x = xi(p.i), up = d.dir > 0, col = up ? C.up : C.down, sz = d.focus ? 6.5 : 5;
      const y = up ? Math.min(plot.y + plot.h - 2, yv(p.b.l) + 5) : Math.max(plot.y + 2, yv(p.b.h) - 5);
      ctx.beginPath();
      if (up) { ctx.moveTo(x, y); ctx.lineTo(x - sz, y + sz * 1.5); ctx.lineTo(x + sz, y + sz * 1.5); } else { ctx.moveTo(x, y); ctx.lineTo(x - sz, y - sz * 1.5); ctx.lineTo(x + sz, y - sz * 1.5); }
      ctx.closePath();
      if (d.forming) { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]); }
      else { ctx.fillStyle = d.focus ? col : hexA(col, 0.75); ctx.fill(); ctx.strokeStyle = 'rgba(5,7,9,0.9)'; ctx.lineWidth = 1; ctx.stroke(); }
      if (!d.focus) continue;
      const x0 = Math.max(plot.x, x), x1 = plot.x + plot.w;
      for (const [v, name, c2] of [[d.stop, 'Stop', C.down], [d.target, 'Target', C.up]]) {
        if (v > hi || v < lo) { offIdea.push(`${name} ${fmtPrice(v)} ${v > hi ? '↑' : '↓'}`); continue; }
        const yy = Math.round(yv(v)) + 0.5;
        ctx.strokeStyle = c2; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); ctx.setLineDash([]);
        label(`${name} ${fmtPrice(v)}`, 'right', yy, { size: 11, color: c2 });
      }
      if (d.price <= hi && d.price >= lo) { const ye = Math.round(yv(d.price)) + 0.5; ctx.strokeStyle = C.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 9, ye); ctx.lineTo(x + 9, ye); ctx.stroke(); }
      label(`${d.forming ? 'Forming' : up ? 'Call idea' : 'Put idea'} · ${d.score}`, 'left', up ? y + sz * 1.5 + 14 : y - sz * 1.5 - 6, { size: 10.5, color: col, spots: [[Math.min(plot.x + plot.w - 90, x + 10), up ? y + sz * 1.5 + 6 : y - sz * 1.5 + 2], [Math.max(plot.x + 4, x - 84), up ? y + sz * 1.5 + 6 : y - sz * 1.5 + 2]] });
    }
    if (offIdea.length) txt(ctx, offIdea.join('   '), plot.x + 6, plot.y + 12, { size: 10.5, color: C.dim });
    // last price tag
    const last = q ? q.last : bars[bars.length - 1].c;
    const ly = Math.round(yv(Math.min(hi, Math.max(lo, last)))) + 0.5;
    ctx.strokeStyle = hexA(C.sky, 0.8); ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(xi(pts[pts.length - 1].i), ly); ctx.lineTo(plot.x + plot.w, ly); ctx.stroke(); ctx.setLineDash([]);
    rr(ctx, plot.x + plot.w + 2, ly - 9, axisW - 2, 18, 4); ctx.fillStyle = C.sky; ctx.fill();
    txt(ctx, fmtPrice(last), plot.x + plot.w + axisW / 2 + 1, ly + 0.5, { size: 10.5, weight: 600, fam: F.mono, color: '#04121c', align: 'center', base: 'middle' });
    this.geo = { W, H, plot, pts, xi, yv, cw, first, lo, hi, axisW };
    this.drawOver();
  }

  // crosshair + candle read-out, on its own layer so moving a finger never redraws the candles
  drawOver() {
    const { ctx, w: W } = fit(this.over);
    const g = this.geo, h = this.hover;
    if (!g || !h) return;
    const { plot, pts, xi, cw, first, lo, hi, axisW } = g;
    if (h.x < plot.x || h.x > plot.x + plot.w || h.y < plot.y || h.y > plot.y + plot.h) return;
    const slot = Math.floor((h.x - plot.x) / cw) + first;
    let best = null; for (const p of pts) if (!best || Math.abs(p.i - slot) < Math.abs(best.i - slot)) best = p;
    if (!best || Math.abs(best.i - slot) > 3) return;
    const x = Math.round(xi(best.i)) + 0.5, y = Math.round(h.y) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
    const b = best.b;
    const parts = W < 460
      ? [fmtHM(b.t), `O ${fmtPrice(b.o)}`, `H ${fmtPrice(b.h)}`, `L ${fmtPrice(b.l)}`, `C ${fmtPrice(b.c)}`]
      : [fmtHM(b.t), `O ${fmtPrice(b.o)}`, `H ${fmtPrice(b.h)}`, `L ${fmtPrice(b.l)}`, `C ${fmtPrice(b.c)}`, `V ${fmtVol(b.v)}`];
    const line = parts.join('  ');
    ctx.font = `500 11px ${F.mono}`;
    const tw = Math.min(plot.w - 8, ctx.measureText(line).width + 16);
    rr(ctx, plot.x + 4, plot.y + 2, tw, 22, 5); ctx.fillStyle = 'rgba(5,7,9,0.92)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
    txt(ctx, line, plot.x + 12, plot.y + 17, { size: 11, fam: F.mono, color: b.c >= b.o ? C.up : C.down });
    const pv = lo + ((plot.y + plot.h - h.y) / plot.h) * (hi - lo);
    rr(ctx, plot.x + plot.w + 2, y - 9, axisW - 2, 18, 4); ctx.fillStyle = C.text; ctx.fill();
    txt(ctx, fmtPrice(pv), plot.x + plot.w + axisW / 2 + 1, y, { size: 10.5, weight: 600, fam: F.mono, color: C.ink, align: 'center', base: 'middle' });
  }
}

// ---------------------------------------------------------------- watchlist sparkline
export function drawSparkline(canvas, bars, base) {
  const { ctx, w, h } = fit(canvas);
  if (!bars || bars.length < 2) return;
  const lo = Math.min(...bars.map(b => b.l)), hi = Math.max(...bars.map(b => b.h));
  const yv = (v) => 2 + (h - 4) - ((v - lo) / ((hi - lo) || 1)) * (h - 4);
  if (base != null && base >= lo && base <= hi) { ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, yv(base)); ctx.lineTo(w, yv(base)); ctx.stroke(); ctx.setLineDash([]); }
  const col = bars[bars.length - 1].c >= (base ?? bars[0].o) ? C.up : C.down;
  const grad = ctx.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, hexA(col, 0.26)); grad.addColorStop(1, hexA(col, 0));
  const path = () => bars.forEach((b, k) => { const x = (k / (bars.length - 1)) * w; k ? ctx.lineTo(x, yv(b.c)) : ctx.moveTo(x, yv(b.c)); });
  ctx.beginPath(); path(); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.beginPath(); path(); ctx.stroke();
}

// ---------------------------------------------------------------- lead / lag since the open
export const LL_COLORS = { SPY: C.white, QQQ: C.violet, IWM: C.gold };
export function leadLagSeries(app) {
  return LEADLAG.map(sym => {
    const bars = app.feed.getBars(sym, '5min');
    const base = bars.length ? bars[0].o : null;
    const pts = base ? bars.map(b => ({ t: b.t + 150e3, v: (b.c / base - 1) * 100 })) : [];
    return { sym, pts, now: pts.length ? pts[pts.length - 1].v : null };
  });
}
export function drawLeadLag(canvas, series) {
  const { ctx, w, h } = fit(canvas);
  const all = series.flatMap(s => s.pts.map(p => p.v));
  if (all.length < 4) { txt(ctx, 'Waiting for SPY, QQQ and IWM…', w / 2, h / 2, { size: 12, color: C.dim, align: 'center' }); return; }
  const sess = chartSession();
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.12 || 0.1; lo -= pad; hi += pad;
  const lastT = Math.max(...series.flatMap(s => s.pts.map(p => p.t)));
  const end = Math.min(sess.close, Math.max(sess.open + 150 * 60e3, sess.open + (lastT - sess.open) * 1.25));   // the session so far, with room to the right
  const xt = (t) => ((t - sess.open) / (end - sess.open)) * (w - 2) + 1;
  const yv = (v) => h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, Math.round(yv(0)) + 0.5); ctx.lineTo(w, Math.round(yv(0)) + 0.5); ctx.stroke(); ctx.setLineDash([]);
  txt(ctx, '0%', w - 2, yv(0) - 4, { size: 9.5, color: C.faint, align: 'right', fam: F.mono });
  for (const sr of series) {
    ctx.strokeStyle = LL_COLORS[sr.sym] || C.text; ctx.lineWidth = 1.75; ctx.lineJoin = 'round'; ctx.beginPath();
    sr.pts.forEach((p, k) => { const x = xt(p.t), y = yv(p.v); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- calculator payoff curve
export function drawPayoff(canvas, c, S, rate, grid) {
  const { ctx, w: W, h: H } = fit(canvas);
  const lo = Math.min(...grid.prices), hi = Math.max(...grid.prices);
  const exp = c.legs.map(l => l.expiry).sort()[0];
  const atExp = expiryCloseMs(exp), now = Date.now();
  const N = 160, xs = [...Array(N + 1)].map((_, i) => lo + (hi - lo) * i / N);
  const e = xs.map(x => positionPnl(c.legs, x, atExp, rate)), t = xs.map(x => positionPnl(c.legs, x, now, rate));
  const ymin = Math.min(0, ...e, ...t), ymax = Math.max(0, ...e, ...t), pad = (ymax - ymin) * 0.1 || 10;
  const L = 52, R = 10, T = 22, B = 22;
  const X = (v) => L + (v - lo) / (hi - lo) * (W - L - R), Y = (v) => T + (1 - (v - ymin + pad) / (ymax - ymin + 2 * pad)) * (H - T - B);
  ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const v = ymin - pad + (ymax - ymin + 2 * pad) * k / 4, y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke(); txt(ctx, fmtMoney(v), L - 6, y + 3.5, { size: 10, fam: F.mono, color: C.faint, align: 'right' }); }
  const nx = W < 460 ? 3 : 4;
  for (let k = 0; k <= nx; k++) { const v = lo + (hi - lo) * k / nx; txt(ctx, fmtPrice(v), X(v), H - 6, { size: 10, fam: F.mono, color: C.faint, align: k === 0 ? 'left' : k === nx ? 'right' : 'center' }); }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(L, Math.round(Y(0)) + 0.5); ctx.lineTo(W - R, Math.round(Y(0)) + 0.5); ctx.stroke();
  for (let i = 0; i < N; i++) { ctx.fillStyle = e[i] >= 0 ? 'rgba(62,207,142,0.16)' : 'rgba(242,112,107,0.16)'; ctx.beginPath(); ctx.moveTo(X(xs[i]), Y(0)); ctx.lineTo(X(xs[i]), Y(e[i])); ctx.lineTo(X(xs[i + 1]), Y(e[i + 1])); ctx.lineTo(X(xs[i + 1]), Y(0)); ctx.fill(); }
  const line = (arr, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.beginPath(); arr.forEach((v, i) => i ? ctx.lineTo(X(xs[i]), Y(v)) : ctx.moveTo(X(xs[i]), Y(v))); ctx.stroke(); };
  line(e, C.text, 1.75); line(t, C.gold, 1.75);
  ctx.setLineDash([3, 4]); ctx.strokeStyle = C.sky; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(X(S)) + 0.5, T - 4); ctx.lineTo(Math.round(X(S)) + 0.5, H - B); ctx.stroke(); ctx.setLineDash([]);
  txt(ctx, `now ${fmtPrice(S)}`, Math.min(W - R - 60, X(S) + 5), T + 8, { size: 10.5, color: C.sky, fam: F.mono });
  // legend
  let lx = L; ctx.lineWidth = 2;
  for (const [label, col] of [['At expiry', C.text], ['Today', C.gold]]) { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(lx, 9.5); ctx.lineTo(lx + 14, 9.5); ctx.stroke(); lx += 18 + txt(ctx, label, lx + 18, 13, { size: 10.5, color: C.dim }) + 14; }
}

export { fmtPct, colorFor };
