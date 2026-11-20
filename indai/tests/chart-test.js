// Moving, zooming and drawing on the main chart, with a mouse (laptop) and with touch (phone).
const { chromium } = require('./browser.cjs');
const URL = (process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/') + '?demo=1&nocheckin=1';   // the automatic morning check-in would otherwise cover the chart from 6 AM New York time
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra === '' ? '' : JSON.stringify(extra)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const st = (p) => p.evaluate(() => { const c = window.__indai.app.chart, g = c.geo; return { ...c.state(), slots: g && +g.slots.toFixed(2), first: g && +g.first.toFixed(2), lo: g && g.lo, hi: g && g.hi, plot: g && g.plot, list: JSON.parse(localStorage.getItem('indai.web.draw.v1') || '{}')[window.__indai.app.settings.main] || [], touch: c.host.style.touchAction, barHidden: document.getElementById('ch-drawbar').hidden, resetHidden: document.getElementById('ch-reset').hidden }; });
const box = (p) => p.evaluate(() => { const r = document.getElementById('chart-host').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const yOf = (p, price) => p.evaluate((v) => { const c = window.__indai.app.chart; return c.host.getBoundingClientRect().top + c.geo.yv(v); }, price);
const ready = async (p) => { await p.waitForFunction(() => window.__indai && window.__indai.app.chart && window.__indai.app.chart.geo, null, { timeout: 30000 }); await sleep(600); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  // ---------------------------------------------------------------- laptop, mouse
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(URL); await ready(p);
    const B = await box(p), s0 = await st(p), cx = B.x + B.w * 0.5, cy = B.y + B.h * 0.5;
    check('[laptop] starts in the automatic view with the drawing bar closed', !s0.manual && s0.barHidden && s0.resetHidden && !s0.drawing, { slots: s0.slots });
    await p.mouse.move(cx, cy); await p.mouse.wheel(0, -300); await sleep(250);
    const s1 = await st(p);
    check('[laptop] wheel up zooms in', s1.manual && s1.slots < s0.slots, { from: s0.slots, to: s1.slots });
    check('[laptop] Reset view appears', !s1.resetHidden);
    await p.mouse.wheel(0, 600); await sleep(250);
    const s2 = await st(p);
    check('[laptop] wheel down zooms out', s2.slots > s1.slots, { to: s2.slots });
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + 160, cy, { steps: 6 }); await p.mouse.up(); await sleep(250);
    const s3 = await st(p);
    check('[laptop] dragging moves the chart back in time', s3.first < s2.first, { from: s2.first, to: s3.first });
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx - 5000, cy, { steps: 4 }); await p.mouse.up(); await sleep(250);
    const s3b = await st(p);
    check('[laptop] it cannot be dragged off the candles', await p.evaluate(() => window.__indai.app.chart.geo.pts.length >= 2), { first: s3b.first });
    await p.click('#ch-reset'); await sleep(250);
    const s4 = await st(p);
    check('[laptop] Reset view goes back to the automatic view', !s4.manual && s4.resetHidden && Math.abs(s4.slots - s0.slots) < 0.01);
    // the axes are handles
    const ax = B.x + B.w - 25, ay = B.y + B.h * 0.5, r0 = s4.hi - s4.lo;
    await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(ax, ay + 80, { steps: 5 }); await p.mouse.up(); await sleep(250);
    const a1 = await st(p);
    check('[laptop] dragging the price axis down squeezes the prices', a1.manual && (a1.hi - a1.lo) > r0 * 1.3, { from: +r0.toFixed(2), to: +(a1.hi - a1.lo).toFixed(2) });
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy + 60, { steps: 5 }); await p.mouse.up(); await sleep(250);
    const a2 = await st(p);
    check('[laptop] with the price scale set by hand, dragging the chart down shows higher prices', a2.lo > a1.lo && Math.abs((a2.hi - a2.lo) - (a1.hi - a1.lo)) < 1e-6, { lo: [+a1.lo.toFixed(2), +a2.lo.toFixed(2)] });
    await p.mouse.move(ax, ay); await p.mouse.wheel(0, -200); await sleep(250);
    const a3 = await st(p);
    check('[laptop] the wheel on the price axis stretches the prices', (a3.hi - a3.lo) < (a2.hi - a2.lo));
    await p.mouse.dblclick(ax, ay); await sleep(300);
    const a4 = await st(p);
    check('[laptop] two quick taps on the price axis fit the prices again', Math.abs((a4.hi - a4.lo) - r0) < r0 * 0.02, { range: +(a4.hi - a4.lo).toFixed(2) });
    const tx = B.x + B.w * 0.5, ty = B.y + B.h - 12;
    await p.mouse.move(cx, cy); await p.mouse.wheel(0, -400); await sleep(250);
    const a5 = await st(p);
    await p.mouse.move(tx, ty); await p.mouse.down(); await p.mouse.move(tx - 120, ty, { steps: 5 }); await p.mouse.up(); await sleep(250);
    const a6 = await st(p);
    check('[laptop] dragging the time axis left fits more candles in, keeping the right edge', a6.slots > a5.slots && Math.abs((a6.first + a6.slots) - (a5.first + a5.slots)) < 0.6, { from: a5.slots, to: a6.slots });
    await p.click('#ch-reset'); await sleep(250);
    check('[laptop] Reset view undoes both scales', !(await st(p)).manual);
    // TradingView in the panel
    await p.click('#ch-tv'); await sleep(300);
    const tv1 = await p.evaluate(() => ({ shown: !document.getElementById('tv-wrap').hidden, src: document.getElementById('tv-frame').getAttribute('src'), label: document.getElementById('ch-tv-label').textContent, drawOff: document.getElementById('ch-draw').disabled, sym: window.__indai.app.settings.main, iv: window.__indai.app.settings.interval, out: document.getElementById('tv-out').href }));
    check('[laptop] TradingView chart shows their chart for this ticker and candle size in the panel', tv1.shown && new globalThis.URL(tv1.src).origin === 'https://www.tradingview-widget.com' && JSON.parse(decodeURIComponent(new globalThis.URL(tv1.src).hash.slice(1))).symbol === tv1.sym && JSON.parse(decodeURIComponent(new globalThis.URL(tv1.src).hash.slice(1))).interval === String(parseInt(tv1.iv)) && tv1.drawOff && tv1.label === 'INDAI chart' && tv1.out.includes(tv1.sym), { src: tv1.src.slice(0, 90) });
    await p.click('#ch-next'); await sleep(500);
    const tv2 = await p.evaluate(() => ({ src: document.getElementById('tv-frame').getAttribute('src'), sym: window.__indai.app.settings.main }));
    check('[laptop] it follows the ticker', JSON.parse(decodeURIComponent(new globalThis.URL(tv2.src).hash.slice(1))).symbol === tv2.sym && tv2.sym !== tv1.sym);
    await p.click('#ch-prev'); await p.click('#ch-tv'); await sleep(400);
    const tv3 = await p.evaluate(() => ({ hidden: document.getElementById('tv-wrap').hidden, src: document.getElementById('tv-frame').getAttribute('src'), drawOff: document.getElementById('ch-draw').disabled, geo: !!window.__indai.app.chart.geo }));
    check('[laptop] INDAI chart brings the own chart back and unloads the frame', tv3.hidden && tv3.src === 'about:blank' && !tv3.drawOff && tv3.geo);
    // drawing a trend line by dragging
    await p.click('#ch-draw'); await p.click('#ch-tools [data-tool="line"]');
    const s5 = await st(p);
    check('[laptop] Draw opens the bar and arms the tool', s5.drawing && !s5.barHidden && s5.tool === 'line' && s5.touch === 'none');
    const Bd = await box(p); // the chart is a little shorter while the drawing bar is open
    const x1 = Bd.x + Bd.w * 0.25, y1 = Bd.y + Bd.h * 0.6, x2 = Bd.x + Bd.w * 0.55, y2 = Bd.y + Bd.h * 0.35;
    await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x2, y2, { steps: 8 }); await p.mouse.up(); await sleep(200);
    const s6 = await st(p);
    check('[laptop] a drag draws one trend line, selects it and goes back to moving', s6.list.length === 1 && s6.list[0].type === 'line' && s6.selected && s6.tool === 'move', s6.list[0] && { a: s6.list[0].a.p.toFixed(2), b: s6.list[0].b.p.toFixed(2) });
    check('[laptop] the line runs upward in price as drawn', s6.list[0] && s6.list[0].b.p > s6.list[0].a.p && s6.list[0].b.t > s6.list[0].a.t);
    // drag its end
    await p.mouse.move(x2, y2); await p.mouse.down(); await p.mouse.move(x2 + 40, y2 - 30, { steps: 5 }); await p.mouse.up(); await sleep(200);
    const s7 = await st(p);
    check('[laptop] dragging an end of the selected line changes that end only', s7.list.length === 1 && s7.list[0].b.p > s6.list[0].b.p && Math.abs(s7.list[0].a.p - s6.list[0].a.p) < 1e-9, { b: s7.list[0].b.p.toFixed(2) });
    // drag its body
    const mx = (x1 + x2 + 40) / 2, my = (y1 + y2 - 30) / 2;
    await p.mouse.move(mx, my); await p.mouse.down(); await p.mouse.move(mx, my + 40, { steps: 5 }); await p.mouse.up(); await sleep(200);
    const s8 = await st(p);
    check('[laptop] dragging the body moves the whole line', s8.list[0].a.p < s7.list[0].a.p && s8.list[0].b.p < s7.list[0].b.p && Math.abs((s8.list[0].b.p - s8.list[0].a.p) - (s7.list[0].b.p - s7.list[0].a.p)) < 1e-6);
    // a level
    await p.click('#ch-tools [data-tool="level"]');
    const ly = Bd.y + Bd.h * 0.2;
    await p.mouse.click(Bd.x + Bd.w * 0.4, ly); await sleep(200);
    const s9 = await st(p);
    const lvl = s9.list.find(d => d.type === 'level');
    const want = s9.hi - ((ly - Bd.y - s9.plot.y) / s9.plot.h) * (s9.hi - s9.lo);
    check('[laptop] Level puts a line at the tapped price', !!lvl && Math.abs(lvl.p - want) < (s9.hi - s9.lo) * 0.01 && s9.tool === 'move', lvl && { p: lvl.p.toFixed(2), want: want.toFixed(2) });
    // they survive a reload
    await p.reload(); await ready(p);
    const s10 = await st(p);
    check('[laptop] drawings are still there after a reload', s10.list.length === 2 && s10.count === 2, { count: s10.count });
    // tap to select, then delete
    const B2 = await box(p);
    await p.mouse.click(B2.x + B2.w * 0.4, await yOf(p, lvl.p)); await sleep(200);
    const s11 = await st(p);
    check('[laptop] tapping a level selects it and opens the bar', s11.selected && s11.drawing && !s11.barHidden);
    await p.click('#ch-del'); await sleep(150);
    const s12 = await st(p);
    check('[laptop] Delete removes the selected one', s12.list.length === 1 && s12.list[0].type === 'line' && !s12.selected);
    await p.click('#ch-clear'); await sleep(150);
    const s13 = await st(p);
    check('[laptop] Clear all removes the rest', s13.list.length === 0 && s13.count === 0);
    // tap-tap line, then Escape
    await p.click('#ch-tools [data-tool="line"]');
    const B3 = await box(p);
    await p.mouse.click(B3.x + B3.w * 0.3, B3.y + B3.h * 0.5); await sleep(100);
    const s14 = await st(p);
    check('[laptop] one tap places the start and waits for the end', s14.pending && s14.list.length === 0 && s14.tool === 'line');
    await p.mouse.click(B3.x + B3.w * 0.6, B3.y + B3.h * 0.4); await sleep(150);
    const s15 = await st(p);
    check('[laptop] the second tap finishes the line', s15.list.length === 1 && !s15.pending);
    await p.keyboard.press('Delete'); await sleep(100);
    check('[laptop] the Delete key removes the selected line', (await st(p)).list.length === 0);
    await p.keyboard.press('Escape'); await sleep(100);
    const s16 = await st(p);
    check('[laptop] Escape closes the drawing bar', !s16.drawing && s16.barHidden && s16.touch === '');
    // scrolling back into earlier sessions
    const h0 = await p.evaluate(() => { const g = window.__indai.app.chart.geo; return { H: g.H, full: g.full, max: g.maxSlots }; });
    const Bh = await box(p), hx = Bh.x + Bh.w * 0.4, hy = Bh.y + Bh.h * 0.5;
    for (let n = 0; n < 3; n++) { await p.mouse.move(hx, hy); await p.mouse.down(); await p.mouse.move(hx + 420, hy, { steps: 5 }); await p.mouse.up(); await sleep(350); }
    await sleep(600);
    const h1 = await p.evaluate(() => { const c = window.__indai.app.chart, g = c.geo; return { H: g.H, first: +g.first.toFixed(1), max: g.maxSlots, neg: g.pts.filter(q => q.i < 0).length, hist: window.__indai.app.history.state(window.__indai.app.settings.main), open: g.open }; });
    check('[laptop] dragging back past the open brings in earlier sessions', h0.H === 0 && h1.H >= 78 && h1.neg > 0 && h1.first < 0 && h1.max > h0.max, { before: h0, after: { H: h1.H, first: h1.first, shown: h1.neg, max: h1.max } });
    await p.mouse.move(hx, hy); await p.mouse.wheel(0, 900); await sleep(400); await p.mouse.wheel(0, 900); await sleep(700);
    const h2 = await p.evaluate(() => { const g = window.__indai.app.chart.geo; return { slots: Math.round(g.slots), full: g.full, H: g.H, days: new Set(g.pts.map(q => q.day)).size }; });
    check('[laptop] zooming out shows more than one session at once', h2.slots > h2.full && h2.days >= 2, h2);
    await p.click('#ch-draw'); await p.click('#ch-tools [data-tool="line"]');
    const Bx = await box(p);
    await p.mouse.move(Bx.x + Bx.w * 0.15, Bx.y + Bx.h * 0.6); await p.mouse.down(); await p.mouse.move(Bx.x + Bx.w * 0.8, Bx.y + Bx.h * 0.4, { steps: 6 }); await p.mouse.up(); await sleep(200);
    const h3 = await st(p);
    const openT = h1.open, ln = h3.list.find(d => d.type === 'line');
    check('[laptop] a trend line can be drawn across earlier sessions', !!ln && Math.min(ln.a.t, ln.b.t) < openT && h3.selected, ln && { from: new Date(Math.min(ln.a.t, ln.b.t)).toISOString().slice(0, 16), to: new Date(Math.max(ln.a.t, ln.b.t)).toISOString().slice(0, 16) });
    await p.mouse.move(Bx.x + Bx.w * 0.5, Bx.y + Bx.h * 0.9); await p.mouse.wheel(0, -500); await sleep(500);
    const h4 = await st(p);
    check('[laptop] it keeps its two points when the zoom changes', h4.list.length === 1 && h4.list[0].a.t === ln.a.t && h4.list[0].b.p === ln.b.p);
    await p.click('#ch-clear'); await p.keyboard.press('Escape'); await p.click('#ch-reset'); await sleep(300);
    check('[laptop] Reset view returns to today', !(await st(p)).manual && (await p.evaluate(() => window.__indai.app.chart.geo.first)) >= 0);
    // changing the ticker or candle size goes back to the automatic view
    await p.mouse.move(cx, cy); await p.mouse.wheel(0, -300); await sleep(200);
    await p.click('#ch-next'); await sleep(500);
    check('[laptop] another ticker starts in the automatic view', !(await st(p)).manual);
    await p.screenshot({ path: __dirname + '/chart-laptop.png' });
    check('[laptop] no page errors', errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }
  // ---------------------------------------------------------------- phone, touch
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(URL); await ready(p);
    await p.evaluate(() => document.querySelector('nav [data-tab="chart"], button[data-tab="chart"]').click()); await sleep(500);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: Math.round(q[0]), y: Math.round(q[1]), id: i + 1 })) });
    const swipe = async (from, to, steps = 6) => { await touch('touchStart', [from]); for (let i = 1; i <= steps; i++) { await touch('touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]); await sleep(16); } await touch('touchEnd', []); await sleep(250); };
    const B = await box(p), s0 = await st(p), cy = B.y + B.h * 0.5;
    // eight candle sizes take a line of their own on a phone; the overlay switches, Draw and Analyze share the next
    check('[phone] the candle sizes fill one line and the other chart tools fit on the next', await p.evaluate(() => { const t = document.querySelector('.chart-tools'), d = document.getElementById('ch-draw').getBoundingClientRect(), a = document.getElementById('ch-analyze').getBoundingClientRect(), s = document.getElementById('ch-show').getBoundingClientRect(), f = document.getElementById('ch-tf'); const fb = f.getBoundingClientRect(), last = f.lastElementChild.getBoundingClientRect(); return Math.abs(d.top - s.top) < 12 && Math.abs(a.top - s.top) < 12 && d.top > fb.bottom - 2 && last.right <= fb.right + 1 && f.scrollWidth <= f.clientWidth + 1 && t.scrollWidth <= t.clientWidth + 1; }));
    await swipe([B.x + B.w * 0.3, cy], [B.x + B.w * 0.7, cy]);
    const s1 = await st(p);
    check('[phone] a sideways drag moves the chart', s1.manual && s1.first < s0.first, { from: s0.first, to: s1.first });
    // pinch out = zoom in
    await touch('touchStart', [[B.x + B.w * 0.45, cy], [B.x + B.w * 0.55, cy]]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[B.x + B.w * (0.45 - 0.04 * i), cy], [B.x + B.w * (0.55 + 0.04 * i), cy]]); await sleep(16); }
    await touch('touchEnd', []); await sleep(300);
    const s2 = await st(p);
    check('[phone] spreading two fingers zooms in', s2.slots < s1.slots, { from: s1.slots, to: s2.slots });
    // double tap resets
    await p.touchscreen.tap(B.x + B.w * 0.5, cy); await sleep(90); await p.touchscreen.tap(B.x + B.w * 0.5, cy); await sleep(300);
    const s3 = await st(p);
    check('[phone] two quick taps go back to the automatic view', !s3.manual);
    // the price axis with a finger
    const pr0 = s3.hi - s3.lo;
    await swipe([B.x + B.w - 22, B.y + B.h * 0.3], [B.x + B.w - 22, B.y + B.h * 0.6], 6);
    const pa = await st(p);
    check('[phone] a finger on the price axis squeezes the prices instead of scrolling the page', pa.manual && (pa.hi - pa.lo) > pr0 * 1.3 && pa.touch === 'none', { from: +pr0.toFixed(2), to: +(pa.hi - pa.lo).toFixed(2) });
    await swipe([B.x + B.w * 0.5, cy], [B.x + B.w * 0.5, cy + 60], 6);
    const pb = await st(p);
    check('[phone] then a finger moves the chart up and down too', pb.lo > pa.lo);
    await p.tap('#ch-reset'); await sleep(250);
    const pc = await st(p);
    check('[phone] Reset view fits it again and gives page scrolling back', !pc.manual && pc.touch === '');
    // draw with a finger
    await p.tap('#ch-draw'); await p.tap('#ch-tools [data-tool="line"]'); await sleep(150);
    const B1 = await box(p);
    await swipe([B1.x + B1.w * 0.2, B1.y + B1.h * 0.65], [B1.x + B1.w * 0.6, B1.y + B1.h * 0.3], 8);
    const s4 = await st(p);
    check('[phone] a finger drag draws a trend line', s4.list.length === 1 && s4.list[0].type === 'line' && s4.selected, { n: s4.list.length });
    check('[phone] the page does not scroll sideways', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.tap('#ch-tools [data-tool="level"]'); await p.touchscreen.tap(B1.x + B1.w * 0.5, B1.y + B1.h * 0.15); await sleep(200);
    const s5 = await st(p);
    check('[phone] a tap places a level', s5.list.filter(d => d.type === 'level').length === 1);
    // drag the selected level down with a finger
    const before = s5.list.find(d => d.type === 'level').p;
    const lvy = await yOf(p, before);
    await swipe([B1.x + B1.w * 0.5, lvy], [B1.x + B1.w * 0.5, lvy + B1.h * 0.25], 6);
    const s6 = await st(p);
    check('[phone] the selected level can be dragged to another price', s6.list.find(d => d.type === 'level').p < before, { from: before.toFixed(2), to: s6.list.find(d => d.type === 'level').p.toFixed(2) });
    await p.screenshot({ path: __dirname + '/chart-phone.png' });
    await p.tap('#ch-clear'); await sleep(150);
    check('[phone] Clear all removes them', (await st(p)).list.length === 0);
    await p.tap('#ch-draw'); await sleep(150);
    check('[phone] closing Draw gives page scrolling back to the chart', (await st(p)).touch === '');
    check('[phone] no page errors', errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }
  await b.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
