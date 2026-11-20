const { chromium } = require('./browser.cjs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); let bad = 0;
  for (const [name, w, h, mobile] of [['laptop', 1440, 900, false], ['tablet', 820, 1180, true], ['phone', 390, 844, true]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: name === 'phone' })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto((process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/') + '?nosw=1&demo=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.quote('IWM'));
    if (name === 'phone') await page.click('#tabs [data-tab="indai"]');
    const gap = () => page.evaluate(() => { const l = document.getElementById('i-log'); return Math.round(l.scrollHeight - l.scrollTop - l.clientHeight); });
    for (const t of ['brief me', 'start my day', '2000', '100', 'balanced', 'QQQ calls expiring today 665 strike']) { await page.evaluate((t) => window.__indai.app.send(t), t); await sleep(t.length > 20 ? 3000 : 1200); }
    await page.evaluate(() => window.__indai.app.closeFocus()); await sleep(500);
    const g1 = await gap();
    await page.evaluate(() => window.__indai.app.send('log a win of 50')); await sleep(900);
    const g2 = await gap();
    await page.evaluate(() => { const l = document.getElementById('i-log'); l.scrollTop = 0; }); await sleep(200);
    await page.evaluate(() => window.__indai.app.brief()); await sleep(700);
    const g3 = await page.evaluate(() => document.getElementById('i-log').scrollTop);
    const ok = g1 <= 2 && g2 <= 2 && g3 < 5 && !errs.length; if (!ok) bad++;
    console.log(ok ? 'PASS' : 'FAIL', name, 'stays on newest line after the verdict card appears; respects scrolling up', JSON.stringify({ g1, g2, g3, errs }));
  }
  await browser.close(); console.log(bad ? 'FAILED' : 'ALL PASSED');
})();
