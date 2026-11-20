const { chromium, OUT, URL, sleep, lastSession, installBackend } = require('./lib.js');
const src = require('fs').readFileSync(__dirname + '/retro-test.js', 'utf8');
const seed = new Function(src.slice(src.indexOf('const GRID = []'), src.indexOf('(async () => {')) + '; return seed();')();
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
  const hide = () => page.evaluate(() => { document.getElementById('caption').hidden = true; document.getElementById('idea-alert').hidden = true; document.getElementById('toast').classList.remove('show'); document.getElementById('fab').style.display = 'none'; });
  await page.evaluate(() => window.__indai.app.openRetro()); await sleep(900);
  const at = async (title, file) => { await page.evaluate((t) => { const h = [...document.querySelectorAll('#sb-ideas h3')].find(x => x.textContent === t); h.scrollIntoView({ block: 'start' }); document.getElementById('sb-ideas').scrollTop -= 10; }, title); await sleep(300); await hide(); await page.screenshot({ path: `${OUT}/${file}` }); };
  await at('Back-test of these changes', 'send-bt-1-table.png');
  await at('Back-test on months of data, and live simulation', 'send-bt-2-tradingview.png');
  const over = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && [...document.querySelectorAll('#sb-ideas .rtable')].every(t => t.scrollWidth <= t.parentElement.clientWidth + 1));
  // the script page
  const p2 = await ctx.newPage(); await p2.goto(URL + 'tradingview/'); await p2.waitForFunction(() => /strategy\("INDAI Backtest"/.test(document.getElementById('code').textContent), null, { timeout: 10000 }); await sleep(400);
  await p2.screenshot({ path: `${OUT}/send-bt-3-script-page.png` });
  const pageOk = await p2.evaluate(() => ({ lines: document.getElementById('code').textContent.split('\n').length, wide: document.documentElement.scrollWidth <= document.documentElement.clientWidth }));
  console.log('fits', over, 'script page', JSON.stringify(pageOk), 'errors', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR', e.message.split('\n')[0]); process.exit(1); });
