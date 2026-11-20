// Trade ideas: the strip, the new-idea card, the list, the chart focus, short speech, quiet (over the limit) ideas,
// what happened since, forming setups, catch-up of missed ideas and keeping the day's list across reloads.
const { chromium, OUT, URL, sleep, check, state, lastSession, installBackend } = require('./lib.js');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  // ---------------------------------------------------------------- A. demo data
  for (const [name, w, h, mobile] of [['phone', 390, 844, true], ['tablet', 820, 1180, true], ['laptop', 1440, 900, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile && w < 700 });
    const page = await ctx.newPage(); const errs = [];
    await page.clock.setFixedTime(new Date('2026-11-19T18:00:00Z'));
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.type() + ' ' + m.text().slice(0, 240)); });
    await page.goto(URL + '?demo=1&nosw=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.getBars('SPY', '5min').length > 10, null, { timeout: 20000 });
    await sleep(1200);
    const A = (fn, arg) => page.evaluate(fn, arg);
    // start from a clean slate, with the scanner held still so the test decides what fires
    await A(() => { const a = window.__indai.app, ap = a.activePlan.bind(a); a.activePlan = () => ({ ...ap(), minScore: 101 }); a.signals = []; a.forming = {}; a.markDirty('all'); });
    await sleep(1300);
    let strip = await A(() => ({ text: document.getElementById('ideas-row').textContent.trim(), h: document.getElementById('ideas').getBoundingClientRect().height, top: document.getElementById('ideas').getBoundingClientRect().top, bar: document.getElementById('top').getBoundingClientRect().bottom, n: document.getElementById('ideas-n').hidden }));
    check(`[${name}] strip sits under the top bar and says what the scanner is doing`, Math.abs(strip.top - strip.bar) < 1.5 && strip.h === 40 && strip.n && /Setups show here|Scanning|starts at the open/.test(strip.text), JSON.stringify(strip));
    const over = await A(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check(`[${name}] no sideways scroll`, over.sw <= over.cw, JSON.stringify(over));
    // spoken text: record what goes to the voice
    await A(() => { const a = window.__indai.app, v = a.indai.voice; window.__spoken = []; v.speak = (t) => { window.__spoken.push(t); }; a.toggleMute(false); a.ui.showTab('watch'); });
    await A(() => window.__indai.app.practiceAlert());
    await sleep(700);
    const st = await A(() => { const a = window.__indai.app, s = a.signals[0], al = document.getElementById('idea-alert'), cap = document.getElementById('caption');
      return { n: a.signals.length, id: s.id, sym: s.sym, practice: s.practice, alert: !al.hidden, alertText: al.textContent.replace(/\s+/g, ' ').trim(), cap: cap.hidden ? null : cap.textContent, spoken: window.__spoken.filter(t => /setup/.test(t)), log: (a.indai.log.filter(l => /^Practice alert, replayed/.test(l.text)).pop() || {}).text || '', talk: a.ui.talkVisible(),
        chip: [...document.querySelectorAll('.ichip')].map(c => c.textContent.replace(/\s+/g, ' ').trim())[0], first: document.querySelector('.ichip')?.dataset.id }; });
    check(`[${name}] new idea: first chip in the strip`, st.n === 1 && st.first === st.id && st.chip.includes(st.sym), JSON.stringify({ chip: st.chip }));
    if (st.talk) check(`[${name}] new idea: conversation is on screen, so no extra card`, !st.alert);
    else check(`[${name}] new idea: card with Analyze and Chart, no long caption`, st.alert && /Analyze\s*Chart\s*Later/.test(st.alertText) && st.alertText.includes(st.sym) && !/setup/.test(st.cap || ''), JSON.stringify({ a: st.alertText.slice(0, 120), cap: st.cap }));
    check(`[${name}] new idea: she says the short version, the full one is on screen`, st.spoken.length === 1 && /^Practice alert\. \w+ (call|put) setup, (A-plus|strong|decent), \d+\. .+ Stop [\d.,]+, target [\d.,]+\.$/.test(st.spoken[0]) && st.spoken[0].length < 190 && /^Practice alert, replayed from/.test(st.log) && st.log.length > st.spoken[0].length, JSON.stringify({ spoken: st.spoken, log: st.log.slice(0, 80) }));
    if (name === 'phone') await page.screenshot({ path: `${OUT}/idt-phone-alert.png` });
    // Chart from the card (or from the list when there is no card)
    if (st.alert) await page.click('#idea-alert [data-do="chart"]');
    else { await page.click('.ichip'); await sleep(400); await page.click('#sb-ideas .idea.open [data-do="chart"]'); }
    await sleep(700);
    const ch = await A((id) => { const a = window.__indai.app; return { main: a.settings.main, focus: a.ideaFocus === id, tab: a.tab, sheet: a.focus, alert: !document.getElementById('idea-alert').hidden, drawn: a.ideasFor(a.settings.main).filter(x => x.focus).length }; }, st.id);
    check(`[${name}] Chart: opens that ticker with the idea in focus`, ch.main === st.sym && ch.focus && ch.drawn === 1 && !ch.sheet && !ch.alert && (name !== 'phone' || ch.tab === 'chart'), JSON.stringify(ch));
    await page.screenshot({ path: `${OUT}/idt-${name}-chart.png` });
    // the chip opens the list on that idea
    await page.click('.ichip'); await sleep(500);
    const li = await A((id) => { const a = window.__indai.app, o = document.querySelector('#sb-ideas .idea.open'); return { sheet: a.focus, openId: o && o.dataset.id, text: o ? o.textContent.replace(/\s+/g, ' ').trim() : '', cards: document.querySelectorAll('#sb-ideas .idea').length }; }, st.id);
    check(`[${name}] chip opens the list on that idea, with contract, stop, entry, target and reasons`, li.sheet === 'ideas' && li.openId === st.id && /stop [\d.,]+/.test(li.text) && /entry [\d.,]+/.test(li.text) && /target [\d.,]+/.test(li.text) && /risk about \$/.test(li.text) && /Analyze/.test(li.text), JSON.stringify(li.text.slice(0, 200)));
    // quiet ideas (over the hourly limit) and earlier ones are listed without an alert
    const q = await A(() => {
      const a = window.__indai.app, plan = a.activePlan(), r = a.replayScan();
      const mk = (off, dir) => { const b = { ...r.practice, barT: r.practice.barT - off, at: Date.now() - off, dir, type: dir > 0 ? 'C' : 'P', sym: dir > 0 ? 'SPY' : 'QQQ' }; delete b.practice; delete b.id; b.contract = a.signals[0].contract; return b; };
      const logBefore = a.indai.log.length, spokenBefore = window.__spoken.length, dayBefore = a.day.signals || 0;
      a.fireSignal(mk(40 * 60e3, 1), plan, { quiet: 'cap' });
      a.fireSignal(mk(70 * 60e3, -1), plan, { quiet: 'earlier' });
      a.fireSignal(mk(40 * 60e3, 1), plan, { quiet: 'cap' });       // the same one again: not listed twice
      return { n: a.signals.length, log: a.indai.log.length - logBefore, spoken: window.__spoken.length - spokenBefore, day: (a.day.signals || 0) - dayBefore, order: a.signals.map(x => x.at).every((v, i, arr) => !i || arr[i - 1] >= v), ids: new Set(a.signals.map(x => x.id)).size };
    });
    check(`[${name}] over-the-limit and earlier ideas: listed quietly, once, newest first`, q.n === 3 && q.log === 0 && q.spoken === 0 && q.day === 0 && q.order && q.ids === 3, JSON.stringify(q));
    await sleep(700);
    const tags = await A(() => { const a = window.__indai.app; const out = []; for (const s of a.signals) { a.ideaOpen = s.id; a.markDirty('ideas'); } return a.signals.map(s => s.quiet || (s.practice ? 'practice' : '')); });
    await A(() => { const a = window.__indai.app; a.openIdeas(a.signals[1].id); }); await sleep(500);
    const tagText = await A(() => document.querySelector('#sb-ideas .idea.open .when').textContent);
    check(`[${name}] the list says why an idea made no sound`, /Over your hourly alert limit|Earlier today/.test(tagText), JSON.stringify({ tags, tagText }));
    // what has happened since: compare with a straight walk through the candles
    const oc = await A(() => {
      const a = window.__indai.app, sym = 'SPY', one = a.feed.getBars(sym, '1min'), k = Math.max(5, one.length - 40), b = one[k];
      const barT = Math.floor(b.t / 300e3) * 300e3 - 300e3, after = one.filter(x => x.t >= barT + 300e3), px = after[0].o;
      const hi = Math.max(...after.map(x => x.h)), lo = Math.min(...after.map(x => x.l));
      const base = { sym, strat: 'ema', title: 't', why: [], against: [], score: 70, price: px, barT, at: barT + 300e3 };
      const walk = (dir, stop, target) => { for (const x of after) { if (dir > 0 ? x.l <= stop : x.h >= stop) return 'stopped'; if (dir > 0 ? x.h >= target : x.l <= target) return 'target'; } return 'open'; };
      const cases = [[1, lo - 1, (px + hi) / 2], [1, (px + lo) / 2, hi + 5], [1, lo - 1, hi + 5], [-1, hi + 1, (px + lo) / 2], [-1, (px + hi) / 2, lo - 5], [1, px - 0.05, px + 0.05], [-1, px + 0.05, px - 0.05]];
      const got = cases.map(([dir, stop, target]) => a.ideaOutcome({ ...base, dir, type: dir > 0 ? 'C' : 'P', stop, target }).state), want = cases.map(c => walk(...c));
      return { got, want, kinds: new Set(want).size, bars: after.length };
    });
    check(`[${name}] what happened since: target, stop and still open are told apart`, oc.got.join() === oc.want.join() && oc.kinds >= 2 && oc.want[2] === 'open', JSON.stringify(oc));
    // a setup that is still forming
    await A(() => { const a = window.__indai.app, s = a.signals[0]; a.forming.IWM = { ...s, sym: 'IWM', id: 'forming|IWM|ema|1|' + s.barT, forming: true, practice: false, quiet: '', at: Date.now(), confirmAt: Math.ceil(Date.now() / 300e3) * 300e3 }; a.markDirty('all'); });
    await sleep(450);
    // (the demo feed's own scan can clear a made-up forming setup when a minute turns over: put it back once if so)
    if (!(await A(() => document.querySelector('.ichip.forming')))) { await A(() => { const a = window.__indai.app, s = a.signals[0]; a.forming.IWM = { ...s, sym: 'IWM', id: 'forming|IWM|ema|1|' + s.barT, forming: true, practice: false, quiet: '', at: Date.now(), confirmAt: Math.ceil(Date.now() / 300e3) * 300e3 }; a.markDirty('all'); }); await sleep(450); }
    const fo = await A(() => ({ chip: [...document.querySelectorAll('.ichip.forming')].map(c => c.textContent.replace(/\s+/g, ' ').trim()), card: [...document.querySelectorAll('#sb-ideas .idea.forming')].length, row: [...document.querySelectorAll('.wrow')].find(r => r.dataset.sym === 'IWM')?.querySelector('.w-sym i').textContent || '' }));
    check(`[${name}] forming setup: dashed chip, in the list, flagged in the watchlist`, fo.chip.length === 1 && /IWM.*forming/.test(fo.chip[0]) && fo.card === 1 && (name === 'phone' || /forming/.test(fo.row)), JSON.stringify(fo));
    await page.screenshot({ path: `${OUT}/idt-${name}-list.png` });
    await A(() => { delete window.__indai.app.forming.IWM; });
    // Analyze from the list
    await A(() => { const a = window.__indai.app; a.openIdeas(a.signals.find(x => x.practice).id); }); await sleep(500);
    await page.click('#sb-ideas .idea.open [data-do="analyze"]');
    await page.waitForFunction((sym) => { const a = window.__indai.app; return a.analysis && a.analysis.idea.sym === sym && !a.indai.thinking; }, st.sym, { timeout: 20000 }).catch(() => {});
    const an = await A(() => { const a = window.__indai.app; return { sym: a.analysis && a.analysis.idea.sym, rag: a.analysis && a.analysis.score.rag, sheet: a.focus, tab: a.tab }; });
    check(`[${name}] Analyze: rates that idea straight away`, an.sym === st.sym && !!an.rag && an.sheet !== 'ideas' && (name !== 'phone' || an.tab === 'indai'), JSON.stringify(an));
    await A(() => window.__indai.app.closeFocus());
    // "show ideas" typed
    if (name === 'phone') await A(() => window.__indai.app.ui.showTab('indai'));
    await page.fill('#i-input', 'show me the ideas'); await page.press('#i-input', 'Enter'); await sleep(900);
    const sh = await A(() => { const a = window.__indai.app; return { sheet: a.focus, last: (a.indai.log.filter(l => /so far today|No setups have confirmed/.test(l.text)).pop() || {}).text || '' }; });
    check(`[${name}] "show me the ideas" opens the list`, sh.sheet === 'ideas' && /2 ideas so far today/.test(sh.last), JSON.stringify(sh));
    await A(() => window.__indai.app.closeFocus());
    const spokenForms = await A(async () => { const a = window.__indai.app, out = {}; for (const t of ['Show me the ideas.', "What are today's ideas?", 'Ideas?', 'show setups', 'show SPY']) { a.closeFocus(); await a.indai.route(t); out[t] = a.focus === 'ideas'; } a.closeFocus(); return out; });
    check(`[${name}] spoken wording with punctuation opens the list too`, spokenForms['Show me the ideas.'] && spokenForms["What are today's ideas?"] && spokenForms['Ideas?'] && spokenForms['show setups'] && !spokenForms['show SPY'], JSON.stringify(spokenForms));
    await A(() => { const a = window.__indai.app; a.openIdeas(a.signals[0].id); }); await sleep(500);
    await page.click('#sb-ideas .idea.open .idea-head'); await sleep(400);
    const closed = await A(() => document.querySelectorAll('#sb-ideas .idea.open').length);
    await page.click('#sb-ideas .idea .idea-head'); await sleep(400);
    const reopened = await A(() => document.querySelectorAll('#sb-ideas .idea.open').length);
    check(`[${name}] an open idea can be closed and opened again`, closed === 0 && reopened === 1, JSON.stringify({ closed, reopened }));
    await A(() => window.__indai.app.closeFocus());
    // More screen entry (phone)
    if (name === 'phone') { await A(() => window.__indai.app.ui.showTab('more')); await sleep(500); check(`[phone] More has Trade ideas`, /Trade ideas/.test(await page.textContent('#more-list'))); await page.click('#more-list [data-act="ideas"]'); await sleep(400); check(`[phone] More opens the list`, await A(() => window.__indai.app.focus === 'ideas')); await A(() => window.__indai.app.closeFocus());
      // the conversation still fits between the strip and the tab bar
      await A(() => window.__indai.app.ui.showTab('indai')); await sleep(400);
      const fit = await A(() => { const f = document.getElementById('i-form').getBoundingClientRect(), t = document.getElementById('tabs').getBoundingClientRect(), p = document.getElementById('p-indai').getBoundingClientRect(), s = document.getElementById('ideas').getBoundingClientRect(); return { formBottom: f.bottom, tabsTop: t.top, panelTop: p.top, stripBottom: s.bottom, scroll: document.documentElement.scrollHeight - innerHeight }; });
      check(`[phone] conversation fits between the strip and the tab bar`, fit.formBottom <= fit.tabsTop && fit.panelTop >= fit.stripBottom && fit.scroll <= 1, JSON.stringify(fit));
    }
    const dup = await A(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.filter((x, i) => ids.indexOf(x) !== i); });
    check(`[${name}] no duplicate ids`, dup.length === 0, dup.join(','));
    check(`[${name}] no page errors`, errs.length === 0, errs.slice(0, 5).join(' | '));
    await ctx.close();
  }
  // ---------------------------------------------------------------- B. real-data path (mocked backend): catch-up and keeping the day's list
  {
    const sess = { ymd: '2026-11-19', minutes: 210 };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(); const errs = [];
    await page.clock.setFixedTime(new Date('2026-11-19T18:00:00Z'));
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    await installBackend(page, sess, async (req, json) => req.method() === 'GET' ? json({ configured: false }) : json({ error: 'not_configured' }, 503));
    const boot = async () => { await page.goto(URL + '?nosw=1&nocheckin=1'); await page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'delayed' && window.__indai.app.feed.getBars('IWM', '5min').length > 5, null, { timeout: 20000 }); };
    await boot();
    const A = (fn, arg) => page.evaluate(fn, arg);
    const open = await A(() => { const m = window.__indai; return { bars: m.app.feed.getBars('SPY', '5min').length }; });
    await sleep(7000);      // first catch-up runs a few seconds after the candles are in
    let cu = await A(() => { const a = window.__indai.app; return { n: a.signals.length, earlier: a.signals.filter(x => x.quiet === 'earlier').length, ids: new Set(a.signals.map(x => x.id)).size, stored: (JSON.parse(localStorage.getItem('indai.web.ideas.v1') || '{}').list || []).length, toast: document.getElementById('toast').textContent, chips: document.querySelectorAll('.ichip').length, again: a.catchUpIdeas(), count: document.getElementById('ideas-n').textContent,
      sorted: a.signals.every((v, i, arr) => !i || arr[i - 1].at >= v.at), contracts: a.signals.every(x => x.contract && x.contract.strike > 0), syms: [...new Set(a.signals.map(x => x.sym))].join(',') }; });
    console.log('   mocked session', JSON.stringify({ bars: open.bars, minutes: sess.minutes, ...cu }));
    {
      check(`[catch-up] earlier setups from today's candles are listed quietly`, cu.n > 0 && cu.earlier > 0 && cu.ids === cu.n && cu.sorted && cu.contracts && cu.chips > 0 && +cu.count === cu.n, JSON.stringify(cu));
      check(`[catch-up] says so once, and running it again adds nothing`, /confirmed earlier today/.test(cu.toast) && cu.again === 0, JSON.stringify({ toast: cu.toast, again: cu.again }));
      check(`[catch-up] the day's list is saved`, cu.stored === cu.n);
      await page.screenshot({ path: `${OUT}/idt-catchup.png` });
      const inv = await A(() => {
        const a = window.__indai.app, m = a._ideaMem, out = { newestSeen: true, newestNotQuiet: true, lastSeeded: true, hourOk: true, syms: 0 };
        for (const sym of a.settings.symbols) {
          const five = a.feed.getBars(sym, '5min'), one = a.feed.getBars(sym, '1min'); if (five.length < 7 || !one.length) continue;
          const latest = one[one.length - 1].t + 60e3, done = five.filter(b => b.t + 300e3 <= latest + 1000), newest = done[done.length - 1].t;
          out.syms++;
          // during the session the live scan has the newest candle first; after the close only the catch-up runs
          const openNow = !!document.querySelector('#t-state.open');
          if ((openNow && m.lastBar[sym] !== newest) || !m.scanned.has(sym + newest)) out.newestSeen = false;
          if (a.signals.some(x => x.sym === sym && x.barT === newest && x.quiet === 'earlier')) out.newestNotQuiet = false;
        }
        for (const x of a.signals) if (!x.practice && !((m.last[x.sym + x.strat + x.dir] || 0) >= x.at)) out.lastSeeded = false;
        out.seenCount = m.scanned.size; out.seenStored = (JSON.parse(localStorage.getItem('indai.web.ideas.v1') || '{}').seen || []).length;
        const t0 = performance.now(); const again = a.runCatchUp({ tell: false }); out.ms = Math.round(performance.now() - t0); out.again = again;
        return out;
      });
      check(`[catch-up] the live scan takes the newest candle first; the repeat rule knows the day's list`, inv.syms >= 5 && inv.newestSeen && inv.newestNotQuiet && inv.lastSeeded, JSON.stringify(inv));
      check(`[catch-up] every candle is gone over once: a second pass is instant and adds nothing`, inv.again === 0 && inv.ms < 25 && inv.seenCount > 100, JSON.stringify({ ms: inv.ms, seen: inv.seenCount }));
      await sleep(4500);
      const seenStored = await A(() => (JSON.parse(localStorage.getItem('indai.web.ideas.v1') || '{}').seen || []).length);
      check(`[catch-up] seen candles are saved for the reload`, seenStored > 100, String(seenStored));
      // the risk breaker: while alerts are paused nothing new is listed, not even quietly
      const br = await A(async () => {
        const a = window.__indai.app, keep = a.signals.slice();
        a.signals = []; a.day.cooldownUntil = Date.now() + 10 * 60e3;
        const paused = a.catchUpIdeas(); a.markDirty('ideabar'); await new Promise(r => setTimeout(r, 1300));
        const text = document.getElementById('ideas-row').textContent;
        a.signals = keep.slice(0, 2); a.markDirty('ideabar'); await new Promise(r => setTimeout(r, 1300));
        const withChips = document.querySelector('#ideas-row .ideas-empty.paused')?.textContent || '';
        a.day.cooldownUntil = 0; a.signals = [];
        const armed = a.catchUpIdeas();
        a.signals = keep; a.markDirty('all');
        const k = 'indai.web.ideas.v1', j = JSON.parse(localStorage.getItem(k)); j.list = keep; localStorage.setItem(k, JSON.stringify(j));   // put the saved list back as it was
        return { paused, text, withChips, armed, scan: document.getElementById('ideas').dataset.scan };
      });
      check(`[breaker] nothing is listed while alerts are paused, and the strip says so`, br.paused === 0 && /Alerts paused: breaker on cooldown/.test(br.text) && br.withChips === 'Alerts paused' && br.armed === 0, JSON.stringify(br));
      const before = await A(() => window.__indai.app.signals.map(x => x.id).sort().join());
      await boot(); await sleep(7000);
      const after = await A(() => ({ ids: window.__indai.app.signals.map(x => x.id), n: window.__indai.app.signals.length, seeded: window.__indai.app.signals.every(x => (window.__indai.app._ideaMem.last[x.sym + x.strat + x.dir] || 0) >= x.at), seen: window.__indai.app._ideaMem.scanned.size }));
      check(`[reload] the repeat rule and the seen candles come back after a reload`, after.seeded && after.seen > 100, JSON.stringify({ seen: after.seen }));
      // (a candle may have closed in between, which can add one; nothing may be lost or doubled)
      check(`[reload] the day's ideas are all still there after a reload, nothing doubled`, before.split(',').every(id => after.ids.includes(id)) && new Set(after.ids).size === after.n && after.n - before.split(',').length <= 2, JSON.stringify({ n: after.n }));
      // a new New York day starts clean
      const nd = await A(() => { const j = JSON.parse(localStorage.getItem('indai.web.ideas.v1')); j.ymd = '2020-01-02'; localStorage.setItem('indai.web.ideas.v1', JSON.stringify(j)); return true; });
      await page.addInitScript(() => { window.__noCatchUp = true; });
      await page.goto(URL + '?nosw=1&nocheckin=1&demo=1');
      await page.waitForFunction(() => window.__indai && window.__indai.app.feed.quote('SPY'), null, { timeout: 20000 });
      const fresh = await A(() => window.__indai.app.signals.filter(x => !x.demo).length);
      check(`[new day / demo] yesterday's or real ideas never show under demo data`, fresh === 0, String(fresh));
    }
    check(`[catch-up] no page errors`, errs.length === 0, errs.slice(0, 5).join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(state.failed ? `\n${state.failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
