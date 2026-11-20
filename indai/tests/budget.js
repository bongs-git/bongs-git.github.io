// The thinking budget: what the website does when the backend says today's budget is used up,
// when she is rate limited, and when web research keeps failing (502) while still being charged.
const { chromium, OUT, URL, sleep, check, state, lastSession, installBackend } = require('./lib.js');
const TRADE_OK = { result: { rag: 'AMBER', confidence: 64, headline: 'Trend is with you but the call wall is close', spoken: 'With the news in, I rate this AMBER. Momentum is fine, but the call wall caps the upside today.', summary: ['Yields easing helps tech'], bullish: [], bearish: [], news: [], events: [], watch: [] }, sources: [], model: 'mock' };
(async () => {
  const browser = await chromium.launch();
  const sess = lastSession();
  for (const [name, w, h, mobile] of [['phone', 390, 844, true], ['laptop', 1440, 900, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.type() + ' ' + m.text().slice(0, 240)); });
    const be = { talk: 'budget', trade: 'budget', calls: { talk: 0, trade: 0, mem: 0 } };
    await installBackend(page, sess, async (req, json) => {
      if (req.method() === 'GET') return json({ configured: true, passcode: false, memory: 1 });
      const b = JSON.parse(req.postData() || '{}');
      if (b.mode === 'memory') { be.calls.mem++; return json({ memory: [{ id: 1, kind: 'taught', text: 'I never trade the first five minutes' }] }); }
      const kind = b.mode === 'talk' ? 'talk' : 'trade'; be.calls[kind]++; await sleep(250);
      const how = be[kind];
      if (how === 'budget') return json({ error: 'budget', message: "INDAI's daily token budget is exhausted." }, 429);
      if (how === 'rate') return json({ error: 'rate_limited', message: 'Hourly request limit reached. Try again later.' }, 429);
      if (how === 'parse') return json({ error: 'parse', message: 'The provider returned an incomplete assessment.', raw: '', sources: [] }, 502);
      if (kind === 'talk') return json({ result: { spoken: 'Tape looks two-sided to me, with a clean VWAP reclaim on the Qs.' }, remembered: [] });
      return json(TRADE_OK);
    });
    const boot = async () => {
      await page.goto(URL + '?nosw=1&nocheckin=1');
      await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'delayed' && window.__indai.app.indai.brain.checked, null, { timeout: 20000 });
      await sleep(1200);
    };
    await boot();
    const A = (fn, arg) => page.evaluate(fn, arg);
    const logLines = () => A(() => window.__indai.app.indai.log.map(m => m.text));
    // type a line, wait until INDAI has answered and gone quiet, return only the new lines
    const say = async (text, timeout = 15000) => {
      if (mobile && await A(() => window.__indai.app.tab !== 'indai' || !!window.__indai.app.focus)) { await A(() => { window.__indai.app.closeFocus(); window.__indai.app.ui.showTab('indai'); }); await sleep(200); }
      const before = (await logLines()).length;
      await page.fill('#i-input', text); await page.press('#i-input', 'Enter');
      const t0 = Date.now(); let last = -1, stable = 0;
      while (Date.now() - t0 < timeout) {
        await sleep(250);
        const st = await A(() => ({ n: window.__indai.app.indai.log.length, thinking: !!window.__indai.app.indai.thinking, pend: !!(window.__indai.app.analysis && window.__indai.app.analysis.pendingAI) }));
        if (st.n > before + 1 && !st.thinking && !st.pend && st.n === last) { if (++stable >= 3) break; } else stable = 0;
        last = st.n;
      }
      return (await logLines()).slice(before + 1).join('\n');
    };
    const IDEA = 'QQQ calls expiring today 665 strike';

    // ---- A. today's budget is used up ----
    let r = await say("Update. What do you think. I'm about to go in");
    check(`[${name}] budget used up: one clear line`, /used up my thinking budget for today/.test(r) && /midnight New York time/.test(r) && /still rate a trade/.test(r), JSON.stringify(r));
    check(`[${name}] budget used up: no "couldn't reach" and no "I heard"`, !/couldn't reach|I heard|token budget is exhausted/.test(r));
    if (mobile) await page.screenshot({ path: `${OUT}/bud-phone-talk.png` });
    r = await say('so what would you do here honestly');
    check(`[${name}] budget used up: short reminder afterwards, no second request`, /^My thinking budget is used up until midnight New York time/.test(r) && be.calls.talk === 1, JSON.stringify({ r, calls: be.calls }));
    r = await say('brief me');
    check(`[${name}] budget used up: built-in commands still work`, /Day P&L/.test(r) && !/budget/.test(r), JSON.stringify(r.slice(0, 90)));
    r = await say('open up the calculator');
    check(`[${name}] budget used up: loose wording is still worked out on the device`, !/budget|couldn't reach/.test(r) && (await A(() => window.__indai.app.focus)) === 'calc', JSON.stringify(r));
    await A(() => window.__indai.app.closeFocus());
    r = await say(IDEA);
    check(`[${name}] budget used up: trade idea still rated, with no promise to check the news`, /Quant read is|So this one is RED/.test(r) && !/Checking the news/.test(r), JSON.stringify(r.slice(0, 200)));
    check(`[${name}] budget used up: research line says why, no request sent`, /Web research didn't finish \(today's thinking budget is used up; it resets at midnight New York time\)/.test(r) && be.calls.trade === 0, JSON.stringify({ tail: r.slice(-190), calls: be.calls }));
    await A(() => window.__indai.app.closeFocus());
    await A(() => window.__indai.app.openSettings()); await sleep(1900);
    let rs = await page.textContent('#research-status');
    check(`[${name}] settings shows the budget is used up, with a check-again button`, /Today's thinking budget is used up/.test(rs) && await page.isVisible('#s-brain-retry') && !(await page.isVisible('#s-research-resume')), JSON.stringify(rs.slice(0, 80)));
    await page.locator('#research-status').scrollIntoViewIfNeeded(); await sleep(200);
    if (mobile) await page.screenshot({ path: `${OUT}/bud-phone-settings.png` });
    // the budget is raised on the backend: after "check again" she thinks again
    be.talk = 'ok'; be.trade = 'ok';
    await page.click('#s-brain-retry'); await sleep(1800);
    await A(() => window.__indai.app.closeFocus());
    r = await say('what do you make of the tape right now');
    check(`[${name}] budget back: she answers through the brain again`, /VWAP reclaim/.test(r) && be.calls.talk === 2, JSON.stringify(r));
    await A(() => window.__indai.app.openSettings()); await sleep(1900);
    rs = await page.textContent('#research-status');
    check(`[${name}] budget back: settings says research is on, buttons gone`, /thinking brain are on/.test(rs) && !(await page.isVisible('#research-actions')), JSON.stringify(rs.slice(0, 80)));
    await A(() => window.__indai.app.closeFocus());

    // ---- B. the budget runs out again and is found again by itself after a while ----
    be.talk = 'budget';
    r = await say('talk me through the plan for the afternoon');
    check(`[${name}] budget out again the same day: short reminder (already explained today)`, /^My thinking budget is used up until midnight/.test(r), JSON.stringify(r));
    be.talk = 'ok';
    await A(() => { const k = 'indai.web.brain.v1', c = JSON.parse(localStorage.getItem(k)); window.__before = c; });
    // five minutes later (simulated by moving the retry time back) she looks again without being asked
    await page.evaluate(() => { const RealNow = Date.now.bind(Date); const shift = 6 * 60e3; Date.now = () => RealNow() + shift; });
    r = await say('talk me through the plan for the afternoon');
    check(`[${name}] she looks again by herself after five minutes`, /VWAP reclaim/.test(r), JSON.stringify(r));

    // ---- C. hourly limit ----
    be.talk = 'rate';
    r = await say('and what about tomorrow morning');
    check(`[${name}] hourly limit: one clear line`, /hit my hourly limit for thinking/.test(r) && !/couldn't reach|I heard/.test(r), JSON.stringify(r));
    be.talk = 'ok';

    // ---- D. research keeps failing on the backend (502 after being charged) ----
    await A(() => { localStorage.removeItem('indai.web.brain.v1'); });
    await boot();
    be.trade = 'parse'; be.calls.trade = 0;
    r = await say(IDEA, 20000);
    check(`[${name}] research fails once: plain reason, rating stands`, /Checking the news/.test(r) && /Web research didn't finish \(the backend's answer came back incomplete\)\. The rating above is from the market data alone\./.test(r), JSON.stringify(r.slice(-170)));
    r = await say(IDEA, 20000);
    check(`[${name}] research fails twice: it pauses itself and says so`, /has failed 2 times in a row on the backend/.test(r) && /paused until midnight New York time; Settings turns it back on/.test(r) && be.calls.trade === 2, JSON.stringify(r.slice(-260)));
    r = await say(IDEA, 20000);
    check(`[${name}] research paused: no more requests, no promise to check the news`, be.calls.trade === 2 && !/Checking the news/.test(r) && /Web research didn't finish \(it is paused until midnight New York time/.test(r), JSON.stringify({ tail: r.slice(-200), calls: be.calls }));
    r = await say('what do you make of the tape right now');
    check(`[${name}] research paused: talking still works`, /VWAP reclaim/.test(r), JSON.stringify(r));
    await boot();   // the pause survives a reload
    r = await say(IDEA, 20000);
    check(`[${name}] research pause survives a reload`, be.calls.trade === 2 && /it is paused until midnight/.test(r), JSON.stringify(be.calls));
    await A(() => window.__indai.app.closeFocus());
    await A(() => window.__indai.app.openSettings()); await sleep(1900);
    rs = await page.textContent('#research-status');
    check(`[${name}] settings shows the pause with a turn-back-on button`, /The thinking brain is on/.test(rs) && /Web research is paused until midnight New York time/.test(rs) && /failed 2 times in a row/.test(rs) && await page.isVisible('#s-research-resume') && !(await page.isVisible('#s-brain-retry')), JSON.stringify(rs));
    await page.locator('#research-status').scrollIntoViewIfNeeded(); await sleep(200);
    await page.screenshot({ path: `${OUT}/bud-${name}-paused.png` });
    be.trade = 'ok';
    await page.click('#s-research-resume'); await sleep(1800);
    check(`[${name}] after turning it back on the buttons go away`, !(await page.isVisible('#research-actions')));
    await A(() => window.__indai.app.closeFocus());
    r = await say(IDEA, 20000);
    const an = await A(() => { const a = window.__indai.app.analysis; return a && { final: a.final && a.final.rag, err: a.aiError || null }; });
    check(`[${name}] research works again after turning it back on`, /Checking the news/.test(r) && /With the news in/.test(r) && an && an.final === 'AMBER' && be.calls.trade === 3, JSON.stringify({ an, calls: be.calls }));
    // one failure, then a success: the count starts over (no pause from two failures far apart)
    be.trade = 'parse'; await say(IDEA, 20000); be.trade = 'ok'; await say(IDEA, 20000); be.trade = 'parse'; r = await say(IDEA, 20000);
    check(`[${name}] a success in between resets the count`, /came back incomplete/.test(r) && !/paused/.test(r), JSON.stringify(r.slice(-150)));
    check(`[${name}] remember/recall never blocked`, /holding 1 thing/.test(await say('what do you remember')));
    check(`[${name}] no page errors`, errs.length === 0, errs.slice(0, 5).join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(state.failed ? `\n${state.failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
