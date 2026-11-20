// INDAI's hosted voice in the browser: the voice page (voice.html) and the app speaking through it
// (js/cloud-voice.js). The back end is a stand-in that answers with a short real sound; nothing reaches ElevenLabs.
const { chromium } = require('playwright');
const BASE = process.env.INDAI_TEST_URL || 'http://127.0.0.1:8765/indai/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };
// a third of a second of a soft tone, as a WAV file
function tone(ms = 320) {
  const rate = 22050, n = Math.round(rate * ms / 1000), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 3000), 44 + i * 2);
  return b;
}
const VOICES = [
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', category: 'premade', gender: 'male', accent: 'American', age: 'middle aged', use: 'narration', description: 'Deep', preview_url: null },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', category: 'premade', gender: 'female', accent: 'American', age: 'young', use: 'conversational', description: 'Soft and warm', preview_url: null },
  { id: 'AAAAAAAAAAAAAAAAAAAA', name: 'Mira', category: 'generated', gender: 'female', accent: 'British', age: 'young', use: 'advertisement', description: 'Bright', preview_url: null },
];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'x-indai-voice-model' };

async function voiceBackend(page, b) {
  Object.assign(b, { calls: [], configured: true, ready: true, chosen: { id: VOICES[1].id, name: 'Sarah', picked: 'auto' }, speakFails: null, delay: 0 });
  await page.route('**://zptjziewsfuvfcogrikz.supabase.co/functions/v1/indai-voice', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || '{}'), pass = req.headers()['x-indai-pass'] || '';
    b.calls.push({ ...body, _pass: pass });
    const send = (status, j) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(j) });
    if (pass !== 'open sesame') return send(401, { error: 'passcode', message: 'Wrong or missing INDAI passcode.' });
    const status = () => !b.configured ? { configured: false, ready: false } : !b.ready ? { configured: true, ready: false, error: 'voice_key', message: 'ElevenLabs did not accept the API key: Invalid API key' } : { configured: true, ready: true, voice: b.chosen, model: 'eleven_v4_turbo', daily_chars: 60000 };
    if (body.op === 'status') return send(200, status());
    if (!b.configured) return send(503, { error: 'not_configured', message: 'Add ELEVENLABS_API_KEY to the Supabase secrets first.' });
    if (body.op === 'voices') return send(200, { voices: VOICES, chosen: b.chosen.id });
    if (body.op === 'choose') { const v = VOICES.find(x => x.id === body.voice_id); if (!v) return send(404, { error: 'no_voice', message: 'That voice is not in your ElevenLabs account.' }); b.chosen = { id: v.id, name: v.name, picked: 'owner' }; return send(200, status()); }
    if (body.op === 'speak') {
      if (b.speakFails) return send(b.speakFails.status, b.speakFails.body);
      if (b.delay) await sleep(b.delay);
      return route.fulfill({ status: 200, contentType: 'audio/mpeg', headers: { ...cors, 'x-indai-voice-model': 'eleven_v4_turbo' }, body: tone() });
    }
    return send(400, { error: 'bad_request', message: 'no' });
  });
}
async function appBackend(page) {
  await page.route('**://zptjziewsfuvfcogrikz.supabase.co/**', async (route) => {
    const req = route.request(), u = new URL(req.url());
    const json = (j, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(j) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname.endsWith('/indai-market')) return json({ error: 'unavailable', message: 'not in this test' }, 503);
    if (u.pathname.endsWith('/indai-brain')) return json(req.method() === 'GET' ? { configured: false, passcode: false, memory: true } : { error: 'not_configured', message: 'off' }, req.method() === 'GET' ? 200 : 503);
    if (u.pathname.endsWith('/indai-schwab')) return json({ error: 'not_connected', message: 'off in this test' }, 409);
    if (u.pathname.includes('/rest/v1/')) return json([]);
    if (u.pathname.endsWith('/indai-tv')) return json(u.searchParams.get('ticker') ? { ticker: u.searchParams.get('ticker'), bars: [], now: Date.now() } : u.searchParams.get('bars') ? { bars: [], live: [], now: Date.now(), cursor: new Date().toISOString() } : { alerts: [] });
    return json({ error: 'not_found' }, 404);
  });
}
const speaks = (b) => b.calls.filter(c => c.op === 'speak');
const settle = (page) => page.waitForFunction(() => document.getElementById('state').textContent !== 'Checking…');

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    // ------------------------------------------------------------ the voice page
    for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1280, height: 800 }]]) {
      const ctx = await browser.newContext({ viewport }), page = await ctx.newPage(), b = {}, errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await voiceBackend(page, b);
      await page.goto(BASE + 'voice.html'); await settle(page);
      check(`[${name}] without a saved passcode the page asks for it`, await page.isVisible('#passcard') && await page.isHidden('#picker') && b.calls.length === 0);
      await page.fill('#pass', 'guess'); await page.click('#passgo'); await page.waitForFunction(() => /not accepted/.test(document.getElementById('state').textContent));
      check(`[${name}] a wrong passcode is refused in plain words`, await page.isVisible('#passcard'));
      await page.evaluate(() => localStorage.setItem('jarvis.settings.v1', JSON.stringify({ researchPass: 'open sesame', name: 'Bongs' })));

      b.configured = false; await page.reload(); await settle(page);
      check(`[${name}] before the key is in Supabase: says so, shows the four steps and the link to the secrets`, (await page.textContent('#state')) === 'Not set up yet.' && await page.isVisible('#setup') && /ELEVENLABS_API_KEY/.test(await page.textContent('#setup')) && (await page.getAttribute('#setup a.btn', 'href')).includes('/functions/secrets') && await page.isHidden('#picker') && await page.isHidden('#hear'));
      b.configured = true; b.ready = false; await page.reload(); await settle(page);
      check(`[${name}] a key ElevenLabs refuses is said in its own words`, /not answering/.test(await page.textContent('#state')) && /Invalid API key/.test(await page.textContent('#detail')) && await page.isHidden('#picker'));

      b.ready = true; b.calls.length = 0; await page.reload(); await page.waitForSelector('#voices .voice');
      const rows = await page.locator('#voices .voice').allTextContents();
      check(`[${name}] ready: her voice is named, and the women's voices in his account are listed first`, (await page.textContent('#state')) === 'Her voice: Sarah' && /picked this one to start/.test(await page.textContent('#detail')) && rows.length === 2 && /^SarahAmerican · young · conversational · Soft and warmListenChosen$/.test(rows[0]) && /^Mira.*ListenUse$/.test(rows[1]) && b.calls.map(c => c.op).join() === 'status,voices', rows);
      await page.click('[data-g=""]'); const all = await page.locator('#voices .voice').count();
      await page.fill('#find', 'bright'); const found = await page.locator('#voices .voice').allTextContents();
      check(`[${name}] All shows every voice, and the search narrows by name or style`, all === 3 && found.length === 1 && found[0].startsWith('Mira'), { all, found });
      await page.fill('#find', '');

      b.calls.length = 0;
      await page.locator('#voices .voice', { hasText: 'Mira' }).locator('button', { hasText: 'Listen' }).click();
      await page.waitForFunction(() => !document.querySelector('#voices .voice:nth-child(3) button').disabled);
      let s = speaks(b);
      check(`[${name}] Listen says one line in that voice, with his name, and changes nothing`, s.length === 1 && s[0].voice_id === 'AAAAAAAAAAAAAAAAAAAA' && /^Good morning, Bongs\. I'm INDAI\./.test(s[0].text) && s[0].text.length < 200 && b.chosen.name === 'Sarah' && (await page.textContent('#out')) === '', { s, out: await page.textContent('#out') });
      await page.locator('#voices .voice', { hasText: 'Mira' }).locator('button', { hasText: 'Use' }).click();
      await page.waitForFunction(() => /Mira is her voice now/.test(document.getElementById('out').textContent));
      check(`[${name}] Use makes it hers and the page shows it`, b.chosen.name === 'Mira' && b.calls.some(c => c.op === 'choose' && c.voice_id === 'AAAAAAAAAAAAAAAAAAAA') && (await page.textContent('#state')) === 'Her voice: Mira' && /she uses everywhere/.test(await page.textContent('#detail')) && await page.locator('#voices .voice.hers', { hasText: 'Mira' }).count() === 1);
      b.calls.length = 0; await page.click('#hear'); await page.waitForFunction(() => !document.getElementById('hear').disabled);
      s = speaks(b);
      check(`[${name}] "Hear her" speaks in her own voice`, s.length === 1 && s[0].voice_id === undefined && s[0]._pass === 'open sesame');
      b.speakFails = { status: 402, body: { error: 'voice_quota', message: "ElevenLabs says this month's credits are used up." } };
      await page.click('#hear'); await page.waitForFunction(() => /credits are used up/.test(document.getElementById('out').textContent));
      check(`[${name}] a refusal is shown in words`, (await page.getAttribute('#out', 'class')) === 'bad'); b.speakFails = null;
      await page.click('#use');
      const off = await page.evaluate(() => localStorage.getItem('indai.voice.hosted')), n = b.calls.length;
      await page.click('#use');
      check(`[${name}] the switch turns the hosted voice off and on for this device only (nothing is sent)`, off === 'off' && (await page.evaluate(() => localStorage.getItem('indai.voice.hosted'))) === 'on' && b.calls.length === n);
      const box = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth > innerWidth + 1, small: [...document.querySelectorAll('button, a.btn, input[type=search]')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.textContent || e.id) }));
      check(`[${name}] fits the screen with tap-sized controls, no script errors`, !box.wide && box.small.length === 0 && errors.length === 0, { box, errors });
      await ctx.close();
    }

    // ------------------------------------------------------------ the app speaks through it
    const open = async ({ pass = 'open sesame', query = '', hosted = '', known = '' } = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }), page = await ctx.newPage(), b = {}, errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(([p, h, k]) => {
        if (window !== window.top) return;
        const s = JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}'); s.researchPass = p; s.voice = true; s.voiceEngine = 'system'; s.main = 'SPY'; localStorage.setItem('jarvis.settings.v1', JSON.stringify(s));
        if (h) localStorage.setItem('indai.voice.hosted', h); if (k) localStorage.setItem('indai.voice.known', k);
        window.__system = []; const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => { window.__system.push(u.text); }; }
      }, [pass, hosted, known]);
      await appBackend(page); await voiceBackend(page, b);
      await page.goto(BASE + '?nosw=1&nocheckin=1' + query);
      await page.waitForFunction(() => window.__indai && window.__indai.app.chart, null, { timeout: 30000 });
      await sleep(900);
      return { ctx, page, b, errors };
    };
    const VERDICT = 'This one is amber. Price is below VWAP by 0.42 percent and the 665 calls need a move by the close. Watch 664.50.';
    {
      const { ctx, page, b, errors } = await open();
      const st = await page.evaluate(() => { const a = window.__indai.app; return { cloud: { state: a.cloudVoice.state, voice: a.cloudVoice.voice }, known: localStorage.getItem('indai.voice.known') }; });
      check('[app] with the passcode saved the app finds her hosted voice', st.cloud.state === 'on' && st.cloud.voice.name === 'Sarah' && st.known === 'on' && b.calls[0].op === 'status', st);
      b.calls.length = 0;
      await page.evaluate((t) => { const v = window.__indai.app.indai.voice; window.__states = []; const on = v.onState; v.onState = (s) => { window.__states.push(s.speaking); on(s); }; window.__seq0 = v.seq; v.speak(t); }, VERDICT);
      await page.waitForFunction(() => window.__states.length > 1 && window.__states.at(-1) === false, null, { timeout: 8000 }).catch(() => {});
      const r = await page.evaluate(() => { const a = window.__indai.app, v = a.indai.voice; return { states: window.__states, seq: v.seq - window.__seq0, system: window.__system, spoken: a.cloudVoice.spoken, tts: !!v._ttsAsked, speaking: v.state.speaking }; });
      const s = speaks(b);
      check('[app] what she says is fetched in pieces: the first sentence alone, then the rest, each knowing its neighbour', s.length === 2 && s[0].text === 'This one is amber.' && s[0].previous === undefined && /^Price is below V-wap by 0\.42 percent/.test(s[0].next) && /^Price is below V-wap by 0\.42 percent.*Watch 664\.50\.$/.test(s[1].text) && s[1].previous === 'This one is amber.' && s.every(x => x._pass === 'open sesame' && x.voice_id === undefined), s);
      check('[app] it plays here, "speaking" goes on and then off, and the voice on the device is not used or downloaded', r.states[0] === true && r.states.at(-1) === false && r.spoken === 2 && r.seq === 0 && r.system.length === 0 && !r.tts && !r.speaking, r);

      // stopping
      b.calls.length = 0; b.delay = 250;
      await page.evaluate((t) => { const v = window.__indai.app.indai.voice; v.speak(t + ' ' + t); setTimeout(() => v.stopSpeaking(), 120); }, VERDICT);
      await sleep(1500);
      const stopped = await page.evaluate(() => { const a = window.__indai.app; return { speaking: a.indai.voice.state.speaking, spoken: a.cloudVoice.spoken, playing: !!a.indai.voice.playing }; });
      check('[app] "stop" stops her at once and nothing more is played', !stopped.speaking && stopped.spoken === 2 && !stopped.playing, stopped);
      b.delay = 0;

      // the hosted voice refuses: the device's own voice says it, she says why once, and the hosted voice rests
      b.calls.length = 0; b.speakFails = { status: 402, body: { error: 'voice_quota', message: "ElevenLabs says this month's credits are used up." } };
      await page.evaluate((t) => { window.__system.length = 0; window.__indai.app.indai.voice.speak(t); }, VERDICT);
      await page.waitForFunction(() => window.__system.length > 0, null, { timeout: 5000 }).catch(() => {});
      const fb = await page.evaluate(() => { const a = window.__indai.app; return { system: window.__system.slice(), resting: a.cloudVoice.downUntil > Date.now() + 20 * 60e3, note: a.cloudVoice.note, log: a.indai.log.slice(-1)[0]?.text }; });
      check('[app] when the hosted voice refuses, the device says the whole reply itself', fb.system.length === 1 && /^This one is amber\. Price is below V-wap by 0\.42 percent.*Watch 664\.50\.$/.test(fb.system[0]), fb.system);
      check('[app] she says why once, in writing, and the hosted voice rests for half an hour', fb.resting && /credits are used up/.test(fb.note) && /credits are used up\. I'm using this device's own voice for now\./.test(fb.log || ''), fb);
      b.speakFails = null; b.calls.length = 0;
      await page.evaluate(() => { window.__system.length = 0; window.__indai.app.indai.voice.speak('Still here.'); });
      await sleep(400);
      check('[app] while it rests nothing is asked of it', speaks(b).length === 0 && (await page.evaluate(() => window.__system.length)) === 1);
      // Settings says what is going on
      await page.evaluate(() => { const a = window.__indai.app; a.ui.openSheet('settings'); });
      await page.waitForFunction(() => /Hosted voice/.test(document.getElementById('voice-status')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
      const resting = await page.evaluate(() => document.getElementById('voice-status').textContent.split('\n')[0]);
      await page.evaluate(() => { const a = window.__indai.app; a.cloudVoice.downUntil = 0; a.markDirty('settings'); });
      await page.waitForFunction(() => !/Resting/.test(document.getElementById('voice-status').textContent), null, { timeout: 5000 }).catch(() => {});
      const line = await page.evaluate(() => ({ text: document.getElementById('voice-status').textContent.split('\n')[0], link: document.querySelector('#voice-status a')?.getAttribute('href') }));
      check('[app] Settings names the hosted voice, says when it is resting and why, and links to the voice page', /^Hosted voice \(Sarah\): she speaks from the server, nothing to download\. Resting for a few minutes: ElevenLabs says this month's credits are used up\. Choose her voice$/.test(resting) && line.text === 'Hosted voice (Sarah): she speaks from the server, nothing to download. Choose her voice' && line.link === './voice.html', { resting, line });
      check('[app] no script errors', errors.length === 0, errors);
      await ctx.close();
    }
    {
      const { ctx, page, b } = await open({ known: 'on' });
      // a slow answer: the device's voice takes over rather than leaving her silent
      b.calls.length = 0; b.delay = 12000;
      await page.evaluate(() => { window.__system.length = 0; window.__indai.app.indai.voice.speak('Good morning.'); });
      await page.waitForFunction(() => window.__system.length > 0, null, { timeout: 12000 }).catch(() => {});
      const slow = await page.evaluate(() => ({ system: window.__system.slice(), note: window.__indai.app.cloudVoice.note, rest: Math.round((window.__indai.app.cloudVoice.downUntil - Date.now()) / 60e3) }));
      check('[app] a hosted voice that takes over nine seconds is given up on, and the device speaks', slow.system.join() === 'Good morning.' && /slow to answer/.test(slow.note) && slow.rest >= 1 && slow.rest <= 2, slow);
      await ctx.close();
    }
    for (const [label, opts] of [['without a saved passcode', { pass: '' }], ['switched off on this device', { hosted: 'off', known: 'on' }], ['in demo mode', { query: '&demo=1', known: 'on' }]]) {
      const { ctx, page, b } = await open(opts);
      await page.evaluate(() => { window.__system.length = 0; window.__indai.app.indai.voice.speak('Good morning.'); });
      await sleep(500);
      const sys = await page.evaluate(() => window.__system.length);
      check(`[app] ${label} the hosted voice is not asked for anything and the device speaks as before`, b.calls.length === 0 && sys === 1, { calls: b.calls, sys });
      await ctx.close();
    }
    {
      // the back end has no voice set up: the app notices and keeps to the device's voice, even if it was on last time
      const { ctx, page, b } = await open({ known: 'on' });
      b.configured = false; b.calls.length = 0;
      await page.evaluate(() => window.__indai.app.cloudVoice.check()); await sleep(300);
      await page.evaluate(() => { window.__system.length = 0; window.__indai.app.indai.voice.speak('Good morning.'); }); await sleep(400);
      const off = await page.evaluate(() => ({ state: window.__indai.app.cloudVoice.state, known: localStorage.getItem('indai.voice.known'), sys: window.__system.length }));
      check('[app] when the back end has no hosted voice, the app uses the device and remembers that', off.state === 'off' && off.known === 'off' && off.sys === 1 && speaks(b).length === 0, off);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
