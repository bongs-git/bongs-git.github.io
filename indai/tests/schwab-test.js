// The Connect Schwab page (schwab.html) and the owner's passcode on price requests (js/owner-feed.js),
// against a stand-in back end. Nothing here reaches Schwab or Supabase.
const { chromium } = require('playwright');
const BASE = process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/';
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };
const AUTH = 'https://api.schwabapi.com/v1/oauth/authorize?response_type=code&client_id=k&redirect_uri=https%3A%2F%2F127.0.0.1';
const BACK = 'https://127.0.0.1/?code=C0.abc123%40&session=9';

async function backend(page, state) {
  await page.route('**://zptjziewsfuvfcogrikz.supabase.co/functions/v1/indai-schwab', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    const body = JSON.parse(req.postData() || '{}'), pass = req.headers()['x-indai-pass'];
    state.calls.push({ op: body.op, pass, url: body.url });
    const send = (status, j) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(j) });
    if (pass !== 'open sesame') return send(401, { error: 'passcode', message: 'Wrong or missing INDAI passcode.' });
    const status = () => ({ configured: state.configured, connected: state.connected, signed_in_at: state.connected ? '2026-11-20T21:10:00.000Z' : null, sign_in_by: state.connected ? '2026-11-27T21:10:00.000Z' : null, days_left: state.connected ? 7 : null });
    if (body.op === 'status') return send(200, status());
    if (body.op === 'start') return send(200, { url: AUTH, callback: 'https://127.0.0.1' });
    if (body.op === 'disconnect') { state.connected = false; return send(200, status()); }
    if (body.op === 'finish') {
      if (body.url !== BACK) return send(400, { error: 'code_rejected', message: 'Schwab did not accept that code. It works once and only for about 30 seconds: sign in again and paste the new address straight away.' });
      state.connected = true; return send(200, { ...status(), test: { ok: true, symbol: 'SPY', price: 712.4, realtime: true } });
    }
    return send(400, { error: 'bad_request', message: 'no' });
  });
}
const settle = (page) => page.waitForFunction(() => document.getElementById('state').textContent !== 'Checking…');

(async () => {
  const browser = await chromium.launch();
  for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1280, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport, permissions: name === 'laptop' ? ['clipboard-read', 'clipboard-write'] : [] });
    const page = await ctx.newPage(), state = { configured: true, connected: false, calls: [] }, errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await backend(page, state);

    // no passcode saved on this device: it is asked for, and a wrong one is said to be wrong
    await page.goto(BASE + 'schwab.html'); await settle(page);
    check(`[${name}] without a saved passcode the page asks for it`, await page.isVisible('#passcard') && await page.isHidden('#steps') && state.calls.length === 0);
    await page.fill('#pass', 'guess'); await page.click('#passgo'); await page.waitForFunction(() => /not accepted/.test(document.getElementById('state').textContent));
    check(`[${name}] a wrong passcode is refused in plain words`, await page.isVisible('#passcard') && await page.isHidden('#steps'));
    await page.fill('#pass', 'open sesame'); await page.click('#passgo'); await page.waitForSelector('#go[aria-disabled="false"]');
    check(`[${name}] with the passcode: not connected, and step 1 links to Schwab's own sign-in`, (await page.textContent('#state')) === 'Not connected.' && (await page.getAttribute('#go', 'href')) === AUTH && (await page.getAttribute('#go', 'target')) === '_blank');

    // the saved passcode is used without asking
    await page.evaluate(() => localStorage.setItem('jarvis.settings.v1', JSON.stringify({ researchPass: 'open sesame' })));
    state.calls.length = 0;
    await page.reload(); await page.waitForSelector('#go[aria-disabled="false"]');
    check(`[${name}] the passcode saved in INDAI is used`, await page.isHidden('#passcard') && state.calls.map(c => c.op).join() === 'status,start' && state.calls.every(c => c.pass === 'open sesame'));

    // a stale address is explained; the right one connects
    await page.fill('#url', 'https://127.0.0.1/?code=old%40&session=1'); await page.click('#connect');
    await page.waitForFunction(() => /30 seconds/.test(document.getElementById('out').textContent));
    check(`[${name}] an address that is too old says so`, (await page.getAttribute('#out', 'class')) === 'bad' && (await page.textContent('#state')) === 'Not connected.');
    await page.fill('#url', ''); await page.click('#connect');
    await page.waitForFunction(() => /Nothing to paste/.test(document.getElementById('out').textContent));
    await page.fill('#url', '  ' + BACK + '  '); await page.click('#connect');
    await page.waitForFunction(() => /^Connected\. First quote/.test(document.getElementById('out').textContent));
    const detail = await page.textContent('#detail');
    check(`[${name}] the pasted address connects and shows the first live quote`, (await page.textContent('#out')) === 'Connected. First quote from Schwab: SPY 712.40, live.' && (await page.textContent('#state')) === 'Connected.' && /sign in again by .*Nov 27/.test(detail) && /7 days/.test(detail), detail);
    check(`[${name}] the address was sent trimmed`, state.calls.at(-1).op === 'finish' && state.calls.at(-1).url === BACK);

    if (name === 'laptop') {
      state.connected = false; await page.reload(); await page.waitForSelector('#go[aria-disabled="false"]');
      await page.evaluate((t) => navigator.clipboard.writeText(t), BACK);
      await page.click('#paste');
      await page.waitForFunction(() => /^Connected\. First quote/.test(document.getElementById('out').textContent));
      check(`[${name}] "Paste and connect" reads the copied address`, state.calls.at(-1).url === BACK);
    }
    await page.click('#off'); await page.waitForFunction(() => document.getElementById('state').textContent === 'Not connected.');
    check(`[${name}] disconnect`, state.connected === false && await page.isHidden('#off'));

    // layout: nothing wider than the screen, buttons big enough to tap
    const box = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth > innerWidth + 1, small: [...document.querySelectorAll('button, a.btn, input')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).length }));
    check(`[${name}] fits the screen with tap-sized controls`, !box.wide && box.small === 0, box);

    // not set up yet
    state.configured = false; await page.reload(); await settle(page);
    check(`[${name}] before the keys are in Supabase the page says what to add`, /not set up yet/.test(await page.textContent('#state')) && /SCHWAB_APP_KEY/.test(await page.textContent('#detail')) && await page.isHidden('#steps'));
    check(`[${name}] no script errors`, errors.length === 0, errors);
    await ctx.close();
  }

  // the app: price requests carry the saved passcode, and nothing else does
  for (const saved of ['open sesame', '']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage(), seen = [];
    await page.addInitScript((p) => localStorage.setItem('jarvis.settings.v1', JSON.stringify({ researchPass: p })), saved);
    await page.route('**://zptjziewsfuvfcogrikz.supabase.co/**', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (req.method() !== 'OPTIONS') seen.push({ path: url.pathname, pass: req.headers()['x-indai-pass'] || '' });
      route.fulfill({ status: req.method() === 'OPTIONS' ? 204 : 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: url.pathname.includes('/rest/v1/') ? '[]' : '{}' });
    });
    await page.goto(BASE + '?nocheckin=1'); await page.waitForTimeout(4000);
    const market = seen.filter(s => s.path.endsWith('/indai-market')), tv = seen.filter(s => s.path.endsWith('/indai-tv')), rest = seen.filter(s => s.path.includes('/rest/v1/'));
    if (saved) check('[app] with a saved passcode every price request carries it', market.length > 0 && market.every(s => s.pass === saved), market.slice(0, 3));
    else check('[app] without a passcode price requests carry none', market.length > 0 && market.every(s => s.pass === ''), market.slice(0, 3));
    check(`[app] ${saved ? 'the passcode goes' : 'nothing goes'} to no other address than the ones that already had it`, tv.every(s => s.pass === '') && rest.every(s => s.pass === ''), { tv: tv.length, rest: rest.length });
    await ctx.close();
  }
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
