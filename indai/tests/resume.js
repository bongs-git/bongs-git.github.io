// Real-data mode on a phone: dropped requests must not block the next ones, prices refresh on resume,
// and the morning chart fills the screen with labels that don't overlap.
const { chromium } = require('./browser.cjs');
const OUT = __dirname, URL = process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); };
const PX = { SPY: 749, QQQ: 673, IWM: 276, TSLA: 387, AMZN: 265, MSFT: 528 };
const etYMD = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
function minutesSoFar() { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date()); const m = (+p.find(x => x.type === 'hour').value % 24) * 60 + +p.find(x => x.type === 'minute').value; return Math.max(0, Math.min(390, m - 570 - 15)); }
function bars(sym, n) { let p = PX[sym], out = []; let s = sym.charCodeAt(0) * 7 + 3; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let i = 0; i < n; i++) { const o = p; p = p * (1 + rnd() * 0.0012 - (sym === 'QQQ' && i > 25 && i < 70 ? 0.00045 : 0)); out.push([571 + i, +o.toFixed(2), +(Math.max(o, p) * 1.0004).toFixed(2), +(Math.min(o, p) * 0.9996).toFixed(2), +p.toFixed(2), 30000]); }
  return out; }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const n = minutesSoFar(); console.log('   minutes of session in the mock:', n);
  if (n < 20) { console.log('   (market not open long enough right now for the morning-chart check; skipping)'); process.exit(0); }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  let drop = false; const seen = { snapshot: 0, dropped: 0 };
  await page.route('**://zptjziewsfuvfcogrikz.supabase.co/**', async (route) => {
    const req = route.request(), u = new globalThis.URL(req.url()), q = u.searchParams;
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(b) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (drop) { seen.dropped++; return route.abort('internetdisconnected'); }
    if (u.pathname.endsWith('/indai-market')) {
      const kind = q.get('kind'), syms = (q.get('symbols') || '').split(',').filter(s => PX[s]);
      if (kind === 'snapshot') { seen.snapshot++; return json({ quotes: syms.map(s => { const b = bars(s, n), c = b[b.length - 1][4]; return { symbol: s, ok: true, price: c, close: c, prevClose: PX[s] * 1.004, open: b[0][1], high: Math.max(...b.map(x => x[2])), low: Math.min(...b.map(x => x[3])), iv30: 19, timestamp: new Date().toISOString() }; }) }); }
      if (kind === 'bars') return json({ bars: Object.fromEntries(syms.map(s => [s, { session: etYMD(new Date()), bars: bars(s, n) }])) });
      return json({ error: 'not in this mock' });
    }
    if (u.pathname.endsWith('/indai-tv')) return json(q.get('bars') ? { bars: [] } : { alerts: [] });
    if (u.pathname.endsWith('/indai_gex_levels')) { const t = etYMD(new Date()); return json([{ ticker: 'QQQ', scope: 'A', asof_et: `${t} 08:46`, call_wall: 680, put_wall: 650, call_wall2: null, put_wall2: 670, gamma_flip: 670.47 }, { ticker: 'QQQ', scope: 'N', asof_et: `${t} 08:46`, expiry: t, call_wall: 680, put_wall: 664, gamma_flip: 670.47 }]); }
    if (u.pathname.endsWith('/indai-brain')) return json({ configured: false });
    return json({});
  });
  await page.goto(URL + '?nosw=1&nocheckin=1');
  await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.cboe === 'ok' && window.__indai.app.feed.getBars('QQQ', '5min').length > 3, null, { timeout: 20000 });
  await page.evaluate(() => window.__indai.app.selectSymbol('QQQ')); await sleep(1200);
  const A = (fn) => page.evaluate(fn);
  const g = await A(() => { const c = window.__indai.app.views.chart; const ch = document.getElementById('chart-host'); return { badge: document.getElementById('t-badge').textContent }; });
  await page.screenshot({ path: `${OUT}/r-phone-morning.png` });
  // the last candle should sit well into the chart, not in the left fifth
  const fill = await A(() => { const cv = document.querySelector('#chart-host canvas.base'), w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, Math.round(h * 0.2), w, Math.round(h * 0.6)).data; let maxX = 0; for (let y = 0; y < Math.round(h * 0.6); y += 3) for (let x = 0; x < w * 0.84; x++) { const i = (y * w + x) * 4; if ((d[i] > 200 && d[i + 1] < 140) || (d[i + 1] > 180 && d[i] < 100)) maxX = Math.max(maxX, x); } return +(maxX / w).toFixed(2); });
  check('morning chart uses the width (last candle past 45% of it)', fill > 0.45, 'last candle at ' + fill);
  // 1. three quote pulls die in a row (weak signal). Nothing may be blocked afterwards.
  await sleep(9000);   // let the 8-second quote cache lapse so the next pulls really go to the network
  drop = true; await A(() => { const f = window.__indai.app.feed; f.lastSnap = 0; return f.cboeTick(); });
  await sleep(600); await A(() => { const f = window.__indai.app.feed; f.lastSnap = 0; return f.cboeTick(); });
  await sleep(600); await A(() => { const f = window.__indai.app.feed; f.lastSnap = 0; return f.cboeTick(); });
  const st1 = await A(() => window.__indai.app.feed.status.cboe);
  drop = false; const before = seen.snapshot; const t0 = Date.now();
  await page.waitForFunction(() => window.__indai.app.feed.status.cboe === 'ok', null, { timeout: 15000 }).catch(() => {});
  const took = Date.now() - t0, st2 = await A(() => window.__indai.app.feed.status.cboe);
  check('after dropped requests the feed recovers within seconds, with no lock-out', st1 === 'err' && st2 === 'ok' && took < 7000 && seen.snapshot > before, JSON.stringify({ st1, st2, tookMs: took, dropped: seen.dropped }));
  const badge = await A(() => document.getElementById('t-badge').textContent);
  check('badge is back to normal', /Delayed/.test(badge), badge);
  // 2. coming back to the app pulls fresh prices at once
  await sleep(9000);
  const b2 = seen.snapshot;
  await A(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(1500);
  check('returning to the app refreshes prices straight away', seen.snapshot > b2, `snapshots ${b2} -> ${seen.snapshot}`);
  // 3. badge explains how to get live prices
  await page.tap('#t-badge'); await sleep(300);
  const toast = await page.textContent('#toast');
  check('badge tap explains the delay and how to go live', /Finnhub/.test(toast) && /TradingView/.test(toast), JSON.stringify(toast));
  await page.screenshot({ path: `${OUT}/r-phone-toast.png` });
  check('no page errors', errs.length === 0, errs.join('|'));
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
