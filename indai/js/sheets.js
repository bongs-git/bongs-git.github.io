// Focus cards: trade analysis (the RAG verdict), deep dive, options calculator, summary, game plan,
// self-test and settings. On a phone they are full-screen sheets; on a laptop they sit over the
// dashboard with INDAI still in view, like the centre card in the headset.
import { marketStatus, fmtClock, fmtDuration } from './market.js';
import { STRATEGIES, PROFILES, buildPlan } from './signals.js';
import { pnlGrid, positionSummary } from './options.js';
import { VOICES } from './voice.js';
import { fmtPrice, fmtPct, fmtMoney, fmtVol, fmtBig, pct0 } from './hud.js';
import { nearestLevel, levelSourceLabel, ideaLabel, expLabelDays, RAG_CLASS } from './panels.js';
import { drawSparkline, drawPayoff } from './chart.js';
import { $, esc } from './views.js';
import { brainCare, brainRetry, resumeResearch } from './demo.js';

const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
// Rebuilding a form while a finger or the mouse is down would swallow the tap in progress (the button it started on
// is gone by the time it ends). afterPointer(fn) runs fn now, or right after the press finishes.
let pointerDown = false; const queued = new Set();
window.addEventListener('pointerdown', () => { pointerDown = true; }, { capture: true, passive: true });
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => { pointerDown = false; if (queued.size) setTimeout(() => { const q = [...queued]; queued.clear(); q.forEach(f => f()); }, 0); }, { capture: true, passive: true });
const afterPointer = (fn) => { if (pointerDown) queued.add(fn); else fn(); };
const focusKey = (el) => !el || !el.dataset ? null : el.id ? '#' + el.id : el.dataset.step ? `[data-step="${el.dataset.step}"][data-dir="${el.dataset.dir}"]` : el.dataset.field ? `[data-field="${el.dataset.field}"]` : el.dataset.aggr ? `[data-aggr="${el.dataset.aggr}"]` : el.dataset.strat ? `[data-strat="${el.dataset.strat}"]` : el.dataset.act ? `[data-act="${el.dataset.act}"]` : null;
const kv = (rows) => `<div class="kv">${rows.map(([l, v, s]) => `<div><span>${esc(l)}</span><b${s ? ' class="s"' : ''}>${esc(v)}</b></div>`).join('')}</div>`;

export function initSheets(app) {
  const ind = app.indai, V = app.views;
  const open = (id) => () => app.focus === id && !document.hidden;
  const demoNote = (demo) => demo ? '<p class="note warn">Demo data: prices, option quotes and levels are simulated. Practice only.</p>' : '';

  // ------------------------------------------------------------ analysis: the verdict card
  let anKey = '';
  V.analysis = {
    visible: open('analysis'),
    render() {
      const an = app.analysis, body = $('sb-analysis');
      $('st-analysis').textContent = an ? `INDAI analysis · ${ideaLabel(an.idea)}` : 'INDAI analysis';
      if (!an) { anKey = ''; body.innerHTML = '<p class="empty">Ask INDAI about a trade, for example “QQQ calls expiring today, 665 strike”. She pulls the chain, flow, charts and levels, and rates it red, amber or green.</p>'; return; }
      const key = [an.at, !!an.final, an.pendingAI, an.aiError, an.demo].join('|');
      if (key === anKey) return; anKey = key;
      const rag = an.final?.rag || an.score.rag, k = an.contract, q = an.quant;
      const rows = [
        ['Underlying', `${fmtPrice(an.spot)}${an.demo ? ' (demo)' : an.delayed ? ' (delayed)' : ''}`],
        ['Option bid / ask', k ? `${k.bid.toFixed(2)} / ${k.ask.toFixed(2)}  (mid ${k.mid.toFixed(2)})` : `model ${q.entry.toFixed(2)}`],
        ['IV · volume · OI', `${(q.iv * 100).toFixed(1)}% · ${k ? fmtVol(k.vol) : '—'} · ${k ? fmtVol(k.oi) : '—'}`],
        ['Breakeven at expiry', `${fmtPrice(q.breakeven)} (${q.moveNeededSigma.toFixed(2)}σ away)`],
        ['Expected move', `±${q.expectedMove.toFixed(2)} by expiry`],
        ['Chance of profit at expiry', pct0(q.popExpiry)],
        ['Chance it finishes in the money', pct0(q.probITM)],
        ['Chance price touches the strike', pct0(q.probTouch)],
        ['Hits +50% / +100% (Monte Carlo)', q.mc ? `${pct0(q.mc.probTouch50)} / ${pct0(q.mc.probTouch100)}` : '—'],
        ['Δ · Γ · Θ per hour · ν', `${q.delta.toFixed(2)} · ${q.gamma.toFixed(3)} · −${(q.thetaPctPerHour ?? 0).toFixed(1)}% · ${q.vega.toFixed(2)}`],
        ['Time left', `${q.hoursLeft.toFixed(1)} trading hours`],
      ];
      const factors = [...an.score.factors].sort((a, b) => Math.abs(b.weight * b.s) - Math.abs(a.weight * a.s));
      const fhtml = factors.map(f => {
        const c = f.s > 0.15 ? 'var(--up)' : f.s < -0.15 ? 'var(--down)' : 'var(--dim)', len = Math.abs(f.s) * 50;
        return `<div class="factor"><b>${esc(f.name)}</b><div class="fbar"><i style="background:${c};width:${len.toFixed(1)}%;${f.s >= 0 ? 'left:50%' : `right:50%`}"></i></div><p>${esc(f.note || '')}</p></div>`;
      }).join('');
      const news = an.final?.news?.length ? an.final.news : an.news || [];
      const fin = an.final;
      body.innerHTML = `<div class="cols two"><div>
          <div class="rag ${RAG_CLASS[rag] || ''}"><b>${esc(rag)}</b><span class="score">${an.score.score}/100</span><span class="how">${fin ? `With web research · ${esc(fin.confidence ?? '—')}% confident` : an.pendingAI ? 'Quant read · researching the news…' : 'Quant read from market data'}</span></div>
          ${an.score.gate ? `<p class="gate">${esc(an.score.gate)}</p>` : ''}
          ${demoNote(an.demo)}
          <div style="margin-top:10px">${kv(rows)}</div>
          <div class="actions"><button type="button" class="btn primary" data-act="calc">Open calculator</button><button type="button" class="btn" data-act="again">Say it again</button></div>
        </div><div>
          ${fin ? `<p class="headline">${esc(fin.headline || '')}</p>${(fin.summary || []).length ? `<ul class="bul">${fin.summary.slice(0, 6).map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}` : ''}
          ${an.aiError ? `<p class="note" style="margin-bottom:12px">Web research didn't finish, so this rating is from market data alone.</p>` : ''}
          <p class="sec-title">What drives the score</p>${fhtml}
          ${news.length ? `<p class="sec-title" style="margin-top:16px">${fin?.news?.length ? 'News and sentiment (web research)' : 'Recent headlines'}</p><ul class="news">${news.slice(0, 5).map(n => `<li class="${esc(n.sentiment || '')}">${esc(n.title)}${n.source ? ` <span>${esc(n.source)}</span>` : ''}</li>`).join('')}</ul>` : ''}
          <p class="note" style="margin-top:16px">Information, not financial advice. You make every trade.</p>
        </div></div>`;
    },
  };

  // ------------------------------------------------------------ deep dive
  let ddKey = '';
  V.deep = {
    gap: 500, visible: open('deep'),
    render() {
      const d = app.deep, body = $('sb-deep');
      $('st-deep').textContent = d ? `Deep dive · ${d.sym}` : 'Deep dive';
      if (!d) { body.innerHTML = '<p class="empty">Pick a ticker in the watchlist, or say “deep dive on Tesla”.</p>'; ddKey = ''; return; }
      const q = app.feed.quote(d.sym) || d.quote, t = d.tech, ch = d.chain, lv = app.levelsFor(d.sym);
      const key = [d.at, d.loading, !!ch, d.news?.length, lv && [lv.cw, lv.pw, lv.zg].join(), t && t.rsi?.toFixed(0)].join('|');
      if (key !== ddKey) {
        ddKey = key;
        const rows = [];
        if (t) rows.push(['Trend', `${t.trend}, fast cloud ${t.emaFast}, slow ${t.emaSlow ?? '—'}`, 1], ['VWAP', `${fmtPrice(t.vwap)} (${t.aboveVwap ? 'above' : 'below'}, ${t.vwapDistPct >= 0 ? '+' : ''}${t.vwapDistPct.toFixed(2)}%)`], ['MACD / RSI', `${t.macdHist > 0 ? 'positive' : 'negative'}, ${t.macdRising ? 'rising' : 'falling'} / RSI ${t.rsi?.toFixed(0)}`, 1], ['Divergence', t.divergence ? `${t.divergence.type}: ${t.divergence.note}` : 'none', 1], ['Day range', `${fmtPrice(t.dayLow)} – ${fmtPrice(t.dayHigh)}`]);
        if (lv) rows.push(['GEX walls', `call ${lv.cw ?? '—'} · put ${lv.pw ?? '—'} · flip ${lv.zg ?? '—'}`]);
        if (ch) rows.push(['Put/call (volume · OI)', `${ch.all?.pcVolume ?? '—'} · ${ch.all?.pcOI ?? '—'}`], ['Premium today', `calls ${fmtBig(ch.all?.callPremium)} · puts ${fmtBig(ch.all?.putPremium)}`], ['IV30', ch.meta?.iv30 ? `${ch.meta.iv30.toFixed(1)}%` : '—']);
        const un = ch?.unusual?.length ? `<p class="sec-title">Unusual options activity</p><div class="unusual">${ch.unusual.slice(0, 5).map(u => `<span class="${u.type === 'C' ? 'up' : 'down'}">${esc(u.exp.slice(5))} ${u.strike}${u.type}  vol ${fmtVol(u.vol)} vs OI ${fmtVol(u.oi)}  ${fmtBig(u.premium)}</span>`).join('')}</div>` : '';
        const nw = d.news?.length ? `<p class="sec-title" style="margin-top:16px">Headlines</p><ul class="news">${d.news.slice(0, 6).map(n => `<li class="${esc(n.sentiment || '')}">${esc(n.title)}</li>`).join('')}</ul>` : '';
        body.innerHTML = `<div class="dd-top"><span class="px mono" id="dd-px">—</span><canvas id="dd-spark"></canvas><span class="pc" id="dd-pc">&nbsp;</span></div>
          ${demoNote(d.demo)}
          <div class="cols two"><div>${rows.length ? kv(rows) : ''}${d.loading ? '<p class="note warn" style="margin-top:10px">Loading options and news…</p>' : !rows.length ? '<p class="empty">No intraday data for this ticker yet.</p>' : ''}</div>
          <div>${un}${nw}${!un && !nw && !d.loading ? '<p class="note">No unusual options prints or headlines right now.</p>' : ''}</div></div>
          <div class="actions"><button type="button" class="btn up" id="dd-calls">Analyze ${esc(d.sym)} calls</button><button type="button" class="btn down" id="dd-puts">Analyze ${esc(d.sym)} puts</button><button type="button" class="btn" id="dd-main">Put on main chart</button><button type="button" class="btn" id="dd-tv">Open in TradingView</button></div>`;
        $('dd-calls').onclick = () => ind.quickIdea(d.sym, 'C');
        $('dd-puts').onclick = () => ind.quickIdea(d.sym, 'P');
        $('dd-main').onclick = () => { app.selectSymbol(d.sym); app.closeFocus(); app.ui.showTab('chart'); };
        $('dd-tv').onclick = () => app.openTradingView(d.sym);
        V.deep._spark = '';
      }
      const px = $('dd-px'), pc = $('dd-pc');
      if (px) { px.textContent = q ? fmtPrice(q.last) : '—'; pc.textContent = q ? fmtPct(q.pct) : ' '; pc.className = 'pc ' + (q ? cls(q.chg ?? q.pct) : 'flat'); }
      const cv = $('dd-spark'), sk = (d.bars?.length || 0) + ':' + cv?.clientWidth;
      if (cv && V.deep._spark !== sk) { V.deep._spark = sk; drawSparkline(cv, d.bars, q?.base); }
    },
  };

  // ------------------------------------------------------------ everything at a glance
  V.summary = {
    gap: 500, visible: open('summary'),
    render() {
      const ms = marketStatus(), rs = app.riskState(), an = app.analysis, main = app.settings.main, lv = app.levelsFor(main);
      const rows = app.settings.symbols.map(sym => {
        const q = app.feed.quote(sym), l = app.levelsFor(sym), n = q && l ? nearestLevel(q.last, l) : null;
        return `<div class="sum-row${sym === main ? ' sel' : ''}"><b>${sym}</b><span class="n">${n ? `${n.short} ${n.level}` : ''}</span><span class="p">${q ? fmtPrice(q.last) : '—'}</span><span class="c ${q ? cls(q.chg) : 'flat'}">${q ? fmtPct(q.pct) : ''}</span></div>`;
      }).join('');
      const rag = an ? an.final?.rag || an.score.rag : null;
      $('sb-summary').innerHTML = `<p class="note" style="margin-bottom:12px">${fmtClock()} ET · ${esc(ms.label.charAt(0) + ms.label.slice(1).toLowerCase())} · ${ms.nextEvent} in ${fmtDuration(ms.msToNext)}</p>
        <div class="cols two"><div class="sum-rows">${rows}</div><div>
          <p><span class="pill ${rs.state === 'tripped' ? 'risk' : rs.state === 'cooldown' ? 'alert' : 'good'}">${rs.state === 'tripped' ? 'Breaker tripped' : rs.state === 'cooldown' ? 'Cooldown' : 'Breaker armed'}</span></p>
          <p style="margin:10px 0 16px;font-size:15px">Day P&amp;L <b class="mono ${cls(app.day.pnl)}">${fmtMoney(app.day.pnl, true)}</b> · ${fmtMoney(rs.room)} of room</p>
          ${app.day.plan ? `<p class="note" style="margin-bottom:16px">Plan: ${fmtMoney(app.day.plan.capital)} start, ${fmtMoney(app.day.plan.goal)} goal, ${esc(PROFILES[app.day.plan.aggr].label.toLowerCase())}${app.day.goalHit ? ' · goal hit' : ''}</p>` : ''}
          ${an ? `<p><span class="pill ${RAG_CLASS[rag] || ''}">${esc(rag)}</span> <b style="font-weight:600;margin-left:6px">${esc(ideaLabel(an.idea))}</b></p><p class="note" style="margin:8px 0 16px">${esc(an.final?.headline || an.score.cons[0]?.note || an.score.pros[0]?.note || '')}</p>` : ''}
          ${lv ? `<p class="note">${esc(main)} walls: call ${lv.cw ?? '—'} · put ${lv.pw ?? '—'} · flip ${lv.zg ?? '—'}</p>` : ''}
        </div></div>`;
    },
  };

  // ------------------------------------------------------------ game plan editor
  const planBody = $('sb-plan');
  let planKey = '';
  V.plan = {
    visible: open('plan'),
    render() {
      const d = app.planDraft, tmp = app.temp, p = buildPlan(d);
      const locked = app.day.plan && app.day.plan.capital === d.capital && app.day.plan.goal === d.goal && app.day.plan.aggr === d.aggr && app.day.plan.strategies.join() === d.strategies.join();
      const key = JSON.stringify([d, tmp && tmp.at, app.tempLoading, locked]);
      if (key === planKey || planBody.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      if (pointerDown) { afterPointer(replan); return; }
      planKey = key;
      const keep = planBody.contains(document.activeElement) ? focusKey(document.activeElement) : null;
      const tc = !tmp ? '' : tmp.label.toLowerCase();
      const temp = tmp ? `<div class="temp ${tc}"><div class="t-head"><b>${esc(tmp.label)}</b><span class="${tmp.bias === 'bullish' ? 'up' : tmp.bias === 'bearish' ? 'down' : 'flat'}">${esc(tmp.bias)} lean</span></div><ul>${tmp.notes.slice(0, 6).map(n => `<li>${esc(n)}</li>`).join('')}</ul><p>${esc(tmp.advice)}</p>${tmp.demo ? '<p class="note warn" style="font-weight:500;margin-top:6px">From demo data.</p>' : ''}</div>`
        : `<div class="temp"><div class="t-head"><b style="font-size:18px;color:var(--dim)">${app.tempLoading ? 'Reading the market…' : 'Market temperature not checked yet'}</b></div></div>`;
      const stepper = (id, val) => `<div class="stepper"><button type="button" data-step="${id}" data-dir="-1" aria-label="Less">−</button><input class="mono" type="text" inputmode="numeric" data-field="${id}" value="${fmtMoney(val)}" aria-label="${id === 'capital' ? 'Starting capital' : 'Minimum goal'}"><button type="button" data-step="${id}" data-dir="1" aria-label="More">+</button></div>`;
      planBody.innerHTML = `<div class="cols two"><div>
          <p class="sec-title">Market temperature</p>${temp}
          <div class="actions" style="margin-top:10px"><button type="button" class="btn mini" data-act="retemp">Re-check</button></div>
        </div><div class="form">
          <div class="plan-grid">
            <div class="field"><label>Starting with</label>${stepper('capital', d.capital)}</div>
            <div class="field"><label>Minimum goal</label>${stepper('goal', d.goal)}</div>
            <div class="field wide"><label>Aggressiveness</label><div class="choice">${['conservative', 'balanced', 'aggressive'].map(k => `<button type="button" data-aggr="${k}" class="${d.aggr === k ? 'on' : ''}" aria-pressed="${d.aggr === k}">${PROFILES[k].label}</button>`).join('')}</div></div>
            <div class="field wide"><label>Alert me on</label><div class="choice four">${Object.entries(STRATEGIES).map(([k, st]) => `<button type="button" data-strat="${k}" class="${d.strategies.includes(k) ? 'on' : ''}" aria-pressed="${d.strategies.includes(k)}">${st.short}</button>`).join('')}</div></div>
          </div>
          <div style="margin-top:14px">${kv([
            ['Risk per trade', `${fmtMoney(p.riskPerTrade)} (stop at −${p.stopPct}% of premium)`, 1],
            ['Breaker trips at', `−${fmtMoney(p.maxLoss)} for the day, or ${p.consec} losses in a row`, 1],
            ['To hit the goal', p.winsNeeded ? `about ${p.winsNeeded} winning trade${p.winsNeeded > 1 ? 's' : ''} at ${p.rr}:1` : '—', 1],
            ['Alerts', `setups scoring ${p.minScore}+, up to ${p.perHour} an hour`, 1],
            ['Contracts', p.aggr === 'conservative' ? '≈0.6 delta, next-day expiry' : p.aggr === 'balanced' ? '≈0.5 delta, 0DTE (1DTE after 1:30pm)' : '≈0.4 delta, 0DTE', 1],
          ])}</div>
          <p class="note${p.warnings[0] ? ' warn' : ''}" style="margin-top:10px">${esc(p.warnings[0] || PROFILES[d.aggr].note)}</p>
          <div class="actions"><button type="button" class="btn primary" id="plan-lock">${locked ? '✓ Plan locked in' : 'Lock in plan'}</button><button type="button" class="btn" id="plan-ask">Ask me the questions</button></div>
        </div></div>`;
      if (keep) planBody.querySelector(keep)?.focus({ preventScroll: true });
    },
  };
  const replan = () => app.markDirty('plan');
  planBody.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.step) app.planStep(b.dataset.step, +b.dataset.dir);
    else if (b.dataset.aggr) app.planSet({ aggr: b.dataset.aggr });
    else if (b.dataset.strat) app.planToggleStrategy(b.dataset.strat);
    else if (b.id === 'plan-lock') { app.lockPlan(); if (!app.ui.sideBySide()) app.closeFocus(); }
    else if (b.id === 'plan-ask') { if (!app.ui.sideBySide()) app.closeFocus(); app.acts.startday(); }
  });
  planBody.addEventListener('focusin', (e) => { const f = e.target.dataset?.field; if (f) { e.target.value = String(app.planDraft[f]); e.target.select(); } });
  planBody.addEventListener('focusout', (e) => {
    const f = e.target.dataset?.field; if (!f) return;
    const v = Math.round(parseFloat(e.target.value.replace(/[^0-9.]/g, '')));
    if (v > 0) app.planDraft[f] = Math.max(f === 'capital' ? 100 : 10, Math.min(1e8, v));
    e.target.value = fmtMoney(app.planDraft[f]);
    setTimeout(replan, 0);
  });
  planBody.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.field) e.target.blur(); });

  // ------------------------------------------------------------ self-test
  V.selftest = {
    visible: open('selftest'),
    render() {
      const t = app.selfTest, icon = { pass: '✓', warn: '•', fail: '✗' };
      if (!t) { $('sb-selftest').innerHTML = '<p class="empty">Checks market data, the options chain, GEX levels, the TradingView bridge, research, voice, microphone, your plan, the breaker and setup alerts.</p><div class="actions"><button type="button" class="btn primary" data-act="selftest">Run the self-test</button></div>'; return; }
      const fails = t.results.filter(r => r.status === 'fail').length, waits = t.results.filter(r => r.status === 'warn').length;
      const sub = t.done ? `${t.results.length - fails - waits} of ${t.results.length} passed${fails ? ` · ${fails} to fix` : ''}${waits ? ` · ${waits} waiting` : ''}. Amber items are normal before the open or on first launch.` : 'Checking every part of INDAI…';
      $('sb-selftest').innerHTML = `<p class="note" style="margin-bottom:6px">${esc(sub)}</p>${t.results.map(r => `<div class="tline"><div class="ic ${r.status}">${icon[r.status]}</div><div><b>${esc(r.name)}</b><span>${esc(r.detail)}</span></div></div>`).join('')}
        <div class="actions"><button type="button" class="btn" data-act="selftest"${t.done ? '' : ' disabled'}>Run again</button><button type="button" class="btn" data-act="practice">Play a practice alert</button><button type="button" class="btn" id="st-plan-btn">Start my day</button></div>`;
      $('st-plan-btn').onclick = () => { app.closeFocus(); app.acts.startday(); };
    },
  };

  initCalc(app);
  initSettings(app);
}

// ---------------------------------------------------------------- options profit calculator
function initCalc(app) {
  const body = $('sb-calc');
  body.innerHTML = `<p class="note" style="margin-bottom:14px">Where the trade would be at each price and time. Black-Scholes pricing with the chain's implied volatility.</p>
    <div class="calc-top">
      <div class="field"><label for="c-sym">Symbol</label><div class="rowf"><input id="c-sym" type="text" maxlength="6" spellcheck="false" autocapitalize="characters"><button type="button" id="c-load" class="btn">Load</button></div></div>
      <div class="field"><label>Price</label><div class="spot" id="c-spot">—</div></div>
      <div class="field"><label for="c-strat">Strategy</label><select id="c-strat">
        <option value="custom">Custom</option><option value="long-call">Long call</option><option value="long-put">Long put</option>
        <option value="bull-call">Bull call spread</option><option value="bear-put">Bear put spread</option>
        <option value="bull-put">Bull put credit spread</option><option value="bear-call">Bear call credit spread</option>
        <option value="straddle">Long straddle</option><option value="strangle">Long strangle</option><option value="condor">Iron condor</option></select></div>
      <div class="field"><label for="c-exp">Expiry</label><select id="c-exp"></select></div>
    </div>
    <div class="legs" id="c-legs"></div>
    <div class="actions" style="margin-top:10px;align-items:center"><button type="button" id="c-add" class="btn mini">Add leg</button><button type="button" id="c-fill" class="btn mini">Use live prices and IV</button><span class="note" id="c-note"></span></div>
    <div class="stats" id="c-stats"></div>
    <div class="payoff"><canvas id="c-payoff"></canvas></div>
    <div class="heat-head"><b>Profit or loss by price and time</b><div class="seg" id="c-unit"><button type="button" data-u="usd" class="on">$</button><button type="button" data-u="pct">% of cost</button></div></div>
    <div class="heat" id="c-heat"></div>
    <p class="note" style="margin-top:12px">Information, not financial advice.</p>`;
  let unit = 'usd', shownFor = null;
  const rate = () => app.settings.rate ?? 0.04;
  const spotOf = (c) => app.feed.quote(c.sym)?.last ?? c.spot;
  const stepOf = (c) => {
    const ks = c.strikes || [], S = spotOf(c);
    const near = ks.filter(k => Math.abs(k - S) / S < 0.05);
    let d = Infinity; for (let i = 1; i < near.length; i++) d = Math.min(d, near[i] - near[i - 1]);
    return isFinite(d) && d > 0 ? d : app.strikeStep(c.sym, S);
  };
  const snap = (c, v) => { const ks = c.strikes; if (!ks || !ks.length) { const st = stepOf(c); return Math.round(v / st) * st; } return ks.reduce((b, k) => Math.abs(k - v) < Math.abs(b - v) ? k : b, ks[0]); };

  function loadSym() {
    const sym = $('c-sym').value.trim().toUpperCase().replace(/[^A-Z.]/g, '');
    if (!sym) return;
    app.calc = null; app.ensureCalc(sym);
    $('c-strat').value = 'long-call';
    renderAll();
    if (!app.feed.quote(sym) && app.feed.status.mode === 'demo') app.toast(`No demo data for ${sym}. Add it to the watchlist first.`);
  }
  $('c-load').addEventListener('click', loadSym);
  $('c-sym').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loadSym(); e.target.blur(); } });
  $('c-exp').addEventListener('change', () => { const c = app.calc; for (const l of c.legs) { l.expiry = $('c-exp').value; app.calcReprice(l); } app.calcFromChain({ quiet: true }); renderLegs(); renderOut(); });
  $('c-strat').addEventListener('change', () => applyStrategy($('c-strat').value));
  $('c-add').addEventListener('click', () => { const c = app.calc; const base = c.legs[c.legs.length - 1] || { type: 'C', side: 1, strike: snap(c, spotOf(c)), qty: 1, entry: 1, iv: 0.2, expiry: $('c-exp').value }; c.legs.push({ ...base }); $('c-strat').value = 'custom'; renderAll(); app.calcFromChain({ quiet: true }); });
  $('c-fill').addEventListener('click', () => app.calcFromChain());
  $('c-unit').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; unit = b.dataset.u; for (const x of $('c-unit').children) x.classList.toggle('on', x === b); renderOut(); });

  function applyStrategy(kind) {
    const c = app.calc; if (!c || kind === 'custom') return;
    const S = spotOf(c), k0 = snap(c, S), st = stepOf(c), w = st * Math.max(1, Math.round(S * 0.0075 / st)), exp = $('c-exp').value || c.legs[0]?.expiry;
    const iv = c.legs[0]?.iv || 0.2;
    const L = (side, type, strike) => ({ side, type, strike: snap(c, strike), qty: 1, entry: 1, iv, expiry: exp });
    const map = {
      'long-call': [L(1, 'C', k0)], 'long-put': [L(1, 'P', k0)],
      'bull-call': [L(1, 'C', k0), L(-1, 'C', k0 + w)], 'bear-put': [L(1, 'P', k0), L(-1, 'P', k0 - w)],
      'bull-put': [L(-1, 'P', k0 - w), L(1, 'P', k0 - 2 * w)], 'bear-call': [L(-1, 'C', k0 + w), L(1, 'C', k0 + 2 * w)],
      straddle: [L(1, 'C', k0), L(1, 'P', k0)], strangle: [L(1, 'C', k0 + w), L(1, 'P', k0 - w)],
      condor: [L(-1, 'P', k0 - w), L(1, 'P', k0 - 2 * w), L(-1, 'C', k0 + w), L(1, 'C', k0 + 2 * w)],
    };
    c.legs = map[kind];
    c.legs.forEach(l => app.calcReprice(l));
    renderAll();
    app.calcFromChain({ quiet: true });
  }
  function renderAll() { renderExp(); renderLegs(); renderOut(); }
  function renderExp() {
    const c = app.calc; if (!c) return;
    const sel = $('c-exp');
    const exps = c.expirations && c.expirations.length ? c.expirations.slice(0, 30) : [...new Set(c.legs.map(l => l.expiry))];
    const cur = c.legs[0]?.expiry;
    if (cur && !exps.includes(cur)) exps.unshift(cur);
    const html = exps.map(e => `<option value="${e}">${expLabelDays(e)}</option>`).join('');
    if (sel._html !== html) { sel._html = html; sel.innerHTML = html; }
    if (document.activeElement !== sel) sel.value = cur;
    $('c-spot').textContent = fmtPrice(spotOf(c));
    $('c-note').textContent = c.loading ? 'Loading the chain…' : c.demo ? 'Simulated demo prices' : c.strikes ? 'Prices from the CBOE chain (delayed about 15 min)' : 'Model prices (chain not loaded)';
  }
  function renderLegs() {
    const c = app.calc; if (!c) return;
    $('c-legs').innerHTML = c.legs.map((l, i) => `<div class="leg" data-i="${i}">
      <div><label>Buy or sell</label><select data-k="side" aria-label="Buy or sell"><option value="1"${l.side > 0 ? ' selected' : ''}>Buy</option><option value="-1"${l.side < 0 ? ' selected' : ''}>Sell</option></select></div>
      <div><label>Type</label><select data-k="type" aria-label="Call or put"><option value="C"${l.type === 'C' ? ' selected' : ''}>Call</option><option value="P"${l.type === 'P' ? ' selected' : ''}>Put</option></select></div>
      <div><label>Strike</label><input data-k="strike" type="number" inputmode="decimal" step="0.5" value="${l.strike}" aria-label="Strike"></div>
      <div><label>Contracts</label><input data-k="qty" type="number" inputmode="numeric" min="1" step="1" value="${l.qty}" aria-label="Contracts"></div>
      <div><label>Price</label><input data-k="entry" type="number" inputmode="decimal" min="0" step="0.01" value="${(+l.entry).toFixed(2)}" aria-label="Price per share"></div>
      <div><label>IV %</label><input data-k="iv" type="number" inputmode="decimal" min="1" step="0.5" value="${(l.iv * 100).toFixed(1)}" aria-label="Implied volatility percent"></div>
      ${c.legs.length > 1 ? '<button type="button" class="rm" data-del="1">Remove</button>' : ''}</div>`).join('');
  }
  $('c-legs').addEventListener('change', (e) => {
    const row = e.target.closest('.leg'); if (!row) return;
    const c = app.calc, leg = c.legs[+row.dataset.i], k = e.target.dataset.k, v = e.target.value;
    if (k === 'side') leg.side = +v; else if (k === 'type') leg.type = v; else if (k === 'strike') leg.strike = +v || leg.strike; else if (k === 'qty') leg.qty = Math.max(1, Math.round(+v || 1));
    else if (k === 'entry') leg.entry = Math.max(0, +v || 0); else if (k === 'iv') leg.iv = Math.max(0.01, (+v || 20) / 100);
    $('c-strat').value = 'custom';
    if (k === 'type' || k === 'strike') { app.calcReprice(leg); afterPointer(renderLegs); app.calcFromChain({ quiet: true }); }
    renderOut();
  });
  $('c-legs').addEventListener('click', (e) => {
    if (!e.target.dataset.del) return;
    const row = e.target.closest('.leg'); app.calc.legs.splice(+row.dataset.i, 1); $('c-strat').value = 'custom'; renderLegs(); renderOut();
  });
  function renderOut() {
    const c = app.calc; if (!c || !c.legs.length) return;
    const S = spotOf(c), rr = rate();
    const sum = positionSummary(c.legs, S, rr);
    const grid = pnlGrid(c.legs, S, rr, { rows: 15, maxCols: window.innerWidth < 700 ? 6 : 9 });
    if (!sum || !grid) return;
    const cost = sum.netDebit;
    const stats = [
      [cost >= 0 ? 'Cost (debit)' : 'Credit received', fmtMoney(Math.abs(cost))],
      ['Max profit', sum.unlimitedProfit ? 'Unlimited' : fmtMoney(sum.maxProfit)],
      ['Max loss', sum.unlimitedLoss ? 'Unlimited' : fmtMoney(sum.maxLoss)],
      ['Breakeven at expiry', sum.breakevens.map(fmtPrice).join(' / ') || '—'],
      ['Chance of profit', `${Math.round(sum.pop * 100)}%`],
      ['Delta (shares)', sum.greeks.delta.toFixed(0)],
      ['Theta per day', fmtMoney(sum.greeks.theta)],
      ['Expected move', `±${grid.expectedMove.toFixed(2)}`],
    ];
    $('c-stats').innerHTML = stats.map(([l, v]) => `<div class="stat"><small>${l}</small><b>${esc(v)}</b></div>`).join('');
    const max = Math.max(1, ...grid.grid.flat().map(Math.abs)), base = Math.abs(cost) || 1;
    const cell = (v) => unit === 'pct' ? `${v >= 0 ? '+' : '−'}${Math.abs(v / base * 100).toFixed(0)}%` : `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    let html = '<table><thead><tr><th>Price</th>' + grid.cols.map(c2 => `<th>${esc(c2.label)}</th>`).join('') + '</tr></thead><tbody>';
    grid.prices.forEach((p, i) => {
      const isSpot = Math.abs(p - S) <= grid.step / 2;
      html += `<tr class="${isSpot ? 'spot' : ''}"><td class="px">${fmtPrice(p)}</td>` + grid.grid[i].map(v => {
        const t = Math.min(1, Math.abs(v) / max), a = (0.08 + 0.55 * t).toFixed(2);
        return `<td style="background:${v >= 0 ? `rgba(62,207,142,${a})` : `rgba(242,112,107,${a})`}">${cell(v)}</td>`;
      }).join('') + '</tr>';
    });
    $('c-heat').innerHTML = html + '</tbody></table>';
    drawPayoff($('c-payoff'), c, S, rr, grid);
  }
  app.onCalcChange = () => { if (app.focus !== 'calc') return; if (!$('c-legs').contains(document.activeElement)) afterPointer(renderLegs); renderExp(); renderOut(); };
  app.views.calc = {
    gap: 1500, visible: () => app.focus === 'calc' && !document.hidden,
    render() {
      const c = app.ensureCalc();
      $('st-calc').textContent = c.legs.length ? `Options calculator · ${c.sym} ${c.legs.map(l => `${l.side < 0 ? '−' : ''}${l.strike}${l.type}`).join(' / ')}` : 'Options profit calculator';
      if (shownFor !== c) { shownFor = c; if (document.activeElement !== $('c-sym')) $('c-sym').value = c.sym; renderAll(); if (!c.strikes && !c.loading) app.calcFromChain({ quiet: true }); return; }
      renderExp(); renderOut();
    },
  };
  new ResizeObserver(() => { if (app.focus === 'calc') app.markDirty('calc'); }).observe($('c-payoff').parentElement);
}

// ---------------------------------------------------------------- settings
function initSettings(app) {
  const body = $('sb-settings');
  body.innerHTML = `<form class="form" id="s-form" autocomplete="off">
    <h3>You</h3>
    <label for="s-name">Name INDAI calls you</label><input id="s-name" type="text" maxlength="24">
    <label for="s-symbols">Watchlist (up to 12, comma separated)</label><input id="s-symbols" type="text" placeholder="SPY, QQQ, IWM, TSLA, AMZN, MSFT" spellcheck="false" autocapitalize="characters">

    <h3>Market data</h3>
    <p class="note">By default INDAI uses free CBOE data, delayed about 15 minutes: quotes, intraday candles and full option chains with Greeks. No keys needed. Add a free <a href="https://finnhub.io/register" target="_blank" rel="noopener">Finnhub</a> key for real-time stock prices on top.</p>
    <label for="s-mode">Data</label><select id="s-mode"><option value="auto">Real market data (CBOE delayed, plus Finnhub if set)</option><option value="demo">Demo data (simulated)</option></select>
    <label for="s-fh">Finnhub API key (optional, kept on this device)</label><div class="rowf"><input id="s-fh" type="password" spellcheck="false" style="text-transform:none"><button type="button" id="s-fh-show" class="btn">Show</button></div>

    <h3>GEX levels</h3>
    <p class="note">Filled in automatically: each weekday morning from your Morning GEX refresh, and live from the options chain. Paste here only to override a ticker. CW = call wall, PW = put wall, ZG = gamma flip.</p>
    <div id="gex-status" class="status"></div>
    <label for="s-levels">Manual override (optional)</label><textarea id="s-levels" spellcheck="false" placeholder="IWM CW 280 PW 275 ZG 278"></textarea>
    <div id="levels-preview" class="status"></div>

    <h3>Risk breaker</h3>
    <div class="grid2">
      <div><label for="s-account">Account size $</label><input id="s-account" type="number" inputmode="decimal" min="100" step="100"></div>
      <div><label for="s-maxloss">Max daily loss $</label><input id="s-maxloss" type="number" inputmode="decimal" min="10" step="10"></div>
      <div><label for="s-riskpct">Risk per trade %</label><input id="s-riskpct" type="number" inputmode="decimal" min="0.1" step="0.1"></div>
      <div><label for="s-stoppct">Stop, % of premium</label><input id="s-stoppct" type="number" inputmode="decimal" min="5" max="100" step="5"></div>
      <div><label for="s-consec">Losses before cooldown</label><input id="s-consec" type="number" inputmode="numeric" min="1" max="10" step="1"></div>
      <div><label for="s-cool">Cooldown minutes</label><input id="s-cool" type="number" inputmode="numeric" min="1" max="240" step="1"></div>
    </div>
    <p class="note" style="margin-top:8px">Locking in a game plan sets these for the day.</p>

    <h3>INDAI's voice</h3>
    <label class="check"><input id="s-voice" type="checkbox"> INDAI speaks out loud</label>
    <div class="grid2">
      <div><label for="s-vengine">Voice engine</label><select id="s-vengine"><option value="neural">Natural voice (on-device)</option><option value="system">Browser voice (lighter, instant)</option></select></div>
      <div><label for="s-vname">Voice</label><select id="s-vname"></select></div>
    </div>
    <label for="s-vspeed">Speaking speed <span id="s-vspeed-v"></span></label><input id="s-vspeed" type="range" min="0.8" max="1.2" step="0.05">
    <label for="s-mic">Listening</label><select id="s-mic"><option value="auto">Automatic</option><option value="whisper">Always on-device (private, works offline after download)</option><option value="browser">Browser speech recognition</option></select>
    <label for="s-handsfree">After INDAI answers</label><select id="s-handsfree"><option value="on">Keep listening for my reply (hands-free)</option><option value="off">Wait for me to tap the mic</option></select>
    <div class="actions" style="margin-top:12px"><button type="button" id="s-test-voice" class="btn mini">Test voice</button><button type="button" id="s-dl-voice" class="btn mini">Download voice and listening now</button><button type="button" id="s-mic-test" class="btn mini">Allow microphone</button></div>
    <div id="voice-status" class="status"></div>
    <p class="note" style="margin-top:8px">The natural voice and the listening model run on this device. The first download is about 130 MB, then it is cached. On a phone, do it on Wi-Fi.</p>

    <h3>What she has learned</h3>
    <div id="learn-status" class="status"></div>
    <div class="actions" style="margin-top:10px"><button type="button" id="s-forget-speech" class="btn mini">Forget learned speech fixes</button></div>

    <h3>Research</h3>
    <p class="note">With research on, INDAI also reads today's news, events and sentiment on the web before rating a trade, and can hold a free conversation. The analysis is information, not financial advice.</p>
    <div id="research-status" class="status"></div>
    <div class="actions" id="research-actions" style="margin-top:10px" hidden><button type="button" id="s-brain-retry" class="btn mini" hidden>Check the budget again</button><button type="button" id="s-research-resume" class="btn mini" hidden>Turn web research back on</button></div>
    <div class="grid2">
      <div><label for="s-depth">Research depth</label><select id="s-depth"><option value="fast">Fast (about 20 seconds)</option><option value="deep">Deep (slower, more thorough)</option></select></div>
      <div><label for="s-rate">Risk-free rate %</label><input id="s-rate" type="number" inputmode="decimal" min="0" max="15" step="0.1"></div>
    </div>
    <label for="s-pass">Research passcode (only if you set one)</label><input id="s-pass" type="password" spellcheck="false">

    <h3>TradingView</h3>
    <p class="note"><b>INDAI Bridge</b> streams your TradingView candles into INDAI every minute, so charts and setup alerts run on your live TradingView data instead of delayed data. Add the <a href="/jarvis-command-center/tradingview/indai-bridge.pine" target="_blank" rel="noopener">INDAI Bridge indicator</a> to a 1-minute chart and create one alert with your INDAI webhook link. Any other TradingView alert sent to the same link is read out loud, and alerts with levels like <code>CW 700 PW 650 ZG 676</code> update the GEX lines. Webhooks need a paid TradingView plan with two-factor authentication on.</p>
    <div id="tv-status" class="status"></div>
    <div class="actions" style="margin-top:10px"><button type="button" class="btn mini" data-act="tv">Open in TradingView</button></div>

    <h3>Alerts</h3>
    <label class="check"><input id="s-a-levels" type="checkbox"> Price crosses a GEX level</label>
    <label class="check"><input id="s-a-hod" type="checkbox"> New high or low of day</label>
    <label class="check"><input id="s-a-bells" type="checkbox"> Opening and closing bell</label>
    <label class="check"><input id="s-a-tv" type="checkbox"> Read out my TradingView alerts</label>
    <div class="actions" style="margin-top:8px"><button type="button" id="s-notify" class="btn mini">Notify me when INDAI is in the background</button></div>
    <p class="note" style="margin-top:8px">Setup alerts arrive while INDAI is open. On a computer or Android a background tab still counts for a while; on iPhone and iPad keep INDAI on screen. Alerts with the app fully closed are on the backend to-do list.</p>

    <h3>Headset-only</h3>
    <p class="note">Scenes, hand gestures and the gesture tutorial live in the Quest app. This website shares the same brain, data and game plan logic.</p>

    <div class="save"><button type="submit" class="btn primary">Save</button><button type="button" id="s-selftest" class="btn">Run self-test</button><button type="button" id="s-reset-day" class="btn">Reset today's P&amp;L</button></div>
  </form>`;
  const f = $, vname = $('s-vname'), toast = (m) => app.toast(m);
  vname.innerHTML = VOICES.map(v => `<option value="${v.id}">${esc(v.label)}</option>`).join('');
  function fill() {
    const s = app.settings;
    f('s-name').value = s.name; f('s-symbols').value = s.symbols.join(', ');
    f('s-mode').value = s.dataMode === 'demo' ? 'demo' : 'auto';
    f('s-fh').value = s.finnhubKey; f('s-levels').value = s.levelsText;
    f('s-account').value = s.risk.account; f('s-maxloss').value = s.risk.maxDailyLoss; f('s-riskpct').value = s.risk.riskPct;
    f('s-stoppct').value = s.risk.stopPct; f('s-consec').value = s.risk.maxConsecLosses; f('s-cool').value = s.risk.cooldownMin;
    f('s-handsfree').value = s.handsFree === false ? 'off' : 'on';
    f('s-voice').checked = s.voice; f('s-vengine').value = s.voiceEngine; vname.value = s.voiceName; f('s-vspeed').value = s.voiceSpeed; f('s-mic').value = s.micEngine;
    f('s-depth').value = s.researchDepth; f('s-rate').value = +(s.rate * 100).toFixed(2); f('s-pass').value = s.researchPass;
    f('s-a-levels').checked = s.alerts.levels; f('s-a-hod').checked = s.alerts.hod; f('s-a-bells').checked = s.alerts.bells; f('s-a-tv').checked = s.alerts.tradingview !== false;
    f('s-vspeed-v').textContent = `${(+f('s-vspeed').value).toFixed(2)}×`;
    updateLevelsPreview(); updateStatus();
  }
  function updateLevelsPreview() {
    const lines = f('s-levels').value.split(/\n|;/).map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(l => { const m = l.match(/^\$?([A-Za-z.]{1,6})/); return m ? m[1].toUpperCase() : null; }).filter(Boolean);
    $('levels-preview').textContent = parsed.length ? `Overriding: ${[...new Set(parsed)].join(', ')}` : '';
  }
  function updateStatus() {
    const s = app.settings, ind = app.indai, v = ind.voice, vs = v.state;
    $('gex-status').innerHTML = s.symbols.map(sym => {
      const lv = app.levelsFor(sym);
      if (!lv) return `${sym}: <span class="warn">loading…</span>`;
      const c = lv.source === 'morning' || lv.source === 'live' || lv.source === 'manual' || lv.source === 'tradingview' ? 'ok' : 'warn';
      return `${sym}: CW ${lv.cw ?? '—'}  PW ${lv.pw ?? '—'}  ZG ${lv.zg ?? '—'}  <span class="${c}">${esc(levelSourceLabel(lv).replace('Levels: ', ''))}</span>`;
    }).join('\n');
    const vp = [];
    vp.push(vs.ttsReady ? '<span class="ok">Voice ready</span>' : vs.ttsLoad != null ? `<span class="warn">Voice downloading ${vs.ttsLoad}%</span>` : s.voiceEngine === 'system' ? 'Using the browser voice' : 'Voice downloads the first time she speaks (about 90 MB, then cached)');
    vp.push(vs.sttReady ? `<span class="ok">Listening ready (${esc(vs.sttModel || 'on-device')})</span>` : vs.sttLoad != null ? `<span class="warn">Listening model ${vs.sttLoad}%</span>` : v.SR && s.micEngine !== 'whisper' ? 'Listening uses the browser recognizer here' : 'Listening model downloads the first time you talk (about 40 MB)');
    vp.push(self.crossOriginIsolated ? 'Multi-core voice processing is on' : 'Single-core voice processing (multi-core switches on after the first reload where the browser supports it)');
    if (vs.error) vp.push(`<span class="bad">${esc(vs.error)}</span>`);
    $('voice-status').innerHTML = vp.join('\n');
    const st = ind.speech.stats, fixes = ind.speech.list().slice(0, 6), ears = v.ears || {};
    $('learn-status').innerHTML = [`${st.fixes} speech fix${st.fixes === 1 ? '' : 'es'} learned${st.heard ? ` · understood ${Math.round(st.understood / st.heard * 100)}% of ${st.heard} things you've said` : ''}`,
      ...fixes.map(x => `“${esc(x.heard)}” means “${esc(x.to)}”`), ears.pause ? `Waits ${ears.pause} ms after you stop talking (learned from your pace)` : 'Say “no, I said …” after a mishear and she learns it', 'Say “what do you remember” for her long-term memory'].join('\n');
    const tv = app.tvAlerts || [], br = app.feed.status.tvAt, t = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const bridge = app.feed.status.mode === 'demo' ? 'Bridge: off while INDAI is on demo data.' : br ? (app.feed.bridgeLive ? `<span class="ok">Bridge live</span>: last candle ${t(br)}` : `<span class="warn">Bridge quiet</span> since ${t(br)}`) : 'Bridge: not connected yet (add the INDAI Bridge indicator and its alert).';
    $('tv-status').innerHTML = bridge + '\n' + (tv.length ? `<span class="ok">Connected</span>: ${tv.length} alert${tv.length === 1 ? '' : 's'} in the last two days. Latest: ${esc(String(tv[0].text).slice(0, 120))}` : 'Alerts: none received yet (optional).');
    const b = ind.brain, care = brainCare();
    let rs = !b.checked ? 'Checking…' : b.configured ? `<span class="ok">Research and the thinking brain are on</span>${b.passcode ? ' (passcode required)' : ''}` : b.error ? '<span class="warn">Can\'t reach the INDAI backend right now.</span> She rates trades from market data alone until it is back.' : '<span class="warn">Research is off.</span> It turns on once the Anthropic API key is saved in the INDAI backend. Until then INDAI rates trades from the market data alone and answers with her built-in commands.';
    if (b.configured && care.out === 'budget') rs = '<span class="warn">Today\'s thinking budget is used up.</span> It resets at midnight New York time. Until then INDAI rates trades from the market data alone and answers with her built-in commands.';
    else if (b.configured && care.out === 'rate') rs = '<span class="warn">INDAI has hit her hourly thinking limit.</span> It clears within the hour.';
    if (b.configured && care.researchPaused && !care.out) rs = '<span class="ok">The thinking brain is on</span>';
    if (b.configured && care.researchPaused) rs += `\n<span class="warn">Web research is paused until midnight New York time.</span> It failed ${care.fails} times in a row on the backend, and each failed try still spends the thinking budget.`;
    const rEl = $('research-status');
    if (rEl.dataset.html !== rs) { rEl.dataset.html = rs; rEl.innerHTML = rs; }
    $('s-brain-retry').hidden = care.out !== 'budget'; $('s-research-resume').hidden = !care.researchPaused;
    $('research-actions').hidden = care.out !== 'budget' && !care.researchPaused;
    const nb = $('s-notify');
    nb.hidden = !('Notification' in window);
    if ('Notification' in window) nb.textContent = Notification.permission === 'granted' ? 'Background notifications are on' : Notification.permission === 'denied' ? 'Notifications are blocked in the browser' : 'Notify me when INDAI is in the background';
  }
  f('s-levels').addEventListener('input', updateLevelsPreview);
  f('s-vspeed').addEventListener('input', () => { $('s-vspeed-v').textContent = `${(+f('s-vspeed').value).toFixed(2)}×`; });
  const num = (el, def, min, max) => { const v = parseFloat(el.value); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
  const readVoice = () => { const s = app.settings; s.voiceEngine = f('s-vengine').value; s.voiceName = vname.value; s.voiceSpeed = +f('s-vspeed').value; s.micEngine = f('s-mic').value; };
  let statusTimer = 0;
  app.views.settings = {
    visible: () => app.focus === 'settings',
    render() {
      if (!body.dataset.open) { fill(); body.dataset.open = '1'; clearInterval(statusTimer); statusTimer = setInterval(() => { if (app.focus === 'settings') updateStatus(); else { clearInterval(statusTimer); delete body.dataset.open; } }, 1500); }
      else updateStatus();
    },
  };
  $('s-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const s = app.settings;
    const prev = { f: s.finnhubKey, syms: s.symbols.join(','), mode: s.dataMode };
    s.name = f('s-name').value.trim().slice(0, 24) || 'Trader';
    const syms = f('s-symbols').value.split(/[\s,]+/).map(x => x.trim().toUpperCase().replace(/[^A-Z.]/g, '')).filter(Boolean);
    s.symbols = [...new Set(syms)].slice(0, 12);
    if (!s.symbols.length) s.symbols = ['SPY', 'QQQ', 'IWM'];
    if (!s.symbols.includes(s.main)) s.main = s.symbols[0];
    s.dataMode = f('s-mode').value;
    s.finnhubKey = f('s-fh').value.trim();
    s.levelsText = f('s-levels').value;
    const r = s.risk;
    r.account = num(f('s-account'), r.account, 100, 1e8);
    r.maxDailyLoss = num(f('s-maxloss'), r.maxDailyLoss, 10, 1e7);
    r.riskPct = num(f('s-riskpct'), r.riskPct, 0.1, 100);
    r.stopPct = num(f('s-stoppct'), r.stopPct, 5, 100);
    r.maxConsecLosses = Math.round(num(f('s-consec'), r.maxConsecLosses, 1, 10));
    r.cooldownMin = Math.round(num(f('s-cool'), r.cooldownMin, 1, 240));
    s.voice = f('s-voice').checked; readVoice();
    s.handsFree = f('s-handsfree').value !== 'off';
    s.researchDepth = f('s-depth').value; s.rate = num(f('s-rate'), s.rate * 100, 0, 15) / 100; s.researchPass = f('s-pass').value.trim();
    s.alerts.levels = f('s-a-levels').checked; s.alerts.hod = f('s-a-hod').checked; s.alerts.bells = f('s-a-bells').checked; s.alerts.tradingview = f('s-a-tv').checked;
    app.applySettings(prev);
    delete body.dataset.open;
    app.closeFocus();
    toast('Saved');
  });
  const resetDay = $('s-reset-day');
  resetDay.addEventListener('click', () => {
    if (resetDay.dataset.armed) { app.resetDay(); resetDay.textContent = "Reset today's P&L"; delete resetDay.dataset.armed; toast("Today's P&L reset"); return; }
    resetDay.dataset.armed = '1'; resetDay.textContent = 'Tap again to confirm';
    setTimeout(() => { resetDay.textContent = "Reset today's P&L"; delete resetDay.dataset.armed; }, 4000);
  });
  $('s-test-voice').addEventListener('click', () => {
    readVoice();
    const v = app.indai.voice; v.unlock(); v.stopSpeaking();
    v.speak(`Hi ${f('s-name').value || app.settings.name}, I'm INDAI. Ready when you are.`);
    if (app.settings.voiceEngine === 'neural' && !v.state.ttsReady) toast('Loading the voice. The first time takes a moment.');
  });
  $('s-dl-voice').addEventListener('click', () => { readVoice(); const v = app.indai.voice; v.unlock(); v.preload({ tts: true, stt: true }); toast("Downloading INDAI's voice and listening model"); updateStatus(); });
  $('s-mic-test').addEventListener('click', async () => { const r = await app.primeMic(); toast(r === 'denied' ? 'Microphone is blocked for this site. Allow it in the browser settings.' : r === 'unavailable' ? 'This browser has no microphone access.' : 'Microphone allowed'); });
  $('s-fh-show').addEventListener('click', (e) => { const el = $('s-fh'); el.type = el.type === 'password' ? 'text' : 'password'; e.target.textContent = el.type === 'password' ? 'Show' : 'Hide'; });
  $('s-selftest').addEventListener('click', () => { delete body.dataset.open; app.indai.voice.unlock(); app.indai.selfTest(); });
  $('s-brain-retry').addEventListener('click', () => { brainRetry(); toast('Ask her something and she will try her thinking brain again'); updateStatus(); });
  $('s-research-resume').addEventListener('click', () => { resumeResearch(); toast('Web research is back on for your next trade idea'); updateStatus(); });
  $('s-forget-speech').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed) { app.indai.speech.forgetAll(); delete b.dataset.armed; b.textContent = 'Forget learned speech fixes'; toast('Speech fixes cleared'); updateStatus(); return; }
    b.dataset.armed = '1'; b.textContent = 'Tap again to confirm';
    setTimeout(() => { b.textContent = 'Forget learned speech fixes'; delete b.dataset.armed; }, 4000);
  });
  $('s-notify').addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
    updateStatus();
    toast(Notification.permission === 'granted' ? 'INDAI will notify you of setups while it is in the background' : 'Notifications are blocked for this site in the browser settings');
  });
}
