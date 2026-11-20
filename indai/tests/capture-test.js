// Timeframes up to weekly, candles kept on the device, and Capture / Analyze, at phone and laptop sizes.
//   - every candle size from 1 minute to weekly draws, and 30 minutes and longer open with earlier sessions in view
//   - Analyze picks up the Capture box; a dragged box opens the reading with a picture, the paths and timeframes;
//     a timeframe button reads the chart again at that size; a second Analyze tap reads the whole chart
//   - captures are kept on the device
//   - with the backend unreachable, earlier minutes and daily candles kept on the device still fill the chart
const { chromium } = require('./browser.cjs');
const { installBackend, lastSession } = require('./lib.js');
const BASE = process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/';
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra === '' ? '' : JSON.stringify(extra)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const geo = (p) => p.evaluate(() => { const g = window.__indai.app.chart.geo; return g && { tf: g.tf, H: g.H, first: g.first, slots: g.slots, pts: g.pts.length, long: g.long }; });
const ready = async (p) => { await p.waitForFunction(() => window.__indai && window.__indai.app.chart && window.__indai.app.chart.geo, null, { timeout: 30000 }); await sleep(500); };
const box = (p) => p.evaluate(() => { const r = document.getElementById('chart-host').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const [label, view] of [['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }], ['laptop', { viewport: { width: 1440, height: 900 } }]]) {
    const ctx = await b.newContext(view), p = await ctx.newPage(), errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + '?demo=1&nocheckin=1&nosw=1'); await ready(p);
    if (label === 'phone') { await p.evaluate(() => window.__indai.app.ui.showTab('chart')); await sleep(300); }
    // every candle size, from its button
    const seen = {};
    for (const tf of ['1min', '5min', '15min', '30min', '1h', '4h', '1D', '1W']) {
      await p.click(`#ch-tf [data-iv="${tf}"]`); await sleep(tf === '1D' ? 1200 : 600);
      seen[tf] = await geo(p);
    }
    check(`[${label}] all eight candle sizes draw`, Object.entries(seen).every(([tf, g]) => g && g.tf === tf && g.pts >= 1), Object.fromEntries(Object.entries(seen).map(([k, g]) => [k, g && g.pts])));
    check(`[${label}] 30m, 1h and 4h open with earlier sessions in view`, ['30min', '1h', '4h'].every(tf => seen[tf].first < 0 && seen[tf].H > 0));
    check(`[${label}] daily and weekly show years of candles`, seen['1D'].H > 500 && seen['1W'].H > 100 && seen['1D'].long, { daily: seen['1D'].H, weekly: seen['1W'].H });
    const pressed = await p.evaluate(() => document.querySelector('#ch-tf [data-iv="1W"]').classList.contains('on'));
    check(`[${label}] the chosen size is highlighted and kept`, pressed && await p.evaluate(() => JSON.parse(localStorage.getItem('indai.web.settings.v1') || localStorage.getItem(Object.keys(localStorage).find(k => /settings/.test(k))) || '{}').chartTf === '1W'));
    if (label === 'phone') await p.screenshot({ path: __dirname + '/capture-weekly-phone.png' });
    // Analyze -> Capture box -> the reading
    await p.click('#ch-tf [data-iv="15min"]'); await sleep(600);
    await p.click('#ch-analyze'); await sleep(200);
    const hint = await p.evaluate(() => ({ text: document.getElementById('ch-hint').textContent, on: document.getElementById('ch-analyze').classList.contains('on'), tool: window.__indai.app.chart.tool }));
    check(`[${label}] Analyze picks up the Capture box`, hint.tool === 'capture' && hint.on && /Drag a box/.test(hint.text), hint);
    const B = await box(p);
    await p.mouse.move(B.x + B.w * 0.25, B.y + B.h * 0.2); await p.mouse.down(); await p.mouse.move(B.x + B.w * 0.75, B.y + B.h * 0.8, { steps: 8 });
    const during = await p.evaluate(() => window.__indai.app.chart.drag && window.__indai.app.chart.drag.kind);
    await p.mouse.up(); await sleep(900);
    const cap = await p.evaluate(() => { const c = window.__indai.app.capture.current(); return c && { whole: c.shot.whole, tf: c.shot.tf, count: c.r && c.r.count, img: (c.shot.image || '').slice(0, 15), paths: c.r && c.r.scenarios.length, tfs: c.r && c.r.timeframes.map(t => t.tf), status: c.status }; });
    check(`[${label}] dragging draws the Capture box`, during === 'cap');
    check(`[${label}] a dragged box opens the reading`, cap && !cap.whole && cap.count >= 3 && cap.paths === 3 && cap.img === 'data:image/jpeg' && await p.evaluate(() => !document.getElementById('sheet-capture').hidden), cap);
    const sheet = await p.evaluate(() => document.getElementById('sb-capture').innerText);
    check(`[${label}] the reading shows the picture, what it shows, the paths and timeframes`, /What it shows/.test(sheet) && /Bull path/.test(sheet) && /Bear path/.test(sheet) && /Look at these timeframes/.test(sheet) && !!(await p.$('#sb-capture img.cap-shot')));
    check(`[${label}] intraday captures say the book's numbers were measured on daily candles`, /measured on daily stock candles/.test(sheet));
    check(`[${label}] with INDAI's thinking off, it says so instead of waiting`, cap.status.read === 'off' && /thinking brain is off/.test(sheet), cap.status);
    if (label === 'phone') await p.screenshot({ path: __dirname + '/capture-sheet-phone.png' });
    // a timeframe suggestion reads the chart again at that size
    const want = cap.tfs.find(t => t !== '15min');
    await p.click(`#sb-capture [data-cap-tf="${want}"]`);
    await p.waitForFunction((tf) => { const c = window.__indai.app.capture.current(); return c && c.shot.tf === tf && c.shot.whole; }, want, { timeout: 10000 }).catch(() => {});
    const again = await p.evaluate(() => { const c = window.__indai.app.capture.current(); return c && { tf: c.shot.tf, whole: c.shot.whole, count: c.r && c.r.count }; });
    check(`[${label}] a suggested timeframe switches the chart and reads it again`, again && again.tf === want && again.whole && again.count >= 3, again);
    await p.evaluate(() => window.__indai.app.closeFocus()); await sleep(200);
    // two taps on Analyze read the whole chart
    await p.click('#ch-analyze'); await sleep(150); await p.click('#ch-analyze'); await sleep(700);
    const whole = await p.evaluate(() => { const c = window.__indai.app.capture.current(); return c && c.shot.whole && !document.getElementById('sheet-capture').hidden; });
    check(`[${label}] Analyze twice reads the whole chart`, whole);
    const kept = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('indai-candles'); r.onsuccess = () => { const q = r.result.transaction('cap', 'readonly').objectStore('cap').count(); q.onsuccess = () => res(q.result); q.onerror = () => res(-1); }; r.onerror = () => res(-1); }));
    check(`[${label}] captures are kept on the device`, kept >= 2, { kept });
    check(`[${label}] no page errors`, !errs.length, errs.slice(0, 3));
    await ctx.close();
  }

  // ---- the device remembers: with the backend unreachable, kept candles still fill the chart
  {
    // a live backend (quotes and today's candles) that has no stored history and no daily candles
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } }), p = await ctx.newPage(), errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await installBackend(p, lastSession(), (req, json) => req.method() === 'GET' ? json({ configured: false, passcode: false }) : json({ error: 'not_configured', message: 'off' }, 503));
    await p.route('**/functions/v1/indai-market?kind=daily*', route => route.fulfill({ status: 502, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'upstream', message: 'Market data is unavailable.' }) }));
    await p.goto(BASE + '?nocheckin=1&nosw=1'); await ready(p);
    // keep three earlier sessions of SPY minutes and two years of daily candles on the device, then reload offline
    await p.evaluate(async () => {
      const { candleStore } = await import('./js/candle-store.js');
      const { sessionTimes, etParts, chartSession, isTradingDay } = await import('./js/market.js');
      const mins = [], days = [];
      let t = chartSession().open, n = 0;
      while (n < 3) { t -= 864e5; const q = etParts(t + 3 * 3600e3); if (!isTradingDay(q.y, q.m, q.d)) continue; const s = sessionTimes(q.y, q.m, q.d); for (let m = s.open, px = 500 + n; m < s.close; m += 60e3) { px += Math.sin(m / 9e5) * 0.05; mins.push({ t: m, o: px, h: px + 0.1, l: px - 0.1, c: px + 0.02, v: 1000 }); } n++; }
      t = chartSession().open; n = 0;
      while (n < 500) { t -= 864e5; const q = etParts(t + 3 * 3600e3); if (!isTradingDay(q.y, q.m, q.d)) continue; const px = 400 + n * 0.1; days.push({ t: sessionTimes(q.y, q.m, q.d).open, o: px, h: px + 3, l: px - 3, c: px + 1, v: 1e6 }); n++; }
      await candleStore.putMinutes('SPY', mins); await candleStore.putDaily('SPY', days);
    });
    await p.reload(); await ready(p);
    check('[device memory] the page runs on the live backend, not demo data', await p.evaluate(() => window.__indai.app.feed.status.mode !== 'demo'), await p.evaluate(() => window.__indai.app.feed.status.mode));
    await p.evaluate(() => { const a = window.__indai.app; a.settings.main = 'SPY'; a.setTimeframe('5min'); a.markDirty('all'); });
    await sleep(1500);
    const hist = await p.evaluate(() => { const a = window.__indai.app, open = (window.__indai.app.chart.geo || {}).open; return { kept: a.history.state('SPY').candles, series: open ? a.tf.hist('SPY', '5min', open).bars.length : -1 }; });
    check('[backend without history] earlier sessions kept on the device fill the chart history', hist.kept >= 3 * 390 && hist.series >= 3 * 78, hist);
    await p.evaluate(() => window.__indai.app.setTimeframe('1D')); await sleep(1500);
    const d = await p.evaluate(() => ({ st: window.__indai.app.tf.state('SPY', '1D'), H: (window.__indai.app.chart.geo || {}).H }));
    check('[backend without daily candles] daily candles kept on the device draw the daily chart', d.st.candles >= 500 && d.H >= 499 && /device/.test(d.st.source || ''), d);
    check('[device memory] no page errors', !errs.length, errs.slice(0, 3));
    await ctx.close();
  }
  // ---- daily candles that cannot load: say so and wait before asking again, instead of asking on every frame
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } }), p = await ctx.newPage(), errs = [];
    let asks = 0;
    p.on('pageerror', e => errs.push(String(e)));
    await installBackend(p, lastSession(), (req, json) => req.method() === 'GET' ? json({ configured: false, passcode: false }) : json({ error: 'not_configured', message: 'off' }, 503));
    await p.route('**/functions/v1/indai-market?kind=daily*', route => { asks++; route.fulfill({ status: 502, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'upstream', message: 'Market data is unavailable.' }) }); });
    await p.goto(BASE + '?nocheckin=1&nosw=1'); await ready(p);
    await p.evaluate(() => window.__indai.app.setTimeframe('1D')); await sleep(4000);
    const note = await p.evaluate(() => document.getElementById('ch-history').textContent);
    check('[daily candles unavailable] the chart says they could not load', /could not load/.test(note), note);
    check('[daily candles unavailable] the backend is asked again only after a pause', asks >= 1 && asks <= 2, { asks });
    check('[daily candles unavailable] no page errors', !errs.length, errs.slice(0, 3));
    await ctx.close();
  }
  // ---- INDAI's part: the conversation brain today; the picture and the atlas once the server offers them
  for (const modes of [[], ['capture', 'atlas']]) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } }), p = await ctx.newPage(), errs = [], asked = [];
    let emptyOnce = !modes.length; // the server's first answer comes back empty (cut off at its length limit)
    p.on('pageerror', e => errs.push(String(e)));
    await installBackend(p, lastSession(), (req, json) => {
      if (req.method() === 'GET') return json({ configured: true, passcode: false, brains: { claude: true }, ...(modes.length ? { modes } : {}) });
      const body = JSON.parse(req.postData() || '{}'); asked.push({ mode: body.mode, search: body.search, session: body.session, image: !!body.image, patterns: (body.patterns || []).length, capture: !!(body.capture || (body.context && body.context.capture)), size: JSON.stringify(body.context || {}).length });
      if (body.mode === 'atlas') return json({ reads: (body.patterns || []).map(x => ({ code: x.code, at: x.at, light: 'AMBER', win: 0.553, base: 0.534, n: 5547, cellKey: 'below/high/5', line: 'a lean, not an edge' })) });
      if (body.mode === 'capture') return json({ result: { spoken: 'From the picture: buyers defended the low twice.', summary: ['Bull path above the box high.'] } });
      if (body.mode === 'talk' && emptyOnce && !(emptyOnce = false)) return json({ result: { spoken: '' }, remembered: [] });
      if (body.mode === 'talk') return json({ result: { spoken: 'Sideways with a slight upward tilt; watch the box high.', summary: ['Box high is the trigger.'] }, remembered: [] });
      return json({ error: 'bad_mode', message: 'unexpected' }, 400);
    });
    await p.goto(BASE + '?nocheckin=1&nosw=1'); await ready(p);
    await p.evaluate(() => window.__indai.app.setTimeframe('5min')); await sleep(800);
    await p.evaluate(() => window.__indai.app.chart.analyzeView());
    await p.waitForFunction(() => { const c = window.__indai.app.capture.current(); return c && c.status.read !== 'working' && c.status.atlas !== 'working'; }, null, { timeout: 15000 }).catch(() => {});
    if (!modes.length) {
      const first = await p.evaluate(() => ({ status: window.__indai.app.capture.current().status.read, text: document.getElementById('sb-capture').innerText, retry: !!document.getElementById('cap-retry') }));
      check('[server today] an empty answer says so and offers Try again', first.status === 'failed' && /cut off before it finished/.test(first.text) && first.retry, { status: first.status, retry: first.retry, text: first.text.slice(-300) });
      await p.click('#cap-retry');
      await p.waitForFunction(() => window.__indai.app.capture.current().status.read === 'done', null, { timeout: 10000 }).catch(() => {});
      const talk = asked.filter(a => a.mode === 'talk');
      check('[server today] the brief sent to the conversation brain stays small', talk.every(a => a.size < 6000), talk.map(a => a.size));
    }
    const c = await p.evaluate(() => { const c = window.__indai.app.capture.current(); return { status: c.status, read: c.read, notable: c.r && c.r.notable.length, atlas: (c.atlas || []).length, text: document.getElementById('sb-capture').innerText }; });
    const label = modes.length ? '[server with capture and atlas]' : '[server today]';
    if (!modes.length) {
      check(`${label} the read comes from the conversation brain, without web search and in its own session`, c.status.read === 'done' && /upward tilt/.test(c.text) && asked.some(a => a.mode === 'talk' && a.search === false && /^capture-\d+$/.test(a.session) && a.capture), asked);
      check(`${label} nothing is sent in a mode the server does not list`, !asked.some(a => a.mode === 'capture' || a.mode === 'atlas'), asked);
      check(`${label} the atlas odds are promised for later, not made up`, c.notable === 0 || /once INDAI's atlas service is switched on/.test(c.text));
    } else {
      check(`${label} the picture goes to the brain with the facts`, c.status.read === 'done' && /From the picture/.test(c.text) && asked.some(a => a.mode === 'capture' && a.image && a.capture), asked);
      check(`${label} each pattern found gets the atlas's tested numbers`, c.notable === 0 || (c.atlas > 0 && /55\.3% vs 53\.4% base · n=5547/.test(c.text) && /AMBER/.test(c.text)), { notable: c.notable, atlas: c.atlas });
    }
    check(`${label} no page errors`, !errs.length, errs.slice(0, 3));
    await ctx.close();
  }
  await b.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
