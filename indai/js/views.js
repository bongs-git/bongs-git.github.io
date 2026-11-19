// The website's always-on screens: top bar, watchlist, chart, lead/lag, GEX levels, risk breaker,
// today's plan and the INDAI conversation. Each view redraws only when app.markDirty(id) says its data changed.
import { marketStatus, fmtClock, fmtDuration, INTERVAL_LABEL } from './market.js';
import { STRATEGIES, PROFILES, buildPlan } from './signals.js';
import { fmtPrice, fmtPct, fmtMoney, fmtMMSS } from './hud.js';
import { nearestLevel, levelSourceLabel, ideaLabel, RAG_CLASS } from './panels.js';
import { PriceChart, drawSparkline, drawLeadLag, leadLagSeries, LL_COLORS } from './chart.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const setClass = (el, c) => { if (el.className !== c) el.className = c; };
const timeET = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

const TAB_OF = { watch: 'watch', leadlag: 'watch', chart: 'chart', levels: 'chart', indai: 'indai', today: 'plan', risk: 'plan', more: 'more' };
const CHECKS = ['Trend with EMA cloud', 'At a GEX level', 'Volume confirms', 'Calm, not revenge'];

export function initViews(app) {
  const ind = app.indai;
  const body = document.body;

  // ------------------------------------------------------------ layout
  const mq = { tablet: matchMedia('(min-width: 700px)'), wide: matchMedia('(min-width: 1024px)'), desk: matchMedia('(min-width: 1320px)') };
  const readLayout = () => { app.layout = mq.desk.matches ? 'desk' : mq.wide.matches ? 'wide' : mq.tablet.matches ? 'tablet' : 'phone'; body.dataset.layout = app.layout; app.markDirty('all'); };
  Object.values(mq).forEach(m => m.addEventListener('change', readLayout));
  app.layout = mq.desk.matches ? 'desk' : mq.wide.matches ? 'wide' : mq.tablet.matches ? 'tablet' : 'phone';
  body.dataset.layout = app.layout;
  const sideBySide = () => app.layout === 'wide' || app.layout === 'desk';       // INDAI stays in view next to everything
  const panelVisible = (id) => () => !document.hidden && (app.layout === 'phone' ? app.tab === TAB_OF[id] && !app.focus : id !== 'more');
  // is the conversation on screen right now?
  let indaiOnScreen = true;
  new IntersectionObserver((es) => { indaiOnScreen = es[0].isIntersecting && es[0].intersectionRatio > 0.2; body.classList.toggle('talk-away', !indaiOnScreen); app.markDirty('dock'); }, { threshold: [0, 0.2, 0.5] }).observe($('p-indai'));
  const talkVisible = () => sideBySide() || (!app.focus && (app.layout === 'phone' ? app.tab === 'indai' : indaiOnScreen));

  // keep the conversation above the on-screen keyboard
  const vv = window.visualViewport;
  const setVV = () => {
    document.documentElement.style.setProperty('--vvh', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
    // iOS pans the page when the keyboard opens; bring the conversation back so the composer sits right above the keys
    if (body.classList.contains('typing') && app.layout === 'phone' && app.tab === 'indai' && !app.focus) window.scrollTo(0, 0);
  };
  if (vv) { vv.addEventListener('resize', setVV); vv.addEventListener('scroll', setVV); window.addEventListener('resize', setVV); setVV(); }
  document.addEventListener('focusin', (e) => { if (app.layout === 'phone' && e.target.matches('input[type=text], input[type=number], input[type=password], textarea')) body.classList.add('typing'); });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!document.activeElement?.matches?.('input, textarea')) body.classList.remove('typing'); }, 60); });

  // ------------------------------------------------------------ toast + caption
  const toastEl = $('toast');
  app.toast = (msg) => { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastEl._h); toastEl._h = setTimeout(() => toastEl.classList.remove('show'), 2800); };
  const cap = $('caption');
  let capMode = null, unseen = false;
  const hideCap = () => { cap.hidden = true; capMode = null; };
  // INDAI's replies show as a caption whenever the conversation itself is not on screen.
  app.caption = (text, kind = 'info') => {
    if (talkVisible()) return;
    unseen = true; app.markDirty('dock');
    if (/^[•✓✗]/.test(text)) return;
    cap.textContent = text; cap.className = kind; cap.hidden = false; capMode = 'msg';
    clearTimeout(cap._h); cap._h = setTimeout(() => { if (capMode === 'msg') hideCap(); }, Math.min(16000, 4500 + text.length * 45));
  };
  cap.addEventListener('click', () => { hideCap(); if (app.focus && app.layout !== 'tablet') return; if (app.focus) ui.closeSheet(); ui.showTab('indai'); if (app.layout === 'tablet') $('p-indai').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });

  // ------------------------------------------------------------ tabs + sheets
  const tabs = $('tabs');
  const ui = {
    showTab(tab) {
      if (!['watch', 'chart', 'indai', 'plan', 'more'].includes(tab)) return;
      app.tab = tab; body.dataset.tab = tab;
      for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === tab);
      if (app.layout === 'phone') window.scrollTo(0, 0);
      if (tab === 'indai') { unseen = false; hideCap(); requestAnimationFrame(() => { const l = $('i-log'); l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); }); }
      app.markDirty('all');
    },
    openSheet(id) {
      const el = $('sheet-' + id); if (!el) return;
      if (app.focus && app.focus !== id) $('sheet-' + app.focus).hidden = true;
      const was = app.focus === id;
      app.focus = id; el.hidden = false;
      $('scrim').hidden = false;
      if (!was) { el.querySelector('.sb').scrollTop = 0; if (!sideBySide()) el.querySelector('.close').focus({ preventScroll: true }); }
      body.dataset.focus = id;
      app.markDirty(id); app.markDirty('dock');
    },
    closeSheet() {
      if (!app.focus) return;
      $('sheet-' + app.focus).hidden = true; $('scrim').hidden = true;
      app.focus = null; delete body.dataset.focus;
      app.markDirty('all');
    },
    flash(id) {
      const el = $('p-' + id); if (!el) return;
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      clearTimeout(el._f); el._f = setTimeout(() => el.classList.remove('flash'), 1700);
    },
    sideBySide, talkVisible,
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) ui.showTab(b.dataset.tab); });
  $('scrim').addEventListener('click', () => app.closeFocus());
  $('sheets').addEventListener('click', (e) => { if (e.target.closest('.close')) app.closeFocus(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && app.focus) { e.preventDefault(); app.closeFocus(); } });

  // one handler for every [data-act] button
  const ACTS = {
    brief: () => app.brief(), calc: () => app.openCalc(), summary: () => app.consolidate(), selftest: () => ind.selfTest(), settings: () => app.openSettings(),
    plan: () => app.openPlan(), startday: () => { if (app.layout === 'phone') ui.showTab('indai'); if (ind.awaiting) return; app.inputMode = 'typed'; ind.startDay({ voice: false, skipTemp: !!app.temp && Date.now() - app.temp.at < 5 * 60e3 }); },
    retemp: () => app.checkTemperature(true), practice: () => app.practiceAlert(), tv: () => app.openTradingView(), deep: () => app.openDeepDive(),
    mute: () => app.toggleMute(), install: () => installApp(), notnow: () => app.cancelCheckIn(),
    details: () => ui.openSheet('analysis'), again: () => ind.repeat(),
  };
  app.acts = ACTS;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const fn = ACTS[b.dataset.act]; if (fn) { e.preventDefault(); fn(b); }
  });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-say]'); if (b) { e.preventDefault(); app.send(b.dataset.say); } });

  // ------------------------------------------------------------ top bar
  const V = app.views;
  V.top = {
    gap: 200,
    render() {
      const ms = marketStatus(), st = app.feed.status, bridge = app.feed.bridgeLive;
      setText($('t-clock'), fmtClock() + ' ET');
      const short = ms.state === 'open' ? (ms.label.includes('EARLY') ? 'Open, early close' : 'Market open') : ms.state === 'pre' ? 'Pre-market' : ms.state === 'post' ? 'After hours' : ms.label.includes('·') ? 'Closed, ' + ms.label.split('·')[1].trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : 'Market closed';
      setText($('t-state-text'), `${short} · ${ms.nextEvent === 'close' ? 'closes' : 'opens'} in ${fmtDuration(ms.msToNext)}`);
      setClass($('t-state'), 'mstate ' + ms.state);
      const [label, c] = st.mode === 'demo' ? ['Demo data', 'badge demo'] : bridge ? ['Live · TradingView', 'badge live'] : st.mode === 'live' ? ['Live', 'badge live'] : ['Delayed 15 min', 'badge'];
      const b = $('t-badge'); setText(b, label); setClass(b, c);
      b.title = st.mode === 'demo' ? (st.note || 'Simulated prices') : bridge ? 'TradingView bridge, options from CBOE' : st.mode === 'live' ? `Finnhub ${st.finnhubWs === 'live' ? 'streaming' : st.finnhubWs}, plus CBOE` : `CBOE ${st.cboe === 'ok' ? 'connected' : st.cboe || 'connecting'}, about 15 minutes delayed`;
    },
  };
  $('t-badge').addEventListener('click', () => app.toast($('t-badge').title));

  // ------------------------------------------------------------ watchlist
  const wrows = $('w-rows');
  let wKey = '';
  const wRev = {};
  V.watch = {
    gap: 300, visible: panelVisible('watch'),
    render() {
      const s = app.settings, key = s.symbols.join(',');
      if (key !== wKey) {
        wKey = key;
        wrows.innerHTML = s.symbols.map(sym => `<div class="wrow" role="listitem" data-sym="${sym}">
          <button type="button" class="hit" aria-label="Show ${sym} on the chart"></button>
          <span class="w-sym"><b>${sym}</b><i>&nbsp;</i></span><canvas></canvas>
          <span class="w-px"><b>—</b><i>&nbsp;</i></span>
          <button type="button" class="dive" aria-label="Deep dive on ${sym}" title="Deep dive"><svg><use href="#ic-dive"/></svg></button></div>`).join('');
        for (const k of Object.keys(wRev)) delete wRev[k];
      }
      for (const row of wrows.children) {
        const sym = row.dataset.sym, q = app.feed.quote(sym), lv = app.levelsFor(sym);
        row.classList.toggle('sel', sym === s.main);
        const near = q && lv ? nearestLevel(q.last, lv) : null;
        const nEl = row.querySelector('.w-sym i');
        // outside regular hours the extended-hours move takes the small line; otherwise the nearest GEX level
        const ext = q && q.ext != null;
        setText(nEl, ext ? `ext ${fmtPct(q.extPct)}` : near ? `${near.short} ${near.dist >= 0 ? '+' : ''}${near.dist.toFixed(2)}%` : '\u00a0');
        setClass(nEl, ext ? cls(q.extPct) : near && Math.abs(near.dist) < 0.15 ? 'near' : '');
        setText(row.querySelector('.w-px b'), q ? fmtPrice(q.last) : '—');
        const pEl = row.querySelector('.w-px i');
        setText(pEl, q ? fmtPct(q.pct) : 'loading');
        setClass(pEl, q ? cls(q.chg) : 'flat');
        const rev = app.feed.syms.get(sym)?.rev, cv = row.querySelector('canvas');
        if (wRev[sym] !== rev + ':' + cv.clientWidth) { wRev[sym] = rev + ':' + cv.clientWidth; drawSparkline(cv, app.feed.getBars(sym, '5min'), q?.base); }
      }
    },
  };
  wrows.addEventListener('click', (e) => {
    const row = e.target.closest('.wrow'); if (!row) return;
    if (e.target.closest('.dive')) { app.openDeepDive(row.dataset.sym); return; }
    app.selectSymbol(row.dataset.sym);
    if (app.layout === 'phone') ui.showTab('chart');
  });
  $('w-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('w-add-in'), sym = inp.value.trim().toUpperCase().replace(/[^A-Z.]/g, '');
    if (!sym) return;
    if (app.settings.symbols.length >= 12 && !app.settings.symbols.includes(sym)) { app.toast('The watchlist holds 12 tickers. Remove one in Settings first.'); return; }
    inp.value = ''; inp.blur();
    app.selectSymbol(sym);
  });

  // ------------------------------------------------------------ chart
  const chart = new PriceChart($('chart-host'), app);
  V.chart = {
    gap: 120, visible: panelVisible('chart'),
    render() {
      const s = app.settings, sym = s.main, q = app.feed.quote(sym);
      setText($('ch-sym'), sym);
      setText($('ch-last'), q ? fmtPrice(q.last) : '—');
      const chg = $('ch-chg');
      setText(chg, q ? `${q.chg >= 0 ? '+' : ''}${q.chg.toFixed(2)}  ${fmtPct(q.pct)}` : ' ');
      setClass(chg, 'mono chg ' + (q ? cls(q.chg) : 'flat'));
      setText($('ch-hl'), q && q.high != null ? `H ${fmtPrice(q.high)}  L ${fmtPrice(q.low)}${q.ext != null ? `  ext ${fmtPrice(q.ext)}` : ''}` : ' ');
      for (const b of $('ch-tf').children) b.classList.toggle('on', b.dataset.iv === s.interval);
      for (const b of $('ch-show').children) { const on = !!s.show[b.dataset.show]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
      const note = $('ch-note'), mode = app.feed.status.mode;
      setText(note, mode === 'demo' ? 'Demo data, not real prices' : mode === 'delayed' && !app.feed.bridgeLive ? 'Delayed about 15 min' : '');
      setClass(note, 'chart-note' + (mode === 'demo' ? '' : ' quiet'));
      chart.draw();
    },
  };
  $('ch-prev').addEventListener('click', () => app.cycleSymbol(-1));
  $('ch-next').addEventListener('click', () => app.cycleSymbol(1));
  $('ch-tf').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) app.setTimeframe(b.dataset.iv); });
  $('ch-show').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) app.toggleShow(b.dataset.show); });
  $('ch-deep').addEventListener('click', () => app.openDeepDive());
  $('ch-tv').addEventListener('click', () => app.openTradingView());

  // ------------------------------------------------------------ GEX levels
  V.levels = {
    gap: 400, visible: panelVisible('levels'),
    render() {
      const sym = app.settings.main, lv = app.levelsFor(sym), q = app.feed.quote(sym);
      setText($('h-lv'), `GEX levels · ${sym}`);
      const rowsEl = $('lv-rows');
      if (!lv) {
        rowsEl.innerHTML = `<p class="lv-empty">Loading levels for ${esc(sym)}… They come from your morning GEX refresh, or live from the options chain.</p>`;
        setText($('lv-regime'), ' '); setText($('lv-src'), ' ');
        return;
      }
      const rows = [['cw', 'Call wall', 'var(--up)'], ['zg', 'Gamma flip', 'var(--amber)'], ['pw', 'Put wall', 'var(--down)']].filter(r => lv[r[0]] != null).map(r => ({ k: r[0], name: r[1], col: r[2], v: lv[r[0]] }));
      if (q) rows.push({ k: 'px', name: 'Price', col: 'var(--sky)', v: q.last });
      rows.sort((a, b) => b.v - a.v);
      rowsEl.innerHTML = rows.map(r => {
        const d = q && r.k !== 'px' ? ((r.v - q.last) / q.last) * 100 : null;
        return `<div class="lv-row${r.k === 'px' ? ' px' : ''}"><i style="background:${r.col}"></i><span>${r.name}</span><b>${fmtPrice(r.v)}</b><em class="${d != null && Math.abs(d) < 0.15 ? 'near' : ''}">${d == null ? '' : (d >= 0 ? '+' : '') + d.toFixed(2) + '%'}</em></div>`;
      }).join('');
      setText($('lv-regime'), lv.zg != null && q ? (q.last >= lv.zg ? 'Positive gamma: moves tend to get dampened' : 'Negative gamma: moves tend to extend') : lv.regime ? `${lv.regime} gamma` : ' ');
      const src = $('lv-src');
      setText(src, levelSourceLabel(lv) + (lv.near?.expiry && (lv.near.cw != null || lv.near.pw != null) ? ` · 0DTE walls ${lv.near.cw ?? '—'}/${lv.near.pw ?? '—'}` : ''));
      setClass(src, 'lv-src' + (lv.source === 'demo' ? ' demo' : ''));
    },
  };

  // ------------------------------------------------------------ lead / lag
  V.leadlag = {
    gap: 1000, visible: panelVisible('leadlag'),
    render() {
      const series = leadLagSeries(app);
      $('ll-legend').innerHTML = series.map(sr => `<span style="color:${LL_COLORS[sr.sym]}">${sr.sym}<b class="${sr.now == null ? 'flat' : cls(sr.now)}">${sr.now == null ? '—' : fmtPct(sr.now)}</b></span>`).join('');
      drawLeadLag($('ll-canvas'), series);
      const ranked = series.filter(x => x.now != null).sort((a, b) => b.now - a.now), msg = $('ll-msg');
      if (ranked.length === 3) {
        const spread = ranked[0].now - ranked[2].now;
        setText(msg, spread < 0.15 ? 'Moving together, no clear leader' : `${ranked[0].sym} leading ${ranked[2].sym} by ${spread.toFixed(2)}%`);
        msg.style.color = spread < 0.15 ? '' : LL_COLORS[ranked[0].sym];
      } else setText(msg, ' ');
    },
  };
  new ResizeObserver(() => { app.markDirty('leadlag'); for (const k of Object.keys(wRev)) delete wRev[k]; app.markDirty('watch'); }).observe($('p-leadlag'));

  // ------------------------------------------------------------ risk breaker
  $('r-check').innerHTML = CHECKS.map((c, i) => `<button type="button" data-i="${i}" aria-pressed="false">${c}</button>`).join('');
  V.risk = {
    gap: 100, visible: panelVisible('risk'),
    render() {
      const day = app.day, r = app.settings.risk, rs = app.riskState();
      const st = $('r-state');
      setText(st, rs.state === 'tripped' ? 'Done for today' : rs.state === 'cooldown' ? `Cooldown ${fmtMMSS(rs.cooldownLeft)}` : 'Armed, trading allowed');
      setClass(st, 'pill ' + (rs.state === 'tripped' ? 'risk' : rs.state === 'cooldown' ? 'alert' : 'good'));
      const pnl = $('r-pnl'); setText(pnl, fmtMoney(day.pnl, true)); setClass(pnl, 'mono big ' + cls(day.pnl));
      setText($('r-trades'), `${day.trades.length} trade${day.trades.length === 1 ? '' : 's'} logged`);
      const used = Math.min(1, rs.used / (r.maxDailyLoss || 1)), bar = $('r-bar');
      bar.style.width = (used * 100).toFixed(1) + '%';
      bar.style.background = used > 0.75 ? 'var(--down)' : used > 0.5 ? 'var(--amber)' : 'var(--up)';
      setText($('r-limit'), `Loss limit ${fmtMoney(rs.used)} of ${fmtMoney(r.maxDailyLoss)} · ${fmtMoney(rs.room)} of room`);
      const dots = $('r-dots');
      if (dots.children.length !== r.maxConsecLosses) dots.innerHTML = '<i></i>'.repeat(r.maxConsecLosses);
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i < day.consec));
      setText($('r-cool'), `cooldown after ${r.maxConsecLosses}`);
      const amt = $('r-amt'); if (document.activeElement !== amt) amt.value = fmtMoney(day.step);
      setText($('r-win'), `Win +${fmtMoney(day.step)}`); setText($('r-loss'), `Loss −${fmtMoney(day.step)}`);
      $('r-undo').disabled = !day.trades.length;
      setText($('r-size-sub'), `risk ${fmtMoney(rs.riskPerTrade)} (${r.riskPct}%), stop ${r.stopPct}%`);
      setText($('r-prem'), '$' + day.premium.toFixed(2));
      const lock = rs.state !== 'armed', wait = !lock && rs.checklistScore < 3;
      setText($('r-max'), lock ? 'Locked' : wait ? 'Wait' : `Max ${rs.contracts}`);
      setText($('r-max-sub'), lock ? 'breaker active' : wait ? `setup ${rs.checklistScore} of 4 checked` : rs.contracts === 1 ? 'contract at this premium' : 'contracts at this premium');
      setClass($('r-max').parentElement, 'r-max' + (lock ? ' lock' : wait ? ' wait' : ''));
      [...$('r-check').children].forEach((b, i) => { b.classList.toggle('on', !!day.checklist[i]); b.setAttribute('aria-pressed', !!day.checklist[i]); });
    },
  };
  $('r-amt-dn').addEventListener('click', () => app.setStep(-1));
  $('r-amt-up').addEventListener('click', () => app.setStep(1));
  $('r-amt').addEventListener('focus', (e) => { e.target.value = String(app.day.step); e.target.select(); });
  const commitAmt = () => { const v = parseFloat($('r-amt').value.replace(/[^0-9.]/g, '')); if (v > 0) app.setStepValue(v); app.markDirty('risk'); };
  $('r-amt').addEventListener('change', commitAmt);
  $('r-amt').addEventListener('blur', () => { commitAmt(); $('r-amt').value = fmtMoney(app.day.step); });
  $('r-amt').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('r-win').addEventListener('click', () => app.logTrade(app.day.step));
  $('r-loss').addEventListener('click', () => app.logTrade(-app.day.step));
  $('r-undo').addEventListener('click', () => app.undoTrade());
  $('r-prem-dn').addEventListener('click', () => app.setPremium(-1));
  $('r-prem-up').addEventListener('click', () => app.setPremium(1));
  $('r-check').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) app.toggleCheck(+b.dataset.i); });

  // ------------------------------------------------------------ today's plan
  const tempClass = (t) => !t ? '' : t.label === 'Hot' ? 'risk' : t.label === 'Warm' ? 'alert' : t.label === 'Calm' ? 'cool' : 'good';
  let tdKey = '';
  V.today = {
    gap: 400, visible: panelVisible('today'),
    render() {
      const p = app.day.plan, t = app.temp, d = app.day;
      const pill = $('td-temp');
      pill.hidden = !t; if (t) { setText(pill, `${t.label} · ${t.bias}`); setClass(pill, 'pill ' + tempClass(t)); }
      const sig = app.signals[0];
      const key = JSON.stringify([p, t && [t.label, t.bias, t.at], d.pnl, d.goalHit, d.signals, sig && sig.at, app.tempLoading, !!ind.awaiting]);
      if (key === tdKey) return; tdKey = key;
      const tempLine = t ? `<p class="td-temp"><b>${esc(t.label)}, ${esc(t.bias)} lean.</b> ${esc(t.advice)}${t.demo ? ' (demo data)' : ''}</p>` : app.tempLoading ? '<p class="td-temp">Reading the market…</p>' : '';
      if (!p) {
        $('td-body').innerHTML = `<div class="td">
          <p class="td-lead">No plan yet today. INDAI reads the market, asks three questions, then sets your risk and alerts to match.</p>
          ${tempLine}
          <div class="td-actions"><button type="button" class="btn primary" data-act="startday">${ind.awaiting ? 'Continue the check-in' : 'Start my day'}</button><button type="button" class="btn" data-act="plan">Set it by hand</button></div></div>`;
        return;
      }
      const bp = buildPlan(p), prog = p.goal > 0 ? Math.max(0, Math.min(1, d.pnl / p.goal)) : 0;
      $('td-body').innerHTML = `<div class="td">
        <div class="td-nums"><div><span>Start</span><b>${fmtMoney(p.capital)}</b></div><div><span>Goal</span><b>${fmtMoney(p.goal)}</b></div><div><span>Style</span><b class="s">${esc(PROFILES[p.aggr].label)}</b></div></div>
        <div class="td-goal"><div class="bar"><i style="width:${(prog * 100).toFixed(1)}%;${d.goalHit ? 'background:var(--up)' : ''}"></i></div><p>${d.goalHit ? `Goal hit: ${fmtMoney(d.pnl, true)} today` : d.pnl > 0 ? `${fmtMoney(d.pnl, true)} of ${fmtMoney(p.goal)} · ${fmtMoney(Math.max(0, p.goal - d.pnl))} to go` : `${fmtMoney(d.pnl, true)} so far · about ${bp.winsNeeded ?? '—'} good trade${bp.winsNeeded === 1 ? '' : 's'} at ${bp.rr}:1 gets there`}</p></div>
        <p class="td-rule">Risk ${fmtMoney(bp.riskPerTrade)} a trade, breaker at −${fmtMoney(bp.maxLoss)}. Alerting on ${p.strategies.map(k => STRATEGIES[k].short).join(', ')} setups scoring ${bp.minScore}+${d.signals ? ` · ${d.signals} alert${d.signals === 1 ? '' : 's'} today` : ''}.</p>
        ${tempLine}
        <div class="td-actions"><button type="button" class="btn" data-act="plan">Edit plan</button><button type="button" class="btn" data-act="retemp">Re-check market</button><button type="button" class="btn" data-act="practice">Practice alert</button></div></div>`;
    },
  };

  // ------------------------------------------------------------ INDAI conversation
  const log = $('i-log'), form = $('i-form'), input = $('i-input');
  let lastMsg = null, pinKey = '';
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  // Stay on the newest line unless the person scrolled up to read, including when a card above the log
  // appears and makes the log shorter.
  let atBottom = true;
  log.addEventListener('scroll', () => { atBottom = nearBottom(); }, { passive: true });
  new ResizeObserver(() => { if (atBottom) log.scrollTop = log.scrollHeight; }).observe(log);
  function appendMsgs() {
    const msgs = ind.log;
    let i = lastMsg ? msgs.indexOf(lastMsg) : -1;
    if (lastMsg && i < 0) { log.textContent = ''; i = -1; }
    if (i === msgs.length - 1) return;
    const stick = atBottom || msgs[msgs.length - 1].kind === 'you';
    const frag = document.createDocumentFragment();
    for (let k = i + 1; k < msgs.length; k++) {
      const m = msgs[k], d = document.createElement('div');
      d.className = `msg ${m.kind}${/^[•✓✗]/.test(m.text) ? ' small' : ''}`;
      d.textContent = m.text;
      frag.appendChild(d);
    }
    log.appendChild(frag);
    while (log.children.length > 80) log.firstChild.remove();
    lastMsg = msgs[msgs.length - 1];
    if (stick) { log.scrollTop = log.scrollHeight; atBottom = true; }
  }
  function pinCard() {
    const an = app.analysis, sig = app.signals[0], pin = $('i-pin');
    const showSig = sig && Date.now() - sig.at < 20 * 60e3 && (!an || sig.at > an.at);
    let key = '', html = '', kind = '';
    if (ind.awaiting) {
      const d = app.planDraft, step = ind.awaiting, cap = app.settings.risk.account || 2000;
      const money = (v) => `<button type="button" class="btn" data-say="${v}">${fmtMoney(v)}</button>`;
      const opts = step === 'capital' ? [...new Set([1000, cap, 2000, 5000])].sort((a, b) => a - b).slice(0, 4).map(money).join('')
        : step === 'goal' ? [0.02, 0.03, 0.05].map(f => money(Math.max(10, Math.round(d.capital * f / 10) * 10))).join('')
        : ['Conservative', 'Balanced', 'Aggressive'].map(k => `<button type="button" class="btn" data-say="${k.toLowerCase()}">${k}</button>`).join('');
      const q = step === 'capital' ? 'How much are you starting with today?' : step === 'goal' ? `Starting with ${fmtMoney(d.capital)}. What is the minimum goal?` : `Goal ${fmtMoney(d.goal)}. How aggressive today?`;
      key = 'ask:' + step + d.capital + d.goal; kind = 'gold';
      html = `<div class="pin-top"><span class="pill">Check-in · ${step === 'capital' ? 1 : step === 'goal' ? 2 : 3} of 3</span></div><h3>${esc(q)}</h3><p>Tap an answer, type one, or say it.</p><div class="pin-actions">${opts}</div><div class="pin-actions"><button type="button" class="btn quiet" data-act="plan">Set it by hand</button><button type="button" class="btn quiet" data-act="notnow">Not now</button></div>`;
    } else if (showSig) {
      const k = sig.contract; kind = sig.dir > 0 ? 'good' : 'risk';
      key = 'sig:' + sig.at + sig.sym;
      html = `<div class="pin-top"><span class="pill ${kind}">${sig.practice ? 'Practice · ' : ''}${sig.type === 'C' ? 'Call' : 'Put'} setup · ${sig.score}</span><time>${timeET(sig.at)}</time></div><h3>${esc(sig.sym)} · ${esc(sig.title)}</h3><p class="mono">${k ? `${k.strike}${sig.type} ${k.expiry.slice(5)} ≈ $${k.premium.toFixed(2)} × ${k.qty} · ` : ''}stop ${sig.stop} · target ${sig.target}</p><div class="pin-actions"><button type="button" class="btn" id="pin-an">Analyze</button><button type="button" class="btn quiet" id="pin-skip">Skip</button></div>`;
    } else if (an) {
      const rag = an.final?.rag || an.score.rag; kind = RAG_CLASS[rag] || '';
      const line = an.final?.headline || (an.score.gate ?? (an.score.cons[0] ? `Watch out: ${an.score.cons[0].name.toLowerCase()}` : an.score.pros[0] ? `Supporting: ${an.score.pros[0].name.toLowerCase()}` : ''));
      key = 'an:' + an.at + rag + !!an.final + an.pendingAI;
      html = `<div class="pin-top"><span class="pill ${kind}">${esc(rag)}</span><span class="r">${an.score.score}/100${an.final ? ' · with research' : an.pendingAI ? ' · researching…' : ''}</span></div><h3>${esc(ideaLabel(an.idea))}</h3><p>${esc(line)}</p><div class="pin-actions"><button type="button" class="btn" data-act="details">Details</button><button type="button" class="btn" data-act="calc">Calculator</button></div>`;
    }
    if (key === pinKey) return; pinKey = key;
    pin.hidden = !key; pin.className = 'pin ' + kind; pin.innerHTML = html;
    if (showSig && !ind.awaiting) {
      $('pin-an').onclick = () => ind.analyzeSignal(sig);
      $('pin-skip').onclick = () => { sig.at = 0; app.markDirty('indai'); };
    }
  }
  V.indai = {
    gap: 60, visible: () => !document.hidden && (app.layout !== 'phone' || (app.tab === 'indai' && !app.focus)),
    render() {
      const vs = ind.voice.state;
      const [st, c] = vs.listening ? ['Listening…', 'pill listen'] : vs.transcribing ? ['Understanding…', 'pill think'] : ind.thinking ? [ind.thinking, 'pill think'] : vs.speaking ? ['Speaking', 'pill good'] : ['Ready', 'pill'];
      setText($('i-state'), st); setClass($('i-state'), c);
      const loads = [];
      if (vs.ttsLoad != null) loads.push(`voice ${vs.ttsLoad}%`);
      if (vs.sttLoad != null) loads.push(`listening model ${vs.sttLoad}%`);
      const ld = $('i-loads'); ld.hidden = !loads.length; if (loads.length) setText(ld, `Downloading ${loads.join(' · ')} (first time only)`);
      const heard = $('i-heard'), showHeard = (vs.listening || vs.transcribing);
      heard.hidden = !showHeard; if (showHeard) setText(heard, vs.heard ? `“${vs.heard}…` : vs.transcribing ? 'Understanding…' : 'Listening… go ahead');
      pinCard();
      appendMsgs();
    },
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); const t = input.value; input.value = ''; form.classList.remove('has-text'); app.send(t); });
  input.addEventListener('input', () => form.classList.toggle('has-text', !!input.value.trim()));
  $('i-mic').addEventListener('click', () => app.talk());
  $('fab').addEventListener('click', () => app.talk());
  $('i-mute').addEventListener('click', () => app.toggleMute());

  // mic buttons, mute icon, unread dot, listening caption: cheap, always current
  const fab = $('fab'), imic = $('i-mic');
  let meter = 0;
  function runMeter() {
    if (meter) return;
    const step = () => {
      const vs = ind.voice.state;
      if (!vs.listening) { meter = 0; fab.style.removeProperty('--lvl'); return; }
      fab.style.setProperty('--lvl', Math.min(1, (ind.voice.level || 0) * 12).toFixed(2));
      meter = requestAnimationFrame(step);
    };
    meter = requestAnimationFrame(step);
  }
  V.dock = {
    render() {
      const vs = ind.voice.state;
      const state = vs.listening ? 'listening' : vs.transcribing || ind.thinking ? 'busy' : vs.speaking ? 'speaking' : '';
      for (const b of [fab, imic]) {
        setClass(b, (b === fab ? 'fab ' : 'mic ') + state);
        const use = b.querySelector('use'), icon = vs.listening ? '#ic-stop' : '#ic-mic';
        if (use.getAttribute('href') !== icon) use.setAttribute('href', icon);
        b.setAttribute('aria-label', vs.listening ? 'Stop listening' : vs.speaking ? 'Talk to INDAI (stops her speaking)' : 'Talk to INDAI');
        b.disabled = !ind.voice.canListen;
      }
      if (vs.listening) runMeter();
      const mute = $('i-mute'), mu = mute.querySelector('use'), mi = ind.muted ? '#ic-mute' : '#ic-sound';
      if (mu.getAttribute('href') !== mi) mu.setAttribute('href', mi);
      mute.setAttribute('aria-pressed', ind.muted); mute.setAttribute('aria-label', ind.muted ? "Turn INDAI's voice on" : "Mute INDAI's voice"); mute.title = ind.muted ? 'Voice is off' : 'Voice is on';
      $('tab-dot').hidden = !(unseen && app.layout === 'phone' && app.tab !== 'indai');
      // while listening away from the conversation, show what she is hearing
      if ((vs.listening || vs.transcribing) && !talkVisible()) {
        cap.textContent = vs.heard ? `“${vs.heard}…` : vs.transcribing ? 'Understanding…' : 'Listening… go ahead'; cap.className = 'listen'; cap.hidden = false; capMode = 'listen';
      } else if (capMode === 'listen') hideCap();
      else if (capMode === 'msg' && talkVisible()) hideCap();
    },
  };

  // ------------------------------------------------------------ More (phone)
  let deferredInstall = null;
  function installApp() {
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.catch(() => {}).finally(() => { deferredInstall = null; $('t-install').hidden = true; app.markDirty('more'); }); return; }
    app.toast(app.platform.iOS ? 'In Safari, tap Share, then “Add to Home Screen”.' : 'Use your browser menu and choose “Install app” or “Add to Home screen”.');
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('t-install').hidden = false; app.markDirty('more'); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; $('t-install').hidden = true; app.markDirty('more'); });
  let moreKey = '';
  V.more = {
    gap: 500, visible: panelVisible('more'),
    render() {
      const sym = app.settings.main, br = app.feed.status.tvAt, tv = app.tvAlerts.length;
      const bridge = app.feed.status.mode === 'demo' ? 'Off while on demo data' : app.feed.bridgeLive ? `Live, last candle ${timeET(br)}` : br ? `Quiet since ${timeET(br)}` : 'Not connected yet. Set it up in Settings';
      const items = [
        ['calc', 'Options profit calculator', 'Payoff, breakevens and a price by time grid'],
        ['deep', `Deep dive on ${sym}`, 'Trend, flow, unusual activity and headlines'],
        ['summary', 'Everything at a glance', 'Watchlist, breaker and the last rating on one screen'],
        ['selftest', 'Run a self-test', 'Checks data, options chain, voice, mic and alerts'],
        ['practice', 'Play a practice alert', 'Replays the best setup from the last session'],
        ['tv', `Open ${sym} in TradingView`, `Bridge: ${bridge}${tv ? ` · ${tv} alert${tv === 1 ? '' : 's'} in two days` : ''}`],
        ['mute', ind.muted ? 'Turn INDAI\'s voice on' : 'Mute INDAI\'s voice', ind.muted ? 'She answers in text only' : 'She speaks her answers out loud'],
        ['settings', 'Settings', 'Watchlist, data, risk, voice, research, alerts'],
      ];
      if (!app.platform.standalone) items.push(['install', 'Install INDAI on this device', app.platform.iOS ? 'Share, then Add to Home Screen' : 'Opens full screen like an app']);
      const key = JSON.stringify(items);
      if (key === moreKey) return; moreKey = key;
      $('more-list').innerHTML = items.map(([act, title, sub]) => `<button type="button" data-act="${act}"><b>${esc(title)}</b><span>${esc(sub)}</span><svg><use href="#ic-right"/></svg></button>`).join('');
    },
  };

  ui.showTab('chart');
  return ui;
}
