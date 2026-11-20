// Pre-market and after-hours on the chart and under the price (js/ext.js, js/history.js, js/chart.js).
// The clock is set, so this test gives the same answer at any time of day. Three parts: a stand-in backend before
// the open, the same after the open, and demo mode.
const { chromium } = require('playwright');
const URL = process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };

// Wednesday November 18 to Friday November 20, 2026 (New York is UTC-5). One-minute candles from 4:00 AM to 8:00 PM.
const DAY = { wed: '2026-11-18', thu: '2026-11-19', fri: '2026-11-20' };
const at = (ymd, hhmm) => Date.parse(`${ymd}T${hhmm}:00-05:00`);
const PX = { SPY: 680, QQQ: 645, IWM: 276, TSLA: 388, AMZN: 265, MSFT: 532, NVDA: 156 };
function candles(sym, until) {
  let seed = sym.charCodeAt(0) * 131 + sym.length, p = PX[sym] || 100;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const out = [];
  for (const ymd of Object.values(DAY)) for (let t = at(ymd, '04:00'); t < at(ymd, '20:00') && t + 60e3 <= until; t += 60e3) {
    const o = p; p = p * (1 + rnd() * 0.0009); const c = p;
    out.push({ t, o: +o.toFixed(2), h: +(Math.max(o, c) * 1.0002).toFixed(2), l: +(Math.min(o, c) * 0.9998).toFixed(2), c: +c.toFixed(2), v: 900 + Math.round(Math.abs(rnd()) * 4000) });
  }
  return out;
}
const regular = (b, ymd) => b.t >= at(ymd, '09:30') && b.t < at(ymd, '16:00');

// The backend as HANDOFF.md describes it: delayed quotes and regular-hours candles for the session on the chart,
// and the bridge's stored one-minute candles (extended hours included) a page at a time.
async function backend(page, now, session, live, forming) {
  const calls = { pages: 0, own: 0, feed: 0, seen: [] };
  await page.route('**://zptjziewsfuvfcogrikz.supabase.co/**', async (route) => {
    const req = route.request(), u = new globalThis.URL(req.url()), q = u.searchParams;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(b) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.pathname.endsWith('/indai-market')) {
      const kind = q.get('kind'), syms = (q.get('symbols') || '').split(',').filter(s => PX[s]);
      const day = (s) => candles(s, now).filter(b => regular(b, session));
      if (kind === 'snapshot') return json({ source: 'CBOE delayed quotes', delay: 900, quotes: syms.map(s => { const d = day(s), all = candles(s, now), prev = candles(s, now).filter(b => regular(b, session === DAY.fri ? DAY.thu : DAY.wed)); return { symbol: s, ok: true, price: all[all.length - 1].c, close: d[d.length - 1].c, prevClose: prev[prev.length - 1].c, open: d[0].o, high: Math.max(...d.map(b => b.h)), low: Math.min(...d.map(b => b.l)), volume: 1e6, timestamp: new Date(now).toISOString(), iv30: 19 }; }) });
      if (kind === 'bars') return json({ source: 'CBOE delayed quotes', delay: 900, bars: Object.fromEntries(syms.map(s => [s, { session, bars: day(s).map(b => [Math.round((b.t - at(session, '00:00')) / 60e3) + 1, b.o, b.h, b.l, b.c, b.v]) }])) });
      return json({ error: 'unavailable', message: 'not in this test' }, 503);
    }
    if (u.pathname.endsWith('/indai-tv')) {
      if (q.get('ticker')) { // one ticker's stored candles, newest first, older than `before`
        if (q.get('before')) calls.pages++; else calls.own++;
        const before = +q.get('before') || now + 60e3, limit = +q.get('limit') || 1000;
        return json({ ticker: q.get('ticker'), bars: candles(q.get('ticker'), now).filter(b => b.t < before).reverse().slice(0, limit), now });
      }
      if (q.get('bars')) { // candles the bridge has just delivered, and the one still forming, as the page's clock has it
        calls.feed++; if (q.get('seen')) calls.seen.push(q.get('seen'));
        const t = await page.evaluate(() => Date.now()).catch(() => now);
        return json({ bars: live.splice(0), live: forming.splice(0).map(({ age = 0, ...r }) => ({ ...r, received_at: new Date(t - age).toISOString() })), now: t, cursor: new Date(t - 1500).toISOString() });
      }
      return json({ alerts: [] });
    }
    if (u.pathname.endsWith('/indai_gex_levels')) return json([]);
    if (u.pathname.endsWith('/indai-brain')) return json(req.method() === 'GET' ? { configured: false, passcode: false, memory: true } : { error: 'not_configured', message: 'off in this test' }, req.method() === 'GET' ? 200 : 503);
    return json({ error: 'not_found' }, 404);
  });
  return calls;
}
async function start(b, { now, demo = false, session, viewport = { width: 1280, height: 860 } }) {
  const ctx = await b.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(() => { if (window !== window.top) return; const s = JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}'); s.voice = false; s.voiceEngine = 'system'; s.main = 'QQQ'; s.interval = '5min'; localStorage.setItem('jarvis.settings.v1', JSON.stringify(s)); });
  const live = [], forming = [], calls = demo ? null : await backend(page, now, session, live, forming);
  await page.goto(URL + '?nosw=1&nocheckin=1' + (demo ? '&demo=1' : ''));
  await page.waitForFunction(() => window.__indai && window.__indai.app.chart && window.__indai.app.chart.geo, null, { timeout: 30000 });
  await sleep(1500);
  return { ctx, page, live, forming, calls, errors };
}
const look = (page) => page.evaluate(() => {
  const a = window.__indai.app, c = a.chart, g = c.geo, q = a.feed.quote(a.settings.main);
  a.ext.paint();
  const xs = g.pts.filter(p => p.x);
  return { X: g.X, H: g.H, full: g.full, first: +g.first.toFixed(2), slots: +g.slots.toFixed(2), pts: g.pts.length, xpts: xs.length, xneg: xs.filter(p => p.i < 0).length,
    kinds: [...new Set(xs.map(p => a.ext.kind(p.b.t)))].sort().join(','), firstAfter: g.X ? g.xb[0].t : null, lastAfter: g.X ? g.xb[g.X - 1].t : null, lastAfterC: g.X ? g.xb[g.X - 1].c : null,
    noLines: xs.every(p => p.vw == null && p.e5 == null && p.e50 == null), regLines: g.pts.filter(p => !p.x).every(p => p.vw != null),
    line: document.getElementById('ch-ext').textContent, tone: document.getElementById('ch-ext').className, last: q && q.last, ext: a.ext.last(a.settings.main), manual: c.state().manual,
    extBtn: document.querySelector('#ch-show [data-show="ext"]').classList.contains('on') };
});

(async () => {
  const b = await chromium.launch();
  try {
    // ---------------------------------------------------------------- before the open (Friday 5:30 AM New York)
    {
      const now = at(DAY.fri, '05:30');
      const { ctx, page, live, forming, calls, errors } = await start(b, { now, session: DAY.thu });
      const all = candles('QQQ', now), close = all.filter(c => regular(c, DAY.thu)).pop().c, newest = all[all.length - 1];
      const s = await look(page);
      check('[pre-market] the chart carries on after the close: 48 after-hours and 18 pre-market five-minute candles', s.X === 66 && s.xpts >= 66 && s.kinds === 'post,pre' && s.full === 78, s);
      check('[pre-market] they start at 4:00 PM Thursday and end with the newest stored candle', s.firstAfter === at(DAY.thu, '16:00') && s.lastAfter === at(DAY.fri, '05:25') && s.lastAfterC === newest.c, s);
      check('[pre-market] the whole session and its extended hours fit the automatic view', s.first === 0 && s.slots === 78 + 66 + 2 && !s.manual, s);
      check('[pre-market] extended-hours candles carry no VWAP or EMA, regular ones keep theirs', s.noLines && s.regLines);
      const chg = newest.c - close, want = `Pre-market ${newest.c.toFixed(2)}  ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}  ${chg >= 0 ? '+' : ''}${(chg / close * 100).toFixed(2)}%`;
      check('[pre-market] the price stays the regular close, with the pre-market price and its change under it', Math.abs(s.last - close) < 0.006 && s.line === want && /\b(up|down|flat)\b/.test(s.tone), { line: s.line, want, last: s.last, close });
      check('[pre-market] the newest stored candles were fetched once, without paging history', calls.own === 1 && calls.pages === 0, calls);

      // a candle from the bridge arrives while the page is open
      const fresh = { ticker: 'QQQ', tf: '1', t: at(DAY.fri, '05:30'), o: newest.c, h: newest.c + 0.6, l: newest.c - 0.1, c: +(newest.c + 0.5).toFixed(2), v: 1200 };
      await page.clock.fastForward(61e3); live.push(fresh);
      await page.waitForFunction((c) => window.__indai.app.ext.last('QQQ')?.price === c && window.__indai.app.chart.geo?.X === 67, fresh.c, { timeout: 15000 }).catch(() => {});
      const s2 = await look(page);
      check('[pre-market] a candle the bridge delivers shows within seconds: one more candle, and the price under the price moves', s2.X === 67 && s2.lastAfter === fresh.t && s2.lastAfterC === fresh.c && s2.line.startsWith(`Pre-market ${fresh.c.toFixed(2)} `) && Math.abs(s2.last - close) < 0.006, s2);

      // the candle that is still forming, sent by the bridge between closes
      const minute = Math.floor((await page.evaluate(() => Date.now())) / 60e3) * 60e3, up = (d) => +(fresh.c + d).toFixed(2);
      // waits until the price is in and the chart has redrawn with it by itself
      const extPrice = (c) => page.waitForFunction((v) => { const a = window.__indai.app, g = a.chart.geo; return a.ext.last('QQQ')?.price === v && !!g && g.X > 0 && g.xb[g.X - 1].c === v; }, c, { timeout: 15000 }).catch(() => {});
      forming.push({ ticker: 'QQQ', t: minute, o: fresh.c, h: up(0.9), l: up(-0.2), c: up(0.8), v: 300 });
      await extPrice(up(0.8));
      const f1 = await look(page), pace = await page.evaluate(() => window.__indai.app.bridgePace());
      check('[pre-market] an update of the forming candle moves the pre-market price and that candle; the close does not move', f1.line.startsWith(`Pre-market ${up(0.8).toFixed(2)} `) && f1.ext.t === minute && Math.abs(f1.last - close) < 0.006 && f1.lastAfterC === up(0.8), f1);
      check('[pre-market] from then on the page rests between updates and tells the backend what it has seen', pace.live && pace.gap === 12500 && !!pace.seen && calls.seen.length >= 1, { pace, seen: calls.seen.length });
      // none of these may change anything: an update that is 60 seconds old, one for a minute that has already closed, one for a ticker nobody watches
      forming.push({ ticker: 'QQQ', t: minute, c: 1, age: 60e3 }, { ticker: 'QQQ', t: fresh.t, c: 2 }, { ticker: 'ZZZZ', t: minute, c: 3 });
      await page.clock.fastForward(13e3); await sleep(1200);
      const f2 = await look(page);
      check('[pre-market] an old update, one for a closed minute and one for an unknown ticker are passed over', f2.line === f1.line && forming.length === 0 && !(await page.evaluate(() => window.__indai.app.feed.syms.has('ZZZZ'))), { line: f2.line, left: forming.length });
      forming.push({ ticker: 'QQQ', t: minute, o: fresh.c, h: up(1.3), l: up(-0.2), c: up(1.1), v: 500 });
      await page.clock.fastForward(2e3); await extPrice(up(1.1));
      const f3 = await look(page);
      check('[pre-market] the next update of the same minute replaces it, within a couple of seconds', f3.line.startsWith(`Pre-market ${up(1.1).toFixed(2)} `) && f3.lastAfterC === up(1.1), f3);
      const feedCalls = calls.feed; await sleep(5000);
      check('[pre-market] between updates the page does not keep asking', calls.feed - feedCalls <= 1, { asked: calls.feed - feedCalls });
      // the finished candle for that minute arrives: it is what stays, and a late update for it changes nothing
      live.push({ ticker: 'QQQ', tf: '1', t: minute, o: fresh.c, h: up(1.4), l: up(-0.3), c: up(0.6), v: 2100, received_at: new Date(minute + 61e3).toISOString() });
      await page.clock.fastForward(14e3); await extPrice(up(0.6));
      forming.push({ ticker: 'QQQ', t: minute, c: 9 });
      await page.clock.fastForward(14e3); await sleep(1200);
      const f4 = await look(page);
      check('[pre-market] the finished candle replaces the forming one and is not reopened by a late update', f4.line.startsWith(`Pre-market ${up(0.6).toFixed(2)} `) && f4.ext.t === minute && forming.length === 0, f4);

      // live trades (a Finnhub key), in a minute of their own: the forming candle and the price under the price tick; the close does not move
      await page.clock.fastForward(61e3); await sleep(300);
      const tick = +(fresh.c + 1.25).toFixed(2);
      const s3 = await page.evaluate((p) => { const a = window.__indai.app, t = Math.floor(Date.now() / 60e3) * 60e3 + 2000; a.feed.applyTrade('QQQ', p - 0.4, 50, t); a.feed.applyTrade('QQQ', p, 70, t + 900); a.chart.draw(); a.ext.paint(); const g = a.chart.geo, lb = g.xb[g.X - 1];
        return { last: a.feed.quote('QQQ').last, ext: a.feed.quote('QQQ').ext, c: lb.c, h: lb.h, t: lb.t, X: g.X, line: document.getElementById('ch-ext').textContent, raw: a.feed.syms.get('QQQ').bars['1min'].filter(x => x.t === t - 2000).length }; }, tick);
      check('[pre-market] a live trade moves the forming candle and the pre-market price, and leaves the regular close alone', Math.abs(s3.last - close) < 0.006 && s3.ext === tick && s3.c === tick && s3.h >= tick && s3.line.startsWith(`Pre-market ${tick.toFixed(2)} `) && s3.raw === 0, s3);
      const odd = await page.evaluate(() => { const a = window.__indai.app, before = a.ext.last('QQQ').price, q0 = a.feed.quote('QQQ').last; a.feed.applyTrade('QQQ', 999, 10, Date.parse('2026-11-21T15:00:00Z')); a.feed.applyTrade('QQQ', 0, 10, Date.now()); return a.ext.last('QQQ').price === before && a.feed.quote('QQQ').last === q0; });
      check('[pre-market] a weekend trade or an empty price changes nothing', odd);

      // the switch
      await page.click('#ch-show [data-show="ext"]'); await sleep(400);
      const off = await look(page);
      check('[pre-market] Ext off: regular hours only on the chart, the price line stays', off.X === 0 && off.xpts === 0 && !off.extBtn && off.slots <= 78 && off.line.startsWith('Pre-market '), off);
      await page.click('#ch-show [data-show="ext"]'); await sleep(400);
      const back = await look(page);
      check('[pre-market] Ext on again: they are back', back.X >= 67 && back.extBtn, back);

      // drawings: a time in the extended hours maps to its candle and back
      const map = await page.evaluate(() => { const c = window.__indai.app.chart, g = c.geo, xs = g.pts.filter(p => p.x), pick = [xs[2], xs[40], xs[xs.length - 1]];
        const reg = g.pts.find(p => !p.x && p.i > 5); // the same rule as a regular candle: its opening time is its middle
        return [reg, ...pick].map(p => ({ err: Math.abs(c.xAt(p.b.t) - g.xi(p.i)), back: Math.abs(c.timeAt(g.xi(p.i)) - p.b.t), half: Math.abs(c.xAt(p.b.t + g.ivMs / 2) - g.xi(p.i) - g.cw / 2) })); });
      check('[pre-market] a time in the extended hours lands on its candle, and the candle gives the time back', map.every(m => m.err < 0.01 && m.back < 5 && m.half < 0.01), map);

      // scrolling back: earlier sessions with their own extended hours in between
      const box = await page.evaluate(() => { const r = document.getElementById('chart-host').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      for (let n = 0; n < 4; n++) { await page.mouse.move(box.x + box.w * 0.25, box.y + box.h * 0.5); await page.mouse.down(); await page.mouse.move(box.x + box.w * 0.85, box.y + box.h * 0.5, { steps: 6 }); await page.mouse.up(); await sleep(500); }
      const h = await page.evaluate(() => { const a = window.__indai.app, g = a.chart.geo, hs = a.history.series('QQQ', '5min', g.open);
        const kinds = hs.bars.map((bar, i) => hs.x[i] ? a.ext.kind(bar.t) : 'reg').filter((k, i, arr) => i === 0 || arr[i - 1] !== k);
        return { H: g.H, first: +g.first.toFixed(1), kinds: kinds.join(' '), sorted: hs.bars.every((bar, i) => i === 0 || bar.t > hs.bars[i - 1].t), nulls: hs.bars.every((bar, i) => (hs.vw[i] == null) === !!hs.x[i] && (!hs.x[i] || (hs.e5[i] == null && hs.e50[i] == null))) && hs.e5.some(v => v != null),
          starts: hs.starts.map(i => new Date(hs.bars[i].t).toISOString().slice(0, 16)), xneg: g.pts.filter(p => p.i < 0 && p.x).length, state: a.history.state('QQQ') }; });
      check('[pre-market] dragging back shows earlier sessions with their pre-market and after-hours between them, in order', h.H > 150 && h.first < 0 && h.sorted && h.xneg > 0 && h.kinds === 'pre reg post pre', h);
      // Wednesday gets its date where its pre-market starts; Thursday's pre-market runs into the open on the chart, which carries Thursday's date
      check('[pre-market] in earlier sessions too, only regular candles carry the averages; each earlier day is marked where it starts', h.nulls && h.starts.join() === '2026-11-18T09:00', h);
      check('[pre-market] history paged the backend for the older candles', calls.pages >= 1, calls);
      check('[pre-market] no script errors', errors.length === 0, errors);
      await page.screenshot({ path: __dirname + '/ext-premarket.png' });
      await ctx.close();
    }
    // ---------------------------------------------------------------- after the open (Friday 11:00 AM New York)
    {
      const now = at(DAY.fri, '11:00');
      const { ctx, page, forming, errors } = await start(b, { now, session: DAY.fri });
      const day = candles('QQQ', now).filter(c => regular(c, DAY.fri));
      const s = await look(page);
      check('[open] nothing follows a session that is still running', s.X === 0 && s.full === 78, s);
      check('[open] this morning\'s pre-market and last night\'s after-hours sit left of the open, ready to scroll to', s.H === 48 + 66 && s.first === 0, s);
      const hi = Math.max(...day.map(c => c.h)), lo = Math.min(...day.map(c => c.l));
      check('[open] the line under the price shows the day\'s high and low', s.line === `H ${hi.toFixed(2)}  L ${lo.toFixed(2)}` && /\bday\b/.test(s.tone) && s.ext === null, { line: s.line, hi, lo });
      const st = await page.evaluate(() => { const a = window.__indai.app, hs = a.history.series('QQQ', '5min', a.chart.geo.open); return { starts: hs.starts.map(i => new Date(hs.bars[i].t).toISOString().slice(0, 16)), first: new Date(hs.bars[0].t).toISOString().slice(0, 16) }; });
      check('[open] the pre-market that runs into the open gets no second date line', st.starts.join() === '2026-11-19T21:00' && st.first === '2026-11-19T21:00', st);
      // an update of the forming candle during the session: the last price and this minute's candle move
      const m1 = Math.floor((await page.evaluate(() => Date.now())) / 60e3) * 60e3, base = day[day.length - 1].c, lc = +(base + 0.42).toFixed(2);
      forming.push({ ticker: 'QQQ', t: m1, o: base, h: +(base + 0.6).toFixed(2), l: +(base - 0.35).toFixed(2), c: lc, v: 400 });
      await page.waitForFunction((c) => window.__indai.app.feed.quote('QQQ')?.last === c, lc, { timeout: 15000 }).catch(() => {});
      const lv = await page.evaluate(() => { const a = window.__indai.app, one = a.feed.getBars('QQQ', '1min'), five = a.feed.getBars('QQQ', '5min'), nb = one[one.length - 1], fb = five[five.length - 1], g = (a.chart.draw(), a.chart.geo);
        return { last: a.feed.quote('QQQ').last, t: nb.t, o: nb.o, h: nb.h, l: nb.l, c: nb.c, v: nb.v, five: fb.c, fiveT: fb.t, chart: g.pts[g.pts.length - 1].b.c, ext: a.ext.last('QQQ'), X: g.X }; });
      check('[open] an update of the forming candle moves the last price and this minute\'s candle, on every candle size', lv.last === lc && lv.t === m1 && lv.c === lc && lv.o === base && lv.h >= +(base + 0.6).toFixed(2) && lv.l <= +(base - 0.35).toFixed(2) && lv.v > 0 && lv.five === lc && lv.fiveT === Math.floor(m1 / 300e3) * 300e3 && lv.chart === lc && lv.ext === null && lv.X === 0, lv);
      const tr = await page.evaluate(() => { const a = window.__indai.app, t = Date.now(), p = +(a.feed.quote('QQQ').last + 0.37).toFixed(2); a.feed.applyTrade('QQQ', p, 100, t); return { p, last: a.feed.quote('QQQ').last, ext: a.ext.last('QQQ') }; });
      check('[open] a regular-hours trade is the last price, as before', tr.last === tr.p && tr.ext === null, tr);
      // while trades are arriving they say more than the bridge's update, which is passed over
      forming.push({ ticker: 'QQQ', t: m1, c: +(base - 3).toFixed(2) });
      await sleep(3200);
      check('[open] with live trades arriving, a bridge update does not pull the price back', (await page.evaluate(() => window.__indai.app.feed.quote('QQQ').last)) === tr.p);
      await page.mouse.move(640, 430); await page.keyboard.down('Control'); for (let n = 0; n < 12; n++) { await page.mouse.wheel(0, 240); await sleep(60); } await page.keyboard.up('Control'); await sleep(500);
      const z = await look(page);
      check('[open] zooming out brings the pre-market into view, tinted and without averages', z.xneg > 0 && z.kinds.includes('pre') && z.noLines, z);
      check('[open] no script errors', errors.length === 0, errors);
      await page.screenshot({ path: __dirname + '/ext-open.png' });
      await ctx.close();
    }
    // ---------------------------------------------------------------- demo mode
    {
      const pre = await start(b, { now: at(DAY.fri, '05:30'), demo: true });
      const s = await look(pre.page);
      check('[demo] before the open, made-up after-hours and pre-market follow the demo session', s.X === 66 && s.kinds === 'post,pre' && s.H === 0 && s.line.startsWith('Pre-market '), s);
      check('[demo] no script errors', pre.errors.length === 0, pre.errors);
      await pre.ctx.close();
      const open = await start(b, { now: at(DAY.fri, '11:00'), demo: true });
      const o = await look(open.page);
      check('[demo] during the session there is nothing extra, before or after it', o.X === 0 && o.H === 0 && o.xpts === 0 && /^H \d/.test(o.line), o);
      await open.ctx.close();
      const phone = await start(b, { now: at(DAY.fri, '17:45'), demo: true, viewport: { width: 390, height: 844 } });
      await phone.page.evaluate(() => document.querySelector('nav [data-tab="chart"], button[data-tab="chart"]').click()); await sleep(600);
      const p = await look(phone.page);
      const fit = await phone.page.evaluate(() => { const q = document.querySelector('.quote'), x = document.getElementById('ch-ext'), t = document.querySelector('.chart-tools'), d = document.getElementById('ch-draw'), f = document.getElementById('ch-tf');
        return { over: document.documentElement.scrollWidth - innerWidth, lineInside: x.getBoundingClientRect().right <= q.getBoundingClientRect().right + 1 && x.scrollWidth <= x.clientWidth + 1, oneLine: Math.abs(d.getBoundingClientRect().top - document.getElementById('ch-show').getBoundingClientRect().top) < 12 && f.scrollWidth <= f.clientWidth + 1 && t.scrollWidth <= t.clientWidth + 1 }; });
      check('[phone] after the close: after-hours candles, with the newest in view', p.X === 21 && p.kinds === 'post' && p.line.startsWith('After hours ') && p.first + p.slots >= p.full + p.X, p);
      // the candle sizes have a line of their own on a phone (eight of them); the switches and Draw stay on one line under it
      check('[phone] the new line and the Ext switch fit: nothing scrolls sideways and the tools stay on one line', fit.over <= 0 && fit.lineInside && fit.oneLine, fit);
      await phone.page.screenshot({ path: __dirname + '/ext-phone.png' });
      await phone.ctx.close();
    }
  } catch (e) { failed++; console.log('SCRIPT ERROR', e); }
  await b.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
