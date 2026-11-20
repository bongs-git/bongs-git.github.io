// Screenshots of the ideas screens for the user (phone, 2x), on demo data with the mocked catch-up list for a realistic day.
const { chromium, OUT, URL, sleep, lastSession, installBackend } = require('./lib.js');
(async () => {
  const browser = await chromium.launch(); const sess = lastSession();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await installBackend(page, sess, async (req, json) => req.method() === 'GET' ? json({ configured: false }) : json({ error: 'not_configured' }, 503));
  await page.goto(URL + '?nosw=1&nocheckin=1');
  await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'delayed' && window.__indai.app.feed.getBars('IWM', '5min').length > 5, null, { timeout: 20000 });
  await sleep(7500);
  const A = (fn, arg) => page.evaluate(fn, arg);
  // a live alert arriving while on the Watch tab
  await A(() => { const a = window.__indai.app; a.ui.showTab('watch'); const s = a.signals.find(x => x.score >= 70) || a.signals[0]; const live = { ...s, at: Date.now(), barT: Math.floor(Date.now() / 300e3) * 300e3 - 300e3 }; delete live.quiet; delete live.id; a.fireSignal(live, a.activePlan()); });
  await sleep(2600);
  await page.screenshot({ path: `${OUT}/send-phone-alert.png` });
  await page.click('#idea-alert [data-do="chart"]'); await sleep(900);
  await page.screenshot({ path: `${OUT}/send-phone-chart.png` });
  await page.click('.ichip'); await sleep(700);
  await page.screenshot({ path: `${OUT}/send-phone-list.png` });
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
