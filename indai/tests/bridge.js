// Once the TradingView bridge alert is running, the website must switch to live candles by itself.
const { chromium } = require('playwright');
const OUT = __dirname, URL = 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (l, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${l} ${x}`); };
const PX = { SPY: 749, QQQ: 662, IWM: 276, TSLA: 387, AMZN: 265, MSFT: 528 };
const etYMD = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
function mins() { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date()); return (+p.find(x => x.type === 'hour').value % 24) * 60 + +p.find(x => x.type === 'minute').value - 570; }
function bars(sym, n) { let p = PX[sym], out = []; let s = sym.charCodeAt(0) * 7 + 3; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; for (let i = 0; i < n; i++) { const o = p; p = p * (1 + rnd() * 0.001); out.push([571 + i, +o.toFixed(2), +(Math.max(o, p) * 1.0003).toFixed(2), +(Math.min(o, p) * 0.9997).toFixed(2), +p.toFixed(2), 30000]); } return out; }
(async () => {
  const m = mins(); if (m < 30 || m > 385) { console.log('   (outside regular hours: skipping the live-bridge check)'); process.exit(0); }
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  let bridgeOn = false; const delayed = m - 15;
  await page.route('**://zptjziewsfuvfcogrikz.supabase.co/**', async (route) => {
    const req = route.request(), u = new globalThis.URL(req.url()), q = u.searchParams;
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(b) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.pathname.endsWith('/indai-market')) {
      const kind = q.get('kind'), syms = (q.get('symbols') || '').split(',').filter(s => PX[s]);
      if (kind === 'snapshot') return json({ quotes: syms.map(s => { const b = bars(s, delayed), c = b[b.length - 1][4]; return { symbol: s, ok: true, price: c, close: c, prevClose: PX[s], open: b[0][1], high: Math.max(...b.map(x => x[2])), low: Math.min(...b.map(x => x[3])), iv30: 19, timestamp: new Date().toISOString() }; }) });
      if (kind === 'bars') return json({ bars: Object.fromEntries(syms.map(s => [s, { session: etYMD(new Date()), bars: bars(s, delayed) }])) });
      return json({ error: 'not in this mock' });
    }
    if (u.pathname.endsWith('/indai-tv')) {
      if (!q.get('bars')) return json({ alerts: [] });
      if (!bridgeOn) return json({ bars: [], now: Date.now() });
      // what the INDAI Bridge indicator posts: one closed 1-minute candle per ticker per minute, from the BATS feed
      const since = Number(q.get('since')) || 0, out = [], nowMin = Math.floor(Date.now() / 60e3) * 60e3;
      for (const s of Object.keys(PX)) for (let k = 16; k >= 1; k--) { const t = nowMin - k * 60e3; if (t <= since) continue; const c = +(PX[s] * 1.01 + (16 - k) * 0.03).toFixed(2); out.push({ ticker: s, t, o: c - 0.02, h: c + 0.04, l: c - 0.05, c, v: 2400, tf: '1', received_at: new Date(t + 61e3).toISOString() }); }
      return json({ bars: out, now: Date.now() });
    }
    if (u.pathname.endsWith('/indai-brain')) return json({ configured: false });
    return json([]);
  });
  await page.goto(URL + '?nosw=1&nocheckin=1');
  await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.cboe === 'ok' && window.__indai.app.feed.getBars('QQQ', '5min').length > 3, null, { timeout: 20000 });
  await page.evaluate(() => window.__indai.app.selectSymbol('QQQ')); await sleep(800);
  const before = await page.evaluate(() => ({ badge: document.getElementById('t-badge').textContent, last: window.__indai.app.feed.quote('QQQ').last, n: window.__indai.app.feed.getBars('QQQ', '1min').length }));
  bridgeOn = true;
  await page.waitForFunction(() => window.__indai.app.feed.bridgeLive, null, { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  const after = await page.evaluate(() => ({ live: !!window.__indai.app.feed.bridgeLive, badge: document.getElementById('t-badge').textContent, note: document.getElementById('ch-note').textContent, last: window.__indai.app.feed.quote('QQQ').last, n: window.__indai.app.feed.getBars('QQQ', '1min').length, said: window.__indai.app.indai.log.map(x => x.text).filter(t => /bridge/i.test(t)) }));
  check('before the bridge: delayed', /Delayed/.test(before.badge), JSON.stringify(before));
  check('bridge candles arrive: badge turns live, price and candles follow TradingView', after.live && /Live · TradingView/.test(after.badge) && after.note === '' && Math.abs(after.last - (PX.QQQ * 1.01 + 15 * 0.03)) < 0.02 && after.n > before.n, JSON.stringify(after));
  await page.screenshot({ path: `${OUT}/b-phone-live.png` });
  check('no page errors', errs.length === 0, errs.join('|'));
  await browser.close(); console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
