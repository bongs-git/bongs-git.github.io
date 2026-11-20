const { chromium } = require('playwright');
const OUT = __dirname;
const only = process.argv[2];
const sizes = { phone: [390, 844], tablet: [820, 1180], laptop: [1440, 900] };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  for (const [name, [w, h]] of Object.entries(sizes)) {
    if (only && only !== name) continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: name !== 'laptop', isMobile: name === 'phone' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
    page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.type() + ' ' + m.text().slice(0, 300)); });
    const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] ${label} ${extra}`); };
    const shot = (n) => page.screenshot({ path: `${OUT}/${name}-${n}.png` });
    await page.goto('http://127.0.0.1:8765/indai/?nosw=1&nocheckin=1', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'demo' && window.__indai.app.feed.quote('IWM'), null, { timeout: 30000 });
    await sleep(800);
    const A = (fn, arg) => page.evaluate(fn, arg);
    const logText = () => A(() => [...document.querySelectorAll('#i-log .msg')].map(m => m.textContent).join('\n'));
    const tab = async (t) => { if (name === 'phone') { await page.click(`#tabs [data-tab="${t}"]`); await sleep(350); } };
    const say = async (text, waitFor, timeout = 15000) => {
      if (name === 'phone') { const cur = await A(() => window.__indai.app.tab); if (cur !== 'indai' || await A(() => !!window.__indai.app.focus)) { await A(() => window.__indai.app.closeFocus()); await tab('indai'); } }
      else if (name === 'tablet') await A(() => window.__indai.app.closeFocus());
      const before = (await logText()).length;
      await page.fill('#i-input', text);
      await page.press('#i-input', 'Enter');
      if (name === 'phone') await A(() => document.activeElement && document.activeElement.blur());
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { const lt = (await logText()).slice(before); if (waitFor.test(lt)) return lt; await sleep(150); }
      return (await logText()).slice(before);
    };
    // ---- every screen
    if (name === 'phone') {
      for (const t of ['watch', 'chart', 'plan', 'more', 'indai']) { await tab(t); await shot('tab-' + t); const vis = await A((t) => getComputedStyle(document.querySelector(`.view[data-view="${t}"]`)).display !== 'none', t); check('tab ' + t + ' shows', vis); }
    } else await shot('home');
    // ---- typed commands
    let r = await say('brief me', /Day P&L/);
    check('brief me', /Demo mode/.test(r) && /Day P&L/.test(r), JSON.stringify(r.slice(0, 160)));
    r = await say('show TSLA', /TSLA,/);
    check('show TSLA', (await A(() => window.__indai.app.settings.main)) === 'TSLA' && /TSLA, \d/.test(r), JSON.stringify(r.slice(0, 120)));
    if (name === 'phone') { await tab('chart'); await shot('chart-tsla'); }
    r = await say('QQQ calls expiring today 665 strike', /Quant read|couldn't|RED\./, 25000);
    const an = await A(() => { const a = window.__indai.app.analysis; return a && { sym: a.idea.sym, strike: a.idea.strike, type: a.idea.type, exp: a.idea.expiry, rag: a.score.rag, score: a.score.score, factors: a.score.factors.length }; });
    check('trade idea -> verdict', an && an.sym === 'QQQ' && an.strike === 665 && an.type === 'C' && /RED|AMBER|GREEN/.test(an.rag), JSON.stringify(an));
    await sleep(500); await shot('verdict');
    if (name !== 'laptop') { await page.click('#i-pin [data-act="details"]'); await sleep(400); }
    check('analysis card open', (await A(() => window.__indai.app.focus)) === 'analysis' && await page.isVisible('#sheet-analysis .rag'));
    await shot('analysis');
    r = await say('open the calculator', /Calculator open/);
    await sleep(600);
    check('calculator open', (await A(() => window.__indai.app.focus)) === 'calc' && await page.isVisible('#c-heat table') && (await A(() => document.querySelectorAll('#c-heat tbody tr').length)) >= 10);
    await shot('calc');
    await page.selectOption('#c-strat', 'condor'); await sleep(900);
    check('iron condor preset', (await A(() => window.__indai.app.calc.legs.length)) === 4 && (await A(() => document.querySelectorAll('#c-legs .leg').length)) === 4);
    await shot('calc-condor');
    r = await say('start my day', /How much are we/, 20000);
    check('start my day asks capital', /How much are we/.test(r) && (await A(() => window.__indai.app.indai.awaiting)) === 'capital', JSON.stringify(r.slice(-160)));
    await sleep(300); await shot('checkin');
    r = await say('show IWM', /IWM,/);
    check('command mid check-in is not taken as the answer', (await A(() => window.__indai.app.settings.main)) === 'IWM' && (await A(() => window.__indai.app.indai.awaiting)) === 'capital');
    r = await say('2000', /minimum goal/);
    check('capital answer', /\$2,000/.test(r) && (await A(() => window.__indai.app.indai.awaiting)) === 'goal');
    r = await say('100', /How aggressive/);
    check('goal answer', /Goal \$100/.test(r));
    r = await say('balanced', /Plan locked/);
    const plan = await A(() => window.__indai.app.day.plan);
    check('plan locked', plan && plan.capital === 2000 && plan.goal === 100 && plan.aggr === 'balanced' && /Plan locked/.test(r), JSON.stringify(plan));
    r = await say('log a win of 50', /Logged a win/);
    check('log a win of 50', (await A(() => window.__indai.app.day.pnl)) === 50 && /Logged a win of \$50/.test(r), JSON.stringify(r.slice(0, 100)));
    r = await say('undo', /Removed the last trade/);
    check('undo', (await A(() => window.__indai.app.day.pnl)) === 0);
    r = await say('log a loss of 40', /Logged a loss/);
    check('log a loss', (await A(() => window.__indai.app.day.pnl)) === -40);
    r = await say('what do you remember', /fix(es)? for how you speak/);
    check('what do you remember', /Nothing saved yet|holding/.test(r), JSON.stringify(r.slice(0, 120)));
    r = await say('remember that I never trade the first five minutes', /couldn't save|remember that/);
    check('remember that (offline -> graceful)', /couldn't save that|I'll remember/.test(r), JSON.stringify(r.slice(0, 120)));
    r = await say('switch to the loft', /headset/);
    check('scene is headset-only', /headset/i.test(r));
    r = await say('gesture tutorial', /headset/);
    check('gesture tutorial is headset-only', /headset/i.test(r));
    r = await say('five minute chart', /5 minute chart/);
    check('timeframe', (await A(() => window.__indai.app.settings.interval)) === '5min');
    r = await say('deep dive on Tesla', /TSLA, \d/, 20000);
    await sleep(500);
    check('deep dive', (await A(() => window.__indai.app.focus)) === 'deep' && /TSLA/.test(await page.textContent('#st-deep')), JSON.stringify(r.slice(0, 140)));
    await shot('deep');
    r = await say('practice alert', /Practice alert/);
    check('practice alert', /Practice alert, replayed/.test(r) && (await A(() => window.__indai.app.signals.length)) >= 1, JSON.stringify(r.slice(0, 140)));
    await sleep(300); await shot('signal');
    r = await say('summary', /Everything in one view/);
    await sleep(400);
    check('summary', (await A(() => window.__indai.app.focus)) === 'summary'); await shot('summary');
    r = await say('run a self-test', /Self-test done/, name === 'phone' ? 9000 : 30000);
    await sleep(500);
    if (name === 'phone') { await shot('selftest'); await A(() => window.__indai.app.closeFocus()); await sleep(400); r = await logText(); }
    check('self-test', /Self-test done\. \d+ of 11/.test(r), JSON.stringify((r.match(/Self-test done[^\n]*/) || [''])[0].slice(0, 200)));
    await shot('selftest');
    await A(() => window.__indai.app.closeFocus());
    await A(() => window.__indai.app.openPlan()); await sleep(500); check('plan editor', await page.isVisible('#plan-lock')); await shot('plan');
    await A(() => window.__indai.app.openSettings()); await sleep(500); check('settings', await page.isVisible('#s-name') && (await page.inputValue('#s-name')) === 'Bongs'); await shot('settings');
    await A(() => window.__indai.app.closeFocus());
    if (name === 'phone') { await tab('plan'); await shot('tab-plan-locked'); await tab('indai'); await shot('tab-indai-end'); await tab('watch'); await shot('tab-watch-end'); }
    else { await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300); await shot('home-end'); if (name === 'tablet') { await page.evaluate(() => window.scrollTo(0, 99999)); await sleep(400); await shot('home-bottom'); } }
    const dup = await A(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))]; });
    check('no duplicate element ids', dup.length === 0, dup.join(','));
    await A(() => window.__indai.app.openSettings()); await sleep(300); await page.click('#s-selftest'); await sleep(1200);
    check('settings -> run self-test works', (await A(() => window.__indai.app.focus)) === 'selftest');
    await A(() => window.__indai.app.closeFocus());
    const overflow = await A(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check('no horizontal overflow', !overflow);
    check('no page errors', errs.length === 0, errs.length ? '\n  ' + errs.slice(0, 6).join('\n  ') : '');
    console.log(`[${name}] conversation tail:\n` + (await logText()).split('\n').slice(-6).map(l => '    ' + l.slice(0, 150)).join('\n'));
    await ctx.close();
  }
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
