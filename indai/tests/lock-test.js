const { quietFixture } = require('./browser.cjs');
// Access lock and push registration against a mocked backend that follows the real one's rules:
// with an owner passcode set, the brain (and push) refuse anyone without the x-indai-pass header.
const { chromium, OUT, URL, sleep, check, state, lastSession, installBackend } = require('./lib.js');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const sess = lastSession();
  const be = { required: true, token: 'open sesame 42', vapid: false, calls: { market: 0, talk: 0, mem: 0, profile: [], push: [] }, subs: [] };
  const brain = async (req, json) => {
    if (req.method() === 'GET') return json({ configured: true, passcode: be.required, memory: true });
    const b = JSON.parse(req.postData() || '{}'), pass = req.headers()['x-indai-pass'] || '';
    if (be.required && pass !== be.token) return json({ error: 'passcode', message: 'Wrong or missing INDAI passcode.' }, 401);
    if (b.mode === 'memory') { be.calls.mem++; if (!be.required) return json({ error: 'sign_in_required', message: 'Sign in or configure the owner passcode to use saved data.' }, 401); return json({ memory: [] }); }
    if (b.mode === 'profile') { if (!be.required) return json({ error: 'sign_in_required' }, 401); be.calls.profile.push(b); return json({ key: b.key, updated_at: new Date().toISOString() }); }
    if (b.mode === 'talk') { be.calls.talk++; return json({ result: { spoken: 'Tape looks two-sided to me.' }, remembered: [] }); }
    return json({ result: { rag: 'AMBER', confidence: 60, spoken: 'With the news in, AMBER.', summary: [] }, sources: [] });
  };
  const newPage = async (ctxOpts = {}, init = null) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...ctxOpts });
    const page = await ctx.newPage(); await quietFixture(page); const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|net::ERR|status of 401|status of 503/.test(m.text())) errs.push(m.type() + ' ' + m.text().slice(0, 200)); });
    if (init) await page.addInitScript(init);
    page.on('request', r => { if (/indai-market/.test(r.url())) be.calls.market++; });
    await installBackend(page, sess, brain);
    await page.route('**://zptjziewsfuvfcogrikz.supabase.co/functions/v1/indai-push', async (route) => {
      const req = route.request(), json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(b) });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (req.method() === 'GET') return be.vapid ? json({ publicKey: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM' }) : json({ error: 'not_configured', message: 'Web Push has not been enabled.' }, 503);
      const b = JSON.parse(req.postData() || '{}'), pass = req.headers()['x-indai-pass'] || '';
      if (be.required ? pass !== be.token : true) return json({ error: be.required ? 'passcode' : 'sign_in_required', message: 'no' }, 401);
      be.calls.push.push(b.op);
      if (b.op === 'subscribe') { be.subs.push(b.subscription.endpoint); return json({ subscribed: true }); }
      if (b.op === 'unsubscribe') { be.subs = be.subs.filter(e => e !== b.endpoint); return json({ subscribed: false }); }
      if (b.op === 'test') return be.subs.length ? json({ accepted: be.subs.length }) : json({ error: 'no_subscription', message: 'Subscribe a browser first.' }, 404);
      return json({ error: 'bad_request' }, 400);
    });
    return { ctx, page, errs, A: (fn, arg) => page.evaluate(fn, arg) };
  };
  const visible = (page) => page.evaluate(() => ({ lock: !document.getElementById('lock').hidden, bodyLocked: document.body.classList.contains('locked'), appShown: getComputedStyle(document.getElementById('app')).display !== 'none', rows: [...document.querySelectorAll('.wrow')].filter(r => r.offsetParent).length, top: getComputedStyle(document.getElementById('top')).display !== 'none' }));

  // ---- 1. a device that has never been here: the lock comes up as soon as the backend says a token is needed
  {
    const { ctx, page, errs, A } = await newPage();
    await page.goto(URL + '?nosw=1&nocheckin=1');
    await page.waitForFunction(() => !document.getElementById('lock').hidden, null, { timeout: 15000 });
    await sleep(300);
    let v = await visible(page);
    check('[lock] first visit: only the lock screen is shown', v.lock && v.bodyLocked && !v.appShown && v.rows === 0 && !v.top, JSON.stringify(v));
    const m0 = be.calls.market; await sleep(9000);
    check('[lock] locked: no market requests, nothing running', be.calls.market === m0 && await A(() => window.__indai.app.locked === true), JSON.stringify({ before: m0, after: be.calls.market }));
    await page.screenshot({ path: `${OUT}/lock-phone.png` });
    await page.fill('#lock-input', 'wrong token'); await page.click('#lock-go'); await sleep(900);
    check('[lock] wrong token: refused, still locked', /not accepted/.test(await page.textContent('#lock-msg')) && (await visible(page)).lock);
    await page.fill('#lock-input', be.token);
    await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.click('#lock-go')]);
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'delayed' && window.__indai.app.feed.quote('SPY'), null, { timeout: 20000 });
    await sleep(1500);
    v = await visible(page);
    const saved = await A(() => ({ pass: window.__indai.app.settings.researchPass, st: window.__indai.app.lockState() }));
    check('[lock] right token: the app opens and the token is kept on this device', !v.lock && !v.bodyLocked && v.appShown && v.top && saved.pass === be.token && saved.st.required && saved.st.ok && !saved.st.locked, JSON.stringify({ v, st: saved.st }));
    // talking carries the token
    await A(() => window.__indai.app.ui.showTab('indai')); await page.fill('#i-input', 'what do you make of the tape'); await page.press('#i-input', 'Enter'); await sleep(1500);
    check('[lock] unlocked: the thinking brain answers', be.calls.talk === 1 && /two-sided/.test(await A(() => window.__indai.app.indai.log.map(l => l.text).join('\n'))));
    // reload: straight in, no lock flash
    await page.addInitScript(() => { window.__lockSeen = false; new MutationObserver(() => { const l = document.getElementById('lock'); if (l && !l.hidden) window.__lockSeen = true; }).observe(document, { subtree: true, attributes: true, childList: true }); });
    await page.goto(URL + '?nosw=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.quote('SPY'), null, { timeout: 20000 }); await sleep(2500);
    check('[lock] known device: opens straight away on reload', !(await A(() => window.__lockSeen)) && !(await visible(page)).lock);
    // settings shows the state, and the device can be locked by hand
    await A(() => window.__indai.app.openSettings()); await sleep(1900);
    check('[lock] settings says it is locked to the token', /locked to its access token/.test(await page.textContent('#lock-status')) && await page.isVisible('#s-lock-device'));
    // the token is changed in the backend: this device is asked again
    be.token = 'a brand new token';
    await A(() => window.__indai.app.closeFocus());
    await A(() => window.__indai.app.ui.showTab('indai')); await page.fill('#i-input', 'and what about now then'); await page.press('#i-input', 'Enter');
    await page.waitForFunction(() => !document.getElementById('lock').hidden, null, { timeout: 15000 });
    v = await visible(page);
    check('[lock] token changed in the backend: locked again, says why', v.lock && !v.appShown && /no longer accepted/.test(await page.textContent('#lock-msg')), JSON.stringify(v));
    await page.fill('#lock-input', be.token);
    await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.click('#lock-go')]);
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.quote('SPY'), null, { timeout: 20000 });
    check('[lock] new token accepted', !(await visible(page)).lock);
    // lock the device by hand
    await A(() => window.__indai.app.openSettings()); await sleep(1900);
    await page.click('#s-lock-device'); await sleep(300);
    await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.click('#s-lock-device')]);
    await page.waitForFunction(() => !document.getElementById('lock').hidden, null, { timeout: 15000 });
    const m1 = be.calls.market; await sleep(4000);
    v = await visible(page);
    check('[lock] "Lock INDAI on this device": locked from the first moment, nothing loads behind it', v.lock && !v.appShown && be.calls.market === m1 && await A(() => !window.__indai.app.settings.researchPass), JSON.stringify({ v, m1, after: be.calls.market }));
    check('[lock] no page errors', errs.length === 0, errs.slice(0, 4).join(' | '));
    await ctx.close();
  }
  // ---- 2. no passcode in the backend: nothing changes for anyone, and Settings says the door is open
  {
    be.required = false;
    const { ctx, page, errs, A } = await newPage();
    await page.goto(URL + '?nosw=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.quote('SPY'), null, { timeout: 20000 }); await sleep(2500);
    check('[open backend] no lock screen', !(await visible(page)).lock);
    await A(() => window.__indai.app.openSettings()); await sleep(1900);
    check('[open backend] settings warns that no token is set', /No access token is set in the backend/.test(await page.textContent('#lock-status')) && !(await page.isVisible('#s-lock-device')));
    check('[open backend] no page errors', errs.length === 0, errs.slice(0, 4).join(' | '));
    await ctx.close();
  }
  // ---- 3. push registration (the browser's push service is stubbed; the backend contract is the real one)
  {
    be.required = true; be.token = 'open sesame 42'; be.vapid = false;
    const stub = () => {
      let sub = null;
      const reg = { scope: location.origin + '/indai/', pushManager: { getSubscription: async () => sub, subscribe: async (o) => { window.__subOpts = { visible: o.userVisibleOnly, keyLen: o.applicationServerKey.length }; sub = { endpoint: 'https://web.push.apple.com/QAbc123', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }; }, unsubscribe: async () => { sub = null; return true; } }; return sub; } } };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(reg), getRegistration: async () => reg, register: async () => reg, addEventListener() {}, controller: null } });
      window.PushManager = window.PushManager || function () {};
      if (window !== window.top) return; localStorage.setItem('indai.web.lock.v1', JSON.stringify({ required: true, ok: true }));
      const st = JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}'); st.researchPass = 'open sesame 42'; localStorage.setItem('jarvis.settings.v1', JSON.stringify(st));
    };
    const { ctx, page, errs, A } = await newPage({ permissions: ['notifications'] }, stub);
    await page.goto(URL + '?nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'delayed' && window.__indai.app.feed.quote('SPY'), null, { timeout: 20000 }); await sleep(2500);
    const pass = await A(() => window.__indai.app.settings.researchPass);
    if (pass !== be.token) console.log('   (settings key differs: token not preloaded)', JSON.stringify(pass));
    await A(() => window.__indai.app.openSettings()); await sleep(1900);
    check('[push] starts off, with a button to turn it on', /Off on this device|Notifications are blocked/.test(await page.textContent('#push-status')) && await page.isVisible('#s-push-on'), JSON.stringify(await page.textContent('#push-status')));
    await page.click('#s-push-on'); await sleep(1500);
    check('[push] backend without push keys: says so plainly', /not switched on in the backend yet/.test(await page.textContent('#push-status')) && be.subs.length === 0, JSON.stringify(await page.textContent('#push-status')));
    be.vapid = true;
    await page.click('#s-push-on'); await sleep(2500);
    const opts = await A(() => window.__subOpts);
    check('[push] turn on: browser subscribed with the backend key, registered with the token', be.subs.length === 1 && be.subs[0].startsWith('https://web.push.apple.com/') && opts && opts.visible === true && opts.keyLen === 65 && /On for this device/.test(await page.textContent('#push-status')), JSON.stringify({ subs: be.subs, opts }));
    const plan = be.calls.profile.find(p => p.key === 'plan'), wl = be.calls.profile.find(p => p.key === 'watchlist');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    check("[push] today's plan, risk state and watchlist went to the backend", plan && plan.op === 'put' && plan.value.date === today && ['conservative', 'balanced', 'aggressive'].includes(plan.value.aggr) && plan.value.capital > 0 && Array.isArray(plan.value.strategies) && plan.value.strategies.length > 0 && plan.value.tripped === false && typeof plan.value.pnl === 'number' && wl && Array.isArray(wl.value.symbols) && wl.value.symbols.includes('SPY'), JSON.stringify(plan && plan.value));
    await page.locator('#push-status').scrollIntoViewIfNeeded(); await sleep(200);
    await page.screenshot({ path: `${OUT}/push-settings.png` });
    await page.click('#s-push-test'); await sleep(900);
    check('[push] test goes out', be.calls.push.includes('test') && /Test accepted for 1 device/.test(await page.textContent('#toast')), JSON.stringify(await page.textContent('#toast')));
    // a logged loss reaches the backend within seconds (so a tripped breaker stops pushes too)
    const n0 = be.calls.profile.length;
    await A(() => { const a = window.__indai.app; a.closeFocus(); a.logTrade(-25); });
    await sleep(7500);
    const latest = be.calls.profile.filter(p => p.key === 'plan').pop();
    check('[push] a logged trade updates the backend copy within seconds', be.calls.profile.length > n0 && latest.value.pnl === -25, JSON.stringify({ n0, n: be.calls.profile.length, pnl: latest && latest.value.pnl }));
    // a tapped notification opens that ticker's ideas
    await A(() => window.__indai.app.openSettings()); await sleep(1900);
    console.log('   push state before turning off', JSON.stringify(await A(() => ({ ...window.__indai.app.push.state, ls: localStorage.getItem('indai.web.push.v1') }))));
    await page.click('#s-push-off'); await sleep(1200);
    check('[push] turn off: taken off the backend and the browser', be.subs.length === 0 && /Off on this device/.test(await page.textContent('#push-status')), JSON.stringify(be.subs));
    check('[push] no page errors', errs.length === 0, errs.slice(0, 4).join(' | '));
    await ctx.close();
  }
  // ---- 4. iPhone in Safari (not installed): told to add to the Home Screen
  {
    const { ctx, page, errs, A } = await newPage({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' }, () => { if (window !== window.top) return; localStorage.setItem('indai.web.lock.v1', JSON.stringify({ required: true, ok: true })); const st = JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}'); st.researchPass = 'open sesame 42'; localStorage.setItem('jarvis.settings.v1', JSON.stringify(st)); });
    await page.goto(URL + '?nosw=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.quote('SPY'), null, { timeout: 20000 }); await sleep(2200);
    await A(() => window.__indai.app.openSettings()); await sleep(1900);
    check('[push] iPhone in Safari: says to add INDAI to the Home Screen', /Add to Home Screen/.test(await page.textContent('#push-status')) && !(await page.isVisible('#s-push-on')), JSON.stringify(await page.textContent('#push-status')));
    await ctx.close();
  }
  await browser.close();
  console.log(state.failed ? `\n${state.failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
