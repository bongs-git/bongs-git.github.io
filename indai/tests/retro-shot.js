// Phone screenshots of the retrospective for the user (2x), on the mocked finished day plus two made-up earlier days.
const { chromium, OUT, URL, sleep, lastSession, installBackend } = require('./lib.js');
const src = require('fs').readFileSync(__dirname + '/retro-test.js', 'utf8');
const seedSrc = src.slice(src.indexOf('const GRID = []'), src.indexOf('(async () => {'));
const seed = new Function(seedSrc + '; return seed();')();
(async () => {
  const browser = await chromium.launch(); const sess = lastSession();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((s) => { localStorage.setItem('indai.web.retro.v1', JSON.stringify(s)); const st = JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}'); st.voice = false; localStorage.setItem('jarvis.settings.v1', JSON.stringify(st)); }, seed);
  await installBackend(page, sess, async (req, json) => req.method() === 'GET' ? json({ configured: true, passcode: false }) : json({ memory: [] }));
  await page.goto(URL + '?nosw=1&nocheckin=1');
  await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'delayed' && window.__indai.app.feed.getBars('IWM', '5min').length > 5, null, { timeout: 20000 });
  await page.waitForFunction(() => { const a = window.__indai.app; return a.settings.symbols.every(s => a.levelsFor(s)); }, null, { timeout: 90000 }).catch(() => {});
  await sleep(6000);
  const hide = () => page.evaluate(() => { document.getElementById('caption').hidden = true; document.getElementById('idea-alert').hidden = true; document.getElementById('toast').classList.remove('show'); });
  await page.evaluate(() => window.__indai.app.openIdeas()); await sleep(700); await hide();
  await page.screenshot({ path: `${OUT}/send-retro-0-button.png` });
  await page.click('#sb-ideas [data-retro="open"]'); await sleep(900); await hide();
  await page.screenshot({ path: `${OUT}/send-retro-1-day.png` });
  await page.evaluate(() => { const h = [...document.querySelectorAll('#sb-ideas h3')].find(x => x.textContent === 'Entry, stop and target'); h.scrollIntoView({ block: 'start' }); document.getElementById('sb-ideas').scrollTop -= 10; }); await sleep(300); await hide();
  await page.screenshot({ path: `${OUT}/send-retro-2-change.png` });
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR', e.message.split('\n')[0]); process.exit(1); });
