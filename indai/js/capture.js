// Capture and Analyze: draw a box around candles (or tap Analyze for the whole chart) and INDAI reads it.
//   1. The picture of the box and the candles inside it are taken from the chart (chart.js `captureBox`).
//   2. patterns.js reads them on the device straight away: TA-Lib candle patterns and the atlas's structure
//      proxies, shapes, trend, momentum, levels, the bull, bear and range paths, and which timeframes to look at.
//   3. INDAI's server adds what only it has: the atlas's tested numbers for each pattern found (`mode:"atlas"`)
//      and a written read of the picture (`mode:"capture"`). Until the server lists those modes in its status,
//      INDAI's conversation brain writes the read from the facts found here, without web search.
//   4. Every capture is kept on the device (candle-store.js) so it can be opened again after the close.
import { $, esc } from './views.js';
import { relay } from './relay.js';
import { researchBlocked } from './demo.js';
import { readCapture, summarize } from './patterns.js';
import { candleStore } from './candle-store.js';
import { TF_LABEL, TF_MS, TF_WORDS, isLong } from './timeframes.js';
import { fmtPrice } from './hud.js';

const timeOf = (t, tf) => new Date(t).toLocaleString('en-US', isLong(tf)
  ? { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }
  : { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const LIGHT = { GREEN: 'good', AMBER: 'alert', RED: 'risk', GREY: 'alert' };
const sideWord = (s) => (s > 0 ? 'long' : s < 0 ? 'short' : '—');
const p2 = (v) => (v == null || !Number.isFinite(v) ? '—' : fmtPrice(v));

export function initCapture(app) {
  const V = app.views;
  let cur = null;       // the capture on screen: { id, shot, r, read, atlas, status }
  let past = [];        // earlier captures on this device, newest first
  let renderKey = '';
  const refreshPast = async () => { past = await candleStore.captures(12); app.markDirty('capture'); };

  // ------------------------------------------------------------ taking a capture
  function run(shot, { open = true } = {}) {
    const sym = shot.sym, tf = shot.tf, all = app.tf.all(sym, tf);
    let i0 = all.findIndex(b => b.t >= shot.t0), i1 = -1;
    for (let i = all.length - 1; i >= 0; i--) if (all[i].t <= shot.t1) { i1 = i; break; }
    if (i0 < 0 || i1 < i0) { i0 = Math.max(0, all.length - 40); i1 = all.length - 1; }
    if (all.length < 3 || i1 - i0 < 2) {
      cur = { id: shot.at, shot, r: null, error: 'Draw the box around at least three candles.', status: {} };
      if (open) app.ui.openSheet('capture');
      app.markDirty('capture');
      return;
    }
    const lv = app.levelsFor ? app.levelsFor(sym) : null;
    const gex = lv ? { cw: lv.cw ?? null, pw: lv.pw ?? null, zg: lv.zg ?? null } : null;
    const r = readCapture(all, i0, i1, { tf, sym, gex });
    cur = { id: shot.at, shot, r, read: null, atlas: null, status: { read: 'working', atlas: 'working' } };
    if (open) app.ui.openSheet('capture');
    app.markDirty('capture');
    keep();
    ask(cur);
  }
  async function keep() {
    const c = cur;
    if (!c || !c.r) return;
    await candleStore.addCapture({ id: c.id, sym: c.shot.sym, tf: c.shot.tf, t0: c.r.t0, t1: c.r.t1, at: c.shot.at, image: c.shot.image, summary: summarize(c.r), lean: c.r.lean.word, read: c.read, atlas: c.atlas, whole: c.shot.whole });
    refreshPast();
  }

  // ------------------------------------------------------------ the server's part
  async function ask(c) {
    const summary = summarize(c.r), pass = app.settings.researchPass;
    let status = null;
    try { status = await relay.brainStatus(); } catch { /* treated as off below */ }
    const modes = (status && Array.isArray(status.modes)) ? status.modes : [];
    // the atlas's tested numbers for each pattern found, only from a server that offers them
    if (modes.includes('atlas') && c.r.notable.length) {
      // A box over a whole session can hold hundreds of patterns. The newest ones are the ones shown, so those are sent.
      relay.brain({ mode: 'atlas', op: 'scan', symbol: c.shot.sym, timeframe: c.shot.tf, intraday: c.r.intraday, patterns: summary.patterns.slice(-150) }, pass)
        .then(res => { c.atlas = (res && (res.reads || res.result?.reads)) || []; c.status.atlas = 'done'; })
        .catch(() => { c.status.atlas = 'failed'; })
        .finally(() => { app.markDirty('capture'); if (c === cur) keep(); });
    } else c.status.atlas = c.r.notable.length ? 'unavailable' : 'none';
    if (researchBlocked() || !status || status.configured === false) {
      c.status.read = 'off';
      app.markDirty('capture');
      return;
    }
    const question = `Read my chart capture: ${c.shot.sym} on the ${TF_WORDS[c.shot.tf]} chart, ${c.r.count} candles from ${timeOf(c.r.t0, c.shot.tf)} to ${timeOf(c.r.t1, c.shot.tf)}. `
      + 'Tell me what it shows, the bull and bear paths with their levels, and what to watch next. Use only the facts in context; do not invent probabilities.';
    try {
      let res;
      if (modes.includes('capture')) res = await relay.brain({ mode: 'capture', name: app.settings.name, symbol: c.shot.sym, timeframe: c.shot.tf, image: c.shot.image, capture: summary, question }, pass);
      else res = await relay.brain({ mode: 'talk', name: app.settings.name, question, history: [], search: false, session: 'capture', context: { capture: summary, note: 'Computed on the device from the candles inside the box. The atlas numbers are not attached here.' } }, pass);
      const out = res && res.result ? res.result : {};
      c.read = { spoken: out.spoken || out.headline || '', summary: Array.isArray(out.summary) ? out.summary.slice(0, 6) : [], by: modes.includes('capture') ? 'picture' : 'facts' };
      c.status.read = 'done';
    } catch (e) {
      c.status.read = 'failed'; c.readError = e.code === 'budget' ? "INDAI's daily thinking budget is used up." : e.code === 'rate_limited' ? 'Too many requests this hour; try again shortly.' : '';
    }
    app.markDirty('capture');
    if (c === cur) keep();
  }

  // ------------------------------------------------------------ looking again on another timeframe
  let rerunTimer = 0;
  function onTimeframe(tf) {
    if (!cur) return;
    app.setTimeframe(tf);
    app.closeFocus();
    if (app.layout === 'phone') app.ui.showTab('chart');
    const started = Date.now(), sym = app.settings.main;
    clearTimeout(rerunTimer);
    const wait = () => {
      const st = app.tf.state(sym, tf), ready = app.tf.bars(sym, tf).length && app.chart.geo && app.chart.geo.tf === tf && (!st || !st.busy);
      if (ready || Date.now() - started > 6000) { app.chart.analyzeView(); return; }
      rerunTimer = setTimeout(wait, 250);
    };
    rerunTimer = setTimeout(wait, 350);
  }

  // ------------------------------------------------------------ the sheet
  function patternsHtml(c) {
    const r = c.r;
    const common = Object.entries(r.commonCounts || {}).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ×${n}`).join(', ');
    const commonLine = common ? `<p class="note">Plain candle shapes on these candles (TA-Lib finds them on a large share of all candles; your book found no edge in them): ${esc(common)}.</p>` : '';
    if (!r.notable.length) return `<p class="note">No named candle pattern or atlas structure proxy fired on these candles.</p>${commonLine}`;
    const reads = new Map((c.atlas || []).map(a => [a.code + '|' + (a.at || ''), a]));
    const byCode = new Map((c.atlas || []).map(a => [a.code, a]));
    return `<ul class="cap-list">${r.notable.slice(-8).reverse().map(e => {
      const a = reads.get(e.code + '|' + new Date(e.t).toISOString()) || byCode.get(e.code);
      const light = a ? `<span class="cap-light ${LIGHT[a.light] || ''}">${esc(a.light)}</span>` : '';
      const nums = a && a.win != null ? `<span class="cap-nums">${(a.win * 100).toFixed(1)}% vs ${(a.base * 100).toFixed(1)}% base · n=${esc(a.n)}${a.cellKey ? ` · ${esc(a.cellKey)}` : ''}</span>` : '';
      return `<li><div class="cap-row"><b>${esc(e.name)}</b>${light}<span class="cap-side ${e.side > 0 ? 'up' : e.side < 0 ? 'down' : ''}">${sideWord(e.side)}</span></div>
        <div class="cap-sub">${esc(timeOf(e.t, r.tf))}${e.cell ? ` · atlas bin ${esc(e.cell)}` : ''}${e.neutral ? ' · neutral candle, scored as a fade of the trend' : ''}${e.also.length ? ` · also fired: ${esc(e.also.join(', '))}` : ''}</div>
        ${nums ? `<div class="cap-sub">${nums}${a.line ? ` — ${esc(a.line)}` : ''}</div>` : ''}
        <div class="cap-sub">${e.neutral ? `Decided by a break of ${p2(e.confirm)} or ${p2(e.fail)}` : `Confirms ${e.side > 0 ? 'above' : 'below'} ${p2(e.confirm)} · fails ${e.side > 0 ? 'below' : 'above'} ${p2(e.fail)}`}</div></li>`;
    }).join('')}</ul>
    ${r.notable.length > 8 ? `<p class="note">${r.notable.length - 8} earlier ones in the box are left out; draw a smaller box to see them.</p>` : ''}${commonLine}
    ${c.status.atlas === 'unavailable' ? '<p class="note">Your book\'s tested odds for these patterns appear here once INDAI\'s atlas service is switched on.</p>' : c.status.atlas === 'working' ? '<p class="note">Looking these up in your book…</p>' : c.status.atlas === 'failed' ? '<p class="note">The atlas lookup did not answer this time.</p>' : ''}`;
  }
  function render() {
    const body = $('sb-capture'), title = $('st-capture'), c = cur;
    const key = c ? [c.id, c.status.read, c.status.atlas, !!c.read, (c.atlas || []).length, past.length].join('|') : 'none|' + past.length;
    if (key === renderKey) return; renderKey = key;
    if (!c) {
      title.textContent = 'Capture';
      body.innerHTML = `<p class="empty">Tap <b>Analyze</b> over the chart, then drag a box around the candles you want read. A tap reads the whole chart.</p>${pastHtml()}`;
      return;
    }
    title.textContent = `Capture · ${c.shot.sym} ${TF_LABEL[c.shot.tf]}`;
    if (!c.r) { body.innerHTML = `<p class="empty">${esc(c.error || 'Nothing to read.')}</p>${pastHtml()}`; return; }
    const r = c.r, m = r.momentum;
    const lean = r.lean.word, leanCls = /bull/i.test(lean) ? 'up' : /bear/i.test(lean) ? 'down' : '';
    const shapes = r.shapes.length ? `<ul class="cap-list">${r.shapes.map(s => `<li><div class="cap-row"><b>${esc(s.name)}</b><span class="cap-side ${s.bias > 0 ? 'up' : s.bias < 0 ? 'down' : ''}">${s.bias > 0 ? 'bullish' : s.bias < 0 ? 'bearish' : 'either way'}</span></div><div class="cap-sub">Trigger ${p2(s.trigger)}${s.fail != null ? ` · cancel ${p2(s.fail)}` : ''}${s.target != null ? ` · objective ${p2(s.target)}` : ''}</div></li>`).join('')}</ul><p class="note">Shapes are read from the swing points. Apart from the six structure proxies, your book gives them no tested win rate.</p>` : '<p class="note">No clean chart shape in the box.</p>';
    const paths = r.scenarios.map(s => `<div class="cap-path ${s.side > 0 ? 'up' : s.side < 0 ? 'down' : ''}"><b>${esc(s.name)}</b><p>If ${esc(s.triggerWord)}${s.side ? ` (${s.dist.toFixed(1)} ATR away)` : ''}.</p>${s.side ? `<p>Objectives ${s.targets.length ? s.targets.map(p2).join(', ') : 'open'} · wrong ${s.side > 0 ? 'below' : 'above'} ${p2(s.invalid)}</p>` : '<p>Fade the edges; a close outside picks the side.</p>'}</div>`).join('');
    const tfs = r.timeframes.map(t => `<button type="button" class="cap-tf" data-cap-tf="${t.tf}"><b>${esc(t.label)}</b><span>${esc(t.why)}</span></button>`).join('');
    const read = c.status.read === 'done' && c.read ? `<p class="headline">${esc(c.read.spoken)}</p>${c.read.summary.length ? `<ul class="bul">${c.read.summary.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p class="note">${c.read.by === 'picture' ? 'INDAI read the picture and the facts above.' : 'INDAI wrote this from the facts above.'}</p><button type="button" class="btn mini" id="cap-say">Read it to me</button>`
      : c.status.read === 'working' ? '<p class="note">INDAI is reading it…</p>'
      : c.status.read === 'off' ? '<p class="note">INDAI\'s thinking brain is off, so this is the on-device reading only.</p>'
      : `<p class="note">INDAI's read did not come back. ${esc(c.readError || '')}</p>`;
    body.innerHTML = `
      ${c.shot.image ? `<img class="cap-shot" src="${c.shot.image}" alt="The captured part of the ${esc(c.shot.sym)} chart">` : ''}
      <div class="cap-head"><span class="cap-lean ${leanCls}">${esc(lean)}</span><span class="cap-meta">${r.count} candles · ${esc(timeOf(r.t0, r.tf))} → ${esc(timeOf(r.t1, r.tf))}</span></div>
      ${r.intraday ? `<p class="note warn">Your book's percentages were measured on daily stock candles. On a ${esc(TF_WORDS[r.tf])} chart the logic carries over; the numbers do not.</p>` : ''}
      <p class="sec-title">What it shows</p>
      <ul class="bul">
        <li>${esc(r.trend.word)} · ${esc(r.trend.structure)} · ${r.trend.movePct >= 0 ? '+' : ''}${r.trend.movePct.toFixed(2)}% (${p2(r.first.o)} → ${p2(r.last)})</li>
        <li>Box ${p2(r.box.lo)} – ${p2(r.box.hi)}, price in the ${r.box.pos >= 0.67 ? 'top' : r.box.pos <= 0.33 ? 'bottom' : 'middle'} third · ATR ${p2(r.atr)}</li>
        <li>RSI ${m.rsi != null ? m.rsi.toFixed(0) : '—'} · MACD histogram ${m.hist != null ? `${m.hist > 0 ? 'above' : 'below'} zero, ${m.histRising ? 'rising' : 'falling'}` : '—'}${m.cross ? ` · ${m.cross.dir > 0 ? 'bullish' : 'bearish'} cross ${m.cross.ago ? m.cross.ago + ' candles ago' : 'on the last candle'}` : ''}</li>
        ${r.divergences.slice(-2).map(d => `<li>${esc(d.kind)} (MACD, the atlas's pivot rule)</li>`).join('')}
        <li>Resistance ${r.levels.above.length ? r.levels.above.map(l => p2(l.p)).join(', ') : '—'} · support ${r.levels.below.length ? r.levels.below.map(l => p2(l.p)).join(', ') : '—'}${r.gex && r.gex.cw != null ? ` · call wall ${p2(r.gex.cw)}, put wall ${p2(r.gex.pw)}` : ''}</li>
      </ul>
      <p class="sec-title">Patterns in the box</p>${patternsHtml(c)}
      <p class="sec-title">Shapes</p>${shapes}
      <p class="sec-title">Paths from here</p><div class="cap-paths">${paths}</div>
      <p class="note">${esc(r.lean.why.map(w => w.text).join(' '))}</p>
      ${r.watch.length ? `<p class="sec-title">Watch next</p><ul class="bul">${r.watch.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <p class="sec-title">Look at these timeframes</p><div class="cap-tfs">${tfs}</div>
      <p class="sec-title">INDAI's read</p>${read}
      ${pastHtml()}
      <p class="note" style="margin-top:14px">Information, not financial advice. You make every trade.</p>`;
  }
  function pastHtml() {
    const list = past.filter(p => !cur || p.id !== cur.id);
    if (!list.length) return '';
    return `<p class="sec-title" style="margin-top:18px">Earlier captures on this device</p><div class="cap-past">${list.slice(0, 8).map(p => `<button type="button" class="cap-old" data-cap-id="${p.id}">${p.image ? `<img src="${p.image}" alt="">` : ''}<span><b>${esc(p.sym)} ${esc(TF_LABEL[p.tf] || p.tf)}</b> ${esc(p.lean || '')}<br>${esc(timeOf(p.at, '5min'))}</span></button>`).join('')}</div>`;
  }
  async function reopen(id) {
    const p = await candleStore.capture(id);
    if (!p) return;
    // the stored facts, re-read from the candles if they are still here, otherwise as they were
    const all = app.tf.all(p.sym, p.tf);
    let i0 = all.findIndex(b => b.t >= p.t0), i1 = -1;
    for (let i = all.length - 1; i >= 0; i--) if (all[i].t <= p.t1) { i1 = i; break; }
    const shot = { sym: p.sym, tf: p.tf, t0: p.t0, t1: p.t1, image: p.image, at: p.id, whole: p.whole };
    if (p.sym === app.settings.main && i0 >= 0 && i1 - i0 >= 2) {
      const lv = app.levelsFor ? app.levelsFor(p.sym) : null;
      const r = readCapture(all, i0, i1, { tf: p.tf, sym: p.sym, gex: lv ? { cw: lv.cw ?? null, pw: lv.pw ?? null, zg: lv.zg ?? null } : null });
      cur = { id: p.id, shot, r, read: p.read, atlas: p.atlas, status: { read: p.read ? 'done' : 'failed', atlas: p.atlas ? 'done' : r.notable.length ? 'unavailable' : 'none' } };
    } else {
      cur = { id: p.id, shot, r: null, error: `Switch the chart to ${p.sym} to read this capture again. INDAI said: ${p.read?.spoken || '—'}`, status: {} };
    }
    renderKey = ''; app.markDirty('capture');
  }

  V.capture = { visible: () => app.focus === 'capture' && !document.hidden, render };
  $('sb-capture').addEventListener('click', (e) => {
    const tf = e.target.closest('[data-cap-tf]'); if (tf) { onTimeframe(tf.dataset.capTf); return; }
    const old = e.target.closest('[data-cap-id]'); if (old) { reopen(+old.dataset.capId); return; }
    if (e.target.closest('#cap-say') && cur && cur.read) app.indai.say(cur.read.spoken, 'info', { log: false });
  });
  app.chart.onCapture = (shot) => run(shot);
  app.capture = { run, open: () => { app.ui.openSheet('capture'); app.markDirty('capture'); }, current: () => cur, tfMs: TF_MS };
  refreshPast();
  return app.capture;
}
