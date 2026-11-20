const assert = require('node:assert/strict');
const { chromium, URL, installBackend, sleep } = require('./lib.js');
const NOW = Date.parse('2026-11-19T18:00:00Z');
(async () => {
  const browser = await chromium.launch();
  for (const width of [360, 820, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, hasTouch: width < 1000, isMobile: width < 700 });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    await page.clock.install({time:new Date(NOW)});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await installBackend(page, { ymd: '2026-11-19', minutes: 210 }, (request, json) => json(request.method() === 'GET' ? { configured: false, passcode: false } : { error: 'bad_key', message: 'Unknown profile key.' }, request.method() === 'GET' ? 200 : 400));
    await page.route('**/functions/v1/indai-market?*', async route => {
      const params = new globalThis.URL(route.request().url()).searchParams;
      const symbols = (params.get('symbols') || '').split(',');
      const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      if (params.get('kind') === 'snapshot') return json({ quotes: symbols.map(symbol => ({ symbol, ok: true, source: 'TradingView bridge', delay: 0, price: 100, close: 100, prevClose: 0, timestamp: new Date(NOW - 60000).toISOString() })) });
      if (params.get('kind') === 'bars') return json({ bars: Object.fromEntries(symbols.map(symbol => [symbol, { source: 'TradingView bridge', delay: 0, session: '2026-11-19', bars: Array.from({ length: 210 }, (_, i) => [571 + i, 100, 101, 99, 100, 1000]) }])) });
      if (params.get('kind') === 'chain') return json({ error: 'upstream', message: 'Provider refused the request' }, 503);
      return route.fallback();
    });
    await page.route('**/rest/v1/indai_gex_levels?*', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
    let releaseHistory;
    await page.route('**/functions/v1/indai-tv?bars=1&ticker=*', route => new Promise(resolve => {
      releaseHistory = async () => { await route.fulfill({ contentType: 'application/json', body: '{"bars":[]}' }); resolve(); };
    }));
    await page.goto(URL + '?nosw=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai?.app.feed.quote('IWM') && window.__indai.app.chart.geo);
    await page.waitForFunction(() => document.getElementById('t-badge').textContent === 'TradingView, live');
    assert.equal(await page.textContent('#ch-note'), 'TradingView, live');
    assert.equal(await page.textContent('#ch-chg'), '—');
    await page.click('#t-badge');
    assert.match(await page.textContent('#toast'), /TradingView, live/);
    await page.clock.setSystemTime(new Date(NOW + 180000));
    await page.evaluate(() => { const a = window.__indai.app; a.views.top.render(); a.views.chart.render(); });
    assert.match(await page.textContent('#t-badge'), /TradingView, last candle/);
    assert.match(await page.textContent('#ch-note'), /TradingView, last candle/);
    console.log(`PASS ${width}px truthful bridge source, stale state and missing previous close`);

    await page.evaluate(() => window.__indai.app.indai.analyzeIdea({ sym: 'IWM', type: 'C', strike: 100, expiry: '2026-11-19' }));
    await page.waitForFunction(() => document.getElementById('sb-analysis').textContent.includes('Option prices are unavailable right now'));
    await page.evaluate(() => { const a = window.__indai.app; a.closeFocus(); a.openCalc(); });
    await page.waitForFunction(() => document.getElementById('c-note').textContent.includes('Option prices are unavailable right now'));
    await page.evaluate(() => { const a = window.__indai.app; a.closeFocus(); a.ui.showTab('chart'); a.views.levels.render(); });
    assert.match(await page.textContent('#lv-rows'), /Option prices are unavailable right now/);
    console.log(`PASS ${width}px failed option chains explain the calculator, verdict and GEX state`);

    await page.click('#ch-draw');
    await page.click('#ch-tools [data-tool="rect"]');
    await sleep(200);
    const rect = await page.locator('#chart-host').boundingBox();
    const x = rect.x + rect.width * 0.25, y = rect.y + rect.height * 0.35;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 65, y + 60, { steps: 8 }); await page.mouse.up();
    let drawings = await page.evaluate(() => JSON.parse(localStorage.getItem('indai.web.draw.v1')).IWM);
    assert.equal(drawings.at(-1).type, 'rect');
    await page.click('#ch-undo');
    assert.equal(await page.evaluate(() => (JSON.parse(localStorage.getItem('indai.web.draw.v1')).IWM || []).length), 0);
    if (width < 1000) {
      await page.click('#ch-tools [data-tool="level"]');
      const touch = await context.newCDPSession(page);
      await touch.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:x+30,y:y+20,id:1}]});
      await page.locator('.chart-magnifier').waitFor({state:'visible'});
      await touch.send('Input.dispatchTouchEvent', {type:'touchCancel',touchPoints:[]});
      await page.locator('.chart-magnifier').waitFor({state:'hidden'});
      assert.equal(await page.evaluate(() => (JSON.parse(localStorage.getItem('indai.web.draw.v1')).IWM || []).length), 0);
      await touch.detach();
      console.log(`PASS ${width}px long-press magnifier and cancelled touch rollback`);
    }
    await page.click('#ch-tools [data-tool="ray"]');
    await page.mouse.click(x + 35, y + 25);
    drawings = await page.evaluate(() => JSON.parse(localStorage.getItem('indai.web.draw.v1')).IWM);
    assert.equal(drawings.at(-1).type, 'ray');
    await page.click('#ch-del'); await page.click('#ch-undo');
    assert.equal(await page.evaluate(() => (JSON.parse(localStorage.getItem('indai.web.draw.v1')).IWM || []).length), 1);
    console.log(`PASS ${width}px rectangle, horizontal ray, delete and undo`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false);
    const buttons = await page.locator('#ch-tools button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height));
    assert(buttons.every(h => h >= 44));

    await page.evaluate(() => { const a = window.__indai.app; a.chart.setDrawing(false); a.settings.researchPass = 'fixture-only'; a.drawSync.refresh(); });
    await page.waitForFunction(() => window.__indai.app.drawSync.state.note.includes('backend support'));
    console.log(`PASS ${width}px unsupported drawing profiles retain local work and explain the sync status`);
    const fixed = await page.evaluate(() => {
      const a = window.__indai.app, c = a.chart;
      c.setView(15, 24); c.draw();
      const before = { ...c.view };
      const s = a.feed.sym(a.settings.main), last = s.bars['1min'].at(-1);
      s.bars['1min'].push({ ...last, t: last.t + 60000 });
      c.draw();
      return { before, after: c.view };
    });
    assert.deepEqual(fixed.before, fixed.after);
    await page.evaluate(() => { const a = window.__indai.app; a.chart.setView(-30, 50); a.views.chart.render(); });
    await page.waitForFunction(() => document.getElementById('ch-history').textContent.includes('Loading earlier candles'));
    assert(releaseHistory); await releaseHistory();
    await page.waitForFunction(() => document.getElementById('ch-history').textContent.includes('That is all INDAI has stored'));
    console.log(`PASS ${width}px history progress, completion and stable scrolled view`);

    await page.click('#ch-tv');
    const frame = page.locator('#tv-frame');
    assert((await frame.getAttribute('sandbox')).includes('allow-scripts'));
    assert.equal(new globalThis.URL(await frame.getAttribute('src')).origin, 'https://www.tradingview-widget.com');
    assert.equal(await frame.getAttribute('srcdoc'), null);
    assert.equal(await frame.getAttribute('credentialless'), '');
    await page.click('#tv-full');
    await page.waitForFunction(() => document.fullscreenElement || document.getElementById('chart-host').classList.contains('expanded'));
    await page.click('#tv-full');
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px cross-origin TradingView frame and full screen`);
    await context.close();
  }
  await browser.close();
  console.log('ALL PASSED');
})().catch(error => { console.error('SCRIPT ERROR', error); process.exit(1); });
