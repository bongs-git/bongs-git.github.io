const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); };
const ready = (page) => page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'demo' && window.__indai.app.feed.quote('IWM'), null, { timeout: 30000 });
(async () => {
  const browser = await chromium.launch();
  const mk = async (q, w = 1440, h = 900) => { const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); await page.goto(URL + q); await ready(page); await sleep(500); return { ctx, page, errs, A: (fn, a) => page.evaluate(fn, a) }; };
  const et = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()));
  const inWindow = et >= 6 && et < 16 && ![0, 6].includes(new Date().getUTCDay());

  // 1. the morning check-in waits for the person: a first typed trade idea is analysed, not taken as "capital"
  { const { ctx, page, errs, A } = await mk('?nosw=1&demo=1');
    await page.fill('#i-input', 'QQQ calls expiring today 665 strike'); await page.press('#i-input', 'Enter');
    await sleep(3500);
    const a = await A(() => ({ an: window.__indai.app.analysis && window.__indai.app.analysis.idea.strike, aw: window.__indai.app.indai.awaiting, cap: window.__indai.app.planDraft.capital, focus: window.__indai.app.focus }));
    check('first typed idea is analysed, check-in holds off', a.an === 665 && !a.aw && a.cap !== 665, JSON.stringify(a));
    await A(() => { window.__indai.app.closeFocus(); document.activeElement.blur(); });
    if (inWindow) { await page.waitForFunction(() => window.__indai.app.indai.awaiting === 'capital', null, { timeout: 20000 }).catch(() => {}); check('check-in starts once things are quiet', (await A(() => window.__indai.app.indai.awaiting)) === 'capital'); }
    else console.log('   (outside 6am-4pm ET on a trading day: automatic check-in not expected)');
    check('run 1: no page errors', errs.length === 0, errs.join('|')); await ctx.close(); }

  // 2 + 3. plan editor: type an amount then click Lock once; answers given in the check-in survive "Set it by hand"
  { const { ctx, page, errs, A } = await mk('?nosw=1&demo=1&nocheckin=1');
    await A(() => window.__indai.app.openPlan()); await sleep(500);
    await page.click('[data-field="capital"]'); await page.keyboard.type('3000');
    await page.click('#plan-lock'); await sleep(600);
    let p = await A(() => window.__indai.app.day.plan);
    check('typed amount then one click on Lock in plan', p && p.capital === 3000, JSON.stringify(p));
    await page.click('[data-field="goal"]'); await page.keyboard.type('120'); await page.keyboard.press('Tab'); await sleep(300);
    const foc = await A(() => { const e = document.activeElement; return e && (e.dataset.step || e.id || e.tagName); });
    check('tabbing out of an amount keeps keyboard focus in the form', foc === 'goal', String(foc));
    await A(() => { window.__indai.app.closeFocus(); window.__indai.app.resetDay(); });
    await page.fill('#i-input', 'start my day'); await page.press('#i-input', 'Enter');
    await page.waitForFunction(() => window.__indai.app.indai.awaiting === 'capital', null, { timeout: 15000 });
    await page.fill('#i-input', '1000'); await page.press('#i-input', 'Enter'); await sleep(500);
    await page.fill('#i-input', '40'); await page.press('#i-input', 'Enter'); await sleep(500);
    await A(() => window.__indai.app.openPlan()); await sleep(400); await A(() => window.__indai.app.closeFocus());
    await page.fill('#i-input', 'balanced'); await page.press('#i-input', 'Enter'); await sleep(700);
    p = await A(() => window.__indai.app.day.plan);
    check('check-in answers survive opening the editor', p && p.capital === 1000 && p.goal === 40 && p.aggr === 'balanced', JSON.stringify(p));
    // 6 + 7. stepper after a typed amount; undo takes back the cooldown its loss started
    const st = await A(() => { const a = window.__indai.app; a.setStepValue(600); a.setStep(1); const up = a.day.step; a.setStepValue(600); a.setStep(-1); const dn = a.day.step; a.setStepValue(5); a.setStep(-1); const lo = a.day.step; return { up, dn, lo }; });
    check('stepper from a typed amount', st.up === 750 && st.dn === 500 && st.lo === 10, JSON.stringify(st));
    const cd = await A(() => { const a = window.__indai.app; a.resetDay(); a.settings.risk.maxDailyLoss = 1e6; a.settings.risk.maxConsecLosses = 2; for (let i = 0; i < 4; i++) a.logTrade(-10); const on = a.riskState().state; a.undoTrade(); const after = a.riskState().state; a.logTrade(-10); const again = a.riskState().state; return { on, after, again }; });
    check('undo clears the cooldown its loss started', cd.on === 'cooldown' && cd.after === 'armed' && cd.again === 'cooldown', JSON.stringify(cd));
    check('run 2: no page errors', errs.length === 0, errs.join('|')); await ctx.close(); }

  // 4. ?demo=1 is for this visit only
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
    await page.goto(URL + '?nosw=1&demo=1&nocheckin=1'); await ready(page);
    await page.click('#w-rows .wrow[data-sym="TSLA"] .hit'); await sleep(400);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}'));
    check('?demo=1 is not saved into settings', saved.main === 'TSLA' && saved.dataMode !== 'demo', JSON.stringify({ main: saved.main, mode: saved.dataMode }));
    await ctx.close(); }
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
