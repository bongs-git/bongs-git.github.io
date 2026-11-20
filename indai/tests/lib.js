// Runs the website against a mocked INDAI backend that follows the HANDOFF.md contract,
// to exercise the real-data path and the "thinking brain" path (which the sandbox cannot reach for real).
const { chromium } = require('./browser.cjs');
const OUT = __dirname, URL = process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const state = { failed: 0 };
process.on('beforeExit', () => { if (state.failed) process.exitCode = 1; });
const check = (label, ok, extra = '') => { if (!ok) state.failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); };
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

async function installBackend(page, sess, brain) {
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
      if (u.pathname.endsWith('/indai-brain')) return brain(req, json);
      return json({ error: 'not_found' }, 404);
    });
}
module.exports = { chromium, OUT, URL, sleep, check, state, lastSession, installBackend };
