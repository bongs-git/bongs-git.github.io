const { chromium } = require('./browser.cjs');
const OUT = __dirname;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const sizes = { phone: [390, 844], tablet: [820, 1180], laptop: [1440, 900] };
  for (const [name, [w, h]] of Object.entries(sizes)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: name !== 'laptop', isMobile: name === 'phone' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 200)); });
    const t0 = Date.now();
    await page.goto((process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/') + '?nosw=1&nocheckin=1', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'demo' && window.__indai.app.feed.quote('IWM'), null, { timeout: 30000 });
    console.log(name, 'demo after', Date.now() - t0, 'ms');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/smoke-${name}.png` });
    console.log(name, 'errors:', errs.filter(e => !/Failed to load resource|net::ERR|morning GEX/.test(e)));
    console.log(name, 'other:', [...new Set(errs.filter(e => /Failed to load resource|net::ERR/.test(e)))].slice(0, 3));
    await ctx.close();
  }
  await browser.close();
})();
