const { quietFixture } = require('./browser.cjs');
// Runs the website against a mocked INDAI backend that follows the HANDOFF.md contract,
// to exercise the real-data path and the "thinking brain" path (which the sandbox cannot reach for real).
const { chromium } = require('./browser.cjs');
const OUT = __dirname, URL = process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); };
const PX = { SPY: 749, QQQ: 662, IWM: 276, TSLA: 387, AMZN: 265, MSFT: 528, VIX: 17.2, NVDA: 156 };
function etYMD(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d); }
function lastSession() { // last completed (or current) regular session, good enough for a weekday test
  const now = new Date(); const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short' }).formatToParts(now);
  const h = +p.find(x => x.type === 'hour').value % 24, mi = +p.find(x => x.type === 'minute').value;
  let d = new Date(now); const started = h * 60 + mi >= 570;
  if (!started) d = new Date(d.getTime() - 864e5);
  while ([0, 6].includes(new Date(etYMD(d) + 'T12:00:00Z').getUTCDay())) d = new Date(d.getTime() - 864e5);
  return { ymd: etYMD(d), minutes: started ? Math.min(390, h * 60 + mi - 570) : 390 };
}
function bars(sym, n) { let p = PX[sym] || 100, out = []; let s = sym.charCodeAt(0) * 7 + 3; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let i = 0; i < n; i++) { const o = p; p = p * (1 + rnd() * 0.0012 + Math.sin(i / 40) * 0.00015); const c = p; out.push([571 + i, +o.toFixed(2), +(Math.max(o, c) * 1.0003).toFixed(2), +(Math.min(o, c) * 0.9997).toFixed(2), +c.toFixed(2), Math.round(20000 + Math.abs(rnd()) * 60000)]); }
  return out; }
function ncdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
function chain(sym, spot, wantExp) {
  const today = etYMD(new Date()); const exps = [0, 1, 2, 5, 6, 7].map(k => etYMD(new Date(Date.now() + k * 864e5))).filter(e => ![0, 6].includes(new Date(e + 'T12:00:00Z').getUTCDay()));
  const expiry = (wantExp && exps.find(e => e >= wantExp)) || exps[0], T = 1 / 365 / 2, iv = 0.19, rows = [];
  for (let K = Math.round(spot * 0.9); K <= spot * 1.1; K++) for (const type of ['C', 'P']) {
    const v = iv * Math.sqrt(T), d1 = (Math.log(spot / K) + 0.5 * iv * iv * T) / v, d2 = d1 - v;
    const price = type === 'C' ? spot * ncdf(d1) - K * ncdf(d2) : K * ncdf(-d2) - spot * ncdf(-d1), mid = Math.max(0.01, +price.toFixed(2));
    rows.push({ type, strike: K, bid: +(mid * 0.98).toFixed(2), ask: +(mid * 1.02 + 0.01).toFixed(2), mid, last: mid, iv, delta: +(type === 'C' ? ncdf(d1) : ncdf(d1) - 1).toFixed(3), gamma: 0.04, theta: -0.9, vega: 0.05, oi: 4000 + (K % 5 === 0 ? 9000 : 0), vol: 3000 + (K % 5 === 0 ? 7000 : 0) });
  }
  const st = { callVol: 900000, putVol: 760000, pcVolume: 0.84, callOI: 2.1e6, putOI: 2.6e6, pcOI: 1.24, callPremium: 61e6, putPremium: 48e6 };
  return { symbol: sym, spot, timestamp: new Date().toISOString(), delayed: true, source: 'CBOE delayed quotes (about 15 minutes)', meta: { iv30: 19.4 }, expirations: exps, expiry, all: st, expiryStats: st,
    gex: { callWall: Math.round(spot * 1.012), putWall: Math.round(spot * 0.985), callWall2: Math.round(spot * 1.02), putWall2: Math.round(spot * 0.975), zeroGamma: Math.round(spot * 0.997), regime: 'positive', total: 1200 },
    gexNear: { expiry: exps[0], callWall: Math.round(spot * 1.008), putWall: Math.round(spot * 0.99), zeroGamma: Math.round(spot * 0.998) },
    unusual: [{ exp: expiry, type: 'C', strike: Math.round(spot) + 3, vol: 21000, oi: 9000, mid: 0.84, premium: 1764000, iv: 0.2 }], chain: rows, today };
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const sess = lastSession(); const memory = [{ id: 1, kind: 'taught', text: 'I never trade the first five minutes', created_at: new Date().toISOString() }];
  const calls = { talk: 0, trade: 0, mem: [] };
  for (const [name, w, h, mobile] of [['laptop', 1440, 900, false], ['phone', 390, 844, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile });
    const page = await ctx.newPage(); await quietFixture(page); const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.type() + ' ' + m.text().slice(0, 240)); });
    await page.route('**://zptjziewsfuvfcogrikz.supabase.co/**', async (route) => {
      const req = route.request(), u = new globalThis.URL(req.url()), q = u.searchParams, json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(b) });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (u.pathname.endsWith('/indai-market')) {
        const kind = q.get('kind'), syms = (q.get('symbols') || '').split(',').filter(Boolean);
        if (kind === 'snapshot') return json({ quotes: syms.map(s => { const b = bars(s, sess.minutes), c = b[b.length - 1][4], pc = (PX[s] || 100) * 0.996; return { symbol: s, ok: !!PX[s], price: +(c * 1.0015).toFixed(2), close: c, prevClose: +pc.toFixed(2), open: b[0][1], high: Math.max(...b.map(x => x[2])), low: Math.min(...b.map(x => x[3])), iv30: 19.4, timestamp: new Date().toISOString(), changePct: +((c / pc - 1) * 100).toFixed(2) }; }) });
        if (kind === 'bars') return json({ bars: Object.fromEntries(syms.filter(s => PX[s]).map(s => [s, { session: sess.ymd, bars: bars(s, sess.minutes) }])) });
        if (kind === 'daily') return json({ daily: Object.fromEntries(syms.map(s => [s, [...Array(40)].map((_, i) => [i, 1, 1, 1, (PX[s] || 100) * (1 + Math.sin(i) * 0.01), 1e6])])) });
        if (kind === 'chain') { const s = q.get('symbol'); if (!PX[s]) return json({ error: 'unknown symbol' }, 404); const b = bars(s, sess.minutes); return json(chain(s, b[b.length - 1][4], q.get('expiry'))); }
        if (kind === 'news') return json({ items: [{ title: 'Tech stocks rally as yields ease', source: 'Reuters' }, { title: 'Options traders pile into weekly calls', source: 'Bloomberg' }, { title: 'Fed speakers on deck this afternoon', source: 'WSJ' }] });
      }
      if (u.pathname.endsWith('/indai-tv')) return json(q.get('bars') ? { bars: [] } : { alerts: [{ id: 7, ticker: 'QQQ', text: 'QQQ reclaimed VWAP', received_at: new Date(Date.now() - 3600e3).toISOString(), levels: null }] });
      if (u.pathname.endsWith('/indai_gex_levels')) return json([{ ticker: 'IWM', scope: 'A', asof_et: `${etYMD(new Date())} 09:14`, expiry: null, spot: 276, call_wall: 280, put_wall: 272, call_wall2: 283, put_wall2: 270, gamma_flip: 275, net_gex_m: 410 }, { ticker: 'IWM', scope: 'N', asof_et: `${etYMD(new Date())} 09:14`, expiry: etYMD(new Date()), spot: 276, call_wall: 279, put_wall: 273, gamma_flip: 275.5 }]);
      if (u.pathname.endsWith('/indai-brain')) {
        if (req.method() === 'GET') return json({ configured: true, passcode: false, memory: memory.length });
        const b = JSON.parse(req.postData() || '{}');
        if (b.mode === 'memory') { calls.mem.push(b.op); if (b.op === 'add') memory.push({ id: memory.length + 1, kind: 'taught', text: b.text, created_at: new Date().toISOString() }); return json({ memory }); }
        if (b.mode === 'talk') { calls.talk++; await sleep(400); return json({ result: /nasdaq look|pull up/i.test(b.question) ? { spoken: 'Here is the Nasdaq. It is holding above VWAP with calls leading.', command: 'show QQQ' } : { spoken: `You have ${Object.keys(b.context.watchlist).length} names on watch and the breaker is ${b.context.riskBreaker.state}. I would wait for a clean VWAP reclaim before sizing up.`, summary: ['Tape is two-sided', 'No plan locked yet'] }, remembered: [] }); }
        if (b.mode === 'trade') { calls.trade++; await sleep(700); return json({ result: { rag: 'AMBER', confidence: 64, headline: 'Trend is with you but the call wall is close', spoken: 'With the news in, I rate this AMBER. Momentum is fine, but the call wall caps the upside today.', summary: ['Yields easing helps tech', 'Call wall sits just above the strike', 'Fed speakers at 2pm could whip it'], bullish: ['flow'], bearish: ['wall'], news: [{ title: 'Tech stocks rally as yields ease', source: 'Reuters', sentiment: 'positive' }], events: ['Fed speakers 2pm'], watch: ['VWAP'], plan_notes: '' }, sources: [], model: 'mock' }); }
      }
      return json({ error: 'not_found' }, 404);
    });
    await page.goto(URL + '?nosw=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'delayed' && window.__indai.app.feed.getBars('IWM', '5min').length > 5, null, { timeout: 20000 });
    await sleep(1500);
    const A = (fn, arg) => page.evaluate(fn, arg);
    const logText = () => A(() => window.__indai.app.indai.log.map(m => m.text).join('\n'));
    const say = async (text, re, timeout = 15000) => { if (mobile && await A(() => window.__indai.app.tab !== 'indai' || !!window.__indai.app.focus)) { await A(() => { window.__indai.app.closeFocus(); window.__indai.app.ui.showTab('indai'); }); await sleep(200); } const before = (await logText()).length; await page.fill('#i-input', text); await page.press('#i-input', 'Enter'); const t0 = Date.now(); while (Date.now() - t0 < timeout) { const lt = (await logText()).slice(before); if (re.test(lt)) return lt; await sleep(120); } return (await logText()).slice(before); };
    const st = await A(() => { const a = window.__indai.app; return { mode: a.feed.status.mode, badge: document.getElementById('t-badge').textContent, lv: a.levelsFor('IWM'), q: a.feed.quote('IWM'), brain: a.indai.brain.configured, tv: a.tvAlerts.length, qqqLv: a.levelsFor('QQQ') && a.levelsFor('QQQ').source }; });
    check(`[${name}] real-data mode with delayed badge`, st.mode === 'delayed' && /CBOE, delayed 15 min/.test(st.badge) && st.q && st.q.last > 0, JSON.stringify({ badge: st.badge, last: st.q && st.q.last, ext: st.q && st.q.ext }));
    check(`[${name}] morning GEX levels used for IWM, live chain levels for others`, st.lv && st.lv.source === 'morning' && st.lv.cw === 280 && st.lv.near && st.lv.near.cw === 279, JSON.stringify({ iwm: st.lv && st.lv.source, qqq: st.qqqLv }));
    check(`[${name}] thinking brain detected, TradingView alerts loaded`, st.brain === true && st.tv === 1);
    await page.screenshot({ path: `${OUT}/m-${name}-home.png` });
    let r = await say('QQQ calls expiring today 665 strike', /With the news in/, 20000);
    const an = await A(() => { const a = window.__indai.app.analysis; return a && { rag: a.score.rag, final: a.final && a.final.rag, conf: a.final && a.final.confidence, strike: a.idea.strike, exp: a.idea.expiry }; });
    check(`[${name}] verdict with web research`, an && an.final === 'AMBER' && an.conf === 64 && /With the news in/.test(r), JSON.stringify(an));
    if (mobile) { await page.click('#i-pin [data-act="details"]'); }
    await sleep(600); await page.screenshot({ path: `${OUT}/m-${name}-verdict.png` });
    r = await say('what do you make of the tape right now', /VWAP reclaim/);
    check(`[${name}] free conversation through the brain`, /clean VWAP reclaim/.test(r) && /• Tape is two-sided/.test(r), JSON.stringify(r.slice(0, 140)));
    r = await say('can you pull up the nasdaq for me', /QQQ,/);
    check(`[${name}] brain runs a command from loose wording`, (await A(() => window.__indai.app.settings.main)) === 'QQQ', JSON.stringify(r.slice(0, 120)));
    r = await say('remember that I size down on Fed days', /I'll remember that/);
    check(`[${name}] remember that`, /I'll remember that: I size down on Fed days/.test(r));
    r = await say('what do you remember', /holding/);
    check(`[${name}] what do you remember`, /I'm holding \d+ things/.test(r) && /never trade the first five minutes/.test(r), JSON.stringify(r.slice(0, 160)));
    r = await say('brief me', /Day P&L/);
    check(`[${name}] brief on real data mentions the nearest level`, /Nearest level/.test(r) && !/Demo mode/.test(r));
    r = await say('run a self-test', /Self-test done/, 30000);
    const t = await A(() => window.__indai.app.selfTest.results.map(x => `${x.status}:${x.name}`));
    check(`[${name}] self-test: data, chain, levels, research pass`, ['pass:Market data', 'pass:Options chain', 'pass:GEX levels', 'pass:Web research'].every(x => t.includes(x)), t.join(', '));
    await A(() => window.__indai.app.closeFocus());
    await A(() => window.__indai.app.openSettings()); await sleep(1800); await page.screenshot({ path: `${OUT}/m-${name}-settings.png` });
    const rs = await page.textContent('#research-status'); const gs = await page.textContent('#gex-status');
    check(`[${name}] settings status lines`, /thinking brain are on/.test(rs) && /IWM: CW 280/.test(gs), JSON.stringify(rs.slice(0, 60)));
    await A(() => window.__indai.app.closeFocus());
    // calculator opened for a ticker with no price yet: the strike snaps to the chain instead of staying at a placeholder
    const kc = await A(async () => { const a = window.__indai.app; a.calc = null; const c = a.ensureCalc('NVDA'); const before = c.legs[0].strike; await new Promise(r => setTimeout(r, 1500)); return { before, after: a.calc.legs[0].strike, spot: a.calc.spot, snap: a.calc.needsSnap }; });
    console.log('   calc for unknown ticker', JSON.stringify(kc));
    if (mobile) { await A(() => window.__indai.app.ui.showTab('more')); await sleep(400); await page.screenshot({ path: `${OUT}/m-${name}-more.png` }); await A(() => window.__indai.app.ui.showTab('chart')); await sleep(500); await page.screenshot({ path: `${OUT}/m-${name}-chart.png` }); }
    check(`[${name}] no page errors`, errs.length === 0, errs.slice(0, 5).join(' | '));
    await ctx.close();
  }
  console.log('   backend calls', JSON.stringify(calls));
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
