// Schwab's live stream in the browser: the "Test live stream" button on the Connect Schwab page (schwab.html) and
// the stream feeding the app's prices (js/owner-feed.js, js/schwab-stream.js). Schwab's stream and the back end are
// stand-ins, and the clock is set, so this gives the same answer at any time of day.
const { chromium } = require('playwright');
const BASE = process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };
const TOKEN = 'access-TOKEN-never-on-screen', SOCKET = 'wss://streamer-api.schwab.com/ws';
const NOON = Date.parse('2026-11-20T12:00:00-05:00');   // Friday, the market open

// Schwab's stream. `mode`: 'ok' signs in and sends prices, 'quiet' sends the first picture only, 'denied' refuses the
// sign-in, 'shut' closes the connection at once.
async function streamer(page, s) {
  Object.assign(s, { sockets: 0, closed: 0, logins: [], subs: [], say: () => {} });
  await page.routeWebSocket(SOCKET, (ws) => {
    s.sockets++;
    if (s.mode === 'shut') { ws.close({ code: 1008, reason: 'no' }); return; }
    const send = (o) => { try { ws.send(JSON.stringify(o)); } catch { /* the page closed it */ } };
    s.say = send;
    ws.onClose(() => { s.closed++; });
    ws.onMessage(async (text) => {
      for (const r of JSON.parse(text).requests) {
        if (r.command === 'LOGIN') {
          s.logins.push(r);
          send({ response: [{ service: 'ADMIN', command: 'LOGIN', requestid: r.requestid, content: s.mode === 'denied' ? { code: 3, msg: 'Login Denied.: token is invalid.' } : { code: 0, msg: 'server=s1;status=NP' } }] });
        } else if (r.command === 'SUBS') {
          s.subs.push(r.parameters);
          send({ response: [{ service: r.service, command: 'SUBS', requestid: r.requestid, content: { code: 0, msg: 'SUBS command succeeded' } }] });
          const t = s.now ? await s.now() : Date.now();
          send({ data: [{ service: 'LEVELONE_EQUITIES', command: 'SUBS', content: r.parameters.keys.split(',').map((key, i) => ({ key, delayed: false, 1: 700.4 + i, 2: 700.44 + i, 3: 700.42 + i, 8: 5000000, 9: 100, 34: t - 20, 35: s.staleFirst ? t - 3600e3 : t - 400 })) }] });
          if (s.mode === 'ok' && s.auto) for (let k = 1; k <= 5; k++) send({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'SPY', 3: +(700.42 + k / 100).toFixed(2), 8: 5000000 + k * 300, 9: 300, 35: t }] }] });
        }
      }
    });
  });
}
async function backend(page, b) {
  Object.assign(b, { calls: [] });
  await page.route('**://zptjziewsfuvfcogrikz.supabase.co/**', async (route) => {
    const req = route.request(), u = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const json = (j, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(j) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname.endsWith('/indai-schwab')) {
      const body = JSON.parse(req.postData() || '{}'), pass = req.headers()['x-indai-pass'] || '';
      b.calls.push({ op: body.op, pass });
      if (pass !== 'open sesame') return json({ error: 'passcode', message: 'Wrong or missing INDAI passcode.' }, 401);
      const status = { configured: true, connected: b.connected, signed_in_at: b.connected ? '2026-11-20T15:00:00.000Z' : null, sign_in_by: b.connected ? '2026-11-27T15:00:00.000Z' : null, days_left: b.connected ? 7 : null };
      if (body.op === 'status') return json(status);
      if (body.op === 'start') return json({ url: 'https://api.schwabapi.com/v1/oauth/authorize?x=1', callback: 'https://127.0.0.1/' });
      if (body.op === 'check') return json({ callback: 'https://127.0.0.1/', recognised: true, status: 400, error: null });
      if (body.op === 'stream') return b.streamOff ? json({ error: 'not_connected', message: 'Schwab is not connected. Sign in on the Connect Schwab page first.' }, 409)
        : json({ socket: SOCKET, customer: 'CUST', correl: 'CORREL', channel: 'N9', fn: 'APIAPP', token: TOKEN, token_until: '2026-11-20T17:30:00.000Z' });
      return json({ error: 'bad_request', message: 'no' }, 400);
    }
    if (u.pathname.endsWith('/indai-market')) {
      const q = u.searchParams, syms = (q.get('symbols') || '').split(',').filter(Boolean);
      b.snapshots = (b.snapshots || 0) + (q.get('kind') === 'snapshot' ? 1 : 0);
      if (q.get('kind') === 'snapshot') return json({ source: 'Schwab', delay: 0, quotes: syms.map((s) => ({ symbol: s, ok: true, price: 699, close: 699, prevClose: 695, open: 696, high: 701, low: 694, volume: 4e6, timestamp: new Date(NOON).toISOString() })) });
      if (q.get('kind') === 'bars') return json({ source: 'Schwab', delay: 0, bars: Object.fromEntries(syms.map((s) => [s, { session: '2026-11-20', bars: Array.from({ length: 150 }, (_, i) => [571 + i, 698, 699.5, 697.5, 699, 1000]) }])) });
      return json({ error: 'unavailable', message: 'not in this test' }, 503);
    }
    if (u.pathname.endsWith('/indai-brain')) return json(req.method() === 'GET' ? { configured: false, passcode: false, memory: true } : { error: 'not_configured', message: 'off' }, req.method() === 'GET' ? 200 : 503);
    if (u.pathname.includes('/rest/v1/')) return json([]);
    if (u.pathname.endsWith('/indai-tv')) return json(u.searchParams.get('ticker') ? { ticker: u.searchParams.get('ticker'), bars: [], now: NOON } : u.searchParams.get('bars') ? { bars: [], live: [], now: NOON, cursor: new Date(NOON).toISOString() } : { alerts: [] });
    return json({ error: 'not_found' }, 404);
  });
}
const savePass = (page, pass) => page.addInitScript((p) => { if (window !== window.top) return; const s = JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}'); s.researchPass = p; s.voice = false; s.voiceEngine = 'system'; s.main = 'SPY'; s.interval = '1min'; localStorage.setItem('jarvis.settings.v1', JSON.stringify(s)); }, pass);

(async () => {
  const browser = await chromium.launch();
  try {
    // ------------------------------------------------------------ the Connect Schwab page
    for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1280, height: 800 }]]) {
      const ctx = await browser.newContext({ viewport }), page = await ctx.newPage(), b = { connected: false }, s = { mode: 'ok', auto: true }, errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.clock.install({ time: new Date(NOON) });
      await savePass(page, 'open sesame'); await backend(page, b); await streamer(page, s);
      const run = async (expect) => { await page.click('#livego'); if (expect) await page.waitForFunction((re) => new RegExp(re).test(document.getElementById('liveout').textContent), expect, { timeout: 8000 }).catch(() => {}); };
      const end = async () => { await page.clock.fastForward(21000); await page.waitForFunction(() => !document.getElementById('livego').disabled, null, { timeout: 8000 }).catch(() => {}); return { out: await page.textContent('#liveout'), kind: await page.getAttribute('#liveout', 'class'), log: await page.isHidden('#livelog') ? '' : await page.textContent('#livelog') }; };

      await page.goto(BASE + 'schwab.html'); await page.waitForSelector('#go[aria-disabled="false"]');
      check(`[${name}] not connected: no live test is offered`, await page.isHidden('#livecard'));
      b.connected = true; await page.reload(); await page.waitForSelector('#go[aria-disabled="false"]');
      check(`[${name}] connected: the page offers "Test live stream"`, await page.isVisible('#livecard') && (await page.textContent('#livego')) === 'Test live stream');

      // prices arrive
      await run('^Stream open\\. [1-9]');
      const mid = await page.textContent('#liveout');
      check(`[${name}] while it runs the page counts the updates and shows the prices`, /^Stream open\. \d+ price updates so far: SPY 700\.47, QQQ 701\.42\. \d+ s left\.$/.test(mid) && await page.isDisabled('#livego'), mid);
      let r = await end();
      check(`[${name}] after 20 seconds: live, with the count and the last prices, in green`, r.out === 'Live. 7 price updates in 20 seconds: SPY 700.47, QQQ 701.42.' && r.kind === 'ok' && !r.log, r);
      check(`[${name}] it signed in with the details INDAI handed over and asked for SPY and QQQ`, s.logins.length === 1 && s.logins[0].parameters.Authorization === TOKEN && s.logins[0].SchwabClientCustomerId === 'CUST' && s.subs[0].keys === 'SPY,QQQ' && b.calls.filter(c => c.op === 'stream').every(c => c.pass === 'open sesame'), { logins: s.logins.length, subs: s.subs });
      await sleep(200);
      check(`[${name}] the stream is closed when the test ends, and the token is never on screen`, s.closed === 1 && s.sockets === 1 && !(await page.evaluate(() => document.documentElement.outerHTML)).includes(TOKEN), { closed: s.closed, sockets: s.sockets });

      // the market is closed: Schwab sends the last prices and nothing more
      s.auto = false; await run('^Stream open\\. 2 '); r = await end();
      check(`[${name}] a quiet stream is said to be open, with nothing moving`, r.out === 'The stream is open and Schwab sent SPY 700.42, QQQ 701.42, but nothing moved in 20 seconds. That is normal when the market is closed.' && r.kind === 'ok', r);

      // Schwab refuses the sign-in: said at once, with the steps
      s.mode = 'denied'; const t0 = Date.now(); await run('did not open'); r = { out: await page.textContent('#liveout'), kind: await page.getAttribute('#liveout', 'class'), log: await page.textContent('#livelog') };
      check(`[${name}] a refused sign-in is reported straight away in Schwab's own words`, r.out === 'The live stream did not open: Schwab refused the stream (3): Login Denied.: token is invalid.' && r.kind === 'bad' && /^Steps: connecting → refused: /.test(r.log) && Date.now() - t0 < 6000, r);
      await page.waitForFunction(() => !document.getElementById('livego').disabled);

      // the connection is closed in the browser's face
      s.mode = 'shut'; const before = s.sockets; await run('Connecting… 1\\d s left'); r = await end();
      check(`[${name}] a stream the browser cannot hold open is reported with the close code and the steps`, r.out === 'The live stream did not open: The stream closed (1008).' && r.kind === 'bad' && /connecting → waiting: The stream closed \(1008\)/.test(r.log) && s.sockets - before >= 1 && s.sockets - before <= 4, { ...r, tries: s.sockets - before });

      // INDAI has no sign-in to hand over
      s.mode = 'ok'; b.streamOff = true; const n = s.sockets; await run('did not open'); r = { out: await page.textContent('#liveout'), kind: await page.getAttribute('#liveout', 'class') };
      check(`[${name}] when Schwab is not connected the page says so and opens nothing`, r.out === 'The live stream did not open: Schwab is not connected. Sign in on the Connect Schwab page first.' && r.kind === 'bad' && s.sockets === n, r);
      await page.waitForFunction(() => !document.getElementById('livego').disabled);

      const box = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth > innerWidth + 1, small: [...document.querySelectorAll('button, a.btn, input')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).length }));
      check(`[${name}] fits the screen with tap-sized controls, no script errors`, !box.wide && box.small === 0 && errors.length === 0, { box, errors });
      await ctx.close();
    }

    // ------------------------------------------------------------ the app
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }), page = await ctx.newPage(), b = { connected: true }, s = { mode: 'ok', auto: false }, errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.clock.install({ time: new Date(NOON) });
      s.now = () => page.evaluate(() => Date.now());
      await savePass(page, 'open sesame'); await backend(page, b); await streamer(page, s);
      // the first picture's trade times come from the page's clock
      s.staleFirst = true;
      await page.goto(BASE + '?nosw=1&nocheckin=1');
      await page.waitForFunction(() => window.__indai && window.__indai.app.chart && window.__indai.app.chart.geo, null, { timeout: 30000 });
      await page.clock.fastForward(2000);
      await page.waitForFunction(() => window.__indai.app.schwabLive && window.__indai.app.schwabLive.state === 'live', null, { timeout: 10000 }).catch(() => {});
      const st = await page.evaluate(() => { const a = window.__indai.app; return { live: a.schwabLive, tracked: a.feed.trackedSymbols, last: a.feed.quote('SPY').last }; });
      check('[app] with the passcode saved the app opens the stream and subscribes to every ticker it tracks', st.live.state === 'live' && s.logins.length === 1 && s.logins[0].parameters.Authorization === TOKEN && s.subs.length === 1 && s.subs[0].keys.split(',').sort().join() === st.tracked.slice().sort().join() && s.subs[0].keys.startsWith('SPY'), { st, subs: s.subs });
      await sleep(300);
      const first = await page.evaluate(() => { const a = window.__indai.app; return { ticks: a.schwabLive.ticks, last: a.feed.quote('SPY').last }; });
      check('[app] the first picture repeats an old last price: it is not counted as a trade', first.ticks === 0 && first.last === 699, first);

      // a trade: the price and this minute's candle move at once
      const now = await page.evaluate(() => Date.now()), minute = Math.floor(now / 60e3) * 60e3;
      s.say({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'SPY', 3: 700.9, 8: 5000400, 9: 400, 35: now - 150 }] }] });
      await page.waitForFunction(() => window.__indai.app.feed.quote('SPY').last === 700.9, null, { timeout: 5000 }).catch(() => {});
      s.say({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'SPY', 3: 701.3, 8: 5000900, 35: now - 50 }, { key: 'SPY', 1: 701.29 }] }] });
      await page.waitForFunction(() => window.__indai.app.feed.quote('SPY').last === 701.3, null, { timeout: 5000 }).catch(() => {});
      const t = await page.evaluate((m) => { const a = window.__indai.app, bars = a.feed.syms.get('SPY').bars['1min'], bar = bars[bars.length - 1]; return { last: a.feed.quote('SPY').last, bar, ticks: a.schwabLive.ticks, isMinute: bar.t === m }; }, minute);
      check('[app] each trade moves the price and the forming one-minute candle; a bid-only update is not a trade', t.last === 701.3 && t.isMinute && t.bar.c === 701.3 && t.bar.h === 701.3 && t.bar.l === 700.9 && t.ticks === 2, t);
      check('[app] the candle\'s volume is what traded since the last message (no first-message total)', t.bar.v === 900, t.bar);

      // the next snapshot (an older price) does not pull the price back
      const snaps = b.snapshots; await page.clock.fastForward(45000); await sleep(600);
      const after = await page.evaluate(() => window.__indai.app.feed.quote('SPY').last);
      check('[app] a later snapshot from the price service does not pull a streamed price back', b.snapshots > snaps && after === 701.3, { snapshots: b.snapshots - snaps, after });

      // an index has no trade time: its price counts while the market is open
      const hasSpx = await page.evaluate(() => window.__indai.app.feed.syms.has('SPX'));
      if (hasSpx) { s.say({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: '$SPX', 3: 7033.1 }] }] }); await page.waitForFunction(() => window.__indai.app.feed.quote('SPX').last === 7033.1, null, { timeout: 5000 }).catch(() => {}); check('[app] an index tick moves the index', (await page.evaluate(() => window.__indai.app.feed.quote('SPX').last)) === 7033.1); }

      // leaving the page closes the stream; coming back opens it again
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(400);
      check('[app] when the page is hidden the stream is closed', s.closed === 1 && (await page.evaluate(() => window.__indai.app.schwabLive.state)) === 'off', { closed: s.closed });
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => window.__indai.app.schwabLive.state === 'live', null, { timeout: 8000 }).catch(() => {});
      check('[app] back on screen it signs in again with fresh details', s.sockets === 2 && s.logins.length === 2 && b.calls.filter(c => c.op === 'stream').length === 2, { sockets: s.sockets, calls: b.calls.length });
      check('[app] no script errors', errors.length === 0, errors);
      await ctx.close();
    }
    for (const [label, pass, query] of [['without a saved passcode', '', ''], ['in demo mode', 'open sesame', '&demo=1']]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage(), b = { connected: true }, s = { mode: 'ok' };
      await page.clock.install({ time: new Date(NOON) });
      await savePass(page, pass); await backend(page, b); await streamer(page, s);
      await page.goto(BASE + '?nosw=1&nocheckin=1' + query);
      await page.waitForFunction(() => window.__indai && window.__indai.app.chart, null, { timeout: 30000 });
      await page.clock.fastForward(12000); await sleep(500);
      check(`[app] ${label} no stream is asked for or opened`, s.sockets === 0 && !b.calls.some(c => c.op === 'stream'), { sockets: s.sockets, calls: b.calls });
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
