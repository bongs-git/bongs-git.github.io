const { chromium } = require('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ permissions: ['notifications'] });
  const page = await ctx.newPage();
  const sw = []; ctx.on('serviceworker', w => sw.push(w));
  const cdp = await ctx.newCDPSession(page); let regs = [], vers = [], errs = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { regs = e.registrations; });
  cdp.on('ServiceWorker.workerVersionUpdated', (e) => { vers = e.versions; });
  cdp.on('ServiceWorker.workerErrorReported', (e) => { errs.push(e.errorMessage); });
  await cdp.send('ServiceWorker.enable');
  await page.goto('http://127.0.0.1:8765/indai/?demo=1&nocheckin=1');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true)); await sleep(3500);
  const perm = await page.evaluate(() => Notification.permission);
  const direct = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; try { await r.showNotification('direct', { body: 'x', tag: 't1' }); } catch (e) { return 'ERR ' + e.message; } return (await r.getNotifications()).length; });
  const reg = regs.find(r => r.scopeURL.includes('/indai/'));
  const worker = ctx.serviceWorkers()[0];
  const inSw = worker ? await worker.evaluate(async () => { try { await self.registration.showNotification('from sw', { body: 'y', tag: 't2' }); return { ok: true, n: (await self.registration.getNotifications()).length, perm: Notification.permission, hasPush: typeof self.onpush }; } catch (e) { return 'ERR ' + e.message; } }) : 'no worker handle';
  let deliver = 'ok';
  try { await cdp.send('ServiceWorker.deliverPushMessage', { origin: 'http://127.0.0.1:8765', registrationId: reg.registrationId, data: JSON.stringify({ title: 'INDAI · TSLA', body: 'b', symbol: 'TSLA' }) }); } catch (e) { deliver = 'ERR ' + e.message; }
  await sleep(1500);
  const after = worker ? await worker.evaluate(async () => (await self.registration.getNotifications()).map(n => n.title + '|' + n.tag)) : null;
  console.log(JSON.stringify({ perm, direct, inSw, deliver, after, errs, versions: vers.map(v => v.status + '/' + v.runningStatus) }));
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR', e.message.split('\n')[0]); process.exit(1); });
