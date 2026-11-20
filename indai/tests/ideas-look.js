const { chromium } = require('playwright');
const OUT = __dirname, URL = 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  for (const [name, w, h, mobile] of [['phone', 390, 844, true], ['tablet', 820, 1180, true], ['laptop', 1440, 900, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile && w < 700, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.type() + ' ' + m.text().slice(0, 240)); });
    await page.goto(URL + '?demo=1&nosw=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.getBars('SPY', '5min').length > 10, null, { timeout: 20000 });
    await sleep(1500);
    const A = (fn, arg) => page.evaluate(fn, arg);
    await page.screenshot({ path: `${OUT}/id-${name}-0-empty.png` });
    await A(() => { const a = window.__indai.app; a.ui.showTab('watch'); a.practiceAlert(); });
    await sleep(900);
    await page.screenshot({ path: `${OUT}/id-${name}-1-alert.png` });
    // a few more ideas from the replay so the list has variety
    const n = await A(() => { const a = window.__indai.app; const r = a.replayScan(); return { count: r.count, best: r.best && r.best.sym }; });
    await A(() => { const a = window.__indai.app; a.hideIdeaAlert(); a.openIdeas(); });
    await sleep(700);
    await page.screenshot({ path: `${OUT}/id-${name}-2-list.png` });
    const btn = page.locator('#sb-ideas [data-do="chart"]').first();
    if (await btn.count()) { await btn.click(); await sleep(900); await page.screenshot({ path: `${OUT}/id-${name}-3-chart.png` }); }
    console.log(name, JSON.stringify(n), 'signals', await A(() => window.__indai.app.signals.length), 'errors', JSON.stringify(errs.slice(0, 4)));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
