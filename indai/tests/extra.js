const { chromium, devices } = require('playwright');
const OUT = __dirname, URL = 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); };
const ready = (page) => page.waitForFunction(() => window.__indai && window.__indai.app.feed.status.mode === 'demo' && window.__indai.app.feed.quote('IWM'), null, { timeout: 30000 });
const watch = (page, errs) => { page.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console ' + m.text().slice(0, 200)); }); };
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

  // 1. service worker: installs, turns on cross-origin isolation, serves the shell offline
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); const errs = []; watch(page, errs);
    await page.goto(URL + '?nocheckin=1');
    await sleep(4000);
    await ready(page);
    const st = await page.evaluate(async () => ({ coi: self.crossOriginIsolated, ctl: !!navigator.serviceWorker.controller, caches: await caches.keys(), n: (await (await caches.open('indai-web-v1')).keys()).length }));
    check('service worker controls the page', st.ctl, JSON.stringify(st));
    check('cross-origin isolated (multi-core voice)', st.coi === true);
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' }).catch(e => errs.push('reload ' + e.message));
    await sleep(1500);
    const off = await page.evaluate(() => ({ app: !!window.__indai, logo: document.querySelector('.brand img').naturalWidth, font: document.fonts.check('14px Geist') })).catch(e => ({ err: e.message }));
    check('offline: shell loads from cache', off.app && off.logo > 0, JSON.stringify(off));
    await ctx.setOffline(false);
    check('sw run: no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // 2. voice in a desktop browser (browser recognizer -> graceful failure offline), then the on-device path
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
    const page = await ctx.newPage(); const errs = []; watch(page, errs);
    await page.goto(URL + '?nosw=1&nocheckin=1&demo=1'); await ready(page);
    const info = await page.evaluate(() => { const v = window.__indai.app.indai.voice; return { SR: !!v.SR, mic: v.micOK, can: v.canListen }; });
    console.log('   desktop voice caps', JSON.stringify(info));
    await page.click('#i-mic'); await sleep(2500);
    let log = await page.evaluate(() => [...document.querySelectorAll('#i-log .msg')].slice(-3).map(m => m.textContent));
    console.log('   after mic tap (browser recognizer):', JSON.stringify(log));
    await page.evaluate(() => { const a = window.__indai.app; a.settings.micEngine = 'whisper'; if (a.indai.voice.state.listening) a.indai.voice.cancel(); });
    await sleep(600);
    await page.click('#i-mic'); await sleep(1500);
    const st = await page.evaluate(() => ({ ...window.__indai.app.indai.voice.state, pill: document.getElementById('i-state').textContent, heard: !document.getElementById('i-heard').hidden, micClass: document.getElementById('i-mic').className }));
    check('on-device path: mic opens and UI shows listening', st.listening === true && /Listening/.test(st.pill) && st.heard && /listening/.test(st.micClass), JSON.stringify({ l: st.listening, pill: st.pill, heard: st.heard, c: st.micClass }));
    await page.screenshot({ path: `${OUT}/x-listening-laptop.png` });
    await sleep(2500);
    log = await page.evaluate(() => [...document.querySelectorAll('#i-log .msg')].slice(-3).map(m => m.textContent));
    console.log('   later:', JSON.stringify(log));
    const st2 = await page.evaluate(async () => { const a = window.__indai.app, v = a.indai.voice; if (v.state.listening) v.cancel(); await new Promise(r => setTimeout(r, 300)); const n = a.indai.log.length; a.talk(); await new Promise(r => setTimeout(r, 250)); const on = v.state.listening; a.talk(); await new Promise(r => setTimeout(r, 1500)); return { on, off: v.state.listening, added: a.indai.log.slice(n).map(m => m.text) }; });
    check('tap again before speaking closes the mic quietly', st2.on === true && st2.off === false && !st2.added.some(t => /didn't catch/.test(t)), JSON.stringify(st2));
    // typed mode never opens the mic by itself
    await page.fill('#i-input', 'start my day'); await page.press('#i-input', 'Enter'); await sleep(3000);
    const st3 = await page.evaluate(() => ({ l: window.__indai.app.indai.voice.state.listening, aw: window.__indai.app.indai.awaiting }));
    check('typed check-in does not open the mic', st3.l === false && st3.aw === 'capital', JSON.stringify(st3));
    check('voice run: no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // 3. iPhone Safari user agent: on-device listening, no WebGPU, phone layout, mic button states
  {
    const ctx = await browser.newContext({ ...devices['iPhone 14'], permissions: ['microphone'] });
    const page = await ctx.newPage(); const errs = []; watch(page, errs);
    await page.goto(URL + '?nosw=1&nocheckin=1&demo=1'); await ready(page);
    const info = await page.evaluate(() => { const a = window.__indai.app, v = a.indai.voice; return { iOS: a.platform.iOS, SR: v.SR, gpu: v.webgpu, can: v.canListen, layout: a.layout, vw: innerWidth, vh: innerHeight }; });
    check('iOS: on-device listening path, no WebGPU assumed', info.iOS && info.SR === null && info.gpu === false && info.can && info.layout === 'phone', JSON.stringify(info));
    await page.tap('#fab'); await sleep(1500);
    const st = await page.evaluate(() => ({ l: window.__indai.app.indai.voice.state.listening, fab: document.getElementById('fab').className, cap: document.getElementById('caption').hidden ? null : document.getElementById('caption').textContent }));
    check('iOS: big mic opens the mic, caption shows listening', st.l === true && /listening/.test(st.fab) && /Listening/.test(st.cap || ''), JSON.stringify(st));
    await page.screenshot({ path: `${OUT}/x-listening-phone.png` });
    await page.tap('#fab'); await sleep(1200);
    check('iOS run: no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // 4. smoothness: chart draw time, layout shift during start-up, auto check-in on first tap
  for (const [name, w, h] of [['phone', 390, 844], ['laptop', 1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: name === 'phone', isMobile: name === 'phone', deviceScaleFactor: name === 'phone' ? 3 : 1 });
    const page = await ctx.newPage(); const errs = []; watch(page, errs);
    await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) { // an alert card arriving in the conversation is content, not a layout jump
        const inTalk = (e.sources || []).some(x => { const n = x.node && (x.node.nodeType === 1 ? x.node : x.node.parentElement); return n && n.closest && n.closest('#p-indai'); });
        if (!e.hadRecentInput && !inTalk) window.__cls += e.value; } }).observe({ type: 'layout-shift', buffered: true }); });
    await page.goto(URL + '?nosw=1'); await ready(page); await sleep(2500);
    const perf = await page.evaluate(() => {
      const a = window.__indai.app, t = (id, n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) a.views[id].render(); return (performance.now() - t0) / n; };
      return { cls: +window.__cls.toFixed(4), chart: +t('chart', 100).toFixed(2), watch: +t('watch', 50).toFixed(2), top: +t('top', 100).toFixed(3) };
    });
    check(`${name}: chart draws well inside a 60 fps frame`, perf.chart < 8, JSON.stringify(perf));
    check(`${name}: no layout jumps while loading`, perf.cls < 0.02, 'CLS ' + perf.cls);
    const et = await page.evaluate(() => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date())));
    if (name === 'phone') await page.tap('#ch-prev'); else await page.click('#ch-prev');
    await sleep(3500);
    const ci = await page.evaluate(() => ({ aw: window.__indai.app.indai.awaiting, tab: window.__indai.app.tab, cap: document.getElementById('caption').hidden ? null : document.getElementById('caption').textContent.slice(0, 60), dot: !document.getElementById('tab-dot').hidden }));
    console.log(`   ${name}: ET hour ${et}; after first tap`, JSON.stringify(ci));
    if (et >= 6 && et < 16) check(`${name}: morning check-in starts on the first tap without leaving the screen`, ci.aw === 'capital' && ci.tab === 'chart' && (name !== 'phone' || (ci.cap && ci.dot)));
    await page.screenshot({ path: `${OUT}/x-checkin-${name}.png` });
    check(`${name} perf run: no page errors`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // 5. odd sizes: small phone, landscape phone, small laptop, reduced motion
  for (const [name, w, h, mobile] of [['small', 320, 568, true], ['landscape', 844, 390, true], ['wide', 1180, 820, false], ['hd', 1366, 768, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' });
    const page = await ctx.newPage(); const errs = []; watch(page, errs);
    await page.goto(URL + '?nosw=1&nocheckin=1&demo=1'); await ready(page); await sleep(900);
    if (await page.evaluate(() => window.__indai.app.layout) === 'phone') await page.click('#tabs [data-tab="indai"]');
    await page.fill('#i-input', 'QQQ calls expiring today 665 strike');
    await page.press('#i-input', 'Enter'); await sleep(2200);
    await page.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(300);
    await page.screenshot({ path: `${OUT}/x-${name}.png` });
    const o = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, layout: window.__indai.app.layout, focus: window.__indai.app.focus }));
    check(`${name} ${w}x${h}: fits, no sideways scroll`, o.over <= 1, JSON.stringify(o));
    check(`${name}: no page errors`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
