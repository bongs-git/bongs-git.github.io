// Trade ideas (INDAI's setup alerts) get a place of their own on the website, so they are seen the moment they
// land and are easy to find again afterwards:
//   - a strip under the top bar on every screen: the newest ideas as chips, a setup that is still forming,
//     and what the scanner is doing when there is nothing yet
//   - the Ideas list: today's ideas with the reasons, the sized contract, what price has done since,
//     and one tap to rate it or to see it on the chart with its entry, stop and target
//   - a card that slides in when a new idea lands while the conversation is not on screen
//   - a short chime the instant it lands (the spoken line follows a moment later)
// The engine (scan, catch-up, forming, the day's list) is in app.js; this file only shows it.
import { marketStatus } from './market.js';
import { STRATEGIES } from './signals.js';
import { fmtPrice, fmtMoney } from './hud.js';
import { $, esc } from './views.js';
import { relay } from './relay.js';
import { etParts } from './market.js';
import { retroHtml, retroQuestion, dayFacts, dayIsOver } from './retro.js';

const timeET = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const age = (ms) => { const s = Math.max(0, Date.now() - ms) / 1000; return s < 50 ? 'now' : s < 3570 ? `${Math.max(1, Math.round(s / 60))}m` : timeET(ms).replace(/\s?([AP])M/, (m, a) => a.toLowerCase()); };
const grade = (s) => (s.score >= 80 ? 'A-plus' : s.score >= 70 ? 'strong' : 'decent');
const side = (s) => (s.type === 'C' ? 'call' : 'put');
const contractLine = (s) => { const k = s.contract; return k ? `${k.strike}${s.type} ${k.expiry.slice(5)} ≈ $${k.premium.toFixed(2)} × ${k.qty}` : ''; };
const STATE = { open: 'open', target: 'hit target', stopped: 'stopped out', forming: 'forming' };

export function initIdeas(app) {
  const V = app.views, ind = app.indai;
  const bar = $('ideas'), row = $('ideas-row'), nEl = $('ideas-n');
  // newest confirmed ideas first, then anything still forming, then the rest of the day
  const all = () => { const now = Date.now(), fresh = app.signals.filter(s => now - s.at < 3 * 60e3); return [...fresh, ...Object.values(app.forming), ...app.signals.filter(s => now - s.at >= 3 * 60e3)]; };
  let pingId = null, pingUntil = 0;

  // ------------------------------------------------------------ what the scanner is doing
  function scanState() {
    const ms = marketStatus(), demo = app.feed.status.mode === 'demo', rs = app.riskState().state, n = app.settings.symbols.length;
    const p = app.day.plan && app.day.goalHit && app.activePlan().afterGoal === 'stop';
    if (rs !== 'armed') return ['paused', `Alerts paused: breaker ${rs === 'tripped' ? 'tripped' : 'on cooldown'}`];
    if (p) return ['paused', 'Goal hit: alerts are off for the day'];
    if (ms.state !== 'open' && !(demo && app.settings.demoSignals)) return ['off', ms.state === 'pre' ? 'Scanning starts at the open' : 'Market closed. Setups show here'];
    return ['on', `Scanning ${n} ticker${n === 1 ? '' : 's'} · none yet today`];
  }

  // ------------------------------------------------------------ the strip
  let barKey = '';
  V.ideabar = {
    gap: 250, visible: () => !document.hidden,
    render() {
      const list = all().slice(0, 14), [scan, text] = scanState();
      const count = app.signals.filter(s => !s.practice).length;
      const chips = list.map((s) => {
        const o = app.ideaOutcome(s), fresh = !s.forming && o.state === 'open' && Date.now() - s.at < 5 * 60e3;
        const mark = s.forming ? 'forming' : o.state === 'target' ? '✓' : o.state === 'stopped' ? '✕' : '';
        const cls = ['ichip', s.dir > 0 ? 'up' : 'down', fresh ? 'fresh' : '', s.id === pingId && Date.now() < pingUntil ? 'ping' : '', s.forming ? 'forming' : '', o.state !== 'open' && !s.forming ? 'done' : '', s.quiet ? 'quiet' : ''].filter(Boolean).join(' ');
        const label = `${s.sym} ${side(s)} setup${s.forming ? ', forming' : `, score ${s.score}`}, ${s.title}${s.practice ? ', practice' : ''}`;
        return `<button type="button" class="${cls}" data-id="${esc(s.id)}" aria-label="${esc(label)}"><i class="arr"></i><b>${esc(s.sym)}</b><span class="sc">${s.score}</span><span class="tt">${esc(s.practice ? 'practice · ' + s.title : s.title)}</span>${mark ? `<span class="mk">${mark}</span>` : ''}<time>${s.forming ? timeET(s.confirmAt).replace(/\s?[AP]M/, '') : age(s.at)}</time></button>`;
      }).join('');
      // while alerts are off (breaker, or the goal is hit and the plan says stop) say so in front of the day's chips
      const retroChip = dayOver() && (count || app.retro.banked(etParts().ymd)) ? '<button type="button" class="ichip retro" data-retro="open" aria-label="Open today\'s retrospective">Retrospective</button>' : '';
      const html = chips ? retroChip + (scan === 'paused' ? `<span class="ideas-empty paused">${esc(text.split(':')[0])}</span>` : '') + chips : `<span class="ideas-empty">${esc(text)}</span>`;
      const key = html + '|' + scan + count;
      if (key === barKey) return; barKey = key;
      row.innerHTML = html;
      bar.dataset.scan = scan;
      nEl.hidden = !count; nEl.textContent = count;
    },
  };
  row.addEventListener('click', (e) => { const b = e.target.closest('.ichip'); if (!b) return; if (b.dataset.retro) app.openRetro(); else app.openIdeas(b.dataset.id); });
  $('ideas-all').addEventListener('click', () => app.openIdeas());

  // ------------------------------------------------------------ the list
  const body = $('sb-ideas');
  let listKey = '', holdUntil = 0;
  body.addEventListener('pointerdown', () => { holdUntil = Date.now() + 700; });
  function card(s, open) {
    const o = app.ideaOutcome(s), k = s.contract, up = s.dir > 0;
    const when = s.forming ? `confirms ${timeET(s.confirmAt)} if the candle closes this way` : `${timeET(s.at)}${Date.now() - s.at < 3570e3 ? ' · ' + (age(s.at) === 'now' ? 'just now' : age(s.at) + ' ago') : ''}`;
    const tag = s.forming ? 'Forming' : s.practice ? 'Practice' : s.quiet === 'earlier' ? 'Earlier today' : s.quiet === 'cap' ? 'Over your hourly alert limit' : '';
    const head = `<button type="button" class="idea-head" data-toggle="${esc(s.id)}" aria-expanded="${open}">
      <span class="pill ${up ? 'good' : 'risk'}">${up ? 'Call' : 'Put'} · ${s.score}</span><b>${esc(s.sym)}</b><span class="tt">${esc(s.title)}</span>
      <span class="st ${o.state}">${STATE[o.state]}</span><time>${s.forming ? 'now' : age(s.at)}</time></button>`;
    if (!open) return `<article class="idea ${up ? 'up' : 'down'} ${s.forming ? 'forming' : ''}" data-id="${esc(s.id)}">${head}</article>`;
    // where price is between the stop and the target
    const pos = Math.round((o.prog >= 0 ? 0.36 + o.prog * 0.64 : 0.36 + o.prog * 0.36) * 100);
    const moved = o.move == null ? '' : `${o.move >= 0 ? '+' : ''}${o.move.toFixed(2)}% ${o.move >= 0 ? 'your way' : 'against'}`;
    const nowLine = o.last == null ? 'Waiting for a price' : s.forming ? `${esc(s.sym)} is ${fmtPrice(o.last)}. Not confirmed yet.`
      : o.state === 'target' ? `Reached the target at ${timeET(o.at + 60e3)}. Now ${fmtPrice(o.last)}.`
      : o.state === 'stopped' ? `Hit the stop at ${timeET(o.at + 60e3)}. Now ${fmtPrice(o.last)}.`
      : `Now ${fmtPrice(o.last)} · ${moved} · neither stop nor target reached yet`;
    return `<article class="idea open ${up ? 'up' : 'down'} ${s.forming ? 'forming' : ''}" data-id="${esc(s.id)}">${head}
      <div class="idea-body">
        <p class="when">${tag ? `<b>${esc(tag)}</b> · ` : ''}${esc(when)} · ${esc(grade(s))} ${esc(STRATEGIES[s.strat]?.short || s.strat)} setup${s.demo ? ' · demo data' : ''}</p>
        ${s.learned ? `<p class="when learned">Scored ${s.raw.score} by the scanner, ${s.score} after what she has learned: ${esc(s.learned.map(l => `${l.label.replace(/\s*\(.*?\)$/, '')} ${l.pts > 0 ? '+' : '−'}${Math.abs(l.pts)}`).join(', '))}.</p>` : ''}
        ${app.marketData.optionNote(s.sym) ? `<p class="note warn">${esc(app.marketData.optionNote(s.sym))} Contract values below are estimates.</p>` : ''}
        ${k ? `<p class="mono k">${esc(contractLine(s))} <span>risk about ${fmtMoney(k.risk)}${k.overBudget ? ', over your per-trade risk' : ''}</span></p>` : ''}
        ${k && !s.demo && app.settings.researchPass ? `<p class="k"><a href="./trade.html?u=${encodeURIComponent(s.sym)}&e=${encodeURIComponent(k.expiry)}&t=${s.type === 'P' ? 'P' : 'C'}&k=${encodeURIComponent(k.strike)}&q=${encodeURIComponent(k.qty)}" style="color:inherit;text-decoration:underline">Open this contract in Trade</a></p>` : ''}
        <div class="track ${o.state}" aria-hidden="true"><i class="zone-stop"></i><i class="zone-go"></i><i class="entry"></i><i class="now" style="left:${Math.max(1, Math.min(99, pos))}%"></i></div>
        <div class="track-lbl mono"><span class="down">stop ${fmtPrice(s.stop)}</span><span>entry ${fmtPrice(s.price)}</span><span class="up">target ${fmtPrice(s.target)}</span></div>
        <p class="nowl">${nowLine}</p>
        <ul class="why">${s.why.slice(0, 4).map(w => `<li>${esc(w)}</li>`).join('')}${s.against.slice(0, 3).map(w => `<li class="con">${esc(w)}</li>`).join('')}</ul>
        <div class="pin-actions"><button type="button" class="btn primary" data-do="analyze">${s.forming ? 'Analyze now' : 'Analyze'}</button><button type="button" class="btn" data-do="chart">Show on chart</button></div>
      </div></article>`;
  }
  // ------------------------------------------------------------ retrospective (the engine and the screen's content are in retro.js)
  let rv = null, rvAt = 0, armed = '';
  const dayOver = () => dayIsOver();
  function renderRetro() {
    if (!rv || (!(rv.today && rv.today.final) && Date.now() - rvAt > 90e3)) { rv = app.retro.review(); rvAt = Date.now(); }
    const html = retroHtml(rv, armed);
    if (html === listKey) return; listKey = html;
    const top = body.scrollTop; body.innerHTML = html; body.scrollTop = top;
  }
  // the TradingView strategy is fetched ahead of the tap, because a phone only lets a page copy during the tap itself
  let pineText = '';
  const loadPine = () => { if (!pineText) fetch('./tradingview/indai-backtest.pine').then(r => (r.ok ? r.text() : '')).then(t => { pineText = t || ''; }).catch(() => {}); };
  async function copyText(text, done) {
    try { await navigator.clipboard.writeText(text); app.toast(done); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch {}
      ta.remove(); app.toast(ok ? done : 'Copying is blocked here. Open the script page and copy from there.');
    }
  }
  app.openRetro = () => { app.ideasView = 'retro'; rv = null; armed = ''; listKey = ''; holdUntil = 0; hideAlert(); body.scrollTop = 0; loadPine(); app.ui.openSheet('ideas'); };
  app.retroTalk = async (r) => {
    if (!r || !r.today || !r.today.recs.length) return;
    const f = dayFacts(r.today.recs);
    app.closeFocus(); if (app.layout === 'phone') app.ui.showTab('indai');
    app.inputMode = 'typed';
    ind.say('“Talk me through today’s retrospective.”', 'you', { speak: false });
    ind.setThinking('Thinking…');
    try {
      const res = await relay.brain({ mode: 'talk', name: app.settings.name, question: retroQuestion(r), history: [], search: false,
        context: { retrospective: { day: r.today.ymd, final: r.today.final, setups: f.all, missedMost: f.missed.map(g => ({ group: g.label, won: g.W, lost: g.L, R: g.R })), worked: f.worked.map(g => ({ group: g.label, won: g.W, lost: g.L, R: g.R })), stopOutsThatWentOnToTarget: f.stt, stopOuts: f.losses, nearMisses: f.near, pullbackEntry: f.pb, inForce: Object.values(r.tuning.labels || {}) } } }, app.settings.researchPass);
      ind.setThinking(null);
      const out = res.result || {};
      if (out.spoken) ind.say(out.spoken, 'info');
      for (const b of (out.summary || []).slice(0, 4)) ind.say('• ' + b, 'info', { speak: false });
    } catch (e) { ind.setThinking(null); ind.say(e.code === 'not_configured' ? 'My thinking brain is not available for that right now. The numbers are all in the retrospective.' : `I couldn't think that through just now (${e.message}).`, 'info', { speak: false }); }
  };
  V.ideas = {
    gap: 300, visible: () => app.focus === 'ideas',
    render() {
      if (Date.now() < holdUntil) { setTimeout(() => app.markDirty('ideas'), 720); return; }     // never rebuild under a finger
      $('st-ideas').textContent = app.ideasView === 'retro' ? 'Retrospective' : 'Trade ideas';
      if (app.ideasView === 'retro') { renderRetro(); return; }
      const list = all(), [, text] = scanState(), plan = app.activePlan();
      if (app.ideaOpen !== '' && !list.some(s => s.id === app.ideaOpen)) app.ideaOpen = list[0]?.id || null;      // '' = all closed on purpose
      const n = app.signals.filter(s => !s.practice).length;
      const tn = app.retro.tuning(), learnedN = Object.keys(tn.adj).length + (tn.minAdd ? 1 : 0) + (tn.stop !== 1 || tn.target !== 1 ? 1 : 0);
      const over = dayOver();
      const head = `<div class="retro-cta"><button type="button" class="btn ${over ? 'primary' : ''}" data-retro="open">Retrospective</button><span>${over ? 'The day is over. Go over how today’s ideas did and what to change.' : 'How today’s ideas have done so far. Best run after the close.'}</span></div>
        <p class="note ideas-how">${n ? `${n} idea${n === 1 ? '' : 's'} today, newest first.` : esc(text) + '.'} Alerting on ${esc(plan.strategies.map(x => STRATEGIES[x].short).join(', '))} setups scoring ${plan.minScore + tn.minAdd}+, up to ${plan.perHour} alerts an hour${learnedN ? `, with ${learnedN} thing${learnedN === 1 ? '' : 's'} she has learned from retrospectives applied` : ''}.</p>`;
      const cards = list.map(s => card(s, s.id === app.ideaOpen)).join('');
      const foot = '<p class="fine">A setup confirms when its 5-minute candle closes. “Forming” is an early look at the candle that is still open, and it can disappear. Stop and target are for the stock price. This is information, not financial advice.</p>';
      const html = head + `<div class="idea-list">${cards || '<p class="idea-none">Nothing yet. The moment a setup confirms it shows here, in the strip at the top, and INDAI says it.</p>'}</div>` + foot;
      if (html === listKey) return; listKey = html;
      const top = body.scrollTop;
      body.innerHTML = html; body.scrollTop = top;
      if (app._ideaScroll) { app._ideaScroll = false; body.querySelector('.idea.open')?.scrollIntoView({ block: 'nearest' }); }
    },
  };
  body.addEventListener('click', (e) => {
    const rb = e.target.closest('[data-retro]');
    if (rb) {
      const act = rb.dataset.retro; holdUntil = 0; listKey = '';
      if (act === 'open') { app.openRetro(); return; }
      if (act === 'copycode') { copyText(rb.dataset.code, 'Copied. Paste it into the strategy’s Changes setting in TradingView.'); return; }
      if (act === 'copyscript') { if (pineText) copyText(pineText, 'Script copied. Paste it into TradingView’s Pine Editor and save it.'); else window.open('./tradingview/', '_blank', 'noopener'); return; }
      if (act === 'back') { app.ideasView = 'list'; body.scrollTop = 0; }
      else if (act === 'apply' && rv) { app.retro.apply(rv.proposal); app.toast('Applied. She alerts with these from now on.'); rv = null; }
      else if (act === 'keep') { app.toast('Nothing changed'); app.ideasView = 'list'; body.scrollTop = 0; }
      else if (act === 'reset') { if (armed === 'reset') { app.retro.reset(); armed = ''; rv = null; app.toast('Cleared. She alerts as the scanner scores.'); } else { armed = 'reset'; setTimeout(() => { if (armed) { armed = ''; listKey = ''; app.markDirty('ideas'); } }, 5000); } }
      else if (act === 'talk') { app.retroTalk(rv); return; }
      V.ideas.render(); return;
    }
    const t = e.target.closest('[data-toggle]');
    if (t) { app.ideaOpen = app.ideaOpen === t.dataset.toggle ? '' : t.dataset.toggle; holdUntil = 0; listKey = ''; V.ideas.render(); return; }
    const b = e.target.closest('[data-do]'); if (!b) return;
    const s = app.ideaById(b.closest('.idea').dataset.id); if (!s) return;
    if (b.dataset.do === 'chart') app.showIdeaOnChart(s); else app.analyzeIdea(s);
  });
  const openIdeas = app.openIdeas;
  app.openIdeas = (id = null) => { app.ideasView = 'list'; if (id) { app.ideaOpen = id; app._ideaScroll = true; } listKey = ''; holdUntil = 0; hideAlert(); openIdeas(id); };

  // ------------------------------------------------------------ the card for a new idea
  const alertEl = $('idea-alert');
  let alertTimer = 0;
  function hideAlert() { alertEl.hidden = true; clearTimeout(alertTimer); }
  function showAlert(s) {
    const up = s.dir > 0, k = s.contract;
    alertEl.className = up ? 'up' : 'down';
    alertEl.innerHTML = `<button type="button" class="ia-main" data-do="open">
        <span class="pin-top"><span class="pill ${up ? 'good' : 'risk'}">${s.practice ? 'Practice · ' : ''}${up ? 'Call' : 'Put'} setup · ${s.score}</span><time>${timeET(s.at)}</time></span>
        <b>${esc(s.sym)} · ${esc(s.title)}</b>
        <span class="mono">${k ? esc(contractLine(s)) + ' · ' : ''}stop ${fmtPrice(s.stop)} · target ${fmtPrice(s.target)}</span></button>
      <div class="ia-actions"><button type="button" class="btn primary" data-do="analyze">Analyze</button><button type="button" class="btn" data-do="chart">Chart</button><button type="button" class="btn quiet" data-do="close" aria-label="Dismiss">Later</button></div>`;
    alertEl.dataset.id = s.id; alertEl.hidden = false;
    clearTimeout(alertTimer); alertTimer = setTimeout(hideAlert, 30000);
  }
  alertEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    const s = app.ideaById(alertEl.dataset.id); hideAlert();
    if (!s || b.dataset.do === 'close') return;
    if (b.dataset.do === 'analyze') app.analyzeIdea(s); else if (b.dataset.do === 'chart') app.showIdeaOnChart(s); else app.openIdeas(s.id);
  });

  // ------------------------------------------------------------ sound and touch
  // Two quick notes, rising for a call setup and falling for a put setup; a single soft tick for one that is forming.
  function chime(dir, soft = false) {
    if (ind.muted) return;
    try {
      const c = ind.voice.ctx; if (!c || c.state !== 'running') return;
      const t0 = c.currentTime + 0.01, notes = soft ? [880] : dir > 0 ? [659.25, 987.77] : [659.25, 440];
      notes.forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain(), t = t0 + i * 0.14;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(soft ? 0.04 : 0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + (soft ? 0.12 : 0.3));
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.34);
      });
    } catch {}
  }
  app.onIdea = (s) => {
    chime(s.dir);
    try { navigator.vibrate?.(s.dir > 0 ? [70, 50, 70] : [160]); } catch {}
    pingId = s.id; pingUntil = Date.now() + 2800; barKey = ''; app.markDirty('ideabar');
    row.scrollLeft = 0;
    // the conversation shows it as a pinned card when it is on screen; everywhere else, this card does
    if (!app.ui.talkVisible() && app.focus !== 'ideas') showAlert(s);
  };
  app.onForming = (s) => { chime(s.dir, true); row.scrollLeft = 0; };
  app.hideIdeaAlert = hideAlert;
}
