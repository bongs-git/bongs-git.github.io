// The service worker's push handler: deliver a real push event through the browser's debugging channel
// and check the notification it shows, then tap it and check the app opens that ticker's ideas.
const { chromium } = require('./browser.cjs');
const URL = process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (l, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${l} ${x}`); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['notifications'] });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  const cdp = await ctx.newCDPSession(page); let regs = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { regs = e.registrations; });
  await cdp.send('ServiceWorker.enable');
  await page.goto(URL + '?demo=1&nocheckin=1');
  await sleep(6000);       // (the page reloads once when the worker takes over)
  await page.waitForFunction(() => window.__indai && window.__indai.app.feed.quote('SPY') && navigator.serviceWorker.controller, null, { timeout: 25000 });
  await sleep(1500);
  const reg = regs.find(r => r.scopeURL === new globalThis.URL('.', URL).href);
  check('service worker registered', !!reg, JSON.stringify(regs.map(r => r.scopeURL)));
  // The test browser cannot be given notification permission, so record what the worker asks to show instead.
  const worker = ctx.serviceWorkers()[0];
  await worker.evaluate(() => { self.__shown = []; ServiceWorkerRegistration.prototype.showNotification = function (title, o) { self.__shown.push({ title, body: o.body, tag: o.tag, data: o.data, silent: o.silent, icon: o.icon }); return Promise.resolve(); }; });
  const payload = { title: 'INDAI · TSLA', body: 'pullback held the fast cloud · score 84', symbol: 'TSLA', score: 84, barT: Date.now() - 306000, strat: 'ema' };
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: new globalThis.URL(URL).origin, registrationId: reg.registrationId, data: JSON.stringify(payload) });
  await sleep(1200);
  const notes = await worker.evaluate(() => self.__shown);
  check('push shows a notification with the setup (quietly, because INDAI is on screen)', notes.length === 1 && notes[0].title === 'INDAI · TSLA' && /score 84/.test(notes[0].body) && notes[0].tag === 'indai-TSLA' && notes[0].data.symbol === 'TSLA' && notes[0].data.barT === payload.barT && notes[0].silent === true && /icon-192/.test(notes[0].icon), JSON.stringify(notes));
  await page.waitForFunction(() => window.__indai.app.push.state.receipt);
  const receipt = await page.evaluate(() => window.__indai.app.push.state.receipt);
  check('arrival timing uses the candle close and survives the notification', receipt.seconds >= 6 && receipt.seconds < 20 && receipt.barT === payload.barT, JSON.stringify(receipt));
  // a test push (no symbol) and a malformed one still show something sensible
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: new globalThis.URL(URL).origin, registrationId: reg.registrationId, data: JSON.stringify({ title: 'INDAI', body: 'Test notification from your command center.', tag: 'indai-test' }) });
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: new globalThis.URL(URL).origin, registrationId: reg.registrationId, data: 'not json at all' });
  await sleep(1200);
  const all = (await worker.evaluate(() => self.__shown)).map(n => `${n.tag}|${n.title}|${n.body}`);
  check('test and malformed pushes are shown too', all.some(x => x.startsWith('indai-test|INDAI|Test notification')) && all.some(x => x === 'indai|INDAI|not json at all'), JSON.stringify(all));
  // the page side of a tapped notification
  await page.evaluate(() => { const a = window.__indai.app; a.practiceAlert(); });
  await sleep(500);
  const sym = await page.evaluate(() => window.__indai.app.signals[0].sym);
  await page.evaluate((s) => navigator.serviceWorker.controller.postMessage && window.dispatchEvent(new Event('noop')) , sym);
  await page.evaluate((s) => { navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'indai-open', symbol: s } })); }, sym);
  await sleep(700);
  const opened = await page.evaluate(() => { const a = window.__indai.app; return { focus: a.focus, main: a.settings.main, open: document.querySelector('#sb-ideas .idea.open b')?.textContent }; });
  check('tapping a notification opens that ticker in Ideas', opened.focus === 'ideas' && opened.main === sym && opened.open === sym, JSON.stringify({ sym, opened }));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e.message.split('\n')[0]); process.exit(1); });
