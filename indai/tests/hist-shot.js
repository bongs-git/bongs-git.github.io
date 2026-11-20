const { chromium } = require('playwright'); const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 }); const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8765/indai/?demo=1'); await p.waitForFunction(() => window.__indai && window.__indai.app.chart && window.__indai.app.chart.geo, null, { timeout: 30000 }); await sleep(700);
  const B = await p.evaluate(() => { const r = document.getElementById('chart-host').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const x = B.x + B.w * 0.4, y = B.y + B.h * 0.5;
  for (let n = 0; n < 2; n++) { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 380, y, { steps: 5 }); await p.mouse.up(); await sleep(400); }
  await p.keyboard.down('Control'); await p.mouse.move(x, y); await p.mouse.wheel(0, 120); await sleep(500); await p.mouse.wheel(0, 60); await p.keyboard.up('Control'); await sleep(900);
  await p.mouse.move(B.x + B.w * 0.3, B.y + B.h * 0.45); await sleep(300);
  const clip = await p.evaluate(() => { const r = document.getElementById('p-chart').getBoundingClientRect(); return { x: Math.max(0, r.left - 6), y: Math.max(0, r.top - 6), width: r.width + 12, height: r.height + 12 }; });
  console.log(JSON.stringify(await p.evaluate(() => { const g = window.__indai.app.chart.geo; return { H: g.H, slots: Math.round(g.slots), first: Math.round(g.first) }; })));
  await p.screenshot({ path: __dirname + '/send-chart-history.png', clip }); await b.close(); })();
