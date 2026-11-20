// The Trade page (trade.html): a ticket that buys one option contract with its stop, the positions he holds with
// the stop as a line he drags on the option's own chart, and his orders. Every send is his tap; the back end
// (indai-orders) enforces the limits whatever this page does. The page keeps one secret of its own: a device key,
// made here and kept in this browser, without which the back end refuses to send.
import { RELAY_URL, RELAY_ANON } from './relay.js';
import { autoStop, clampStop, roundTo, stopChart, tickFor } from './trade-chart.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const say = (node, text, kind = '') => { node.textContent = text; node.classList.remove('ok', 'bad', 'dim'); if (kind) node.classList.add(kind); };
const usd = (n) => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const px = (n) => Number(n).toFixed(2);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(Date.now());
const visible = () => document.visibilityState !== 'hidden';
function stored(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function store(key, value) { try { localStorage.setItem(key, value); } catch { /* private window: kept for this visit only */ } }
function deviceKey() {
  const had = stored('indai.trade.device');
  if (/^[A-Za-z0-9_-]{43}$/.test(had)) return had;
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  store('indai.trade.device', key);
  return key;
}
const ua = navigator.userAgent, label = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Browser';
// "SPY   261120C00695000" in words
function named(symbol) {
  const m = String(symbol || '').match(/^(\S+) *(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/);
  if (!m) return { root: '', text: String(symbol || '') };
  const day = new Date(Date.UTC(2000 + +m[2], +m[3] - 1, +m[4])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return { root: m[1], text: `${m[1]} ${+m[6] / 1000} ${m[5] === 'C' ? 'call' : 'put'} · ${day}` };
}

const S = { pass: '', device: deviceKey(), account: '', accounts: [], cap: 5000, enrolled: false, book: null, pending: {}, cards: new Map(), ordersKey: '' };
try { S.pass = (JSON.parse(stored('jarvis.settings.v1') || 'null') || {}).researchPass || ''; } catch { /* no saved settings */ }

async function ask(body) {
  let r;
  try {
    r = await fetch(`${RELAY_URL}/functions/v1/indai-orders`, { method: 'POST', headers: { apikey: RELAY_ANON, Authorization: `Bearer ${RELAY_ANON}`, 'Content-Type': 'application/json', 'x-indai-pass': S.pass, 'x-indai-device': S.device }, body: JSON.stringify(body) });
  } catch { const e = new Error('No answer reached this device.'); e.status = 0; throw e; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || `Something went wrong (${r.status}).`); e.status = r.status; e.code = j.error; throw e; }
  return j;
}
// A send. When nothing is known about what happened, say so: the order may or may not be at Schwab.
async function send(body) {
  try { return await ask({ ...body, account: S.account, nonce: crypto.randomUUID() }); }
  catch (e) { if (e.status === 0 || e.status === 502) e.message = 'No clear answer came back, so this may or may not have reached Schwab. Look at Orders below before trying again.'; throw e; }
}

// ------------------------------------------------------------------ start
async function boot() {
  $('passcard').hidden = true; $('pickacct').hidden = true;
  if (!S.pass) { $('passcard').hidden = false; say($('note'), 'Enter your passcode to begin.'); return; }
  say($('note'), 'Connecting…', 'dim');
  try {
    const d = await ask({ op: 'enroll', label });
    S.enrolled = d.enrolled === true; $('devcode').textContent = d.code; $('devcard').hidden = S.enrolled;
    const a = await ask({ op: 'accounts' });
    S.accounts = a.accounts.map((x) => x.tail); S.cap = a.max_order_usd || 5000;
    const had = stored('indai.trade.account');
    if (S.accounts.includes(had)) S.account = had; else if (S.accounts.length === 1) S.account = S.accounts[0];
    if (!S.account) { pickAccount(); return; }
    open();
  } catch (e) {
    if (e.status === 401) { S.pass = ''; $('passcard').hidden = false; say($('note'), 'That passcode was not accepted.', 'bad'); }
    else if (e.status === 409) { $('note').replaceChildren('Schwab is not connected. ', el('a', { href: './schwab.html', textContent: 'Connect it first.' })); }
    else say($('note'), e.message, 'bad');
  }
}
function pickAccount() {
  say($('note'), ''); $('app').hidden = true; $('pickacct').hidden = false;
  $('accts').replaceChildren(...S.accounts.map((tail) => el('button', { className: 'grow', textContent: 'Ending ' + tail, onclick: () => { S.account = tail; store('indai.trade.account', tail); $('pickacct').hidden = true; open(); } })));
}
function open() {
  say($('note'), ''); $('app').hidden = false;
  $('acct').hidden = false; $('acct').textContent = 'Account …' + S.account; $('acct').disabled = S.accounts.length < 2;
  for (const c of S.cards.values()) { c.chart.destroy(); c.root.remove(); }
  S.cards.clear(); S.book = null; S.pending = {}; S.ordersKey = '';
  summarise(); loadBook();
  if (parts() && !T.contract) changed();   // a contract handed over in the address
}
$('acct').onclick = pickAccount;
$('passgo').onclick = () => { S.pass = $('pass').value.trim(); boot(); };
$('pass').onkeydown = (e) => { if (e.key === 'Enter') $('passgo').click(); };
$('devretry').onclick = boot;

// ------------------------------------------------------------------ the ticket
const T = { type: 'C', root: null, contract: null, quote: null, mode: 'ask', stopAuto: true, busy: false, hold: 0, seq: 0, checked: '' };
const parts = () => {
  const underlying = $('t-u').value.trim().toUpperCase(), expiry = $('t-e').value, strike = Number($('t-k').value);
  return /^\$?[A-Z][A-Z0-9.]{0,5}$/.test(underlying) && /^\d{4}-\d\d-\d\d$/.test(expiry) && strike > 0 ? { underlying, expiry, type: T.type, strike } : null;
};
const order = () => ({ symbol: T.contract ? T.contract.symbol : '', qty: Number($('t-q').value), limit: Number($('t-l').value), stop: $('t-s').value.trim() === '' ? null : Number($('t-s').value) });
function setType(t) { T.type = t; $('t-c').classList.toggle('on', t === 'C'); $('t-p').classList.toggle('on', t === 'P'); }
let finding = null;
function changed() { T.contract = null; T.quote = null; T.root = null; T.checked = ''; $('t-order').hidden = true; $('t-roots').hidden = true; say($('t-out'), ''); clearTimeout(finding); finding = setTimeout(find, 500); say($('t-quote'), parts() ? 'Looking it up…' : 'Fill in the contract to see its price.', 'dim'); }
async function find() {
  const p = parts(), seq = ++T.seq;
  if (!p) return;
  try {
    const j = await ask({ op: 'quote', ...p, ...(T.root ? { root: T.root } : {}) });
    if (seq !== T.seq) return;
    if (!j.contract) {   // an index with two contracts that day: he says which
      say($('t-quote'), 'Two contracts match. Which one?', 'dim'); $('t-roots').hidden = false;
      $('t-roots').replaceChildren(...j.choices.map((c) => el('button', { className: 'chip grow', textContent: c.description || c.root, onclick: () => { T.root = c.root; $('t-roots').hidden = true; find(); } })));
      return;
    }
    T.contract = j.contract; T.quote = j; T.mode = 'ask'; T.stopAuto = true; $('t-order').hidden = false;
    quoted();
  } catch (e) { if (seq === T.seq) say($('t-quote'), e.message, 'bad'); }
}
function quoted() {
  const q = T.quote;
  say($('t-quote'), `${named(T.contract.symbol).text}:  bid ${q.bid != null ? px(q.bid) : '—'}  ·  ask ${q.ask != null ? px(q.ask) : '—'}  ·  mark ${q.mark != null ? px(q.mark) : '—'}`, 'dim');
  for (const m of ['bid', 'mid', 'ask']) $('t-' + m).classList.toggle('on', T.mode === m);
  if (T.mode !== 'typed' && document.activeElement !== $('t-l')) {
    const tick = tickFor(T.contract.root, q.mark || q.ask || 1);
    const v = T.mode === 'bid' ? q.bid : T.mode === 'ask' ? q.ask : q.bid != null && q.ask != null ? roundTo((q.bid + q.ask) / 2, tick) : q.mark;
    if (v > 0) $('t-l').value = px(v);
  }
  summarise();
}
let checking = null;
function summarise() {
  if (!T.contract) return;
  const o = order(), cost = o.limit * o.qty * 100;
  if (T.stopAuto && document.activeElement !== $('t-s')) { const s = autoStop(T.contract.root, o.limit); $('t-s').value = s ? px(s) : ''; o.stop = s; }
  $('t-auto').classList.toggle('on', T.stopAuto);
  let why = '';
  if (!Number.isInteger(o.qty) || o.qty < 1) why = 'The number of contracts is 1 or more.';
  else if (!(o.limit > 0)) why = 'Give a limit price.';
  else if (cost > S.cap + 1e-6) why = `This would cost ${usd(cost)}. INDAI sends nothing over ${usd(S.cap)}.`;
  else if (o.stop != null && !(o.stop > 0 && o.stop < o.limit)) why = 'The stop has to be below the price you are buying at.';
  if (why) say($('t-sum'), why, 'bad');
  else say($('t-sum'), `Costs ${usd(cost)}.` + (o.stop ? ` If the stop sells at ${px(o.stop)}: about ${usd((o.stop - o.limit) * o.qty * 100)}.` : ' No stop goes with it.'));
  const name = named(T.contract.symbol).text.split(' · ')[0];
  $('t-buy').textContent = Date.now() < T.hold ? 'Sent' : `Buy ${o.qty || ''} ${name} at ${o.limit > 0 ? px(o.limit) : '…'}` + (o.stop && !why ? ` · stop ${px(o.stop)}` : '');
  $('t-buy').disabled = !!why || !S.enrolled || T.busy || Date.now() < T.hold;
  // Schwab's own check is asked once for a contract and a quantity, not each time the price moves.
  const key = why ? '' : o.symbol + '|' + o.qty;
  if (key === T.checked) return;
  T.checked = key; clearTimeout(checking); say($('t-check'), '');
  if (key) checking = setTimeout(() => check(key), 700);
}
async function check(key) {
  try {
    const j = await ask({ op: 'preview', account: S.account, order: order() });
    if (key !== T.checked) return;
    if (j.ok === false) say($('t-check'), 'Schwab would refuse this: ' + j.rejects.join(' '), 'bad');
    else if (j.ok === true) say($('t-check'), "Schwab's check passes." + (j.warns.length ? ' It notes: ' + j.warns.join(' ') : ''), 'dim');
    else say($('t-check'), "Schwab's check is not answering. You can still send; Schwab decides when it arrives.", 'dim');
  } catch (e) { if (key === T.checked) say($('t-check'), e.message, e.status === 400 ? 'bad' : 'dim'); }
}
async function buy() {
  const o = order();
  T.busy = true; summarise(); say($('t-out'), 'Sending…', 'dim');
  try {
    const j = await send({ op: 'place', order: o });
    T.hold = Date.now() + 4000; setTimeout(summarise, 4100);
    say($('t-out'), j.duplicate ? 'That tap was already sent. It shows under Orders below.' : `Sent to Schwab${j.order_id ? ' (order ' + j.order_id + ')' : ''}. It shows under Orders below.`, 'ok');
    loadBook(); setTimeout(loadBook, 2500);
  } catch (e) { say($('t-out'), e.message, 'bad'); loadBook(); }
  T.busy = false; summarise();
}
for (const id of ['t-u', 't-e', 't-k']) $(id).addEventListener('input', changed);
$('t-c').onclick = () => { setType('C'); changed(); };
$('t-p').onclick = () => { setType('P'); changed(); };
$('t-q').addEventListener('input', summarise);
$('t-less').onclick = () => { $('t-q').value = Math.max(1, (Number($('t-q').value) || 1) - 1); summarise(); };
$('t-more').onclick = () => { $('t-q').value = (Number($('t-q').value) || 0) + 1; summarise(); };
$('t-l').addEventListener('input', () => { T.mode = 'typed'; for (const m of ['bid', 'mid', 'ask']) $('t-' + m).classList.remove('on'); summarise(); });
for (const m of ['bid', 'mid', 'ask']) $('t-' + m).onclick = () => { T.mode = m; if (T.quote) quoted(); };
$('t-s').addEventListener('input', () => { T.stopAuto = false; summarise(); });
$('t-auto').onclick = () => { T.stopAuto = true; summarise(); };
$('t-buy').onclick = buy;
// the quote under the ticket keeps itself fresh
setInterval(async () => {
  if (!T.contract || !visible() || T.busy) return;
  const symbol = T.contract.symbol;
  try { const j = await ask({ op: 'quote', symbol }); if (T.contract && T.contract.symbol === symbol) { T.quote = { ...T.quote, ...j }; quoted(); } } catch { /* the next one will do */ }
}, 5000);

// ------------------------------------------------------------------ what he holds, and his orders
async function loadBook() {
  if (!S.account) return;
  try { S.book = await ask({ op: 'book', account: S.account }); paintBook(); }
  catch (e) { if (!S.book) say($('orders').firstElementChild || $('orders'), e.message, 'bad'); }
}
setInterval(() => { if (visible() && !$('app').hidden) loadBook(); }, 6000);
document.addEventListener('visibilitychange', () => { if (visible() && !$('app').hidden) loadBook(); });

function card(p) {
  const c = { symbol: p.symbol, bars: [], armed: 0 };
  c.title = el('h2'); c.line = el('p', { className: 'num' });
  c.canvas = el('canvas', { className: 'px' }); c.canvas.setAttribute('aria-label', 'Price of this option today, with your stop. Drag the stop line to move it.');
  c.ask = el('p', { className: 'num' }); c.yes = el('button', { className: 'red grow' }); c.no = el('button', { className: 'grow', textContent: 'Leave it' });
  c.bar = el('div', { className: 'bar', hidden: true }, c.ask, el('div', { className: 'row' }, c.yes, c.no));
  c.add = el('button', { className: 'grow', textContent: 'Add a stop' }); c.close = el('button', { className: 'grow' });
  c.out = el('p', { style: 'margin:10px 0 0' }); c.out.setAttribute('role', 'status');
  c.root = el('div', { className: 'card' }, c.title, c.line, c.canvas, c.bar, el('div', { className: 'row' }, c.add, c.close), c.out);
  c.chart = stopChart(c.canvas, { onDrop: (price) => { S.pending[c.symbol] = price; paintCard(c); } });
  c.no.onclick = () => { delete S.pending[c.symbol]; paintCard(c); };
  c.yes.onclick = async () => {
    const stop = S.pending[c.symbol];
    c.yes.disabled = true; say(c.out, 'Sending…', 'dim');
    try { await send({ op: 'stop', symbol: c.symbol, stop }); delete S.pending[c.symbol]; say(c.out, `Your stop is now at ${px(stop)}.`, 'ok'); }
    catch (e) { say(c.out, e.message, 'bad'); }
    c.yes.disabled = false; await loadBook(); paintCard(c);
  };
  c.add.onclick = () => { const m = c.p.quote && c.p.quote.mark; if (!(m > 0)) return; const tick = tickFor(named(c.symbol).root, m); S.pending[c.symbol] = clampStop(roundTo(m * 0.8, tick, 'down'), tick, m); paintCard(c); };
  c.close.onclick = async () => {
    const limit = sellAt(c.p);
    if (!(limit > 0)) return;
    if (Date.now() > c.armed) { c.armed = Date.now() + 4000; paintCard(c); setTimeout(() => paintCard(c), 4100); return; }   // the first tap asks, the second sells
    c.armed = 0; c.close.disabled = true; say(c.out, 'Sending…', 'dim');
    try { await send({ op: 'close', symbol: c.symbol, limit }); delete S.pending[c.symbol]; say(c.out, `Sell order sent at ${px(limit)}. It shows under Orders below.`, 'ok'); }
    catch (e) { say(c.out, e.message, 'bad'); }
    c.close.disabled = false; await loadBook(); paintCard(c);
  };
  ask({ op: 'history', symbol: p.symbol }).then((j) => { c.bars = [...j.bars, ...c.bars.filter((b) => !j.bars.length || b[0] > j.bars[j.bars.length - 1][0])]; paintCard(c); }).catch(() => {});
  return c;
}
// The price a Close sells at: the bid, which is what a buyer pays right now.
const sellAt = (p) => { const q = p.quote || {}; return q.bid > 0 ? q.bid : q.mark > 0 ? roundTo(q.mark, tickFor(named(p.symbol).root, q.mark), 'down') : 0; };
function paintCard(c) {
  const p = c.p, q = p.quote || {}, mark = q.mark > 0 ? q.mark : null, stop = p.stop ? p.stop.stop : null, pending = S.pending[c.symbol] ?? null;
  c.title.textContent = `${named(p.symbol).text} · ${p.qty} contract${p.qty === 1 ? '' : 's'}`;
  const pl = mark != null && p.avg != null ? (mark - p.avg) * p.qty * 100 : null;
  c.line.replaceChildren(`Paid ${p.avg != null ? px(p.avg) : '—'}  ·  now ${mark != null ? px(mark) : '—'}  ·  `, el('span', { className: pl == null ? 'dim' : pl >= 0 ? 'ok' : 'bad', textContent: pl == null ? '—' : (pl >= 0 ? '+' : '') + usd(pl) }), stop != null ? `  ·  stop ${px(stop)}` : '  ·  no stop');
  c.chart.set({ bars: c.bars, mark, entry: p.avg, stop, pending, tick: tickFor(named(p.symbol).root, mark || stop || 1) });
  const moving = pending != null && pending !== stop;
  c.bar.hidden = !moving;
  if (moving) { c.ask.textContent = stop != null ? `Move your stop from ${px(stop)} to ${px(pending)}?` : `Set a stop at ${px(pending)}? You can drag it first.`; c.yes.textContent = stop != null ? 'Move stop' : 'Set stop'; c.yes.disabled = !S.enrolled; }
  c.add.hidden = stop != null || pending != null || p.sells > 0;
  const limit = sellAt(p), armed = Date.now() < c.armed;
  c.close.textContent = !(limit > 0) ? 'Close' : armed ? `Sell ${p.qty} at ${px(limit)}: tap again` : `Close at ${px(limit)}`;
  c.close.classList.toggle('red', armed); c.close.disabled = !S.enrolled || !(limit > 0);
}
function paintBook() {
  const b = S.book, host = $('positions'), seen = new Set();
  for (const p of b.positions) {
    seen.add(p.symbol);
    let c = S.cards.get(p.symbol);
    if (!c) { c = card(p); S.cards.set(p.symbol, c); host.append(c.root); }
    c.p = p;
    const m = p.quote && p.quote.mark;
    if (m > 0) {   // this minute's candle grows with each look at the price
      const t = Math.floor(Date.now() / 60e3) * 60e3, last = c.bars[c.bars.length - 1];
      if (last && last[0] === t) { last[2] = Math.max(last[2], m); last[3] = Math.min(last[3], m); last[4] = m; } else if (!last || t > last[0]) c.bars.push([t, m, m, m, m, 0]);
    }
    if (!c.chart.dragging) paintCard(c);
  }
  for (const [symbol, c] of S.cards) if (!seen.has(symbol)) { c.chart.destroy(); c.root.remove(); S.cards.delete(symbol); delete S.pending[symbol]; }
  const key = JSON.stringify(b.orders) + S.enrolled;
  if (key === S.ordersKey) return;
  S.ordersKey = key;
  const word = { WORKING: 'Working', FILLED: 'Filled', CANCELED: 'Cancelled', REJECTED: 'Refused', REPLACED: 'Replaced', EXPIRED: 'Expired', PENDING_ACTIVATION: 'Waiting', AWAITING_PARENT_ORDER: 'Waiting for the buy', QUEUED: 'Queued', ACCEPTED: 'Accepted' };
  const rows = b.orders.map((o) => {
    const what = `${o.side === 'BUY_TO_OPEN' ? 'Buy' : o.side === 'SELL_TO_CLOSE' ? 'Sell' : o.side} ${o.qty} ${named(o.symbol).text}` + (o.kind === 'STOP' ? `, stop ${o.stop != null ? px(o.stop) : ''}` : o.price != null ? ` at ${px(o.price)}` : ` (${o.kind.toLowerCase().replace(/_/g, ' ')})`) + (o.fill != null ? `, filled at ${px(o.fill)}` : '');
    const row = el('div', { className: 'order' }, el('div', {}, el('b', { className: o.status === 'FILLED' ? 'ok' : o.status === 'REJECTED' ? 'bad' : '', textContent: word[o.status] || o.status.toLowerCase().replace(/_/g, ' ') }), el('div', { className: 'dim num', textContent: what + (o.status === 'REJECTED' && o.note ? ': ' + o.note : '') })));
    if (o.open && o.cancelable !== false) {
      const x = el('button', { className: 'chip', textContent: 'Cancel', disabled: !S.enrolled });
      x.onclick = async () => { x.disabled = true; try { await send({ op: 'cancel', order_id: o.id }); } catch (e) { say($('note'), e.message, 'bad'); } S.ordersKey = ''; loadBook(); };
      row.append(x);
    }
    return row;
  });
  $('orders').replaceChildren(...(rows.length ? rows : [el('p', { className: 'dim', textContent: 'No option orders today.' })]));
}

// ------------------------------------------------------------------ the devices that may send
async function paintDevices(act) {
  const host = $('devlist');
  try {
    const j = await ask(act || { op: 'devices' });
    host.replaceChildren(...j.devices.map((d) => {
      const row = el('div', { className: 'order' }, el('div', {}, el('b', { textContent: (d.label || 'Device') + (d.this ? ' (this one)' : '') }), el('div', { className: 'dim num', textContent: `${d.approved ? 'Approved' : 'Waiting for your approval'} · code ${d.code}` })));
      if (!d.approved) row.append(el('button', { className: 'chip', textContent: 'Approve', onclick: () => paintDevices({ op: 'approve', code: d.code }) }));
      else if (!d.this) row.append(el('button', { className: 'chip', textContent: 'Remove', onclick: () => paintDevices({ op: 'forget', code: d.code }) }));
      return row;
    }));
  } catch (e) { host.replaceChildren(el('p', { className: 'dim', textContent: e.status === 403 ? 'Only an approved device can see and approve devices.' : e.message })); }
}
$('devs').addEventListener('toggle', () => { if ($('devs').open) paintDevices(); });

// ------------------------------------------------------------------ a contract handed over in the address
const params = new URLSearchParams(location.search);
$('t-e').value = /^\d{4}-\d\d-\d\d$/.test(params.get('e') || '') ? params.get('e') : today();
if (params.get('u')) $('t-u').value = params.get('u').toUpperCase().slice(0, 7);
if (Number(params.get('k')) > 0) $('t-k').value = String(Number(params.get('k')));
if (Number.isInteger(Number(params.get('q'))) && Number(params.get('q')) > 0) $('t-q').value = String(Number(params.get('q')));
setType(params.get('t') === 'P' ? 'P' : 'C');
window.__indaiTrade = S;   // for the page's own tests
boot();
