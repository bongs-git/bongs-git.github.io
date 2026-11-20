// Being heard on an iPhone: audio session switching around the microphone, letting go of the mic when listening ends,
// waking the audio engine, the slow-natural-voice fallback, and the sound line in Settings.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8765/indai/', OUT = __dirname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); };
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  for (const withSession of [true, false]) {
    const tag = withSession ? 'iPhone with audio session' : 'older iPhone';
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IOS, permissions: ['microphone'] });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    if (withSession) await page.addInitScript(() => {
      const s = { log: [], t: 'auto' };
      Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { get type() { return s.t; }, set type(v) { s.t = v; s.log.push(v); }, get _log() { return s.log; } } });
    });
    await page.addInitScript(() => { window.__audios = []; const A = window.Audio; window.Audio = function (src) { const a = new A(src); window.__audios.push(a); return a; }; });
    await page.goto(URL + '?demo=1&nosw=1&nocheckin=1');
    await page.waitForFunction(() => window.__indai && window.__indai.app.feed.quote('SPY'), null, { timeout: 20000 });
    const A = (fn, arg) => page.evaluate(fn, arg);
    check(`[${tag}] treated as an iPhone`, await A(() => window.__indai.app.platform.iOS === true));
    let info = await A(() => window.__indai.app.audioInfo());
    check(`[${tag}] nothing started before the first tap`, info.ctx === 'not started', JSON.stringify(info));
    await page.tap('#h-watch').catch(() => page.tap('header.top'));
    await sleep(600);
    info = await A(() => window.__indai.app.audioInfo());
    if (withSession) check(`[${tag}] first tap: sound on, session set to playback (plays on silent)`, info.ctx === 'running' && info.session === 'playback', JSON.stringify(info));
    else {
      const loop = await A(() => window.__audios.map(a => ({ loop: a.loop, paused: a.paused, mp3: a.src.startsWith('data:audio/mpeg') })));
      check(`[${tag}] first tap: sound on, silent clip looping instead`, info.ctx === 'running' && info.session === null && loop.length === 1 && loop[0].loop && loop[0].mp3 && !loop[0].paused, JSON.stringify({ info, loop }));
    }
    // open the microphone
    await A(() => { window.__indai.app.ui.showTab('indai'); }); await sleep(200);
    await page.tap('#fab');
    await page.waitForFunction(() => window.__indai.app.indai.voice.state.listening, null, { timeout: 8000 }).catch(() => {});
    let st = await A(() => { const v = window.__indai.app.indai.voice; return { listening: v.state.listening, stream: !!(v._stream && v._stream.active), session: navigator.audioSession ? navigator.audioSession.type : null }; });
    check(`[${tag}] mic open${withSession ? ': session is play-and-record' : ''}`, st.listening && st.stream && (!withSession || st.session === 'play-and-record'), JSON.stringify(st));
    await A(() => { window.__tracks = window.__indai.app.indai.voice._stream.getTracks(); });
    await page.tap('#fab');      // tap again: stop listening
    await page.waitForFunction(() => !window.__indai.app.indai.voice.state.listening, null, { timeout: 8000 });
    await sleep(300);
    st = await A(() => { const v = window.__indai.app.indai.voice; return { stream: v._stream, tracks: window.__tracks.map(t => t.readyState), session: navigator.audioSession ? navigator.audioSession.type : null, log: navigator.audioSession ? navigator.audioSession._log : null }; });
    check(`[${tag}] listening ended: mic released at once${withSession ? ', session back to playback' : ''}`, st.stream === null && st.tracks.every(x => x === 'ended') && (!withSession || st.session === 'playback'), JSON.stringify(st));
    // a second turn still works after the mic was released
    await page.tap('#fab');
    await page.waitForFunction(() => window.__indai.app.indai.voice.state.listening, null, { timeout: 8000 }).catch(() => {});
    check(`[${tag}] mic opens again for the next turn`, await A(() => window.__indai.app.indai.voice.state.listening));
    await page.tap('#fab'); await page.waitForFunction(() => !window.__indai.app.indai.voice.state.listening, null, { timeout: 8000 }); await sleep(300);
    // waking the audio engine never throws and leaves it running
    await A(() => window.__indai.app.wakeSound(true)); await sleep(1700); await A(() => window.__indai.app.wakeSound(false));
    info = await A(() => window.__indai.app.audioInfo());
    check(`[${tag}] wake-up leaves the audio engine running`, info.ctx === 'running', JSON.stringify(info));
    // a suspended engine is resumed by the next thing that needs it
    const resumed = await A(async () => { const v = window.__indai.app.indai.voice; await v.ctx.suspend(); const before = v.ctx.state; v.audioCtx(); await new Promise(r => setTimeout(r, 300)); return { before, after: v.ctx.state }; });
    check(`[${tag}] a paused audio engine is resumed`, resumed.before === 'suspended' && resumed.after === 'running', JSON.stringify(resumed));
    if (withSession) {
      // natural voice that takes too long to start, twice: she switches to the phone's own voice and says so
      const slow = await A(async () => {
        const app = window.__indai.app, v = app.indai.voice;
        app.settings.voiceEngine = 'neural';
        v.state.ttsReady = true; v._ttsAsked = true; v.ttsFailedAt = 0;
        v.worker = { postMessage(m) { if (m.type === 'speak') setTimeout(() => v.onWorker({ type: 'audio', id: m.id, epoch: m.epoch, samples: new Float32Array(2400), rate: 24000 }), 3700); } };
        const one = async () => { v.speak('Hello there.'); await new Promise(r => setTimeout(r, 4300)); };
        await one(); const afterOne = !!app.slowVoice; await one();
        return { afterOne, slow: !!app.slowVoice, engine: v.getSettings().voiceEngine, saved: app.settings.voiceEngine, lag: app.voiceLag, said: app.indai.log.some(l => /natural voice is slow on this phone/.test(l.text)) };
      });
      check(`[${tag}] slow natural voice twice in a row: falls back to the phone's voice and says so`, !slow.afterOne && slow.slow && slow.engine === 'system' && slow.saved === 'neural' && slow.lag > 3.5 && slow.said, JSON.stringify(slow));
      await A(() => window.__indai.app.closeFocus());
      await A(() => window.__indai.app.openSettings()); await sleep(1900);
      const vs = await page.textContent('#voice-status');
      check(`[${tag}] settings shows the sound state`, /Sound: on, plays even when the phone is on silent/.test(vs) && /started speaking after \d\.\d s/.test(vs) && /Using the phone's own voice for now/.test(vs) && /volume up/.test(vs), JSON.stringify(vs.slice(-330)));
      await page.locator('#voice-status').scrollIntoViewIfNeeded(); await sleep(200);
      await page.screenshot({ path: `${OUT}/snd-settings.png` });
      await A(() => { window.__indai.app.toggleMute(true); }); await sleep(1700);
      check(`[${tag}] settings says when she is muted`, /Sound: muted/.test(await page.textContent('#voice-status')));
    }
    check(`[${tag}] no page errors`, errs.length === 0, errs.slice(0, 4).join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
