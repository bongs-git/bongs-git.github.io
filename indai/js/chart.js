// Canvas drawing for the website: the main candlestick chart (VWAP, EMA clouds, GEX levels),
// watchlist sparklines, the lead/lag lines and the calculator's payoff curve.
// Everything is drawn in CSS pixels on a canvas scaled for the screen's pixel density.
import { ema, vwap, fmtHM, etParts, chartSession, INTERVAL_MS } from './market.js';
import { LEADLAG } from './feeds.js';
import { positionPnl, expiryCloseMs } from './options.js';
import { C, F, fmtPrice, fmtPct, fmtVol, fmtMoney, hexA, colorFor } from './hud.js';
import { levelSourceLabel } from './panels.js';
import { drawingsFor, addDrawing, removeDrawing, clearDrawings, saveDrawings, startDrawingEdit, finishDrawingEdit, canUndoDrawing, undoDrawing, distToSegment } from './draw.js';
import { TF_MS, isLong } from './timeframes.js';

const DPR = () => Math.min(3, window.devicePixelRatio || 1);
const MIN_SLOTS = 8;
// Between the chart's pixels and its time and price, for the view in `g` (the geometry of the last draw).
// Today's candles sit at their minute of the session; earlier sessions are packed to the left of them without the
// overnight gaps, so a time before today's open is looked up among those candles.
// Pre-market and after-hours candles after the session on the chart follow it one slot each, without the overnight gap.
const slotOf = (g, t) => {
  if (g.X && t >= g.xb[0].t) {
    let lo = 0, hi = g.X - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g.xb[m].t <= t) lo = m; else hi = m - 1; }
    const part = (t - g.xb[lo].t) / g.ivMs;
    return g.full + lo + (lo === g.X - 1 ? part : Math.min(1, part));
  }
  if (!g.H || t >= g.open) return (t - g.open) / g.ivMs;
  const h = g.hist;
  if (t <= h[0].t) return -g.H + (t - h[0].t) / g.ivMs;
  let lo = 0, hi = g.H - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (h[m].t <= t) lo = m; else hi = m - 1; }
  return lo - g.H + Math.min(1, (t - h[lo].t) / g.ivMs);
};
const timeOf = (g, s) => {
  if (g.X && s >= g.full) { const j = s - g.full, k = Math.min(g.X - 1, Math.floor(j)); return g.xb[k].t + (j - k) * g.ivMs; }
  if (!g.H || s >= 0) return g.open + s * g.ivMs;
  const j = s + g.H, k = Math.min(g.H - 1, Math.floor(j));
  return j < 0 ? g.hist[0].t + j * g.ivMs : g.hist[k].t + (j - k) * g.ivMs;
};
const xOf = (g, t) => g.plot.x + (slotOf(g, t) - g.first + 0.5) * g.cw;
const tOf = (g, x) => timeOf(g, (x - g.plot.x) / g.cw + g.first - 0.5);
const fmtDay = (t) => new Date(t).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const fmtDate = (t) => new Date(t).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pOf = (g, y) => g.lo + ((g.plot.y + g.plot.h - Math.max(g.plot.y, Math.min(g.plot.y + g.plot.h, y))) / g.plot.h) * (g.hi - g.lo);
const inPlot = (g, p) => p.x >= g.plot.x && p.x <= g.plot.x + g.plot.w && p.y >= g.plot.y && p.y <= g.plot.y + g.plot.h;

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
    // Moving and zooming: null follows the session by itself, otherwise the stretch of candles the trader chose.
    this.view = null; this.viewKey = '';
    // The price scale: null fits the candles on screen, otherwise the range the trader set by dragging the price axis.
    this.ys = null;
    // Drawing: whether the drawing bar is open, the tool in hand, the selected drawing, the gesture in progress,
    // and the first point of a line that is being placed with two taps.
    this.drawing = false; this.tool = 'move'; this.sel = null; this.drag = null; this.pending = null;
    this.loupe = document.createElement('canvas'); this.loupe.className = 'chart-magnifier'; this.loupe.hidden = true; this.loupe.setAttribute('aria-hidden', 'true'); host.append(this.loupe);
    this.loupeTimer = 0;
    this.ptrs = new Map(); this.raf = 0; this.lastTap = null; this.swallow = false; this.hoverTimer = 0; this.onUi = null;
    new ResizeObserver(() => { app.markDirty('chart'); }).observe(host);
    this.bind();
  }

  // ---- pointer, touch and wheel
  bind() {
    const host = this.host;
    const pos = (ev) => { const r = host.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    host.addEventListener('pointerdown', (ev) => {
      if ((ev.pointerType === 'mouse' && ev.button !== 0) || ev.target.closest('button, a, .tv-wrap')) return;
      const p = pos(ev);
      clearTimeout(this.hoverTimer);
      this.ptrs.set(ev.pointerId, p);
      this.hover = p;
      if (!this.geo) { this.drawOver(); return; }
      try { host.setPointerCapture(ev.pointerId); } catch { /* the pointer is already gone */ }
      if (this.ptrs.size === 2) this.startPinch();
      else if (this.ptrs.size === 1) {
        this.down(p, ev.pointerType !== 'mouse');
        if (ev.pointerType === 'touch' && this.drawing && this.drag && !['pan', 'yscale', 'xscale'].includes(this.drag.kind)) {
          this.loupeTimer = setTimeout(() => { this.loupe.hidden = false; this.drawOver(); }, 450);
        }
      }
    });
    host.addEventListener('pointermove', (ev) => {
      const p = pos(ev);
      if (this.ptrs.has(ev.pointerId)) this.ptrs.set(ev.pointerId, p);
      if (this.drag && this.drag.kind === 'pinch') { this.pinch(); return; }
      this.hover = p;
      if (this.drag) {
        if (this.loupe.hidden && Math.hypot(p.x - this.drag.start?.x, p.y - this.drag.start?.y) > 8) clearTimeout(this.loupeTimer);
        this.move(p);
      }
      else {
        if (ev.pointerType === 'mouse') host.style.cursor = this.tool === 'move' && this.hit(p, false) ? 'pointer' : '';
        this.drawOver();
      }
    });
    const end = (ev, cancelled) => {
      if (!this.ptrs.delete(ev.pointerId)) return;
      const p = pos(ev);
      clearTimeout(this.loupeTimer); this.loupe.hidden = true;
      if (this.drag && this.drag.kind === 'pinch') { this.drag = null; this.hover = null; this.drawOver(); }
      else if (this.swallow) { /* the finger left over from a pinch does nothing */ }
      else this.up(p, cancelled);
      if (!this.ptrs.size) this.swallow = false;
      if (ev.pointerType !== 'mouse' || cancelled) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = setTimeout(() => { if (!this.ptrs.size) { this.hover = null; this.drawOver(); } }, cancelled ? 0 : 1600);
      }
    };
    host.addEventListener('pointerup', (ev) => end(ev, false));
    host.addEventListener('pointercancel', (ev) => end(ev, true));
    host.addEventListener('pointerleave', () => { if (!this.ptrs.size) { this.hover = null; this.drawOver(); } });
    // Wheel: zooms where the page itself cannot scroll, and always with a trackpad pinch (which arrives as ctrl + wheel).
    // A sideways swipe moves the chart. Where the page scrolls, a plain up or down wheel is left to the page.
    host.addEventListener('wheel', (ev) => {
      const g = this.geo;
      if (!g) return;
      const x = ev.clientX - host.getBoundingClientRect().left;
      const unit = ev.deltaMode === 1 ? 33 : 1, dx = ev.deltaX * unit, dy = ev.deltaY * unit;
      if (x > g.plot.x + g.plot.w) { // over the price axis: stretch or squeeze the price scale
        ev.preventDefault();
        const k = Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0015), mid = (g.lo + g.hi) / 2, half = (g.hi - g.lo) / 2 * k;
        this.setY(mid - half, mid + half);
        return;
      }
      if (x < g.plot.x) return;
      const pinch = ev.ctrlKey || ev.metaKey, fixed = document.documentElement.scrollHeight <= window.innerHeight + 1;
      if (!pinch && Math.abs(dx) > Math.abs(dy)) { ev.preventDefault(); this.setView(g.first + dx / g.cw, g.slots); return; }
      if (!pinch && !fixed) return;
      ev.preventDefault();
      const slots = this.clampSlots(g.slots * Math.exp(Math.max(-300, Math.min(300, dy)) * (pinch ? 0.01 : 0.0015)));
      const under = g.first + (x - g.plot.x) / g.cw;
      this.setView(under - (x - g.plot.x) / (g.plot.w / slots), slots);
    }, { passive: false });
  }
  ui() { if (this.onUi) this.onUi(); }
  // Dragging a drawing up or down must not scroll the page, so the browser's own touch panning is off while drawing.
  syncTouch() { this.host.style.touchAction = this.drawing || this.sel || this.ys || this.tool !== 'move' ? 'none' : ''; }
  clampSlots(n) { const g = this.geo; return Math.max(MIN_SLOTS, Math.min(g ? g.maxSlots : 390, n)); }
  redraw() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
  setView(first, slots) { const was = !!this.view; this.view = { first, slots }; this.redraw(); if (!was) this.ui(); }
  // The price range, kept between a sliver of and many times the range that fits the candles.
  setY(lo, hi) {
    const g = this.geo, fit = g ? g.autoHi - g.autoLo : hi - lo, was = !!this.ys;
    const span = Math.max(fit * 0.03, Math.min(fit * 40, hi - lo)), mid = (lo + hi) / 2;
    this.ys = { lo: mid - span / 2, hi: mid + span / 2 };
    this.syncTouch(); this.redraw(); if (!was) this.ui();
  }
  resetView() { if (!this.view && !this.ys) return; this.view = null; this.ys = null; this.syncTouch(); this.redraw(); this.ui(); }
  state() {
    const g = this.geo;
    return { drawing: this.drawing, tool: this.tool, selected: !!this.sel, pending: !!this.pending, manual: !!(this.view || this.ys),
      undo: canUndoDrawing(this.app.settings.main), count: g ? drawingsFor(this.app.settings.main, g.open).length : 0 };
  }
  setDrawing(on) {
    this.drawing = !!on;
    if (!on) { finishDrawingEdit(this.app.settings.main, false); this.drag = null; clearTimeout(this.loupeTimer); this.loupe.hidden = true; this.tool = 'move'; this.pending = null; this.sel = null; }
    this.syncTouch(); this.ui(); this.drawOver();
  }
  setTool(tool) {
    finishDrawingEdit(this.app.settings.main, false);
    this.drag = null;
    this.tool = this.tool === tool ? 'move' : tool;
    this.pending = null;
    if (this.tool !== 'move') { this.sel = null; this.drawing = true; }
    this.syncTouch(); this.ui(); this.drawOver();
  }
  undo() {
    finishDrawingEdit(this.app.settings.main, false);
    if (!undoDrawing(this.app.settings.main)) return;
    this.sel = null; this.pending = null; this.drag = null; this.syncTouch(); this.ui(); this.drawOver();
  }
  deleteSelected() {
    if (!this.sel) return;
    removeDrawing(this.app.settings.main, this.sel);
    this.sel = null; this.syncTouch(); this.ui(); this.drawOver();
  }
  clearAll() {
    const g = this.geo;
    if (!g) return;
    clearDrawings(this.app.settings.main, g.open);
    this.sel = null; this.pending = null; this.syncTouch(); this.ui(); this.drawOver();
  }
  // The drawing under a point: an end of a line, its body, or a level.
  hit(p, coarse) {
    const g = this.geo;
    if (!g || !inPlot(g, p)) return null;
    const list = drawingsFor(this.app.settings.main, g.open), near = coarse ? 20 : 11, edge = coarse ? 13 : 7;
    const ends = (d) => [xOf(g, d.a.t), g.yv(d.a.p), xOf(g, d.b.t), g.yv(d.b.p)];
    const picked = list.find(d => d.id === this.sel);
    if (picked && ['line', 'rect'].includes(picked.type)) { // the ends of the selected line win over anything lying across them
      const [ax, ay, bx, by] = ends(picked);
      if (Math.hypot(p.x - ax, p.y - ay) <= near) return { d: picked, part: 'a' };
      if (Math.hypot(p.x - bx, p.y - by) <= near) return { d: picked, part: 'b' };
    }
    for (let n = list.length - 1; n >= 0; n--) {
      const d = list[n];
      if (d.type === 'level') { if (d.p <= g.hi && d.p >= g.lo && Math.abs(p.y - g.yv(d.p)) <= edge) return { d, part: 'level' }; continue; }
      if (d.type === 'ray') {
        const ax = xOf(g, d.a.t), ay = g.yv(d.a.p);
        if (p.x >= ax - edge && Math.abs(p.y - ay) <= edge) return { d, part: 'ray' };
        continue;
      }
      const [ax, ay, bx, by] = ends(d);
      if (d.type === 'rect') {
        const nearBorder = Math.min(distToSegment(p.x, p.y, ax, ay, bx, ay), distToSegment(p.x, p.y, bx, ay, bx, by), distToSegment(p.x, p.y, bx, by, ax, by), distToSegment(p.x, p.y, ax, by, ax, ay));
        if (nearBorder <= edge) return { d, part: 'body' };
        continue;
      }
      if (distToSegment(p.x, p.y, ax, ay, bx, by) <= edge) return { d, part: 'body' };
    }
    return null;
  }
  down(p, coarse) {
    const g = this.geo;
    this.drag = null;
    // Dragging the price axis stretches or squeezes the prices; dragging the time axis does the same to the candles.
    const right = g.plot.x + g.plot.w, bottom = g.plot.y + g.plot.h;
    if (p.x > right && p.y <= bottom + 6) { this.drag = { kind: 'yscale', start: p, lo0: g.lo, hi0: g.hi, moved: false }; return; }
    if (p.y > bottom && p.x >= g.plot.x && p.x <= right) { this.drag = { kind: 'xscale', start: p, first0: g.first, slots0: g.slots, moved: false }; return; }
    if (!inPlot(g, p)) return;
    const at = { t: tOf(g, p.x), p: pOf(g, p.y) }, sym = this.app.settings.main;
    if (this.tool === 'capture') { this.drag = { kind: 'cap', start: p, p0: p, p1: p }; this.drawOver(); return; }
    if (['line', 'rect'].includes(this.tool)) {
      startDrawingEdit(sym);
      this.drag = { kind: 'new', type: this.tool, a: this.pending || at, b: at, start: p, second: !!this.pending };
    } else if (['level', 'ray'].includes(this.tool)) {
      startDrawingEdit(sym);
      const d = addDrawing(sym, this.tool === 'ray' ? { type: 'ray', a: at } : { type: 'level', p: at.p });
      this.sel = d.id; this.drag = { kind: this.tool, d, start: p, moved: true };
      this.ui();
    } else {
      const hit = this.hit(p, coarse);
      // A drawing is first tapped to select it; once selected, dragging moves it. Anything else moves the chart.
      if (hit && hit.d.id === this.sel) { startDrawingEdit(sym); this.drag = { kind: hit.part, d: hit.d, start: p, from: at, a0: hit.d.a && { ...hit.d.a }, b0: hit.d.b && { ...hit.d.b }, moved: false }; }
      else this.drag = { kind: 'pan', start: p, first0: g.first, slots0: g.slots, cw0: g.cw, lo0: g.lo, hi0: g.hi, hit, moved: false };
    }
    this.drawOver();
  }
  move(p) {
    const g = this.geo, d = this.drag;
    if (!g || !d) return;
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) > 5) d.moved = true;
    const at = { t: tOf(g, p.x), p: pOf(g, p.y) };
    if (d.kind === 'yscale') { // down squeezes the prices together, up stretches them
      if (d.moved) { const k = Math.exp((p.y - d.start.y) * 0.006), mid = (d.lo0 + d.hi0) / 2, half = (d.hi0 - d.lo0) / 2 * k; this.setY(mid - half, mid + half); }
      return;
    }
    if (d.kind === 'xscale') { // left squeezes more candles in, right spreads them out; the right edge stays put
      if (d.moved) { const slots = this.clampSlots(d.slots0 * Math.exp((d.start.x - p.x) * 0.006)); this.setView(d.first0 + d.slots0 - slots, slots); }
      return;
    }
    if (d.kind === 'pan') {
      if (d.moved) {
        this.host.style.cursor = 'grabbing';
        // once the price scale has been set by hand, the chart also moves up and down with the finger
        if (this.ys) { const dp = (p.y - d.start.y) / g.plot.h * (d.hi0 - d.lo0); this.ys = { lo: d.lo0 + dp, hi: d.hi0 + dp }; }
        this.setView(d.first0 - (p.x - d.start.x) / d.cw0, d.slots0);
      } else this.drawOver();
      return;
    }
    if (d.kind === 'cap') { d.p1 = { x: Math.max(g.plot.x, Math.min(g.plot.x + g.plot.w, p.x)), y: Math.max(g.plot.y, Math.min(g.plot.y + g.plot.h, p.y)) }; this.drawOver(); return; }
    if (d.kind === 'new') d.b = at;
    else if (d.kind === 'level') d.d.p = at.p;
    else if (d.kind === 'ray') d.d.a = at;
    else if (d.kind === 'a' || d.kind === 'b') d.d[d.kind] = at;
    else if (d.kind === 'body') {
      const dt = at.t - d.from.t, dp = at.p - d.from.p;
      d.d.a = { t: d.a0.t + dt, p: d.a0.p + dp }; d.d.b = { t: d.b0.t + dt, p: d.b0.p + dp };
    }
    this.drawOver();
  }
  up(p, cancelled) {
    const g = this.geo, d = this.drag, sym = this.app.settings.main;
    this.drag = null;
    this.host.style.cursor = '';
    if (!d) return;
    if (cancelled) { finishDrawingEdit(sym, false); this.pending = null; this.sel = null; this.ui(); this.drawOver(); return; }
    if (d.kind === 'cap') {
      // a box dragged around some candles reads those; a tap reads everything on the chart
      const far = Math.abs(d.p1.x - d.p0.x) >= 14 && Math.abs(d.p1.y - d.p0.y) >= 10;
      this.captureBox(far ? d.p0 : null, far ? d.p1 : null);
      return;
    }
    if (d.kind === 'new') {
      const far = Math.hypot(p.x - d.start.x, p.y - d.start.y) >= 10;
      if (cancelled || !g) this.pending = null;
      else if (d.second || far) {
        // a drag from start to end, or the second of two taps
        const long = Math.hypot(xOf(g, d.a.t) - xOf(g, d.b.t), g.yv(d.a.p) - g.yv(d.b.p)) >= 8;
        if (long) this.sel = addDrawing(sym, { type: d.type, day: g.open, a: d.a, b: d.b }).id;
        this.pending = null; this.tool = 'move'; finishDrawingEdit(sym);
      } else this.pending = d.a; // one tap: the start is placed, the next tap ends the line
      this.syncTouch(); this.ui();
    } else if (d.kind === 'pan') {
      if (!d.moved && !cancelled) {
        const now = performance.now(), again = this.lastTap && !this.lastTap.zone && now - this.lastTap.t < 320 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 28;
        this.lastTap = again ? null : { t: now, x: p.x, y: p.y };
        if (d.hit) { this.sel = d.hit.d.id; this.drawing = true; this.syncTouch(); this.ui(); }
        else if (this.sel) { this.sel = null; this.syncTouch(); this.ui(); }
        else if (again) this.resetView(); // two quick taps on the chart itself go back to the automatic view
      }
    } else if (d.kind === 'yscale' || d.kind === 'xscale') {
      if (!d.moved && !cancelled) { // two quick taps on an axis hand that axis back to the automatic fit
        const now = performance.now(), again = this.lastTap && this.lastTap.zone === d.kind && now - this.lastTap.t < 320;
        this.lastTap = again ? null : { t: now, x: p.x, y: p.y, zone: d.kind };
        if (again) { if (d.kind === 'yscale') this.ys = null; else this.view = null; this.syncTouch(); this.redraw(); this.ui(); }
      }
    } else {
      // a level or a line was placed or moved
      if (['level', 'ray'].includes(d.kind) && this.tool === d.kind) this.tool = 'move';
      saveDrawings(); this.syncTouch(); this.ui();
    }
    this.drawOver();
  }
  startPinch() {
    const g = this.geo, [a, b] = [...this.ptrs.values()];
    finishDrawingEdit(this.app.settings.main, false);
    this.pending = null; clearTimeout(this.loupeTimer); this.loupe.hidden = true;
    this.drag = { kind: 'pinch', d0: Math.max(24, Math.hypot(a.x - b.x, a.y - b.y)), mid0: (a.x + b.x) / 2, first0: g.first, slots0: g.slots, cw0: g.cw };
    this.swallow = true; this.hover = null;
    this.drawOver();
  }
  pinch() {
    const g = this.geo, d = this.drag, [a, b] = [...this.ptrs.values()];
    if (!g || !a || !b) return;
    const slots = this.clampSlots(d.slots0 * d.d0 / Math.max(24, Math.hypot(a.x - b.x, a.y - b.y)));
    const under = d.first0 + (d.mid0 - g.plot.x) / d.cw0; // the candle that was between the fingers stays between them
    this.setView(under - ((a.x + b.x) / 2 - g.plot.x) / (g.plot.w / slots), slots);
  }
  // ---- Capture: the trader draws a box (or asks for the whole chart) and INDAI reads what is inside it.
  // The picture is taken without the box, the crosshair or the drawing handles on it.
  captureBox(a, b) {
    const g = this.geo;
    if (!g) return;
    const box = a && b ? { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) }
      : { x0: g.plot.x, x1: g.plot.x + g.plot.w, y0: g.plot.y, y1: g.plot.y + g.plot.h };
    this.drag = null; this.hover = null; this.sel = null;
    this.setDrawing(false);
    this.draw();
    const shot = { sym: g.sym, tf: g.tf, whole: !(a && b), t0: tOf(g, box.x0), t1: tOf(g, box.x1), lo: pOf(g, box.y1), hi: pOf(g, box.y0), image: this.snapshot(box), at: Date.now() };
    if (this.onCapture) this.onCapture(shot);
  }
  analyzeView() { this.captureBox(null, null); }
  snapshot(box, maxW = 960) {
    const g = this.geo;
    try {
      const d = this.base.width / Math.max(1, this.base.clientWidth), right = g.plot.x + g.plot.w;
      const axis = Math.max(0, Math.min(g.axisW, this.base.clientWidth - right)), bw = Math.max(1, box.x1 - box.x0), h = Math.max(1, box.y1 - box.y0);
      const k = Math.min(1.5, maxW / (bw + axis)), c = document.createElement('canvas');
      c.width = Math.round((bw + axis) * k); c.height = Math.round(h * k);
      const x = c.getContext('2d');
      x.fillStyle = C.ink; x.fillRect(0, 0, c.width, c.height);
      for (const src of [this.base, this.over]) {
        x.drawImage(src, box.x0 * d, box.y0 * d, bw * d, h * d, 0, 0, bw * k, h * k);
        if (axis) x.drawImage(src, right * d, box.y0 * d, axis * d, h * d, bw * k, 0, axis * k, h * k);
      }
      return c.toDataURL('image/jpeg', 0.82);
    } catch { return null; }
  }
  // The time under a pixel across the chart, and back: what a drawing's ends are stored and placed by.
  timeAt(x) { return this.geo ? tOf(this.geo, x) : null; }
  xAt(t) { return this.geo ? xOf(this.geo, t) : null; }

  draw() {
    const { ctx, w: W, h: H } = fit(this.base);
    const app = this.app, s = app.settings, sym = s.main, iv = app.tf ? app.tf.current() : s.interval, long = isLong(iv);
    const bars = app.tf ? app.tf.bars(sym, iv) : app.feed.getBars(sym, iv), q = app.feed.quote(sym);
    this.geo = null;
    const axisW = W < 420 ? 50 : 58;
    const plot = { x: 4, y: 8, w: W - axisW - 6, h: H - 30 };
    // One candle is enough to draw: right after the open a 1h or 4h chart has a single candle for an hour or more.
    if (!bars.length) {
      if (long && app.tf) app.tf.want(sym, iv);
      txt(ctx, long ? 'Loading daily candles…' : 'Loading market data…', W / 2, H / 2 - 6, { size: 14, color: C.dim, align: 'center' });
      if (app.feed.status.note) txt(ctx, app.feed.status.note, W / 2, H / 2 + 16, { size: 11.5, color: C.faint, align: 'center' });
      this.drawOver();
      return;
    }
    // Daily and weekly: the candle still forming plays the part of today's session, and every earlier candle is history.
    const sess = long ? { open: bars[bars.length - 1].t, close: bars[bars.length - 1].t + 1 } : chartSession(), ivMs = TF_MS[iv] || INTERVAL_MS[iv];
    const hs0 = long && app.tf ? app.tf.hist(sym, iv, sess.open) : null;
    const closes = long && hs0 ? [...hs0.bars.map(b => b.c), ...bars.map(b => b.c)] : bars.map(b => b.c), tail = (a) => long ? a.slice(-bars.length) : a;
    const e5 = tail(ema(closes, 5)), e12 = tail(ema(closes, 12)), e34 = tail(ema(closes, 34)), e50 = tail(ema(closes, 50)), vw = long ? bars.map(() => null) : vwap(bars);
    const idxOf = (b) => Math.round((b.t - sess.open) / ivMs);
    // Fit the chart to the session so far, with room to the right, instead of leaving most of it empty in the morning.
    // On a narrow screen, show the most recent stretch at a readable candle width instead of squeezing the whole day in.
    const full = Math.max(bars.length, Math.ceil((sess.close - sess.open) / ivMs)), li0 = idxOf(bars[bars.length - 1]);
    // Once the session is over, its after-hours candles and the next morning's pre-market follow it, one slot each.
    const xa = app.tf ? app.tf.after(sym, iv, sess.close) : app.ext ? app.ext.after(sym, iv, sess.close) : [], XN = xa.length, li = XN ? full + XN - 1 : li0;
    const minSlots = { '1min': 45, '5min': 30, '15min': 14, '30min': 13, '1h': 7, '4h': 6, '1D': 130, '1W': 104 }[iv] || 30;
    // 30-minute and longer candles open with earlier sessions in view, the way TradingView does
    const back = { '30min': 52, '1h': 42, '4h': 36, '1D': 130, '1W': 104 }[iv] || 0;
    let slots = XN ? li + 3 : Math.min(full, Math.max(minSlots, Math.ceil((li + 1) * 1.3) + 1)), first = 0;
    const maxSlots = Math.max(30, Math.floor(plot.w / 3.4));
    if (back) { slots = Math.min(maxSlots, Math.max(back, (XN ? li : full) + 3)); first = (XN ? li : Math.max(li0, full - 1)) + 3 - slots; }
    else if (slots > maxSlots) { first = Math.max(0, Math.min((XN ? li + 3 : full) - maxSlots, li - Math.floor(maxSlots * 0.86))); slots = maxSlots; }
    // The trader's own view (dragged or zoomed) replaces the automatic one until it is reset, or the ticker, the candle
    // size or the session changes. It is kept where at least a few candles stay on screen.
    const key = sym + '|' + iv + '|' + sess.open;
    if (this.viewKey !== key) {
      finishDrawingEdit(this.viewKey.split('|')[0], false);
      this.viewKey = key; this.view = null; this.ys = null; this.sel = null; this.pending = null;
      if (this.drag && this.drag.kind !== 'pinch') this.drag = null;
      this.syncTouch(); this.ui();
    }
    // Earlier sessions, when the trader has scrolled or zoomed back to them, sit at negative slots left of today's open.
    const hs = long ? hs0 : app.tf ? app.tf.hist(sym, iv, sess.open) : app.history ? app.history.series(sym, iv, sess.open) : null, HN = hs ? hs.bars.length : 0;
    const zoomMax = Math.min(2400, Math.max(full, 30) + HN + XN);
    if (this.view) {
      slots = Math.max(MIN_SLOTS, Math.min(zoomMax, this.view.slots));
      first = Math.max((HN ? -HN : idxOf(bars[0])) + 3 - slots, Math.min(li - 2, this.view.first));
      this.view = { first, slots };
    } else if (back) first = Math.max((HN ? -HN : idxOf(bars[0])) + 3 - slots, first);
    // near the oldest candle we have: fetch older ones
    if ((this.view || back) && first < 60 - HN) { if (app.tf) app.tf.want(sym, iv); else if (app.history) app.history.want(sym); }
    const cw = plot.w / slots;
    const xi = (i) => plot.x + (i - first + 0.5) * cw;
    const pts = [];
    for (let j = Math.max(0, Math.ceil(first - 1 + HN)); j < HN && j - HN < first + slots; j++) pts.push({ b: hs.bars[j], i: j - HN, e5: hs.e5[j], e12: hs.e12[j], e34: hs.e34[j], e50: hs.e50[j], vw: hs.vw[j], day: hs.day[j], x: hs.x[j] });
    bars.forEach((b, k) => { const i = idxOf(b); if (i > first - 1 && i < first + slots) pts.push({ b, i, e5: e5[k], e12: e12[k], e34: e34[k], e50: e50[k], vw: vw[k], day: long ? 0 : -1, x: 0 }); });
    xa.forEach((b, k) => { const i = full + k; if (i > first - 1 && i < first + slots) pts.push({ b, i, e5: null, e12: null, e34: null, e50: null, vw: null, day: -2, x: 1 }); });
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
    const autoLo = lo, autoHi = hi;
    if (this.ys) { lo = this.ys.lo; hi = this.ys.hi; }
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
    const spanH = slots * ivMs / 3600e3, spanMin = spanH * 60;
    const everyMin = spanMin <= 25 ? 5 : spanMin <= 50 ? 10 : spanMin <= 100 ? 15 : spanH <= 2.2 ? 30 : spanH <= 4 ? 60 : W < 460 ? 120 : 60;
    // where each earlier session starts, and where today starts: a line and the date
    const dayXs = [];
    if (HN && !long) for (const [i, t] of [...hs.starts.map(j => [j - HN, hs.bars[j].t]), [0, sess.open]]) {
      const x = Math.round(plot.x + (i - first) * cw) + 0.5;
      if (x < plot.x + 1 || x > plot.x + plot.w - 30) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
      if (!dayXs.length || x - dayXs[dayXs.length - 1] > 44) { txt(ctx, fmtDay(t), x + 4, plot.y + plot.h + 15, { size: 10.5, weight: 600, color: C.dim }); dayXs.push(x); }
    }
    if (long) { // daily and weekly: a faint line and a label where each month (or year) starts
      const marks = [...(hs ? hs.bars.map((b, j) => ({ ym: hs.ym[j], slot: j - HN })) : []), ...bars.map(b => { const p = etParts(b.t); return { ym: p.y * 12 + p.m - 1, slot: idxOf(b) }; })];
      const months = slots * ivMs / (30.4 * 864e5), stepM = iv === '1W' ? (months > 60 ? 12 : months > 30 ? 6 : 3) : months > 36 ? 12 : months > 16 ? 6 : months > 7 ? 3 : months > 3.5 ? 2 : 1;
      let prev = null, lastLx = -99;
      for (const m of marks) {
        if (m.slot < first - 1 || m.slot > first + slots) { prev = m.ym; continue; }
        if (m.ym === prev) continue;
        prev = m.ym;
        if ((m.ym % 12) % stepM) continue;
        const x = Math.round(plot.x + (m.slot - first) * cw) + 0.5;
        if (x < plot.x + 8 || x > plot.x + plot.w - 22 || x - lastLx < 40) continue;
        lastLx = x;
        const jan = m.ym % 12 === 0, word = jan || stepM >= 12 ? String(Math.floor(m.ym / 12)) : MON[m.ym % 12];
        ctx.strokeStyle = jan ? 'rgba(255,255,255,0.14)' : C.grid; ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
        txt(ctx, word, x, plot.y + plot.h + 15, { size: 10.5, weight: jan ? 600 : 400, color: jan ? C.dim : C.faint, align: 'center' });
      }
    }
    const labels = long ? [] : hs ? hs.bars.map((bar, index) => ({ t: bar.t, slot: index - HN })) : [];
    for (let minute = 570; minute <= 960 && !long; minute += 5) {
      const t = sess.open + (minute - 570) * 60000;
      if (t <= sess.close) labels.push({ t, slot: (t - sess.open) / ivMs });
    }
    let lastX = -99;
    for (const label of labels) {
      const parts = etParts(label.t);
      if ((parts.h * 60 + parts.mi - 600) % everyMin) continue;
      const x = Math.round(plot.x + (label.slot - first) * cw) + 0.5;
      if (x < plot.x + 8 || x > plot.x + plot.w - 4 || x - lastX < 46 || dayXs.some(d => x - d > -30 && x - d < 50)) continue;
      lastX = x;
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
      txt(ctx, fmtHM(label.t).replace(':00', '').replace(' ', '').toLowerCase(), x, plot.y + plot.h + 15, { size: 10.5, color: C.faint, align: 'center' });
    }
    ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y - 4, plot.w, plot.h + 8); ctx.clip();
    if (s.show.ema) {
      const cloud = (fa, fb, upCol, dnCol) => {
        for (let n = 0; n < pts.length - 1; n++) {
          const a = pts[n], b = pts[n + 1], A = a[fa], B = a[fb], A2 = b[fa], B2 = b[fb];
          if (a.day !== b.day || A == null || B == null || A2 == null || B2 == null) continue;
          ctx.fillStyle = A >= B ? upCol : dnCol;
          ctx.beginPath(); ctx.moveTo(xi(a.i), yv(A)); ctx.lineTo(xi(b.i), yv(A2)); ctx.lineTo(xi(b.i), yv(B2)); ctx.lineTo(xi(a.i), yv(B)); ctx.closePath(); ctx.fill();
        }
      };
      cloud('e34', 'e50', 'rgba(110,195,242,0.13)', 'rgba(240,150,74,0.13)');
      cloud('e5', 'e12', 'rgba(62,207,142,0.22)', 'rgba(242,112,107,0.22)');
    }
    // Outside regular hours: a tint behind each stretch of pre-market or after-hours candles, with its name, and
    // those candles drawn fainter so the regular session still reads first.
    for (let n = 0; n < pts.length;) {
      if (!pts[n].x) { n++; continue; }
      const kind = app.ext.kind(pts[n].b.t);
      let z = n;
      while (z + 1 < pts.length && pts[z + 1].x && pts[z + 1].i - pts[z].i === 1 && app.ext.kind(pts[z + 1].b.t) === kind) z++;
      const x0 = xi(pts[n].i) - cw / 2, x1 = xi(pts[z].i) + cw / 2, name = kind === 'pre' ? 'Pre-market' : 'After hours';
      ctx.fillStyle = hexA(kind === 'pre' ? C.amber : C.sky, 0.055); ctx.fillRect(x0, plot.y - 4, x1 - x0, plot.h + 8);
      ctx.font = `600 10px ${F.sans}`;
      if (x1 - Math.max(x0, plot.x) > ctx.measureText(name).width + 10) txt(ctx, name, Math.max(x0, plot.x) + 5, plot.y + 10, { size: 10, weight: 600, color: C.dim });
      n = z + 1;
    }
    const bw = Math.max(1, Math.min(14, cw * 0.66));
    for (const p of pts) {
      const b = p.b, x = xi(p.i), up = b.c >= b.o;
      ctx.globalAlpha = p.x ? 0.62 : 1;
      ctx.strokeStyle = ctx.fillStyle = up ? C.up : C.down;
      ctx.lineWidth = Math.max(1, Math.min(1.5, cw * 0.18));
      ctx.beginPath(); ctx.moveTo(x, yv(b.h)); ctx.lineTo(x, yv(b.l)); ctx.stroke();
      const y1 = yv(Math.max(b.o, b.c)), y2 = yv(Math.min(b.o, b.c));
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
    }
    ctx.globalAlpha = 1;
    if (s.show.vwap) {
      ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath();
      let pen = null; // the session whose line is being drawn; candles outside regular hours have no VWAP and lift the pen
      for (const p of pts) { if (p.vw == null) { pen = null; continue; } const x = xi(p.i), y = yv(p.vw); if (pen === p.day) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = p.day; }
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
    const lp = s.show.vwap ? [...pts].reverse().find(p => p.vw != null) : null;
    if (lp) {
      // to the right of the last candle when there is room, otherwise just left of it, below the line
      const vx = xi(lp.i), vy = yv(lp.vw);
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
    for (const d of long || iv === '4h' ? [] : ideas) {
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
    // from the newest candle to the axis (from the left edge when the chart has been moved back in time)
    ctx.beginPath(); ctx.moveTo(xi(li0) > plot.x + plot.w ? plot.x : Math.max(plot.x, xi(li0)), ly); ctx.lineTo(plot.x + plot.w, ly); ctx.stroke(); ctx.setLineDash([]);
    // The extended-hours price gets its own tag, from the newest pre-market or after-hours candle. When the two
    // prices are close, the regular tag steps aside so both can be read; its line stays at the true price.
    const xl = XN && app.ext ? app.ext.last(sym) : null, ey = xl ? Math.round(yv(Math.min(hi, Math.max(lo, xl.price)))) + 0.5 : null;
    const ty = xl && Math.abs(ly - ey) < 19 ? ey + (ly >= ey ? 19 : -19) : ly;
    rr(ctx, plot.x + plot.w + 2, ty - 9, axisW - 2, 18, 4); ctx.fillStyle = C.sky; ctx.fill();
    txt(ctx, fmtPrice(last), plot.x + plot.w + axisW / 2 + 1, ty + 0.5, { size: 10.5, weight: 600, fam: F.mono, color: '#04121c', align: 'center', base: 'middle' });
    if (xl) {
      ctx.strokeStyle = hexA(C.amber, 0.85); ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(xi(li) > plot.x + plot.w ? plot.x : Math.max(plot.x, xi(li)), ey); ctx.lineTo(plot.x + plot.w, ey); ctx.stroke(); ctx.setLineDash([]);
      rr(ctx, plot.x + plot.w + 2, ey - 9, axisW - 2, 18, 4); ctx.fillStyle = C.amber; ctx.fill();
      txt(ctx, fmtPrice(xl.price), plot.x + plot.w + axisW / 2 + 1, ey + 0.5, { size: 10.5, weight: 600, fam: F.mono, color: '#1c1204', align: 'center', base: 'middle' });
    }
    // the hours under the candles after the close, and the date where the next morning starts
    for (let k = 0, lastX = Math.round(plot.x + (full - first) * cw); k < XN; k++) {
      const t = xa[k].t, x = Math.round(plot.x + (full + k - first) * cw) + 0.5, newDay = k > 0 && t - xa[k - 1].t > 3 * 3600e3;
      if (!newDay && (t / 60e3) % everyMin) continue;
      if (x < plot.x + 8 || x > plot.x + plot.w - (newDay ? 30 : 4) || x - lastX < 46) continue;
      lastX = x;
      ctx.strokeStyle = newDay ? 'rgba(255,255,255,0.16)' : C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
      if (newDay) txt(ctx, fmtDay(t), x + 4, plot.y + plot.h + 15, { size: 10.5, weight: 600, color: C.dim });
      else txt(ctx, fmtHM(t).replace(':00', '').replace(' ', '').toLowerCase(), x, plot.y + plot.h + 15, { size: 10.5, color: C.faint, align: 'center' });
    }
    this.geo = { W, plot, pts, xi, yv, cw, first, lo, hi, autoLo, autoHi, axisW, slots, full, maxSlots: zoomMax, open: sess.open, ivMs, H: HN, hist: hs ? hs.bars : [], X: XN, xb: xa, tf: iv, long, sym };
    this.drawOver();
  }

  // The trader's trend lines and levels, and the line being drawn.
  drawMarks(ctx, g) {
    const { plot, axisW } = g, right = plot.x + plot.w;
    const list = drawingsFor(this.app.settings.main, g.open), tags = [], handles = [];
    ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
    const line = (a, b, on, ghost) => {
      const L = a.t <= b.t ? a : b, R = L === a ? b : a;
      const ax = xOf(g, L.t), ay = g.yv(L.p), bx = xOf(g, R.t), by = g.yv(R.p);
      ctx.strokeStyle = on ? C.white : C.violet; ctx.lineWidth = on ? 2 : 1.6; ctx.globalAlpha = ghost ? 0.75 : 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      if (bx - ax > 1 && bx < right) { // carried on to the right edge at the same slope, so it can be read ahead of price
        ctx.globalAlpha = ghost ? 0.35 : 0.55; ctx.lineWidth = 1.2; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(right, by + (by - ay) / (bx - ax) * (right - bx)); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      return [[ax, ay], [bx, by]];
    };
    const rectangle = (a, b, on) => {
      const ax = xOf(g, a.t), ay = g.yv(a.p), bx = xOf(g, b.t), by = g.yv(b.p);
      ctx.fillStyle = hexA(C.violet, 0.13); ctx.strokeStyle = on ? C.white : C.violet; ctx.lineWidth = on ? 2 : 1.4;
      ctx.fillRect(ax, ay, bx - ax, by - ay); ctx.strokeRect(ax, ay, bx - ax, by - ay);
      return [[ax, ay], [bx, by]];
    };
    for (const d of list) {
      const on = d.id === this.sel;
      if (d.type === 'rect') { const ends = rectangle(d.a, d.b, on); if (on) handles.push(...ends); continue; }
      if (d.type === 'ray') {
        const ax = xOf(g, d.a.t), ay = g.yv(d.a.p);
        ctx.strokeStyle = on ? C.white : C.violet; ctx.lineWidth = on ? 2 : 1.4;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(right, ay); ctx.stroke();
        if (on) handles.push([ax, ay]);
        continue;
      }
      if (d.type === 'line') { const ends = line(d.a, d.b, on, false); if (on) handles.push(...ends); continue; }
      if (d.p > g.hi || d.p < g.lo) continue;
      const y = Math.round(g.yv(d.p)) + 0.5;
      ctx.strokeStyle = on ? C.white : C.violet; ctx.lineWidth = on ? 2 : 1.4;
      ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(right, y); ctx.stroke();
      tags.push({ y, p: d.p, on });
      if (on) handles.push([right - 16, y]);
    }
    if (this.drag && this.drag.kind === 'new') handles.push(...(this.drag.type === 'rect' ? rectangle(this.drag.a, this.drag.b, true) : line(this.drag.a, this.drag.b, true, true)));
    else if (this.pending && ['line', 'rect'].includes(this.tool)) {
      const a = this.pending, h = this.hover;
      if (h && inPlot(g, h)) { const b = { t: tOf(g, h.x), p: pOf(g, h.y) }; if (this.tool === 'rect') rectangle(a, b, true); else line(a, b, true, true); }
      handles.push([xOf(g, a.t), g.yv(a.p)]);
    }
    for (const [x, y] of handles) { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill(); ctx.strokeStyle = C.white; ctx.lineWidth = 2; ctx.stroke(); }
    if (this.drag && this.drag.kind === 'cap') {
      const { p0, p1 } = this.drag, x0 = Math.min(p0.x, p1.x), y0 = Math.min(p0.y, p1.y), w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
      ctx.fillStyle = hexA(C.gold, 0.10); ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = C.gold; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]); ctx.strokeRect(x0 + 0.5, y0 + 0.5, w, h); ctx.setLineDash([]);
      for (const [cx, cy] of [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]]) { ctx.fillStyle = C.gold; ctx.fillRect(cx - 3, cy - 3, 6, 6); }
      if (w > 64 && h > 22) { rr(ctx, x0 + 4, y0 + 4, 62, 18, 4); ctx.fillStyle = C.gold; ctx.fill(); txt(ctx, 'CAPTURE', x0 + 35, y0 + 13.5, { size: 10, weight: 700, color: '#1c1404', align: 'center', base: 'middle' }); }
    }
    ctx.restore();
    for (const t of tags) {
      rr(ctx, right + 2, t.y - 9, axisW - 2, 18, 4); ctx.fillStyle = t.on ? C.white : C.violet; ctx.fill();
      txt(ctx, fmtPrice(t.p), right + axisW / 2 + 1, t.y + 0.5, { size: 10.5, weight: 600, fam: F.mono, color: C.ink, align: 'center', base: 'middle' });
    }
  }

  // drawings, crosshair and candle read-out, on their own layer so moving a finger never redraws the candles
  drawMagnifier() {
    const p = this.hover;
    if (this.loupe.hidden || !p) return;
    const size = 112, ratio = this.base.width / this.base.clientWidth;
    this.loupe.width = size * DPR(); this.loupe.height = size * DPR();
    const ctx = this.loupe.getContext('2d'); ctx.scale(DPR(), DPR());
    ctx.fillStyle = C.ink; ctx.fillRect(0, 0, size, size);
    for (const canvas of [this.base, this.over]) ctx.drawImage(canvas, (p.x - 28) * ratio, (p.y - 28) * ratio, 56 * ratio, 56 * ratio, 0, 0, size, size);
    ctx.strokeStyle = C.white; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(44, 56); ctx.lineTo(68, 56); ctx.moveTo(56, 44); ctx.lineTo(56, 68); ctx.stroke();
    this.loupe.style.left = Math.max(4, Math.min(this.host.clientWidth - size - 4, p.x - size / 2)) + 'px';
    this.loupe.style.top = (p.y > 150 ? p.y - 140 : Math.min(this.host.clientHeight - size - 4, p.y + 30)) + 'px';
  }
  drawOver() {
    const { ctx, w: W } = fit(this.over);
    const g = this.geo, h = this.hover;
    if (!g) return;
    this.drawMarks(ctx, g);
    this.drawMagnifier();
    if (!h || (this.drag && (this.drag.kind === 'pinch' || this.drag.kind === 'cap'))) return;
    const { plot, pts, xi, cw, first, lo, hi, axisW } = g;
    if (h.x < plot.x || h.x > plot.x + plot.w || h.y < plot.y || h.y > plot.y + plot.h) return;
    const slot = Math.floor((h.x - plot.x) / cw + first);
    let best = null; for (const p of pts) if (!best || Math.abs(p.i - slot) < Math.abs(best.i - slot)) best = p;
    if (!best || Math.abs(best.i - slot) > 3) return;
    const x = Math.round(xi(best.i)) + 0.5, y = Math.round(h.y) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
    const b = best.b, when = g.long ? (g.tf === '1W' ? 'Wk ' : '') + fmtDate(b.t) : (b.t < g.open ? fmtDay(b.t) + ' ' : '') + fmtHM(b.t);
    const parts = W < 460
      ? [when, `O ${fmtPrice(b.o)}`, `H ${fmtPrice(b.h)}`, `L ${fmtPrice(b.l)}`, `C ${fmtPrice(b.c)}`]
      : [when, `O ${fmtPrice(b.o)}`, `H ${fmtPrice(b.h)}`, `L ${fmtPrice(b.l)}`, `C ${fmtPrice(b.c)}`, `V ${fmtVol(b.v)}`];
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
