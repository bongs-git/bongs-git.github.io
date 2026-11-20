const { chromium } = require('playwright');
const OUT = '/tmp/claude-0/-home-claude/04b46bd6-b6df-55a1-a7c4-1aad3a90796a/scratchpad';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  for (const [name, w, h, mobile] of [['laptop', 1440, 900, false], ['phone', 390, 844, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('http://127.0.0.1:8765/indai/?nosw=1&demo=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.quote('IWM'));
    await page.evaluate(() => { window.__indai.app.indai.setMuted(true); });
    const say = async (t, ms = 900) => { await page.evaluate((t) => window.__indai.app.send(t), t); await sleep(ms); };
    await say('start my day', 2500); await say('2000'); await say('100'); await say('balanced', 1200);
    await say('QQQ calls expiring today 665 strike', 3000);
    await page.evaluate(() => window.__indai.app.closeFocus());
    await say('log a win of 50', 1000);
    if (mobile) { await page.evaluate(() => window.__indai.app.ui.showTab('chart')); await sleep(600); await page.evaluate(() => { document.getElementById('caption').hidden = true; }); }
    await sleep(700);
    await page.screenshot({ path: `${OUT}/indai-${name}.png` });
    console.log(name, 'errors', errs.length);
    await ctx.close();
  }
  await browser.close();
})();
