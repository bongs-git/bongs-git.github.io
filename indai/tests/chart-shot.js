const { chromium } = require('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  for (const [name, w, h, scale] of [['laptop', 1440, 900, 2], ['tablet', 820, 1180, 2], ['small-phone', 360, 740, 2]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://127.0.0.1:8765/indai/?demo=1');
    await p.waitForFunction(() => window.__indai && window.__indai.app.chart && window.__indai.app.chart.geo, null, { timeout: 30000 }); await sleep(700);
    if (w < 700) { await p.evaluate(() => document.querySelector('button[data-tab="chart"]').click()); await sleep(400); }
    const oneLine = await p.evaluate(() => { const d = document.getElementById('ch-draw'), f = document.getElementById('ch-tf'); return Math.abs(d.getBoundingClientRect().top - f.getBoundingClientRect().top) < 12; });
    await p.click('#ch-draw'); await p.click('#ch-tools [data-tool="line"]'); await sleep(200);
    const B = await p.evaluate(() => { const r = document.getElementById('chart-host').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await p.mouse.move(B.x + B.w * 0.18, B.y + B.h * 0.7); await p.mouse.down(); await p.mouse.move(B.x + B.w * 0.5, B.y + B.h * 0.42, { steps: 6 }); await p.mouse.up(); await sleep(150);
    await p.click('#ch-tools [data-tool="level"]'); await p.mouse.click(B.x + B.w * 0.5, B.y + B.h * 0.25); await sleep(150);
    await p.mouse.move(B.x + B.w * 0.6, B.y + B.h * 0.55); await sleep(200);
    const info = await p.evaluate(() => ({ n: window.__indai.app.chart.state().count, sideways: document.documentElement.scrollWidth > innerWidth + 1, hostH: Math.round(document.getElementById('chart-host').getBoundingClientRect().height) }));
    console.log(name, JSON.stringify({ toolsOnOneLine: oneLine, ...info, errs }));
    const clip = await p.evaluate(() => { const r = document.getElementById('p-chart').getBoundingClientRect(); return { x: Math.max(0, r.left - 6), y: Math.max(0, r.top - 6), width: Math.min(innerWidth, r.width + 12), height: Math.min(innerHeight - Math.max(0, r.top - 6), r.height + 12) }; });
    await p.screenshot({ path: `${__dirname}/send-chart-${name}.png`, clip });
    await ctx.close();
  }
  await b.close();
})();
