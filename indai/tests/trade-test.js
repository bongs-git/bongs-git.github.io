// The Trade page (trade.html, js/trade.js, js/trade-chart.js) against a stand-in back end. Nothing here reaches
// Schwab or Supabase. Checks what the page shows and, above all, exactly what it would send and when.
const { chromium } = require('playwright');
const BASE = process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(Date.now()), YY = TODAY.slice(2, 4) + TODAY.slice(5, 7) + TODAY.slice(8, 10);
const SPY = `SPY   ${YY}C00695000`, QQQ = `QQQ   ${YY}P00600000`;
const quote = (symbol) => ({ symbol, bid: 1.44, ask: 1.45, mark: 1.445, last: 1.46, delta: 0.41, underlying_price: 695.2, realtime: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function backend(page, b) {
  Object.assign(b, { calls: [], enrolled: true, connected: true, sendAnswer: null, nextId: 9000,
    stop: { id: '2', parent: '1', status: 'WORKING', open: true, kind: 'STOP', side: 'SELL_TO_CLOSE', symbol: SPY, description: '', asset: 'OPTION', qty: 2, filled: 0, price: null, stop: 1, fill: null, entered: new Date().toISOString(), cancelable: true, note: '' } });
  await page.route('**://zptjziewsfuvfcogrikz.supabase.co/functions/v1/indai-orders', async (route) => {
    const req = route.request(), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || '{}'), h = req.headers();
    b.calls.push({ ...body, _pass: h['x-indai-pass'], _device: h['x-indai-device'] });
    const send = (status, j) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(j) });
    if (h['x-indai-pass'] !== 'open sesame') return send(401, { error: 'passcode', message: 'Wrong or missing INDAI passcode.' });
    if (body.op === 'enroll') return send(200, { enrolled: b.enrolled, code: 'A1B2C3', first: false });
    if (body.op === 'devices' || body.op === 'approve' || body.op === 'forget') return b.enrolled ? send(200, { devices: [{ code: 'A1B2C3', label: 'iPhone', approved: true, added_at: '', this: true }, { code: 'D4E5F6', label: 'Mac', approved: body.op === 'approve', added_at: '', this: false }] }) : send(403, { error: 'device', message: 'This device is not approved to send orders.' });
    if (!b.connected) return send(409, { error: 'not_connected', message: 'Schwab is not connected.' });
    if (body.op === 'accounts') return send(200, { accounts: [{ tail: '1234' }, { tail: '5678' }], max_order_usd: 5000 });
    if (body.op === 'quote') return send(200, { contract: { symbol: SPY, root: 'SPY', underlying: 'SPY', expiry: TODAY, type: 'C', strike: 695 }, ...quote(SPY), choices: [] });
    if (body.op === 'history') return send(200, { symbol: body.symbol, bars: Array.from({ length: 30 }, (_, i) => [Date.now() - (30 - i) * 60e3, 1.2 + i / 100, 1.22 + i / 100, 1.19 + i / 100, 1.21 + i / 100, 5]) });
    if (body.op === 'preview') return send(200, { cost: 0, checked: true, ok: true, rejects: [], warns: ['This option expires today.'] });
    if (body.op === 'book') return send(200, { account: body.account, at: new Date().toISOString(), max_order_usd: 5000, positions: body.account !== '1234' ? [] : [
      { symbol: QQQ, underlying: 'QQQ', description: '', type: 'P', strike: 600, expiry: TODAY, qty: 1, avg: 2, value: 144.5, open_pl: -55.5, day_pl: -55.5, quote: quote(QQQ), stop: null, sells: 0 },
      { symbol: SPY, underlying: 'SPY', description: '', type: 'C', strike: 695, expiry: TODAY, qty: 2, avg: 1.24, value: 289, open_pl: 41, day_pl: 41, quote: quote(SPY), stop: b.stop, sells: b.stop ? 1 : 0 }],
      orders: body.account !== '1234' ? [] : [...(b.stop ? [b.stop] : []), { id: '1', parent: null, status: 'FILLED', open: false, kind: 'LIMIT', side: 'BUY_TO_OPEN', symbol: SPY, description: '', asset: 'OPTION', qty: 2, filled: 2, price: 1.25, stop: null, fill: 1.24, entered: new Date(Date.now() - 60e3).toISOString(), cancelable: false, note: '' }] });
    if (['place', 'stop', 'close', 'cancel'].includes(body.op)) {
      if (!b.enrolled) return send(403, { error: 'device', message: 'This device is not approved to send orders.' });
      if (b.sendAnswer) return send(b.sendAnswer.status, b.sendAnswer.body);
      if (body.op === 'stop' && body.symbol === SPY) b.stop = { ...b.stop, stop: body.stop };
      return send(200, { ok: true, order_id: String(++b.nextId) });
    }
    return send(400, { error: 'bad_request', message: 'no' });
  });
}
const sends = (b) => b.calls.filter(c => ['place', 'stop', 'close', 'cancel'].includes(c.op));
const text = (page, sel) => page.textContent(sel);
const until = (page, sel, re) => page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ''), [sel, re], { timeout: 8000 }).catch(() => {});
const cardOf = (page, symbol) => page.locator('#positions .card', { hasText: symbol.startsWith('SPY') ? 'SPY 695 call' : 'QQQ 600 put' });
// drags the stop line of one position from where it is to the place of another price
async function dragStop(page, symbol, from, to) {
  await cardOf(page, symbol).locator('canvas').scrollIntoViewIfNeeded();
  const box = await cardOf(page, symbol).locator('canvas').boundingBox();
  const ys = await page.evaluate(([s, a, z]) => { const c = window.__indaiTrade.cards.get(s).chart; return [c.yOf(a), c.yOf(z)]; }, [symbol, from, to]);
  await page.mouse.move(box.x + box.width / 2, box.y + ys[0]); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + (ys[0] + ys[1]) / 2, { steps: 4 }); await page.mouse.move(box.x + box.width / 2, box.y + ys[1], { steps: 4 });
  await page.mouse.up();
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1280, height: 800 }]]) {
      const ctx = await browser.newContext({ viewport }), page = await ctx.newPage(), b = {}, errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await backend(page, b);
      const link = `trade.html?u=spy&e=${TODAY}&t=C&k=695&q=2`;

      // the passcode, the device and the account
      await page.goto(BASE + link); await until(page, '#note', 'passcode');
      check(`[${name}] without a saved passcode the page asks for it and shows nothing else`, await page.isVisible('#passcard') && await page.isHidden('#app') && b.calls.length === 0);
      await page.fill('#pass', 'guess'); await page.click('#passgo'); await until(page, '#note', 'not accepted');
      check(`[${name}] a wrong passcode is refused in plain words`, /not accepted/.test(await text(page, '#note')) && await page.isHidden('#app'));
      await page.evaluate(() => localStorage.setItem('jarvis.settings.v1', JSON.stringify({ researchPass: 'open sesame' })));
      b.calls.length = 0; await page.reload(); await page.waitForSelector('#pickacct:not([hidden])');
      const enroll = b.calls[0], key = await page.evaluate(() => localStorage.getItem('indai.trade.device'));
      check(`[${name}] the device introduces itself with a key it made and keeps`, enroll.op === 'enroll' && /^[A-Za-z0-9_-]{43}$/.test(enroll._device) && enroll._device === key && !!enroll.label, enroll);
      check(`[${name}] with two accounts the page asks which, by their last four digits`, (await page.locator('#accts button').allTextContents()).join() === 'Ending 1234,Ending 5678' && await page.isHidden('#app'));
      await page.click('#accts button >> nth=0'); await page.waitForSelector('#t-order:not([hidden])'); await until(page, '#t-check', 'check');
      check(`[${name}] the choice is remembered and shown`, (await text(page, '#acct')) === 'Account …1234' && (await page.evaluate(() => localStorage.getItem('indai.trade.account'))) === '1234');

      // the ticket, filled in from the address
      const q = b.calls.find(c => c.op === 'quote');
      check(`[${name}] a contract in the address is looked up as it stands`, q.underlying === 'SPY' && q.expiry === TODAY && q.type === 'C' && q.strike === 695, q);
      const t = { quote: await text(page, '#t-quote'), limit: await page.inputValue('#t-l'), stop: await page.inputValue('#t-s'), qty: await page.inputValue('#t-q'), sum: await text(page, '#t-sum'), buy: await text(page, '#t-buy'), check: await text(page, '#t-check') };
      check(`[${name}] the ticket shows the live quote and fills in the ask, the quantity and a stop 20% below`, /SPY 695 call · \w+ \d+:  bid 1\.44  ·  ask 1\.45  ·  mark 1\.45/.test(t.quote) && t.limit === '1.45' && t.stop === '1.16' && t.qty === '2', t);
      check(`[${name}] it says what the order costs and what the stop would lose, and the button says exactly what it sends`, t.sum === 'Costs $290.00. If the stop sells at 1.16: about −$58.00.' && t.buy === 'Buy 2 SPY 695 call at 1.45 · stop 1.16' && await page.isEnabled('#t-buy'), t);
      check(`[${name}] Schwab's own check is shown`, t.check === "Schwab's check passes. It notes: This option expires today.", t.check);
      await page.click('#t-bid'); const bid = await page.inputValue('#t-l'); await page.click('#t-mid'); const mid = await page.inputValue('#t-l');
      check(`[${name}] Bid and Mid set the limit, and the stop follows`, bid === '1.44' && mid === '1.45' && (await page.inputValue('#t-s')) === '1.16', { bid, mid });
      await page.click('#t-ask');
      await page.fill('#t-q', '40'); const over = { sum: await text(page, '#t-sum'), off: await page.isDisabled('#t-buy') };
      check(`[${name}] an order over $5,000 cannot be sent and the page says why`, over.sum === 'This would cost $5,800.00. INDAI sends nothing over $5,000.00.' && over.off, over);
      await page.fill('#t-q', '2'); await page.fill('#t-s', '1.50');
      check(`[${name}] a stop above the buying price cannot be sent`, /has to be below/.test(await text(page, '#t-sum')) && await page.isDisabled('#t-buy'));
      await page.click('#t-auto'); await page.fill('#t-s', ''); await page.dispatchEvent('#t-s', 'input');
      check(`[${name}] the stop can be left off, and the page says so`, /No stop goes with it/.test(await text(page, '#t-sum')) && (await text(page, '#t-buy')) === 'Buy 2 SPY 695 call at 1.45');
      await page.click('#t-auto');
      await sleep(5600);
      check(`[${name}] the quote refreshes by itself; Schwab's check is not asked again for the same contract and quantity`, b.calls.filter(c => c.op === 'quote' && c.symbol === SPY).length >= 1 && b.calls.filter(c => c.op === 'preview').length <= 3, b.calls.filter(c => c.op === 'preview').length);

      // sending
      await page.click('#t-buy'); await until(page, '#t-out', 'Sent to Schwab');
      await page.click('#t-buy', { force: true, timeout: 1000 }).catch(() => {});
      const placed = sends(b);
      check(`[${name}] one tap sends one order, exactly as shown, with the passcode, the device key and a fresh nonce`, placed.length === 1 && placed[0].op === 'place' && placed[0].account === '1234' && UUID.test(placed[0].nonce) && JSON.stringify(placed[0].order) === JSON.stringify({ symbol: SPY, qty: 2, limit: 1.45, stop: 1.16 }) && placed[0]._pass === 'open sesame' && placed[0]._device === key, placed);
      check(`[${name}] the page says it was sent, with Schwab's order number, and holds the button for a moment`, (await text(page, '#t-out')) === 'Sent to Schwab (order 9001). It shows under Orders below.' && (await text(page, '#t-buy')) === 'Sent' && await page.isDisabled('#t-buy'));
      await sleep(4300);
      b.sendAnswer = { status: 422, body: { error: 'schwab_refused', message: 'Schwab refused it: Insufficient buying power. (Schwab 400)' } };
      await page.click('#t-buy'); await until(page, '#t-out', 'refused');
      check(`[${name}] Schwab's refusal is shown in its own words`, (await text(page, '#t-out')) === 'Schwab refused it: Insufficient buying power. (Schwab 400)' && await page.isEnabled('#t-buy'));
      b.sendAnswer = { status: 502, body: { error: 'schwab', message: 'Schwab did not answer.' } };
      await page.click('#t-buy'); await until(page, '#t-out', 'may or may not');
      check(`[${name}] when no clear answer comes back the page says the order may or may not be there`, /may or may not have reached Schwab\. Look at Orders below/.test(await text(page, '#t-out')));
      b.sendAnswer = null; b.calls.length = 0;

      // what he holds
      await page.waitForSelector('#positions .card >> nth=1');
      const spy = cardOf(page, SPY), qqq = cardOf(page, QQQ);
      check(`[${name}] each option he holds shows what he paid, the price now, the gain and the stop`, /^SPY 695 call · \w+ \d+ · 2 contracts$/.test(await spy.locator('h2').textContent()) && /Paid 1\.24  ·  now 1\.45  ·  \+\$41\.00  ·  stop 1\.00/.test(await spy.locator('p.num').first().textContent()) && /−\$55\.50  ·  no stop/.test(await qqq.locator('p.num').first().textContent()), await spy.locator('p.num').first().textContent());
      await sleep(300);
      await dragStop(page, SPY, 1, 1.1);
      const ask1 = await spy.locator('.bar p').textContent();
      check(`[${name}] dragging the stop line asks before anything is sent`, ask1 === 'Move your stop from 1.00 to 1.10?' && sends(b).length === 0 && (await spy.locator('.bar button').first().textContent()) === 'Move stop', ask1);
      if (process.env.TRADE_SHOT && name === 'phone') await page.screenshot({ path: process.env.TRADE_SHOT, fullPage: true });   // a picture of the page mid-drag, for a look
      await spy.locator('.bar button', { hasText: 'Leave it' }).click();
      check(`[${name}] "Leave it" puts the line back and sends nothing`, await spy.locator('.bar').isHidden() && sends(b).length === 0);
      await dragStop(page, SPY, 1, 9);
      const top = await spy.locator('.bar p').textContent();
      check(`[${name}] the line cannot be dragged to or above the option's price`, top === 'Move your stop from 1.00 to 1.43?', top);
      await dragStop(page, SPY, 1.43, 1.2);
      await spy.locator('.bar button', { hasText: 'Move stop' }).click(); await until(page, '#positions', 'Your stop is now at 1.20');
      const moved = sends(b);
      check(`[${name}] "Move stop" sends the new stop for that contract, once`, moved.length === 1 && moved[0].op === 'stop' && moved[0].symbol === SPY && moved[0].stop === 1.2 && moved[0].account === '1234' && UUID.test(moved[0].nonce) && moved[0]._device === key, moved);
      await until(page, '#positions', 'stop 1\\.20');
      check(`[${name}] the card then shows the stop where Schwab has it`, /stop 1\.20/.test(await spy.locator('p.num').first().textContent()) && await spy.locator('.bar').isHidden());
      b.calls.length = 0;
      await qqq.locator('button', { hasText: 'Add a stop' }).click();
      const add = await qqq.locator('.bar p').textContent();
      check(`[${name}] a position without a stop offers one 20% under the price, to drag before sending`, add === 'Set a stop at 1.15? You can drag it first.' && sends(b).length === 0, add);
      await qqq.locator('.bar button', { hasText: 'Set stop' }).click(); await until(page, '#positions', 'Your stop is now at 1.15');
      check(`[${name}] "Set stop" sends it`, sends(b).length === 1 && sends(b)[0].op === 'stop' && sends(b)[0].symbol === QQQ && sends(b)[0].stop === 1.15, sends(b));
      b.calls.length = 0;
      const close = spy.locator('button', { hasText: /^Close at 1\.44$/ });
      await close.click();
      const armed = await spy.locator('button.red', { hasText: 'tap again' }).textContent().catch(() => '');
      check(`[${name}] Close asks for a second tap and says what it will sell`, armed === 'Sell 2 at 1.44: tap again' && sends(b).length === 0, armed);
      await spy.locator('button', { hasText: 'tap again' }).click(); await until(page, '#positions', 'Sell order sent at 1.44');
      check(`[${name}] the second tap sells the whole position at the bid`, sends(b).length === 1 && sends(b)[0].op === 'close' && sends(b)[0].symbol === SPY && sends(b)[0].limit === 1.44, sends(b));

      // his orders
      b.calls.length = 0;
      const rows = await page.locator('#orders .order').allTextContents();
      check(`[${name}] today's orders are listed in words`, rows.some(r => /^Working.*Sell 2 SPY 695 call · \w+ \d+, stop 1\.20Cancel$/.test(r)) && rows.some(r => /^Filled.*Buy 2 SPY 695 call · \w+ \d+ at 1\.25, filled at 1\.24$/.test(r)), rows);
      await page.locator('#orders .order button', { hasText: 'Cancel' }).first().click(); await sleep(400);
      check(`[${name}] Cancel sends that order's number`, sends(b).length === 1 && sends(b)[0].op === 'cancel' && sends(b)[0].order_id === '2', sends(b));
      await page.click('#devs summary'); await page.waitForSelector('#devlist .order');
      const devs = await page.locator('#devlist .order').allTextContents();
      check(`[${name}] the devices are listed, and a waiting one can be approved from here`, /iPhone \(this one\)Approved · code A1B2C3/.test(devs[0]) && /MacWaiting for your approval · code D4E5F6Approve/.test(devs[1]), devs);
      await page.locator('#devlist button', { hasText: 'Approve' }).click(); await sleep(300);
      check(`[${name}] Approve names the device by its code`, b.calls.some(c => c.op === 'approve' && c.code === 'D4E5F6'));
      const box = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth > innerWidth + 1, small: [...document.querySelectorAll('button, a.btn, input')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent) }));
      check(`[${name}] fits the screen with tap-sized controls, no script errors`, !box.wide && box.small.length === 0 && errors.length === 0, { box, errors });

      // a device that is not approved can look and cannot send
      b.enrolled = false; b.calls.length = 0; b.stop = { ...b.stop, stop: 1 };
      await page.reload(); await page.waitForSelector('#t-order:not([hidden])'); await page.waitForSelector('#positions .card >> nth=1');
      const locked = { card: await page.isVisible('#devcard'), code: await text(page, '#devcode'), buy: await page.isDisabled('#t-buy'), close: await cardOf(page, SPY).locator('button', { hasText: /^Close/ }).isDisabled(), cancel: await page.locator('#orders .order button').first().isDisabled() };
      await dragStop(page, SPY, 1, 1.1);
      locked.move = await cardOf(page, SPY).locator('.bar button').first().isDisabled();
      check(`[${name}] a device waiting for approval shows its code, can look, and every send button is off`, locked.card && locked.code === 'A1B2C3' && locked.buy && locked.close && locked.cancel && locked.move && sends(b).length === 0, locked);
      b.connected = false; await page.reload(); await until(page, '#note', 'not connected');
      check(`[${name}] without a Schwab sign-in the page says so and links to the connection page`, (await page.getAttribute('#note a', 'href')) === './schwab.html' && await page.isHidden('#app'));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
