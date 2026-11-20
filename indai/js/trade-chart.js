// The option's own price chart on the Trade page, with the stop as a line you grab and move.
// The geometry is plain functions (tests/trade-unit.mjs); stopChart() draws on a canvas and handles the finger.
//   const c = stopChart(canvas, { onDrop: (price) => ... });
//   c.set({ bars: [[t,o,h,l,c,v]], mark, entry, stop, pending, tick });   c.destroy();
// `stop` is the stop resting at Schwab (or null), `pending` a new place for it that has not been sent yet.

// The smallest price step an option trades in. Index options move in nickels and dimes; SPY, QQQ and IWM in cents
// at every price; the rest are taken to be in the penny programme (cents under $3, nickels from $3). When that guess
// is wrong Schwab refuses the price and says so.
const INDEX = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'XSP', 'VIX', 'VIXW', 'DJX', 'OEX', 'XEO']);
const PENNY = new Set(['SPY', 'QQQ', 'IWM']);
export function tickFor(root, price) {
  if (INDEX.has(root)) return price < 3 ? 0.05 : 0.1;
  if (PENNY.has(root)) return 0.01;
  return price < 3 ? 0.01 : 0.05;
}
export function roundTo(price, tick, mode = 'nearest') {
  const n = price / tick, k = mode === 'down' ? Math.floor(n + 1e-9) : mode === 'up' ? Math.ceil(n - 1e-9) : Math.round(n + 1e-7);   // a half goes up, whatever the floating point says
  return Math.round(k * tick * 100) / 100;
}
// The stop that goes out with a buy: a share of the limit price below it, on a price Schwab accepts, never zero.
export function autoStop(root, limit, share = 0.2) {
  if (!(limit > 0)) return null;
  const want = limit * (1 - share), tick = tickFor(root, want), stop = roundTo(want, tick, 'down');
  return stop > 0 && stop < limit ? stop : null;
}
// Where a dragged stop may rest: on a tick, at least one tick above zero and one tick under the option's price now.
export function clampStop(price, tick, mark) {
  const top = mark > 0 ? roundTo(mark - tick, tick, 'down') : Infinity;
  return Math.max(tick, Math.min(roundTo(price, tick), top));
}
// The prices the chart has to show, with a little room above and below.
export function span(bars, levels) {
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { if (b[3] > 0 && b[3] < lo) lo = b[3]; if (b[2] > hi) hi = b[2]; }
  for (const v of levels) if (v > 0) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > 0)) return [0, 1];
  if (!(lo < Infinity)) lo = hi;
  const pad = Math.max((hi - lo) * 0.12, hi * 0.02, 0.02);
  return [Math.max(0, lo - pad), hi + pad];
}
export function scale([lo, hi], top, bottom) {
  const k = (bottom - top) / (hi - lo || 1);
  return { y: (p) => bottom - (p - lo) * k, p: (y) => lo + (bottom - y) / k };
}

const GRAB = 26;   // how far from the line, in CSS pixels, a finger still takes hold of it
export function stopChart(canvas, { onDrop = () => {}, onMove = () => {} } = {}) {
  let d = { bars: [], mark: null, entry: null, stop: null, pending: null, tick: 0.01 }, drag = null, sc = null, box = { w: 0, h: 0 };
  const css = (name, fallback) => getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;
  const line = () => drag != null ? drag : d.pending != null ? d.pending : d.stop;
  function draw() {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    box = { w, h };
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const right = w - 64, now = line();
    sc = scale(span(d.bars, [d.mark, d.entry, d.stop, now]), 10, h - 10);
    g.font = '12px system-ui, sans-serif'; g.textBaseline = 'middle';
    const level = (p, color, label, dash, strong) => {
      if (!(p > 0)) return;
      const y = Math.round(sc.y(p)) + 0.5;
      g.strokeStyle = color; g.lineWidth = strong ? 2 : 1; g.setLineDash(dash || []); g.beginPath(); g.moveTo(0, y); g.lineTo(right + 4, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = color; g.textAlign = 'left'; g.fillText(label, right + 8, y);
    };
    // the price so far today
    if (d.bars.length) {
      const t0 = d.bars[0][0], t1 = Math.max(d.bars[d.bars.length - 1][0], t0 + 60e3), x = (t) => (t - t0) / (t1 - t0) * (right - 6);
      g.strokeStyle = css('--text', '#f3f1ea'); g.lineWidth = 1.5; g.beginPath();
      d.bars.forEach((b, i) => { const X = x(b[0]), Y = sc.y(b[4]); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.stroke();
    }
    level(d.entry, css('--dim', '#9aa3b2'), 'Paid ' + d.entry?.toFixed(2), [4, 4]);
    level(d.mark, css('--gold', '#dcbf6e'), 'Now ' + d.mark?.toFixed(2));
    if (d.stop > 0 && now !== d.stop) level(d.stop, 'rgba(242,112,107,.45)', '', [2, 4]);
    if (now > 0) {
      level(now, css('--down', '#f2706b'), '', null, true);
      const y = Math.round(sc.y(now)), text = 'Stop ' + now.toFixed(2);
      g.fillStyle = css('--down', '#f2706b'); g.beginPath(); g.roundRect(right - 2, y - 12, 66, 24, 6); g.fill();
      g.fillStyle = '#17120a'; g.textAlign = 'center'; g.font = '600 12px system-ui, sans-serif'; g.fillText(text, right + 31, y);
    }
  }
  const priceAt = (ev) => { const r = canvas.getBoundingClientRect(); return sc ? sc.p(ev.clientY - r.top) : 0; };
  function down(ev) {
    const now = line();
    if (!(now > 0) || !sc) return;
    const r = canvas.getBoundingClientRect();
    if (Math.abs(ev.clientY - r.top - sc.y(now)) > GRAB) return;
    drag = now; canvas.setPointerCapture?.(ev.pointerId); ev.preventDefault();
  }
  function move(ev) {
    if (drag == null) return;
    ev.preventDefault();
    const next = clampStop(priceAt(ev), d.tick, d.mark);
    if (next !== drag) { drag = next; onMove(next); draw(); }
  }
  function up(ev) {
    if (drag == null) return;
    const dropped = drag; drag = null; canvas.releasePointerCapture?.(ev.pointerId);
    if (ev.type === 'pointercancel') { draw(); return; }
    if (dropped !== (d.pending != null ? d.pending : d.stop)) onDrop(dropped);
    draw();
  }
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
  if (ro) ro.observe(canvas);
  return {
    set(next) { d = { ...d, ...next }; if (drag == null) draw(); },
    get dragging() { return drag != null; },
    // where a price sits on the canvas, in CSS pixels from its top (for tests and for placing a label)
    yOf: (p) => (sc ? sc.y(p) : null),
    destroy() { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); if (ro) ro.disconnect(); },
  };
}
