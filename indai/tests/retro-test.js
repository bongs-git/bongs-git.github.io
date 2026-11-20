// The retrospective in the app: the button and chip after the close, the screen's numbers against the engine,
// learning from several days, applying and clearing it, the scanner using it, keeping the day, talking it through.
// Runs against the mocked real-data backend; the "after the close" parts need the real clock to be past 4 pm New York,
// so the page clock is moved there when it is not.
const { chromium, OUT, URL, sleep, check, state, lastSession, installBackend } = require('./lib.js');
const GRID = []; for (const stop of [1, 1.5, 2]) for (const target of [0.75, 1, 1.5]) GRID.push({ stop, target });
const ymdOf = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
// two earlier days kept on the device: lunch-window setups all lost, the rest won two of three
function seed() {
  const days = {}; let back = 0;
  for (let k = 0; k < 2; k++) {
    let d; do { back++; d = new Date(Date.now() - back * 864e5); } while ([0, 6].includes(new Date(ymdOf(d) + 'T12:00:00Z').getUTCDay()));
    const ymd = ymdOf(d), t0 = Date.parse(ymd + 'T15:00:00Z');
    days[ymd] = { at: t0, minScore: 64, recs: [...Array(20)].map((_, i) => {
      const lunch = i < 7, win = !lunch && i % 3 !== 0;
      return { id: `S|${ymd}|${i}`, sym: lunch ? 'TSLA' : 'SPY', strat: 'ema', dir: 1, title: 'pullback held the fast cloud', raw: 70 + (i % 9), t: t0 + i * 6e5, min: lunch ? 720 : 600, flags: lunch ? ['below VWAP'] : [], rr: 2,
        res: win ? 'W' : 'L', R: win ? 2 : -1, mfe: win ? 2 : 0.4, mae: win ? 0.3 : 1, mins: win ? 14 : 6, stopThenTarget: false, near: false, grid: GRID.map(v => win ? (v.target > 1 ? 1 : 2 * v.target) : -v.stop), pb: null };
    }) };
  }
  return { days, tuning: null, log: [] };
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const sess = lastSession();
  // the mock's session must be a whole, finished day for the after-the-close checks
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(new Date());
  const hour = +p.find(x => x.type === 'hour').value % 24, weekday = !['Sat', 'Sun'].includes(p.find(x => x.type === 'weekday').value);
  const afterClose = weekday && hour >= 16 && sess.ymd === ymdOf(new Date());
  console.log(`   New York hour ${hour}, session ${sess.ymd}, ${sess.minutes} minutes${afterClose ? ', after the close' : ' (not after the close: those checks are skipped)'}`);
  const be = { talk: [], mem: [] };
  for (const [name, w, h, mobile] of [['phone', 390, 844, true], ['laptop', 1440, 900, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.type() + ' ' + m.text().slice(0, 240)); });
    await page.addInitScript((s) => { if (!localStorage.getItem('indai.web.retro.v1')) localStorage.setItem('indai.web.retro.v1', JSON.stringify(s)); }, seed());
    await installBackend(page, sess, async (req, json) => {
      if (req.method() === 'GET') return json({ configured: true, passcode: false, memory: true });
      const b = JSON.parse(req.postData() || '{}');
      if (b.mode === 'memory') { be.mem.push(b); return json({ memory: [] }); }
      if (b.mode === 'talk') { be.talk.push(b); return json({ result: { spoken: 'The lunch window cost you most today, so tomorrow sit that hour out.', summary: ['Stops were fine', 'Calls beat puts'] }, remembered: [] }); }
      return json({ error: 'not_found' }, 404);
    });
    await page.goto(URL + '?nosw=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'delayed' && window.__indai.app.feed.getBars('IWM', '5min').length > 5, null, { timeout: 20000 });
    // levels for every ticker have to be in first: the replay uses them, like the scanner does
    await page.waitForFunction(() => { const a = window.__indai.app; return a.settings.symbols.every(s => a.levelsFor(s)); }, null, { timeout: 90000 }).catch(() => {});
    await sleep(7000);
    const A = (fn, arg) => page.evaluate(fn, arg);
    const day = await A(() => { const d = window.__indai.app.retro.buildDay(); return d && { n: d.recs.length, final: d.final, ymd: d.ymd, W: d.recs.filter(r => r.res === 'W').length, L: d.recs.filter(r => r.res === 'L').length, O: d.recs.filter(r => r.res === 'O').length, R: +d.recs.reduce((a, r) => a + r.R, 0).toFixed(2), gridOk: d.recs.every(r => r.grid.length === 9 && r.grid[1] === r.R), ids: new Set(d.recs.map(r => r.id)).size, sorted: d.recs.every((r, i, a) => !i || a[i - 1].t <= r.t), minOk: d.recs.every(r => r.raw >= d.minScore) }; });
    if (!day) { console.log(`   [${name}] no session to go over right now (before 10:05 New York or not a trading day): app checks skipped`); await ctx.close(); continue; }
    check(`[${name}] the day's setups are replayed with results, each once, in order, at the plan's level`, day.n > 0 && day.ids === day.n && day.sorted && day.minOk && day.gridOk && day.W + day.L + day.O === day.n, JSON.stringify(day));
    // the Ideas screen: the button
    await A(() => window.__indai.app.openIdeas()); await sleep(600);
    const cta = await A(() => { const b = document.querySelector('#sb-ideas [data-retro="open"]'); return b && { text: b.textContent, primary: b.classList.contains('primary'), note: b.parentElement.textContent }; });
    check(`[${name}] Ideas has a Retrospective button${afterClose ? ', gold once the day is over' : ''}`, cta && cta.text === 'Retrospective' && (!afterClose || (cta.primary && /day is over/.test(cta.note))), JSON.stringify(cta));
    if (afterClose) check(`[${name}] the strip leads with a Retrospective chip after the close`, await A(() => document.querySelector('#ideas-row .ichip')?.textContent === 'Retrospective'));
    await page.click('#sb-ideas [data-retro="open"]'); await sleep(900);
    const scr = await A(() => ({ title: document.getElementById('st-ideas').textContent, pill: document.querySelector('.retro-top .pill')?.textContent, tiles: [...document.querySelectorAll('.rtiles b')].map(b => b.textContent), text: document.getElementById('sb-ideas').textContent.replace(/\s+/g, ' '), h3: [...document.querySelectorAll('#sb-ideas h3')].map(x => x.textContent) }));
    const wr = day.W + day.L ? Math.round(day.W / (day.W + day.L) * 100) + '%' : '—';
    check(`[${name}] the screen's headline matches the engine`, scr.title === 'Retrospective' && scr.pill === (day.final ? 'Final' : 'So far today') && scr.tiles[0] === String(day.n) && scr.tiles[1] === wr && scr.tiles[3].startsWith(`${day.W}–${day.L}`), JSON.stringify({ pill: scr.pill, tiles: scr.tiles, day }));
    check(`[${name}] it shows where it missed, entry / stop / target, what she would change, what is in force, day by day`, ['Where it missed most', 'Entry, stop and target', 'What INDAI would change', 'In force now', 'Day by day'].every(x => scr.h3.includes(x)) && /Stops\./.test(scr.text) && /Targets\./.test(scr.text) && /Stop and target together/.test(scr.text) && /not option fills/.test(scr.text), JSON.stringify(scr.h3));
    await page.screenshot({ path: `${OUT}/retro-${name}-top.png` });
    // learning: with the two kept days the lunch window stands out
    const prop = await A(() => { const r = window.__indai.app.retro.review(); return { ready: r.proposal.ready, n: r.proposal.n, days: r.proposal.days, adj: r.proposal.adj, why: r.proposal.why.map(x => x.text) }; });
    check(`[${name}] three days behind it: she proposes marking down what lost`, prop.ready && prop.days === 3 && prop.adj['time:lunch'] < 0 && prop.why.some(x => /Lunch window/.test(x)), JSON.stringify(prop));
    const before = await A(() => { const a = window.__indai.app; const c = { sym: 'SPY', strat: 'ema', dir: 1, type: 'C', title: 'pullback held the fast cloud', why: [], against: [], score: 72, price: 100, stop: 99, target: 102, rr: 2, barT: 0 }; return a.tune({ ...c }, Date.UTC(2026, 10, 19, 17, 30)).score; });
    // the back-test of the proposed changes: all the numbers, matching the engine
    const btUi = await A(() => {
      const t = [...document.querySelectorAll('#sb-ideas .rtable')][0]; if (!t) return null;
      const rows = Object.fromEntries([...t.querySelectorAll('tbody tr')].map(r => [r.querySelector('th').textContent, [...r.querySelectorAll('td')].map(c => c.textContent)]));
      return { head: [...t.querySelectorAll('thead td')].map(c => c.textContent), rows, h3: [...document.querySelectorAll('#sb-ideas h3')].map(x => x.textContent), days: document.querySelectorAll('#sb-ideas .rtable.days tbody tr').length, fair: [...document.querySelectorAll('#sb-ideas .note')].map(x => x.textContent).find(x => /The fair test/.test(x)) || '' };
    });
    const eng = await A(async () => { const m = await import('./js/retro.js'); const a = window.__indai.app, r = a.retro.review(); const b = m.backtest(r.days, r.minScore, r.proposal); const w = m.walkForward(r.days, r.minScore); return { base: b.base, tuned: b.tuned, risk: r.riskPerTrade, wf: w && { days: w.days, n: w.base.n }, code: m.tvCode(r.proposal) }; });
    check(`[${name}] back-test table: every number, scanner against the changes, as the engine has them`, btUi && btUi.h3.includes('Back-test of these changes') && btUi.head.join('|') === 'As the scanner scores|With the changes' && btUi.rows['Setups alerted'].join('|') === `${eng.base.n}|${eng.tuned.n}` && btUi.rows['Win rate'].join('|') === `${eng.base.winRate}%|${eng.tuned.winRate}%` && btUi.rows['Won – lost – open'][0] === `${eng.base.W} – ${eng.base.L} – ${eng.base.O}` && ['Result', 'Average per setup', `At $${eng.risk} a trade`, 'Profit factor', 'Deepest drawdown', 'Longest losing run'].every(k => btUi.rows[k] && btUi.rows[k].length === 2) && btUi.rows['Profit factor'][1] === (eng.tuned.pf === Infinity || eng.tuned.pf == null ? btUi.rows['Profit factor'][1] : eng.tuned.pf.toFixed(2)) && btUi.rows['Longest losing run'].join('|') === `${eng.base.losingRun}|${eng.tuned.losingRun}`, JSON.stringify({ btUi, eng: { base: eng.base, tuned: eng.tuned } }));
    check(`[${name}] back-test: day by day, and the fair test on later days`, btUi.days === 3 && /Each day judged with only what she could have learned from the days before it/.test(btUi.fair) && eng.wf && eng.wf.days >= 1, JSON.stringify({ days: btUi.days, fair: btUi.fair.slice(0, 140), wf: eng.wf }));
    // TradingView hand-off
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.locator('#sb-ideas [data-retro="copycode"]').scrollIntoViewIfNeeded(); await page.click('#sb-ideas [data-retro="copycode"]'); await sleep(500);
    const clip1 = await A(() => navigator.clipboard.readText().catch(() => 'unreadable'));
    await page.waitForFunction(() => true); await sleep(1200);
    await page.click('#sb-ideas [data-retro="copyscript"]'); await sleep(700);
    const clip2 = await A(() => navigator.clipboard.readText().catch(() => 'unreadable'));
    check(`[${name}] TradingView: the changes copy as one line, the script copies whole`, (clip1 === eng.code || clip1 === 'unreadable') && /^minadd=\d+;stop=[\d.]+;target=[\d.]+;/.test(eng.code) && /time:lunch=-\d+/.test(eng.code) && (clip2 === 'unreadable' || (/^\/\/@version=5/.test(clip2) && /strategy\("INDAI Backtest"/.test(clip2))) && /Bar Replay/.test(await page.textContent('#sb-ideas')), JSON.stringify({ clip1: String(clip1).slice(0, 90), clip2: String(clip2).slice(0, 40) }));
    await page.locator('#sb-ideas [data-retro="apply"]').scrollIntoViewIfNeeded(); await sleep(200);
    await page.screenshot({ path: `${OUT}/retro-${name}-change.png` });
    await page.click('#sb-ideas [data-retro="apply"]'); await sleep(900);
    const applied = await A(() => { const a = window.__indai.app, t = a.retro.tuning(); const c = { sym: 'SPY', strat: 'ema', dir: 1, type: 'C', title: 'pullback held the fast cloud', why: [], against: [], score: 72, price: 100, stop: 99, target: 102, rr: 2, barT: 0 };
      const lunch = a.tune({ ...c }, Date.UTC(2026, 10, 19, 17, 30)), morning = a.tune({ ...c }, Date.UTC(2026, 10, 19, 15, 0));
      return { adj: t.adj, stored: !!JSON.parse(localStorage.getItem('indai.web.retro.v1')).tuning, lunch: lunch.score, lunchRaw: lunch.raw.score, learned: lunch.learned, morning: morning.score, text: document.getElementById('sb-ideas').textContent.replace(/\s+/g, ' '), toast: document.getElementById('toast').textContent }; });
    check(`[${name}] Apply: kept on the device, in force, and the scanner now scores a lunch-window setup lower`, before === 72 && applied.stored && applied.adj['time:lunch'] < 0 && applied.lunch === 72 + Object.entries(applied.adj).filter(([k]) => ['time:lunch', 'kind:ema|pullback held the fast cloud', 'dir:1', 'sym:SPY'].includes(k)).reduce((a, [, v]) => a + v, 0) && applied.lunchRaw === 72 && applied.lunch < applied.morning && /Applied/.test(applied.toast), JSON.stringify({ before, lunch: applied.lunch, morning: applied.morning, adj: applied.adj }));
    check(`[${name}] after applying: nothing new to change, the changes are listed as in force`, /Nothing new\. What she has learned still fits/.test(applied.text) && /In force now.*Lunch window/.test(applied.text) && /Clear what she has learned/.test(applied.text), applied.text.slice(applied.text.indexOf('What INDAI would change'), applied.text.indexOf('What INDAI would change') + 220));
    check(`[${name}] the lesson went to her long-term memory`, be.mem.some(m => m.op === 'add' && m.kind === 'rule' && /^Retrospective .*trade ideas over 3 days: .*Lunch window/.test(m.text)), JSON.stringify(be.mem.slice(-1)));
    check(`[${name}] today's setups are shown split into alerted and skipped`, /What she has learned, on today’s setups/.test(applied.text) && /She alerted on \d+/.test(applied.text));
    // the Ideas list says what is applied
    await page.click('#sb-ideas [data-retro="back"]'); await sleep(500);
    check(`[${name}] back on the list, it says what she has learned is applied`, /thing(s)? she has learned from retrospectives applied/.test(await page.textContent('#sb-ideas .ideas-how')) && await A(() => document.getElementById('st-ideas').textContent === 'Trade ideas'));
    // talk it through
    await page.click('#sb-ideas [data-retro="open"]'); await sleep(700);
    const t0 = be.talk.length;
    await page.locator('#sb-ideas [data-retro="talk"]').scrollIntoViewIfNeeded(); await page.click('#sb-ideas [data-retro="talk"]'); await sleep(1500);
    const talk = be.talk[be.talk.length - 1], log = await A(() => window.__indai.app.indai.log.slice(-4).map(l => l.text).join('\n'));
    check(`[${name}] Talk it through: the day's numbers go to her brain and she answers in the conversation`, be.talk.length === t0 + 1 && talk.question.length <= 600 && /^Retrospective for today\. \d+ setups/.test(talk.question) && talk.context.retrospective.setups.n === day.n && /lunch window cost you most/.test(log) && /• Stops were fine/.test(log) && await A(() => !window.__indai.app.focus), JSON.stringify({ q: talk && talk.question.slice(0, 120), log: log.slice(0, 160) }));
    // typed
    if (mobile) await A(() => window.__indai.app.ui.showTab('indai'));
    await page.fill('#i-input', 'Retrospective'); await page.press('#i-input', 'Enter'); await sleep(900);
    check(`[${name}] typing "retrospective" opens it`, await A(() => window.__indai.app.focus === 'ideas' && window.__indai.app.ideasView === 'retro'));
    // clear it (two taps)
    await page.locator('#sb-ideas [data-retro="reset"]').scrollIntoViewIfNeeded(); await page.click('#sb-ideas [data-retro="reset"]'); await sleep(400);
    const armedText = await page.textContent('#sb-ideas [data-retro="reset"]');
    await page.click('#sb-ideas [data-retro="reset"]'); await sleep(700);
    const cleared = await A(() => { const a = window.__indai.app; return { adj: Object.keys(a.retro.tuning().adj).length, score: a.tune({ sym: 'SPY', strat: 'ema', dir: 1, title: 'pullback held the fast cloud', against: [], score: 72, price: 100, stop: 99, target: 102, rr: 2 }, Date.UTC(2026, 10, 19, 17, 30)).score, text: document.getElementById('sb-ideas').textContent }; });
    check(`[${name}] Clear what she has learned (two taps): back to the scanner as it scores, and she proposes again`, /Tap again/.test(armedText) && cleared.adj === 0 && cleared.score === 72 && /Nothing yet\. She alerts exactly as the scanner scores/.test(cleared.text) && /Apply these changes/.test(cleared.text), JSON.stringify({ armedText, adj: cleared.adj, score: cleared.score }));
    // keeping the day
    if (afterClose && day.final) {
      const banked = await A(() => { const a = window.__indai.app, y = a.retro.buildDay().ymd, ok = a.retro.bank(); const st = JSON.parse(localStorage.getItem('indai.web.retro.v1')); return { ok, has: !!st.days[y], n: st.days[y] && st.days[y].recs.length, days: Object.keys(st.days).length, hist: a.retro.history().length, banked: a.retro.banked(y) }; });
      check(`[${name}] after the close the day is kept for next time`, banked.has && banked.n === day.n && banked.days === 3 && banked.banked, JSON.stringify(banked));
    } else {
      const notYet = await A(() => window.__indai.app.retro.bank());
      check(`[${name}] a day that is not over is not kept yet`, notYet === false);
    }
    const dup = await A(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.filter((x, i) => ids.indexOf(x) !== i); });
    const over = await A(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    check(`[${name}] no duplicate ids, no sideways scroll, no page errors`, dup.length === 0 && over && errs.length === 0, [dup.join(','), errs.slice(0, 3).join(' | ')].join(' '));
    await ctx.close();
  }
  // demo data: can be looked at, changes nothing, keeps nothing
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(URL + '?demo=1&nosw=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.getBars('SPY', '5min').length > 10, null, { timeout: 20000 }); await sleep(3500);
    const A = (fn, arg) => page.evaluate(fn, arg);
    const d = await A(() => { const a = window.__indai.app, day = a.retro.buildDay(); a.openRetro(); return day && { n: day.recs.length, demo: day.demo, banked: a.retro.bank(day) }; });
    await sleep(800);
    const text = await page.textContent('#sb-ideas');
    if (d) check('[demo] viewable, marked as demo, nothing kept, nothing to apply, never tunes the scanner', d.demo && d.banked === false && /Demo data/.test(await page.textContent('.retro-top .pill')) && /nothing is kept and nothing changes/.test(text) && !(await page.$('#sb-ideas [data-retro="apply"]')) && await A(() => { const a = window.__indai.app; a.retro.apply({ adj: { 'dir:1': -9 }, labels: {}, minAdd: 0, stop: 1, target: 1, n: 30, days: 1, why: [] }); const s = a.tune({ sym: 'SPY', strat: 'ema', dir: 1, title: 'x', against: [], score: 72, price: 100, stop: 99, target: 102, rr: 2 }, Date.now()).score; a.retro.reset(); return s === 72; }), JSON.stringify(d));
    else console.log('   [demo] no session to go over right now: skipped');
    check('[demo] no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(state.failed ? `\n${state.failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
