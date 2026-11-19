// INDAI for the web: the same brains as the Quest command center, with a flat, responsive face.
// This file is the website's counterpart of the Quest app's main.js. It builds the `app` object that
// indai.js talks to (same method names), minus everything 3D. The screens themselves are in views.js,
// sheets.js and chart.js. Headset-only calls (scenes, gestures, recenter, tutorial) answer politely.
import { loadSettings, saveSettings, loadDay, saveDay, freshDay, todayET, parseLevels } from './store.js';
import { MarketFeed, LEADLAG } from './feeds.js';
import { marketStatus, fmtDuration, etParts, INTERVAL_LABEL, isTradingDay, nextTradingDay, prevTradingDay, etToMs } from './market.js';
import { STRATEGIES, PROFILES, buildPlan, temperature, scanSetups, suggestContract } from './signals.js';
import { Indai, wordsToNumbers } from './indai.js';
import { relay } from './relay.js';
import { bs, yearsTo } from './options.js';
import { fmtPrice, fmtMoney } from './hud.js';
import { nearestLevel } from './panels.js';
import { installRelayGuards, researchBlocked } from './demo.js';
import { initViews } from './views.js';
import { initSheets } from './sheets.js';
import { initIdeas } from './ideas.js';
import { initLock } from './lock.js';
import { initPush } from './push.js';
import { initRetro } from './retro.js';

const STEPS = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
const ETFS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'SPX', 'XLF', 'XLE', 'SMH', 'TLT', 'GLD']);
const SHEETS = ['analysis', 'calc', 'deep', 'summary', 'plan', 'selftest', 'settings', 'ideas'];
// ids the shared code marks dirty -> the website views that show that data
const DIRTY_MAP = { plan: ['today', 'plan', 'indai'], dock: ['dock'], scenes: [], coach: [], risk: ['risk', 'today'] };

// ------------------------------------------------------------------ app state
const app = {
  settings: loadSettings(),
  day: loadDay(),
  inXR: false,              // always false here: this is the flat website
  xrMode: null,
  web: true,
  views: {},
  dirty: new Set(),
  focus: null,
  consolidated: false,
  analysis: null,
  calc: null,
  deep: null,
  selfTest: null,
  morningGex: {},
  liveGex: {},
  tvLevels: {},
  tvAlerts: [],
  signals: [],
  temp: null,
  tutorial: null,
  tab: 'chart',
  layout: 'phone',
  inputMode: 'typed',
  markDirty(id) {
    if (id === 'all') Object.keys(this.views).forEach(k => this.dirty.add(k));
    else (DIRTY_MAP[id] || [id]).forEach(k => this.dirty.add(k));
    schedule();
  },
};
app.levels = parseLevels(app.settings.levelsText);
app.feed = new MarketFeed(app.settings);
installRelayGuards(app);
app.indai = new Indai(app);
app.saveSettings = () => saveSettings(app.forceDemo ? { ...app.settings, dataMode: app.savedDataMode } : app.settings);   // ?demo=1 is for this visit only
const say = (...a) => app.indai.say(...a);

// Safari and every iOS browser: the built-in speech recognizer is unreliable there, and WebGPU can't be assumed.
// Listen with the on-device model on plain WebAssembly unless the person picks the browser recognizer in Settings.
{
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(ua);
  app.platform = { iOS, safari, standalone: window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true };
  if (iOS || safari) {
    const v = app.indai.voice, SR = v.SR;
    Object.defineProperty(v, 'SR', { configurable: true, get: () => (app.settings.micEngine === 'browser' ? SR : null) });
    Object.defineProperty(v, 'webgpu', { configurable: true, get: () => false });
  }
}

// When the person is typing, INDAI doesn't open the microphone by herself (after a question or for a
// hands-free follow-up). Tapping the mic switches back to voice and those come back.
{
  const ind = app.indai, talk = ind.talk.bind(ind);
  ind.talk = (opts) => { if (!app._tapTalk && app.inputMode === 'typed') return Promise.resolve(); app._quietTalk = !!opts?.quiet; return talk(opts); };
  // While web research can't run (today's thinking budget is used up, or research is paused after failing),
  // she doesn't promise to check the news at the end of a quant read.
  // "Show me the ideas" (typed or spoken) opens today's list.
  const route = ind.route.bind(ind);
  ind.route = async (text) => {
    const plain = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!ind.awaiting && /^(?:(?:show|open|see|list|what are|where are) )?(?:me )?(?:all )?(?:(?:the|my|today s|todays) )?(?:(?:trade|trading) )?(?:ideas|setups|set ups)(?: (?:today|list|so far))?$/.test(plain)) {
      const n = app.signals.filter(x => !x.practice).length;
      app.openIdeas();
      ind.say(n ? `${n} idea${n === 1 ? '' : 's'} so far today. Newest first.` : 'No setups have confirmed yet today. They show here the moment one does.', 'info');
      return 'ok';
    }
    if (!ind.awaiting && /^(?:(?:show|open|run|do|start|give) )?(?:me )?(?:the |a |my |today s |todays )?(?:retrospective|retro|post mortem|day review|review of (?:the day|today))(?: (?:for )?today)?$/.test(plain)) {
      app.openRetro();
      ind.say('Here is the retrospective.', 'info');
      return 'ok';
    }
    return route(text);
  };
  const sayIt = ind.say.bind(ind);
  ind.say = (text, ...rest) => sayIt(typeof text === 'string' && researchBlocked() ? text.replace(/ Checking the news and today's events now\.$/, '') : text, ...rest);
  // Tapping the mic again (or letting go of the space bar) before saying anything simply closes the mic:
  // no "I didn't catch that", and no listening again straight after.
  const v = ind.voice, listen = v.listen.bind(v);
  v.listen = async (opts) => { const t = await listen(opts); return t === '' && Date.now() - (app._userStop || 0) < 2500 ? null : t; };
}

// ------------------------------------------------------------------ being heard, on a phone above all
// iPhone and iPad (every browser there runs on WebKit) have four ways of leaving her silent, each handled here:
//   1. The ring/silent switch mutes web audio unless the page says it is playing media: say so (audio session "playback").
//   2. While the microphone is open the phone plays everything at quiet "call" volume, and the shared voice code keeps
//      the mic open for 25 seconds after you stop talking, which is exactly when she answers. Let go of the mic the
//      moment listening ends and switch the session back to playback.
//   3. Coming back from the lock screen or another app can leave the audio engine stopped ("interrupted", or "running"
//      with a clock that stands still). Wake it on return and on every tap.
//   4. The phone's own voice (used while the natural voice downloads) stays silent until a tap has unlocked it.
// And on any phone: if the natural voice takes several seconds to start talking, use the phone's own voice instead.
{
  const v = app.indai.voice, iOS = app.platform.iOS, phone = iOS || /Android/i.test(navigator.userAgent);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const session = (type) => { try { if (iOS && navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch {} };
  const audioCtx = v.audioCtx.bind(v);
  v.audioCtx = () => { const c = audioCtx(); if (c.state !== 'running' && c.state !== 'closed') c.resume().catch(() => {}); return c; };
  let micWanted = false;                                  // from the tap on the mic until listening has ended
  const micOn = () => micWanted || v.state.listening;
  if (iOS) {
    const setState = v.setState.bind(v);
    v.setState = (p) => {
      const was = v.state.listening; setState(p);
      if (was && !v.state.listening) { micWanted = false; try { v._stream?.getTracks().forEach(t => t.stop()); } catch {} v._stream = null; session('playback'); }
    };
    const listen = v.listen.bind(v);
    v.listen = (opts) => {
      if (!v.state.listening) { micWanted = true; session('play-and-record'); }
      const p = listen(opts);
      p.catch(() => {}).then(() => { micWanted = false; if (!v.state.listening) session('playback'); });
      return p;
    };
  }
  app.micSession = (on) => session(on || micOn() ? 'play-and-record' : 'playback');
  let unlocked = false, quietLoop = null, lastWake = 0;
  // Call from a tap. Safe to call on every tap.
  app.unlockSound = () => {
    session(micOn() ? 'play-and-record' : 'playback');
    if (unlocked) return; unlocked = true;
    if (iOS || app.platform.safari) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch {} }
    // Older iPhones without the audio session setting: a silent clip playing in a loop has the same effect on the silent switch.
    if (iOS && !navigator.audioSession) { try { quietLoop = new Audio('data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//MgxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVf/zIsQnAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVV//MgxE8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVf/zIMR2AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVX/8yDEnQAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVV//MixMQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVX/8yDE2AAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVV//MgxNgAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVf/zIMTYAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVX/8yLE1wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVf/zIMTYAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVX/8yDE2AAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVV//MgxNgAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVf/zIsTXAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVV//MgxNgAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVf/zIMTYAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVX/8yDE2AAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVV//MixNcAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVX/8yDE2AAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVV//MgxNgAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zIMTYAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/8yLE1wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zIMTYAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/8yDE2AAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//MgxNgAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ=='); quietLoop.loop = true; quietLoop.preload = 'auto'; quietLoop.setAttribute('x-webkit-airplay', 'deny'); quietLoop.play().catch(() => {}); } catch {} }
  };
  app.wakeSound = async (tap = false) => {
    const c = v.ctx, now = Date.now();
    if (!c || c.state === 'closed' || now - lastWake < 1200) return;
    lastWake = now;
    if (!micOn()) session('playback');
    if (iOS && !tap) { try { if (!speechSynthesis.speaking) speechSynthesis.cancel(); } catch {} }
    if (quietLoop && quietLoop.paused && tap) quietLoop.play().catch(() => {});
    try {
      if (c.state !== 'running') await Promise.race([c.resume(), wait(500)]);
      const t = c.currentTime; await wait(180);
      if (c.state !== 'running' || c.currentTime !== t) return;            // not running yet (needs a tap), or healthy
      await Promise.race([c.suspend(), wait(400)]); await Promise.race([c.resume(), wait(500)]); await wait(180);
      // still stuck: start a fresh audio engine (only possible from a tap, and never in the middle of listening or speaking)
      if (c.currentTime === t && tap && v.ctx === c && !v.playing && !micOn()) { try { c.close(); } catch {} v.ctx = null; v.unlock(); }
    } catch {}
  };
  // How long the natural voice takes to start talking. It runs on this device, and on a phone that can be slow.
  const asked = new Map();
  let slow = 0;
  const speak = v.speak.bind(v);
  v.speak = (text) => { const idle = !v.state.speaking && !v.audioQueue.length, first = v.seq; speak(text); if (idle && v.seq > first) { asked.clear(); asked.set(first, performance.now()); } };
  const onWorker = v.onWorker.bind(v);
  v.onWorker = (m) => {
    if (m.type === 'audio' && asked.has(m.id)) {
      const lag = (performance.now() - asked.get(m.id)) / 1000, dur = m.samples.length / (m.rate || 24000); asked.delete(m.id);
      app.voiceLag = lag;
      slow = lag > 3.5 && lag > dur * 0.8 ? slow + 1 : 0;
      if (phone && slow >= 2 && !app.slowVoice && app.settings.voiceEngine !== 'system') {
        app.slowVoice = true;
        say("The natural voice is slow on this phone, so I'm using the phone's own voice for now. It answers at once. You can change it back under Voice in Settings.", 'info', { speak: false });
        app.markDirty('settings');
      }
    }
    onWorker(m);
  };
  const getSettings = v.getSettings;
  v.getSettings = () => (app.slowVoice ? { ...getSettings(), voiceEngine: 'system' } : getSettings());
  app.audioInfo = () => ({ ctx: v.ctx ? v.ctx.state : 'not started', session: iOS && navigator.audioSession ? navigator.audioSession.type : null, lag: app.voiceLag ?? null, slow: !!app.slowVoice, iOS });
}

// ------------------------------------------------------------------ GEX levels
// Priority: levels you pasted > this morning's GEX refresh > live from the options chain > an older morning refresh > demo.
const num = (v) => v == null || v === '' ? null : Number(v);
function fromMorning(a, n, source) {
  return {
    cw: num(a.call_wall), pw: num(a.put_wall), zg: num(a.gamma_flip), cw2: num(a.call_wall2), pw2: num(a.put_wall2),
    near: n ? { expiry: n.expiry, cw: num(n.call_wall), pw: num(n.put_wall), zg: num(n.gamma_flip) } : null,
    source, asof: a.asof_et, netGexM: num(a.net_gex_m),
  };
}
function fromLive(c) {
  const g = c.gex || {}, n = c.gexNear;
  return {
    cw: g.callWall ?? null, pw: g.putWall ?? null, zg: g.zeroGamma ?? null, cw2: g.callWall2 ?? null, pw2: g.putWall2 ?? null, regime: g.regime,
    near: n ? { expiry: n.expiry, cw: n.callWall ?? null, pw: n.putWall ?? null, zg: n.zeroGamma ?? null } : null,
    source: 'live', asof: c.timestamp,
  };
}
app.levelsFor = (sym) => {
  const m = app.morningGex[sym], live = app.liveGex[sym];
  if (app.levels[sym]) return { ...app.levels[sym], source: 'manual', near: m?.N ? fromMorning(m.N, m.N, 'x').near : live ? fromLive(live).near : null };
  const tv = app.tvLevels[sym];
  if (tv && tv.day === todayET() && (tv.cw != null || tv.pw != null)) {
    const base = m?.A ? fromMorning(m.A, m.N, 'x') : live ? fromLive(live) : {};
    return { ...base, ...tv, source: 'tradingview', asof: tv.asof };
  }
  if (app.feed.status.mode === 'demo' && app.feed.demoLevels[sym]) return { ...app.feed.demoLevels[sym], source: 'demo' };
  if (m?.A && String(m.A.asof_et || '').slice(0, 10) === todayET()) return fromMorning(m.A, m.N, 'morning');
  if (live?.gex && (live.gex.callWall || live.gex.putWall)) return fromLive(live);
  if (m?.A) return fromMorning(m.A, m.N, 'morning-stale');
  return null;
};
app.noteChainGex = (sym, chain) => {
  if (!chain || !chain.gex || chain.demo) return;
  app.liveGex[sym] = { gex: chain.gex, gexNear: chain.gexNear, timestamp: chain.timestamp, spot: chain.spot, at: Date.now() };
  ['levels', 'chart', 'watch', 'summary'].forEach(id => app.markDirty(id));
};
async function loadMorningGex() {
  try { app.morningGex = await relay.morningGex(); app.markDirty('all'); } catch (e) { if (!e.offline && !(e instanceof TypeError)) console.warn('morning GEX', e); }
}
// TradingView alerts (webhook -> indai-tv -> here). Your Pine alerts are spoken and can update GEX levels.
let tvSeen = null;
async function pollTradingView() {
  let res;
  try { res = await relay.tvAlerts(); } catch { return; }
  const rows = (res.alerts || []).slice().reverse();   // oldest first
  const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
  const etTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const first = tvSeen === null;
  if (first) tvSeen = 0;
  for (const a of rows) {
    if (a.id <= tvSeen) continue;
    tvSeen = a.id;
    app.tvAlerts.unshift(a); app.tvAlerts.length = Math.min(app.tvAlerts.length, 30);
    if (a.levels && a.ticker) {
      const lv = {}; for (const k of ['cw', 'pw', 'zg', 'cw2', 'pw2']) if (a.levels[k] != null) lv[k] = Number(a.levels[k]);
      app.tvLevels[a.ticker] = { ...(app.tvLevels[a.ticker]?.day === etDay(a.received_at) ? app.tvLevels[a.ticker] : {}), ...lv, day: etDay(a.received_at), asof: `${etDay(a.received_at)} ${etTime(a.received_at)}` };
      ['levels', 'chart', 'watch'].forEach(id => app.markDirty(id));
    }
    const recent = Date.now() - Date.parse(a.received_at) < 3 * 60e3;
    if (first && !recent) continue;
    say(`TradingView${a.ticker ? ` · ${a.ticker}` : ''}: ${a.text}`, 'alert', { speak: recent && app.settings.alerts.tradingview !== false });
    if (a.ticker && app.settings.symbols.includes(a.ticker)) { flash('watch'); if (a.ticker === app.settings.main) flash('chart'); }
  }
  if (first && rows.length) say(`${rows.length} TradingView alert${rows.length === 1 ? '' : 's'} in the last two days. The newest: ${rows[rows.length - 1].text}`, 'info', { speak: false });
  app.markDirty('more'); app.markDirty('settings');
}
// Live candles from the INDAI Bridge indicator running in your TradingView account.
let bridgeSince = 0;
let bridgeGot = 0;
// TradingView posts each one-minute candle a few seconds after the minute turns. While the bridge is live, look every
// 2.5 seconds from then until that candle is in (so a setup shows within seconds of its candle closing), and every
// 8 seconds the rest of the time.
function bridgeGap() {
  if (marketStatus().state === 'closed') return 60000;
  const now = Date.now(), sec = (now / 1000) % 60, since = now - bridgeGot;
  const waiting = app.feed.bridgeLive && sec >= 1.5 && sec < 30 && since > sec * 1000;     // this minute's candles are not in yet
  return waiting || since < 6000 ? 2500 : 8000;                                            // one ticker's candle in: the others follow
}
async function pollBridge() {
  if (app.feed.status.mode === 'demo') return;
  let j; try { j = await relay.tvBars(bridgeSince); } catch { return; }
  const rows = j.bars || [];
  for (const b of rows) {
    const sym = b.ticker; if (!sym) continue;
    app.feed.applyBridgeBar(sym, { t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v }, b.tf || '1');
    bridgeSince = Math.max(bridgeSince, +b.t - 1);
  }
  if (rows.length) { bridgeGot = Date.now(); scanSoon(); }
  if (rows.length && !app.bridgeAnnounced && app.feed.bridgeLive) { app.bridgeAnnounced = true; say('TradingView bridge connected. Charts and setup alerts are now on your live TradingView candles.', 'good', { speak: false }); }
}
app.openTradingView = (sym) => {
  sym = (sym || app.settings.main).toUpperCase();
  window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`, '_blank', 'noopener');
};

let gexQueue = [], lastGexSweep = 0;
function gexTick() {
  if (app.feed.status.mode === 'demo') return;
  const now = Date.now();
  if (!gexQueue.length && now - lastGexSweep > (marketStatus().state === 'open' ? 12 * 60e3 : 45 * 60e3)) {
    lastGexSweep = now;
    const syms = [app.settings.main, ...app.settings.symbols.filter(s => s !== app.settings.main)];
    gexQueue = syms.filter(s => { const lv = app.levelsFor(s); return !lv || lv.source === 'live' || lv.source === 'morning-stale' || lv.source === 'demo' || lv.source === 'manual'; });
  }
  const sym = gexQueue.shift();
  if (sym) relay.chain(sym, '', 0.03).then(c => app.noteChainGex(sym, c)).catch(() => {});
}

// ------------------------------------------------------------------ symbols / chart
app.selectSymbol = (sym, { announce = false } = {}) => {
  sym = sym.toUpperCase();
  if (!app.settings.symbols.includes(sym)) {
    if (!/^[A-Z.]{1,6}$/.test(sym)) { say(`I don't know the ticker ${sym}.`); return; }
    app.settings.symbols = [...app.settings.symbols, sym].slice(-12);
    app.settings.main = sym; app.saveSettings();
    say(`Adding ${sym} to your watchlist.`);
    restartFeed();
    return;
  }
  app.settings.main = sym; app.saveSettings();
  app.feed.requestInterval(sym, app.settings.interval);
  if (app.feed.status.mode !== 'demo' && !app.liveGex[sym]) relay.chain(sym, '', 0.03).then(c => app.noteChainGex(sym, c)).catch(() => {});
  app.markDirty('all');
  if (announce) {
    const q = app.feed.quote(sym);
    say(q ? `${sym}, ${fmtPrice(q.last)}, ${q.pct >= 0 ? 'up' : 'down'} ${Math.abs(q.pct).toFixed(2)} percent.` : `${sym} on the main screen.`);
  }
};
app.cycleSymbol = (dir) => {
  const s = app.settings.symbols, i = s.indexOf(app.settings.main);
  app.selectSymbol(s[(i + dir + s.length) % s.length]);
};
app.removeSymbol = (sym) => {
  const s = app.settings;
  if (s.symbols.length <= 1 || !s.symbols.includes(sym)) return;
  s.symbols = s.symbols.filter(x => x !== sym);
  if (s.main === sym) s.main = s.symbols[0];
  app.saveSettings(); restartFeed();
};
app.setTimeframe = (iv) => {
  if (!INTERVAL_LABEL[iv]) return;
  app.settings.interval = iv; app.saveSettings();
  app.feed.requestInterval(app.settings.main, iv);
  app.markDirty('chart');
};
app.toggleShow = (k) => app.setShow(k, !app.settings.show[k]);
app.setShow = (k, v) => { app.settings.show[k] = v; app.saveSettings(); app.markDirty('chart'); say(`${k.toUpperCase()} ${v ? 'on' : 'off'}.`, 'info', { speak: false }); };

// ------------------------------------------------------------------ risk breaker
app.riskState = () => {
  const r = app.settings.risk, d = app.day, now = Date.now();
  const used = Math.max(0, -d.pnl);
  const room = Math.max(0, r.maxDailyLoss - used);
  const state = d.tripped ? 'tripped' : d.cooldownUntil > now ? 'cooldown' : 'armed';
  const riskPerTrade = Math.min(r.account * r.riskPct / 100, room);
  const perContract = Math.max(0.01, d.premium * 100 * (r.stopPct / 100));
  return {
    state, used, room, riskPerTrade,
    contracts: Math.max(0, Math.floor(riskPerTrade / perContract)),
    cooldownLeft: d.cooldownUntil - now,
    checklistScore: d.checklist.filter(Boolean).length,
  };
};
function persistDay() { saveDay(app.day); app.markDirty('risk'); app.markDirty('summary'); }
app.logTrade = (amt) => {
  const d = app.day, r = app.settings.risk;
  d.trades.push({ t: Date.now(), amt });
  d.pnl = +(d.pnl + amt).toFixed(2);
  d.checklist = [false, false, false, false];
  if (amt < 0) d.consec++; else d.consec = 0;
  const pnlTxt = `Day P&L ${d.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(d.pnl))}.`;
  if (!d.tripped && -d.pnl >= r.maxDailyLoss) {
    d.tripped = true;
    say(`Logged a loss of ${fmtMoney(-amt)}. That's your daily loss limit, so the breaker is tripped and you're done for today. Protect the account.`, 'risk');
    flash('risk');
  } else if (amt < 0 && d.consec >= r.maxConsecLosses) {
    d.cooldownUntil = Date.now() + r.cooldownMin * 60e3;
    d.consec = 0;
    say(`Logged a loss of ${fmtMoney(-amt)}. That's ${r.maxConsecLosses} in a row, so take a ${r.cooldownMin} minute cooldown. No revenge trades. ${pnlTxt}`, 'risk');
    flash('risk');
  } else if (amt < 0) {
    const left = r.maxConsecLosses - d.consec;
    say(`Logged a loss of ${fmtMoney(-amt)}. ${pnlTxt} ${left === 1 ? 'One more loss and you go on cooldown.' : ''}`.trim(), 'risk');
  } else {
    say(`Logged a win of ${fmtMoney(amt)}. ${pnlTxt}`, 'good');
  }
  persistDay();
};
app.undoTrade = () => {
  const d = app.day, r = app.settings.risk;
  const t = d.trades.pop();
  if (!t) { say('There is no trade to undo today.', 'info', { speak: false }); return; }
  d.pnl = +d.trades.reduce((s, x) => s + x.amt, 0).toFixed(2);
  let trailing = 0; for (let i = d.trades.length - 1; i >= 0 && d.trades[i].amt < 0; i--) trailing++;
  d.consec = trailing % r.maxConsecLosses;
  d.tripped = -d.pnl >= r.maxDailyLoss;
  if (t.amt < 0 && d.cooldownUntil > Date.now() && (trailing + 1) % r.maxConsecLosses === 0) d.cooldownUntil = 0;   // the loss that started the cooldown was taken back
  say(`Removed the last trade (${t.amt >= 0 ? '+' : '−'}${fmtMoney(Math.abs(t.amt))}). Day P&L ${fmtMoney(d.pnl, true)}.`, 'info', { speak: false });
  persistDay();
};
app.setStep = (dir) => {
  const cur = app.day.step, i = STEPS.indexOf(cur);
  let j;
  if (i >= 0) j = i + dir;
  else if (dir > 0) { j = STEPS.findIndex(v => v > cur); if (j < 0) j = STEPS.length - 1; }      // a typed amount (say $600) steps to the next preset
  else { j = 0; for (let k = 0; k < STEPS.length; k++) if (STEPS[k] < cur) j = k; }
  app.day.step = STEPS[Math.max(0, Math.min(STEPS.length - 1, j))];
  persistDay();
};
app.setStepValue = (v) => { v = Math.round(Number(v)); if (v > 0 && v <= 100000) { app.day.step = v; persistDay(); } };
app.setPremium = (dir) => {
  const p = app.day.premium;
  const step = p < 1 ? 0.05 : p < 5 ? 0.1 : 0.25;
  app.day.premium = Math.max(0.05, +(p + dir * step).toFixed(2));
  persistDay();
};
app.toggleCheck = (i) => { app.day.checklist[i] = !app.day.checklist[i]; persistDay(); };
app.resetDay = () => { app.day = freshDay(); persistDay(); app.markDirty('all'); say("Today's P&L and breaker were reset.", 'info', { speak: false }); };

// ------------------------------------------------------------------ INDAI actions
function firstGesture() {
  if (app.locked) return;
  app.indai.voice.unlock();
  app.unlockSound();
  if (firstGesture.done) return;
  firstGesture.done = true;
  if (!app.indai.muted && !navigator.connection?.saveData) app.indai.voice.preload({ tts: true });
  maybeCheckIn();
}
app.firstGesture = firstGesture;
// Tap the mic: talk to INDAI (tap again to stop early).
app.talk = () => {
  firstGesture();
  app.lastAct = Date.now();
  app.inputMode = 'voice';
  if (app.indai.voice.state.listening) app._userStop = Date.now();
  app._tapTalk = true;
  try { return app.indai.talk(); } finally { app._tapTalk = false; }
};
// Typed message: same brain, no microphone.
app.send = async (text) => {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  firstGesture();
  app.lastAct = Date.now();
  app.inputMode = 'typed'; app._quietTalk = false;
  const ind = app.indai;
  if (ind.voice.state.listening) ind.voice.cancel();
  ind.voice.stopSpeaking();
  ind.followUp = 0; ind.autoListen = 0;
  ind.say(`“${text}”`, 'you', { speak: false });
  // Mid check-in, a typed command ("show TSLA") is run as a command, not taken as the answer to her question.
  const pend = ind.awaiting;
  if (pend && !looksLikeAnswer(pend, text)) {
    ind.awaiting = null;
    const res = await ind.handle(text, { voice: false });
    if (!ind.awaiting && !app.day.plan) { ind.awaiting = pend; app.markDirty('indai'); }
    return res;
  }
  return ind.handle(text, { voice: false });
};
function looksLikeAnswer(step, text) {
  const t = wordsToNumbers(text.toLowerCase());
  if (/^\s*(cancel|stop|never ?mind|skip( it)?|later)\b/.test(t)) return true;
  if (/\b(calls?|puts?|show|chart|log|win|loss|brief|calculator|deep dive|minute|self ?test|remember|practice|summary|trading ?view|mute|what|how|why)\b/.test(t)) return false;
  if (step === 'aggr') return /\b(conservative|safe|careful|low|light|easy|defensive|aggressive|high|send it|full|max|attack|go hard|balanced|medium|moderate|normal|middle|regular|mid)\b/.test(t);
  return /\d/.test(t) || /\b(grand|thousand|hundred|percent)\b/.test(t);
}
// Stop the check-in questions (the plan can still be set by hand or restarted with "start my day").
app.cancelCheckIn = () => { if (app.indai.awaiting) { app.indai.awaiting = null; app.indai.autoListen = 0; say('No problem. Say “start my day” when you want to set the plan.', 'info', { speak: false }); app.markDirty('plan'); } };
app.toggleMute = (force) => {
  const m = typeof force === 'boolean' ? force : !app.indai.muted;
  app.indai.setMuted(m);
  app.settings.voice = !m; app.saveSettings();
  if (!m) say('Voice on.'); else say('Voice off. I will keep answering in text.', 'info', { speak: false });
  app.markDirty('dock');
};
app.openDeepDive = (sym) => app.indai.deepDive((sym || app.settings.main).toUpperCase());
app.brief = () => {
  const ms = marketStatus();
  const h = ms.et.h;
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const parts = [];
  if (app.feed.status.mode === 'demo') parts.push('Demo mode, prices are simulated.');
  parts.push(`${greet}, ${app.settings.name}.`);
  if (ms.state === 'open') parts.push(`Market's open, closing in ${fmtDuration(ms.msToNext)}.`);
  else if (ms.state === 'pre') parts.push(`Pre-market. The bell rings in ${fmtDuration(ms.msToNext)}.`);
  else parts.push(`${ms.label.toLowerCase().replace('·', ',')}. Next open in ${fmtDuration(ms.msToNext)}.`);
  const sym = app.settings.main, q = app.feed.quote(sym);
  if (q) {
    parts.push(`${sym} is ${fmtPrice(q.last)}, ${q.pct >= 0 ? 'up' : 'down'} ${Math.abs(q.pct).toFixed(2)} percent.`);
    const lv = app.levelsFor(sym);
    if (lv) {
      const n = nearestLevel(q.last, lv);
      if (n) parts.push(`Nearest level is the ${n.name.toLowerCase()} at ${fmtPrice(n.level)}, ${Math.abs(n.dist).toFixed(2)} percent ${n.dist >= 0 ? 'above' : 'below'}.`);
    }
  }
  const ll = LEADLAG.map(s => ({ s, q: app.feed.quote(s) })).filter(x => x.q).sort((a, b) => b.q.pct - a.q.pct);
  if (ll.length === 3 && ll[0].q.pct - ll[2].q.pct >= 0.15) parts.push(`${ll[0].s} is leading, ${ll[2].s} is lagging.`);
  const rs = app.riskState();
  if (rs.state === 'tripped') parts.push('The risk breaker is tripped. No more trades today.');
  else if (rs.state === 'cooldown') parts.push(`You're on cooldown for ${fmtDuration(rs.cooldownLeft)}.`);
  else parts.push(`Day P&L ${app.day.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(app.day.pnl))}, with ${fmtMoney(rs.room)} of room before the breaker.`);
  if (ms.upcoming.length) parts.push(`Heads up: ${ms.upcoming[0].text} on ${new Date(ms.upcoming[0].date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}.`);
  say(parts.join(' '));
};

// ------------------------------------------------------------------ options calculator state
const fmtYMD = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function nearestExpiry() {
  const p = etParts();
  if (isTradingDay(p.y, p.m, p.d) && Date.now() < etToMs(p.y, p.m, p.d, 16, 0)) return fmtYMD(p.y, p.m, p.d);
  return fmtYMD(...nextTradingDay(p.y, p.m, p.d));
}
function strikeStep(sym, spot) { return ETFS.has(sym) ? 1 : spot < 30 ? 0.5 : spot < 100 ? 1 : spot < 300 ? 2.5 : 5; }
function calcSpot() { const c = app.calc; return app.feed.quote(c.sym)?.last ?? c.spot; }
function repriceModel(leg) {
  const S = calcSpot();
  if (!S) return;
  leg.entry = Math.max(0.01, +bs(S, leg.strike, yearsTo(leg.expiry), app.settings.rate ?? 0.04, leg.iv, leg.type).price.toFixed(2));
}
function calcChanged({ chain = true } = {}) {
  app.markDirty('calc');
  app.onCalcChange?.();
  if (chain) { clearTimeout(calcChanged.t); calcChanged.t = setTimeout(() => app.calcFromChain({ quiet: true }), 700); }
}
app.calcReprice = (leg) => repriceModel(leg);
app.strikeStep = strikeStep;
app.nearestExpiry = nearestExpiry;
app.loadCalc = ({ sym, spot, legs, expirations, strikes }) => {
  app.calc = { sym, spot, legs: legs.map(l => ({ ...l })), expirations: expirations || null, strikes: strikes || null, loading: false };
  autoAnalysis = true; queueMicrotask(() => { autoAnalysis = false; });   // indai.js opens the analysis right after this
  if (app.analysis && app.analysis.demo == null) app.analysis.demo = app.feed.status.mode === 'demo';
  calcChanged({ chain: false });
};
app.ensureCalc = (sym) => {
  sym = (sym || app.calc?.sym || app.settings.main).toUpperCase();
  if (app.calc && app.calc.sym === sym && app.calc.legs.length) return app.calc;
  const q = app.feed.quote(sym);
  const spot = q?.last ?? 100;
  const step = strikeStep(sym, spot);
  const leg = { type: 'C', side: 1, strike: Math.round(spot / step) * step, qty: 1, entry: 1, iv: q?.iv30 ? q.iv30 / 100 : 0.2, expiry: nearestExpiry() };
  app.calc = { sym, spot, legs: [leg], expirations: null, strikes: null, loading: false, needsSnap: !q };   // no price yet: the strike is a placeholder
  repriceModel(leg);
  app.calcFromChain({ quiet: true });
  return app.calc;
};
app.calcSet = (patch) => {
  const c = app.ensureCalc(); const leg = c.legs[0];
  Object.assign(leg, patch);
  if ('type' in patch || 'strike' in patch || 'expiry' in patch) repriceModel(leg);
  calcChanged({ chain: 'type' in patch || 'strike' in patch || 'expiry' in patch });
};
app.calcStep = (field, dir) => {
  const c = app.ensureCalc(); const leg = c.legs[0];
  if (field === 'strike') {
    const ks = (c.strikes || []).filter((k, i, a) => a.indexOf(k) === i).sort((a, b) => a - b);
    const i = ks.indexOf(leg.strike);
    if (i >= 0 && ks[i + dir] != null) leg.strike = ks[i + dir];
    else leg.strike = +(leg.strike + dir * strikeStep(c.sym, calcSpot() || leg.strike)).toFixed(2);
    repriceModel(leg); return calcChanged();
  }
  if (field === 'expiry') {
    const ex = c.expirations;
    const i = ex ? ex.indexOf(leg.expiry) : -1;
    if (ex && i >= 0 && ex[i + dir]) leg.expiry = ex[i + dir];
    else {
      const [y, m, d] = leg.expiry.split('-').map(Number);
      const nd = dir > 0 ? nextTradingDay(y, m, d) : prevTradingDay(y, m, d);
      const cand = fmtYMD(...nd);
      if (cand >= nearestExpiry()) leg.expiry = cand;
    }
    repriceModel(leg); return calcChanged();
  }
  if (field === 'entry') { const p = leg.entry, st = p < 3 ? 0.05 : p < 10 ? 0.1 : 0.25; leg.entry = Math.max(0.01, +(p + dir * st).toFixed(2)); return calcChanged({ chain: false }); }
  if (field === 'iv') { leg.iv = Math.max(0.01, +(leg.iv + dir * 0.01).toFixed(4)); return calcChanged({ chain: false }); }
  if (field === 'qty') { leg.qty = Math.max(1, Math.min(500, leg.qty + dir)); return calcChanged({ chain: false }); }
};
// Fill entry prices and IVs from the live (delayed) chain.
app.calcFromChain = async ({ quiet = false } = {}) => {
  const c = app.calc; if (!c) return;
  c.loading = true; app.markDirty('calc'); app.onCalcChange?.();
  const exps = [...new Set(c.legs.map(l => l.expiry))];
  try {
    for (const exp of exps) {
      const ch = await relay.chain(c.sym, exp, 0.12);
      if (app.calc !== c) return;
      if (!ch || !ch.spot) throw new Error(ch?.error || 'no chain');
      c.expirations = ch.expirations; c.spot = ch.spot; c.demo = !!ch.demo;
      c.strikes = [...new Set(ch.chain.map(o => o.strike))].sort((a, b) => a - b);
      if (c.needsSnap && c.strikes.length) { c.needsSnap = false; for (const leg of c.legs) { leg.strike = c.strikes.reduce((b, k) => Math.abs(k - ch.spot) < Math.abs(b - ch.spot) ? k : b, c.strikes[0]); repriceModel(leg); } }
      for (const leg of c.legs.filter(l => l.expiry === exp)) {
        if (ch.expiry !== exp) leg.expiry = ch.expiry;
        const row = ch.chain.find(o => o.type === leg.type && o.strike === leg.strike);
        if (row) { if (row.mid > 0) leg.entry = row.mid; if (row.iv > 0.01) leg.iv = row.iv; }
      }
    }
    if (!quiet) say(`Calculator updated from the ${c.sym} chain.`, 'info', { speak: false });
  } catch (e) { if (!quiet) say(`Couldn't load the ${c.sym} chain: ${e.offline ? "the backend can't be reached" : e.message}`, 'info', { speak: false }); }
  c.loading = false; app.markDirty('calc'); app.onCalcChange?.();
};
app.openCalc = () => { app.ensureCalc(); app.ui.openSheet('calc'); };

// ------------------------------------------------------------------ daily game plan
const roundTo = (v, st) => Math.max(st, Math.round(v / st) * st);
function defaultDraft() {
  const p = app.day.plan;
  if (p) return { capital: p.capital, goal: p.goal, aggr: p.aggr, strategies: [...p.strategies] };
  const cap = app.settings.risk.account || 2000;
  return { capital: cap, goal: roundTo(cap * 0.03, 10), aggr: app.settings.lastAggr || 'balanced', strategies: app.settings.strategies?.length ? [...app.settings.strategies] : Object.keys(STRATEGIES) };
}
app.planDraft = defaultDraft();
app.activePlan = () => app.day.plan ? buildPlan(app.day.plan) : buildPlan({ capital: app.settings.risk.account, goal: 0, aggr: app.settings.lastAggr || 'balanced', strategies: app.settings.strategies?.length ? app.settings.strategies : Object.keys(STRATEGIES) });
app.planSet = (patch) => { Object.assign(app.planDraft, patch); app.markDirty('plan'); };
app.planStep = (field, dir) => {
  const d = app.planDraft;
  if (field === 'capital') { const st = d.capital < 1000 ? 100 : d.capital < 10000 ? 250 : 1000; d.capital = Math.max(100, d.capital + dir * st); }
  if (field === 'goal') { const st = d.goal < 100 ? 10 : d.goal < 1000 ? 25 : 100; d.goal = Math.max(10, d.goal + dir * st); }
  app.markDirty('plan');
};
app.planToggleStrategy = (k) => {
  const d = app.planDraft; const on = d.strategies.includes(k);
  if (on && d.strategies.length === 1) return;
  d.strategies = on ? d.strategies.filter(x => x !== k) : [...d.strategies, k];
  app.markDirty('plan');
};
app.lockPlan = ({ quiet = false } = {}) => {
  const d = app.planDraft, p = buildPlan(d);
  app.day.plan = { capital: d.capital, goal: d.goal, aggr: d.aggr, strategies: [...d.strategies], at: Date.now() };
  app.day.goalHit = false;
  const r = app.settings.risk;
  r.account = d.capital; r.maxDailyLoss = p.maxLoss; r.riskPct = PROFILES[d.aggr].riskPct; r.stopPct = p.stopPct; r.maxConsecLosses = p.consec; r.cooldownMin = p.cool;
  app.settings.lastAggr = d.aggr; app.settings.strategies = [...d.strategies];
  app.indai.awaiting = null;
  app.saveSettings(); persistDay();
  ['plan', 'risk', 'dock', 'indai', 'summary'].forEach(id => app.markDirty(id));
  if (!quiet) say(`Plan locked: starting with ${fmtMoney(d.capital)}, goal ${fmtMoney(d.goal)}, ${p.label.toLowerCase()}. About ${fmtMoney(p.riskPerTrade)} risk per trade, and the breaker trips at minus ${fmtMoney(p.maxLoss)}. ${p.winsNeeded ? `That's roughly ${p.winsNeeded} good trade${p.winsNeeded > 1 ? 's' : ''} at ${p.rr} to 1.` : ''} I'll call out ${d.strategies.map(k => STRATEGIES[k].short).join(', ')} setups scoring ${p.minScore} or better.${p.warnings[0] ? ' ' + p.warnings[0] : ''}`, 'good');
};
// Open the plan editor (by hand). The spoken check-in goes through indai.startDay().
app.openPlan = () => { if (!app.indai.awaiting) app.planDraft = defaultDraft(); app.ui.openSheet('plan'); if (!app.temp) app.checkTemperature(); };
app.checkTemperature = async (force = false) => {
  if (app.tempLoading) return app.temp;
  if (app.temp && !force && Date.now() - app.temp.at < 10 * 60e3) return app.temp;
  app.tempLoading = true; app.markDirty('plan');
  const quotes = {}; for (const s of ['SPY', 'QQQ', 'IWM']) { const q = app.feed.quote(s); if (q) quotes[s] = q; }
  let vix = null;
  if (app.feed.status.mode !== 'demo') {
    try { const j = await relay.snapshot(['VIX']); const v = (j.quotes || [])[0]; if (v && v.ok) vix = { last: v.price || v.close, pct: v.changePct ?? (v.prevClose ? ((v.price || v.close) / v.prevClose - 1) * 100 : 0) }; } catch {}
  }
  const gex = {};
  for (const s of ['SPY', 'QQQ', 'IWM']) { const lv = app.levelsFor(s), q = app.feed.quote(s); if (lv && q) gex[s] = { zg: lv.zg, spot: q.ext ?? q.last }; }
  const st = marketStatus().state;
  app.temp = { ...temperature({ quotes, vix, gex, preMarket: st !== 'open' }), vix, at: Date.now(), demo: app.feed.status.mode === 'demo' };
  app.tempLoading = false; app.markDirty('plan');
  return app.temp;
};
// Each trading day, the first time you touch the app, INDAI reads the market and asks for the day's plan.
function maybeCheckIn() {
  if (app.locked || app.day.plan || app.checkInStarted || app.noAutoCheckIn) return;
  const p = etParts();
  if (!isTradingDay(p.y, p.m, p.d) || p.h < 6 || p.h >= 16) return;
  app.checkInStarted = true;
  // Never talk over what the person is doing: wait until the mic is closed, nothing is open and nothing was just asked.
  let tries = 0;
  const go = () => {
    if (app.day.plan || app.indai.awaiting) return;
    const vs = app.indai.voice.state;
    const busy = vs.listening || vs.transcribing || vs.speaking || app.indai.thinking || app.focus || document.hidden
      || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || Date.now() - (app.lastAct || 0) < 6000;
    if (busy) { if (++tries < 60) setTimeout(go, 2500); else app.checkInStarted = false; return; }
    app.indai.startDay({ voice: false });
  };
  setTimeout(go, 1200);
}
app.maybeCheckIn = maybeCheckIn;

// ------------------------------------------------------------------ INDAI's own setup alerts ("ideas")
// app.signals is today's list, newest first. It is kept for the New York day, so a reload (or iOS putting the
// page to sleep) never loses the ideas, and setups that confirmed while nobody was looking are caught up quietly.
const sigMem = { lastBar: {}, lastOne: {}, lastOneAt: {}, scanned: new Set(), last: {}, hour: [], pausedNote: 0 };
const IDEAS_KEY = 'indai.web.ideas.v1';
const ideaId = (s) => `${s.sym}|${s.strat}|${s.dir}|${s.barT}`;
app.forming = {};                 // ticker -> a setup taking shape on the candle that is still open
app.ideaFocus = null;             // the idea whose entry, stop and target are drawn on the chart
let ideasDay = etParts().ymd;
function stored() {
  try { const j = JSON.parse(localStorage.getItem(IDEAS_KEY)); if (j && j.ymd === etParts().ymd && Array.isArray(j.list)) return { list: j.list.filter(x => x && x.sym && x.contract && x.barT && x.id), seen: Array.isArray(j.seen) ? j.seen : [] }; } catch {}
  return { list: [], seen: [] };
}
let saveTimer = 0;
function saveIdeas() {
  clearTimeout(saveTimer); saveTimer = 0;
  if (app.feed.status.mode === 'demo') return;          // simulated ideas are never kept
  try { localStorage.setItem(IDEAS_KEY, JSON.stringify({ ymd: ideasDay, list: app.signals.filter(x => !x.practice && !x.demo).slice(0, 40), seen: [...sigMem.scanned] })); } catch {}
}
// Which candles have been looked at is saved too (a few seconds after it changes), so a reload never goes over them again.
function sawCandle(key) { if (sigMem.scanned.has(key)) return; sigMem.scanned.add(key); if (!saveTimer) saveTimer = setTimeout(saveIdeas, 4000); }
window.addEventListener('pagehide', () => { if (saveTimer) saveIdeas(); });
// The 20-minute repeat rule and the alerts-per-hour count pick up from the day's list, so a reload or a catch-up
// never lets the same setup alert again a candle later.
function seedMemory() {
  const now = Date.now();
  for (const x of app.signals) {
    if (x.practice) continue;
    const k = x.sym + x.strat + x.dir; if ((sigMem.last[k] || 0) < x.at) sigMem.last[k] = x.at;
    if (!x.quiet && now - x.at < 3600e3 && !sigMem.hour.includes(x.at)) sigMem.hour.push(x.at);
  }
}
function loadIdeas() { const st = stored(); app.signals = [...app.signals.filter(x => x.practice && !x.demo), ...st.list].sort((a, b) => b.at - a.at); sigMem.scanned = new Set(st.seen); sigMem.last = {}; sigMem.hour = []; seedMemory(); }
function ideasChanged() { for (const v of ['indai', 'summary', 'today', 'ideabar', 'ideas', 'chart', 'watch', 'more']) app.markDirty(v); }
if (app.settings.dataMode !== 'demo') loadIdeas();
function nextExpiries(at = Date.now()) {
  const p = etParts(at), todayOk = isTradingDay(p.y, p.m, p.d) && at < etToMs(p.y, p.m, p.d, 16, 0);
  const today = todayOk ? fmtYMD(p.y, p.m, p.d) : fmtYMD(...nextTradingDay(p.y, p.m, p.d));
  const [y, m, d] = today.split('-').map(Number);
  return { today, next: fmtYMD(...nextTradingDay(y, m, d)) };
}
function completedBars(sym) {
  const bars = app.feed.getBars(sym, '5min');
  const one = app.feed.getBars(sym, '1min');
  const latest = one.length ? one[one.length - 1].t + 60e3 : (app.feed.syms.get(sym)?.lastTradeAt || Date.now());
  return bars.filter(b => b.t + 300e3 <= latest + 1000);
}
function leadDirection() {
  const dirs = ['SPY', 'QQQ'].map(s => { const b = completedBars(s); if (b.length < 4) return 0; const ch = b[b.length - 1].c - b[b.length - 4].c; return Math.abs(ch) / b[b.length - 1].c < 0.0005 ? 0 : Math.sign(ch); });
  return dirs[0] === dirs[1] ? dirs[0] : 0;
}
function contractFor(sig, plan, at = Date.now()) {
  const q = app.feed.quote(sig.sym);
  return suggestContract(sig, plan, { iv: q?.iv30 ? q.iv30 / 100 : 0.22, r: app.settings.rate ?? 0.04, strikeStep: strikeStep(sig.sym, sig.price), now: at, nextExpiry: nextExpiries(at) });
}
function setForming(sym, c) {
  const was = app.forming[sym];
  if (!was && !c) return;
  if (c) app.forming[sym] = c; else delete app.forming[sym];
  app.markDirty('ideabar'); app.markDirty('ideas'); app.markDirty('chart');
  if (c && (!was || was.strat !== c.strat || was.dir !== c.dir)) app.onForming?.(c);
}
function clearForming() { for (const sym of Object.keys(app.forming)) setForming(sym, null); }
// The score a setup needs right now, or null while alerts are off (breaker tripped or cooling down, or the plan
// says stop once the goal is hit). While they are off nothing new is listed either, not even quietly.
function alertFloor(plan) {
  if (app.riskState().state !== 'armed') return null;
  if (app.day.plan && app.day.goalHit) { if (plan.afterGoal === 'stop') return null; if (plan.afterGoal === 'aplus') return Math.max(plan.minScore, 80); }
  return plan.minScore + (app.retro ? app.retro.tuning().minAdd : 0);      // plus what the retrospectives taught her
}
const tuned = (list, at) => (app.tune ? list.map(c => app.tune(c, at)) : list);
app.completedBars = completedBars;
// Candles that close while alerts are off count as seen, so they are not "caught up" later.
function markSeen() { for (const sym of app.settings.symbols) { const b = completedBars(sym); if (!b.length) continue; const t = b[b.length - 1].t; sigMem.lastBar[sym] = t; sawCandle(sym + t); } }
function scanTick() {
  const ms = marketStatus();
  const demo = app.feed.status.mode === 'demo';
  if (ms.state !== 'open' && !(demo && app.settings.demoSignals)) { clearForming(); return; }
  const plan = app.activePlan();
  const rs = app.riskState();
  if (rs.state !== 'armed') { clearForming(); markSeen(); if (Date.now() - sigMem.pausedNote > 30 * 60e3) { sigMem.pausedNote = Date.now(); say(`Setup alerts are paused while the breaker is ${rs.state === 'tripped' ? 'tripped' : 'on cooldown'}.`, 'risk', { speak: false }); } return; }
  const minScore = alertFloor(plan);
  if (minScore == null) { clearForming(); markSeen(); return; }
  const now = Date.now();
  sigMem.hour = sigMem.hour.filter(t => now - t < 3600e3);
  const lead = leadDirection();
  const liveData = app.feed.status.mode === 'live' || app.feed.bridgeLive;
  for (const sym of app.settings.symbols) {
    const bars = completedBars(sym);
    if (bars.length < 6) continue;
    const lastT = bars[bars.length - 1].t;
    const lv = app.levelsFor(sym), leadDir = ['SPY', 'QQQ'].includes(sym) ? 0 : lead;
    if (sigMem.lastBar[sym] !== lastT) {
      sigMem.lastBar[sym] = lastT;
      setForming(sym, null);                                   // that candle has closed: it confirms now or not at all
      if (now - (lastT + 300e3) > (liveData ? 6 * 60e3 : 25 * 60e3)) continue; // stale bar
      sawCandle(sym + lastT);
      const cands = tuned(scanSetups(sym, bars, { levels: lv, leadDir, now, enabled: plan.strategies }), now)
        .filter(c => c.score >= minScore).sort((a, b) => b.score - a.score);
      const sig = cands.find(c => now - (sigMem.last[sym + c.strat + c.dir] || 0) > 20 * 60e3);
      if (!sig) continue;
      sigMem.last[sym + sig.strat + sig.dir] = now;
      // Past the plan's alerts-per-hour limit it is still listed, just without sounding an alert, so nothing good is hidden.
      const quiet = sigMem.hour.length >= plan.perHour;
      if (!quiet) sigMem.hour.push(now);
      sig.contract = contractFor(sig, plan);
      fireSignal(sig, plan, { quiet: quiet ? 'cap' : '' });
      continue;
    }
    lookAhead(sym, bars, { lv, leadDir, plan, minScore, now, liveData });
  }
}
// An early look at the candle that is still open: a setup that is taking shape shows as "forming" a minute or
// more before the 5-minute candle closes and confirms it (or doesn't). Volume is projected to the full candle.
function lookAhead(sym, done, { lv, leadDir, plan, minScore, now, liveData }) {
  const five = app.feed.getBars(sym, '5min'), open = five[five.length - 1], lastDone = done[done.length - 1];
  const one = app.feed.getBars(sym, '1min');
  const latest = one.length ? one[one.length - 1].t + 60e3 : 0;      // how far into the open candle the data reaches
  if (sigMem.lastOne[sym] === latest) {                               // nothing new since the last look
    if (app.forming[sym] && now - (sigMem.lastOneAt[sym] || 0) > 150e3) setForming(sym, null);   // the candles stopped coming
    return;
  }
  sigMem.lastOne[sym] = latest; sigMem.lastOneAt[sym] = now;
  const mins = open ? Math.round((latest - open.t) / 60e3) : 0;
  if (!open || open.t !== lastDone.t + 300e3 || mins < 2 || mins > 4 || now - latest > (liveData ? 150e3 : 25 * 60e3)) { setForming(sym, null); return; }
  const c = tuned(scanSetups(sym, [...done, { ...open, v: Math.round((open.v || 0) * 5 / mins) }], { levels: lv, leadDir, now, enabled: plan.strategies }), now)
    .filter(x => x.score >= minScore && now - (sigMem.last[sym + x.strat + x.dir] || 0) > 20 * 60e3).sort((a, b) => b.score - a.score)[0];
  if (!c) { setForming(sym, null); return; }
  c.forming = true; c.confirmAt = open.t + 300e3; c.id = 'forming|' + ideaId(c); c.contract = contractFor(c, plan);
  if (app.feed.status.mode === 'demo') c.demo = true;
  setForming(sym, c);
}
function fireSignal(sig, plan, { practice = false, quiet = '' } = {}) {
  sig.id = ideaId(sig) + (practice ? '|practice' : '');
  if (practice) app.signals = app.signals.filter(x => x.id !== sig.id);
  else if (app.signals.some(x => x.id === sig.id)) return;            // already on the list
  if (quiet) sig.quiet = quiet;
  if (app.feed.status.mode === 'demo') sig.demo = true;
  app.signals.push(sig); app.signals.sort((a, b) => b.at - a.at); if (app.signals.length > 40) app.signals.length = 40;
  delete app.forming[sig.sym];
  if (!practice && !quiet) { app.day.signals = (app.day.signals || 0) + 1; saveDay(app.day); }
  if (!practice) saveIdeas();
  ideasChanged();
  if (quiet) return;
  const k = sig.contract, side = sig.type === 'C' ? 'call' : 'put';
  const delayed = practice ? '' : app.feed.status.mode === 'demo' ? ' Demo data.' : app.feed.status.mode === 'delayed' && !app.feed.bridgeLive ? ' Heads up, this is on delayed data.' : '';
  const grade = sig.score >= 80 ? 'A-plus' : sig.score >= 70 ? 'strong' : 'decent';
  const text = `${practice ? `Practice alert, replayed from the ${new Date(sig.barT + 300e3).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} candle. ` : ''}${sig.sym} ${side} setup, ${grade}, score ${sig.score}: ${sig.title}. Idea: the ${k.strike} ${side} ${k.expiry === nextExpiries().today ? 'for today' : 'for ' + new Date(k.expiry + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}, about ${k.premium.toFixed(2)}, ${k.qty} contract${k.qty > 1 ? 's' : ''}, risking about ${fmtMoney(k.risk)}${k.overBudget ? `, which is over your ${fmtMoney(plan.riskPerTrade)} per-trade risk, so size down or skip` : ''}. Out if ${sig.sym} ${sig.dir > 0 ? 'loses' : 'gets back above'} ${fmtPrice(sig.stop)}; target ${fmtPrice(sig.target)}.${sig.against.length ? ' Watch: ' + sig.against.slice(0, 2).join(', ') + '.' : ''}${delayed}`;
  // Everything is on screen at once (the conversation, the ideas strip and the alert card); out loud she keeps it to
  // the few words that matter, so the alert is heard in seconds instead of half a minute.
  const short = `${practice ? 'Practice alert. ' : ''}${sig.sym} ${side} setup, ${grade}, ${sig.score}. ${sig.title}. The ${k.strike} ${side}, about ${k.premium.toFixed(2)}. Stop ${fmtPrice(sig.stop)}, target ${fmtPrice(sig.target)}.`;
  app._ideaSay = true;
  try { say(text, sig.dir > 0 ? 'good' : 'risk', { speak: false }); say(short, sig.dir > 0 ? 'good' : 'risk', { log: false }); } finally { app._ideaSay = false; }
  app.onIdea?.(sig);
  flash('watch'); if (sig.sym === app.settings.main) flash('chart');
  if (document.hidden) notify(`INDAI · ${sig.sym} ${side} setup (${sig.score})`, { body: `${sig.title}. ${k.strike}${sig.type} ≈ $${k.premium.toFixed(2)} × ${k.qty}. Stop ${fmtPrice(sig.stop)}, target ${fmtPrice(sig.target)}.`, icon: './icons/icon-192.png', tag: 'indai-' + sig.sym });
}
// Setups that confirmed while the page was closed, asleep in a pocket, or between reloads: replay today's candles
// with the same rules and list the ones that are missing, without sounding an alert for something that is past.
function catchUp() {
  if (app.feed.status.mode === 'demo') return 0;
  const p = etParts(), now = Date.now();
  if (!isTradingDay(p.y, p.m, p.d)) return 0;
  const open = etToMs(p.y, p.m, p.d, 9, 30);
  if (now < open + 30 * 60e3) return 0;
  const plan = app.activePlan(), found = [], floor = alertFloor(plan);
  if (floor == null) return 0;
  for (const sym of app.settings.symbols) {
    const bars = completedBars(sym).filter(b => b.t >= open);
    if (bars.length < 6) continue;
    const lv = app.levelsFor(sym), last = {};
    for (let i = 6; i <= bars.length; i++) {
      const sub = bars.slice(0, i), barT = sub[i - 1].t, at = barT + 300e3;
      if (sigMem.scanned.has(sym + barT)) continue;                      // looked at already, live or in an earlier catch-up
      sawCandle(sym + barT);
      const c = tuned(scanSetups(sym, sub, { levels: lv, leadDir: 0, now: at, enabled: plan.strategies }), at)
        .filter(x => x.score >= floor && at - (last[x.strat + x.dir] || 0) > 20 * 60e3).sort((a, b) => b.score - a.score)[0];
      if (!c) continue;
      last[c.strat + c.dir] = at; found.push({ ...c, at });
    }
  }
  let added = 0;
  for (const c of found) {
    c.id = ideaId(c);
    if (app.signals.some(x => !x.practice && (x.id === c.id || (x.sym === c.sym && x.strat === c.strat && x.dir === c.dir && Math.abs(x.barT - c.barT) < 20 * 60e3)))) continue;
    c.quiet = 'earlier'; c.contract = contractFor(c, plan, c.at);
    app.signals.push(c); added++;
  }
  if (added) { app.signals.sort((a, b) => b.at - a.at); if (app.signals.length > 40) app.signals.length = 40; seedMemory(); saveIdeas(); ideasChanged(); }
  return added;
}
app.catchUpIdeas = catchUp;
app._ideaMem = sigMem;               // read by the tests
// What has happened to an idea since its candle closed: did price reach the target or the stop first, and where is it now.
app.ideaOutcome = (sig) => {
  const q = app.feed.quote(sig.sym), last = q?.last ?? null, after = sig.barT + 300e3;
  let bars = app.feed.getBars(sig.sym, '1min').filter(b => b.t >= after);
  if (!bars.length) bars = app.feed.getBars(sig.sym, '5min').filter(b => b.t >= after);
  let state = sig.forming ? 'forming' : 'open', at = 0;
  if (!sig.forming) for (const b of bars) {
    const stopHit = sig.dir > 0 ? b.l <= sig.stop : b.h >= sig.stop, targetHit = sig.dir > 0 ? b.h >= sig.target : b.l <= sig.target;
    if (stopHit) { state = 'stopped'; at = b.t; break; }               // both inside one candle: count the stop
    if (targetHit) { state = 'target'; at = b.t; break; }
  }
  const gain = last != null ? (last - sig.price) * sig.dir : 0;
  const move = last != null ? gain / sig.price * 100 : null;          // percent in the idea's favour
  const prog = gain >= 0 ? Math.min(1, gain / (Math.abs(sig.target - sig.price) || 1e-9)) : Math.max(-1, gain / (Math.abs(sig.price - sig.stop) || 1e-9));
  return { state, at, last, move, prog };
};
// Ideas for one ticker, for the chart: where each confirmed, and which one has its levels drawn.
app.ideasFor = (sym) => {
  const list = app.signals.filter(x => x.sym === sym);
  const f = app.forming[sym]; if (f) list.unshift(f);
  const focus = list.find(x => x.id === app.ideaFocus) || list.find(x => !x.forming && Date.now() - x.at < 30 * 60e3) || null;
  return list.map(x => ({ ...x, focus: x === focus }));
};
app.ideaById = (id) => app.signals.find(x => x.id === id) || Object.values(app.forming).find(x => x.id === id) || null;
app.openIdeas = (id = null) => { app.ideaOpen = id; app.ui.openSheet('ideas'); };
app.showIdeaOnChart = (sig) => {
  app.ideaFocus = sig.id;
  if (app.focus) app.closeFocus();
  app.selectSymbol(sig.sym);
  if (app.settings.interval === '15min') app.setTimeframe('5min');
  if (app.layout === 'phone') app.ui.showTab('chart'); else document.getElementById('p-chart').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  app.markDirty('chart');
};
app.analyzeIdea = (sig) => {
  app.ideaFocus = sig.id; app.inputMode = 'typed'; app._quietTalk = false;
  if (app.focus) app.closeFocus();
  if (app.layout === 'phone') app.ui.showTab('indai');
  app.indai.analyzeSignal(sig);
};
// Android Chrome only allows notifications through the service worker; desktop browsers accept either.
async function notify(title, opts) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { try { new Notification(title, opts); } catch {} }
}
app.notify = notify;
app.fireSignal = fireSignal;

// Replay the setup scanner over the current (or last) session's candles: how many alerts your plan would have fired.
app.replayScan = () => {
  const plan = app.activePlan();
  const all = []; let syms = 0;
  for (const sym of app.settings.symbols) {
    const bars = app.feed.getBars(sym, '5min');
    if (bars.length < 8) continue;
    syms++;
    const lv = app.levelsFor(sym), last = {};
    for (let i = 8; i <= bars.length; i++) {
      const sub = bars.slice(0, i), at = sub[i - 1].t + 300e3;
      for (const c of scanSetups(sym, sub, { levels: lv, leadDir: 0, now: at, enabled: plan.strategies })) {
        const k = c.strat + c.dir;
        if (at - (last[k] || 0) < 20 * 60e3) continue;
        last[k] = at; all.push({ ...c, at });
      }
    }
  }
  // same limits as live alerts: score bar and alerts-per-hour cap
  const hits = [];
  for (const c of all.filter(x => x.score >= plan.minScore).sort((a, b) => a.at - b.at)) {
    if (hits.filter(h => c.at - h.at < 3600e3).length < plan.perHour) hits.push(c);
  }
  const best = [...hits].sort((a, b) => b.score - a.score)[0] || null;
  const practice = best || [...all].sort((a, b) => b.score - a.score)[0] || null;
  return { symbols: syms, count: hits.length, best, practice, label: marketStatus().state === 'open' ? "today's" : 'last', minScore: plan.minScore };
};
// Play one replayed setup as a clearly-labelled practice alert, so the whole alert flow can be tested any time.
app.practiceAlert = (sig) => {
  if (!sig) sig = app.replayScan().practice;
  if (!sig) { say('There are no candles to replay yet. Give the data a minute to load, then try again.', 'info'); return; }
  const plan = app.activePlan(), q = app.feed.quote(sig.sym);
  const s = { ...sig, at: Date.now(), practice: true };
  s.contract = suggestContract(s, plan, { iv: q?.iv30 ? q.iv30 / 100 : 0.22, r: app.settings.rate ?? 0.04, strikeStep: strikeStep(sig.sym, sig.price), nextExpiry: nextExpiries() });
  fireSignal(s, plan, { practice: true });
};

// ------------------------------------------------------------------ headset-only features, answered politely
const HEADSET = {
  scene: 'Scenes (passthrough, the Loft, Midnight, Ocean, Orbit and the Command deck) only exist in the Quest headset. On the website everything is already on one flat screen.',
  gestures: 'Hand gestures are headset-only. On the website you tap, click, type or talk instead.',
  tutorial: 'The gesture tutorial needs the Quest headset with hand tracking. There are no gestures to learn here: tap, type or talk.',
  recenter: 'Recentering the screens around you is a headset feature. I took you back to the main chart instead.',
};
app.scenes = [];
app.sceneShown = null;
app.passthroughAvailable = () => false;
app.setScene = (id, { announce = true } = {}) => { if (announce) say(HEADSET.scene, 'info'); };
app.cycleScene = () => app.setScene();
app.setGestures = (level, { announce = true } = {}) => { if (announce) say(HEADSET.gestures, 'info'); };
app.startTutorial = () => say(HEADSET.tutorial, 'info');
app.endTutorial = () => {};
app.tutorialGo = () => {};
app.tutorialEvent = () => {};
app.recenter = () => { app.ui.closeSheet(); app.ui.showTab('chart'); window.scrollTo({ top: 0 }); say(HEADSET.recenter, 'info', { speak: false, log: true }); };
app.resetLayout = () => { app.recenter(); };
app.enterXR = async () => { say('Mixed reality needs the INDAI app on a Meta Quest. This website is the flat version for phone, tablet and laptop.', 'info'); };
app.exitXR = () => {};

// ------------------------------------------------------------------ focus cards (sheets), summary
let autoAnalysis = false;
app.openFocus = (id) => {
  if (id === 'scenes') { app.setScene(); return; }
  if (!SHEETS.includes(id)) return;
  if (id === 'calc') app.ensureCalc();
  if (id === 'deep' && app.deep && app.deep.demo == null) app.deep.demo = app.feed.status.mode === 'demo';
  const compact = !app.ui.sideBySide();
  // On a phone or tablet the verdict and the check-in stay in the conversation (pinned card) instead of covering it.
  if (compact && id === 'analysis' && autoAnalysis) { app.markDirty('indai'); return; }
  if (compact && id === 'plan') { app.markDirty('indai'); app.markDirty('today'); return; }
  app.ui.openSheet(id);
};
app.closeFocus = () => { app.consolidated = false; app.ui.closeSheet(); };
app.consolidate = () => {
  app.consolidated = true;
  app.ui.openSheet('summary');
  say('Everything in one view. Close it to go back to your screens.', 'info', { speak: false });
};
app.restoreAll = () => { app.consolidated = false; app.ui.closeSheet(); };
app.openSettings = () => app.ui.openSheet('settings');
app.onSelfTest = (results, done) => {
  app.selfTest = { results: [...results], done, at: Date.now() };
  if (app.focus !== 'selftest') app.ui.openSheet('selftest');
  app.markDirty('selftest');
};

// Ask for the microphone before it is needed, so the permission prompt is easy to answer.
app.primeMic = async () => {
  if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';
  try {
    const st = await navigator.permissions?.query({ name: 'microphone' }).catch(() => null);
    if (st && st.state !== 'prompt') return st.state;
  } catch {}
  app.micSession?.(true);
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); return 'granted-now'; }
  catch { return 'denied'; }
  finally { app.micSession?.(false); }
};

// ------------------------------------------------------------------ alerts
const alertMem = { last: {}, at: {}, hod: {}, lod: {}, mkt: null, warned5: null };
function flash(id) { app.ui?.flash(id); }
function canAlert(key, ms) { const now = Date.now(); if (now - (alertMem.at[key] || 0) < ms) return false; alertMem.at[key] = now; return true; }
function checkAlerts() {
  const s = app.settings, now = Date.now();
  const ms = marketStatus(now);
  const demo = app.feed.status.mode === 'demo';
  const tag = demo ? ' (demo)' : '';
  if (s.alerts.bells) {
    if (alertMem.mkt && alertMem.mkt !== ms.state) {
      if (ms.state === 'open') say('Opening bell. Market is open. Trade your plan and size from the breaker.', 'alert');
      if (alertMem.mkt === 'open' && ms.state !== 'open') say(`Closing bell. Day P&L ${app.day.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(app.day.pnl))}.`, 'alert');
    }
    if (ms.state === 'open' && ms.msToNext < 5 * 60e3 && alertMem.warned5 !== ms.et.ymd) { alertMem.warned5 = ms.et.ymd; say('Five minutes to the close. Zero-day options decay fast here.', 'alert'); }
  }
  alertMem.mkt = ms.state;
  for (const sym of s.symbols) {
    const q = app.feed.quote(sym);
    if (!q) continue;
    const prev = alertMem.last[sym];
    alertMem.last[sym] = q.last;
    if (prev == null) { alertMem.hod[sym] = q.high; alertMem.lod[sym] = q.low; continue; }
    const lv = app.levelsFor(sym);
    if (s.alerts.levels && lv && prev !== q.last && ms.state === 'open') {
      for (const [k, name] of [['cw', 'call wall'], ['pw', 'put wall'], ['zg', 'gamma flip']]) {
        const L = lv[k]; if (L == null) continue;
        if ((prev - L) * (q.last - L) <= 0 && canAlert(sym + k, 10 * 60e3)) {
          say(`${sym} crossing ${q.last >= L ? 'above' : 'below'} the ${name} at ${fmtPrice(L)}${tag}.`, 'alert');
          if (sym === s.main) flash('chart'); flash('watch');
        }
      }
    }
    if (s.alerts.hod && ms.state === 'open' && ms.et.h >= 10) {
      if (q.high != null && alertMem.hod[sym] != null && q.high > alertMem.hod[sym] && canAlert(sym + 'hod', 15 * 60e3)) { say(`${sym} new high of day, ${fmtPrice(q.high)}${tag}.`, 'alert'); flash('watch'); }
      if (q.low != null && alertMem.lod[sym] != null && q.low < alertMem.lod[sym] && canAlert(sym + 'lod', 15 * 60e3)) { say(`${sym} new low of day, ${fmtPrice(q.low)}${tag}.`, 'alert'); flash('watch'); }
    }
    alertMem.hod[sym] = q.high; alertMem.lod[sym] = q.low;
  }
  const d = app.day;
  if (d.plan && d.plan.goal > 0 && !d.goalHit && d.pnl >= d.plan.goal) {
    d.goalHit = true; saveDay(d);
    const after = PROFILES[d.plan.aggr]?.afterGoal;
    say(`Goal hit: you're up ${fmtMoney(d.pnl)} against a ${fmtMoney(d.plan.goal)} goal. ${after === 'stop' ? "That's the plan, so I'm turning setup alerts off. Great day to walk away." : after === 'aplus' ? "From here I'll only flag A-plus setups. Don't give it back." : "If you keep going, protect at least 70 percent of today's gains."}`, 'good');
    app.markDirty('today');
  }
  if (d.cooldownUntil && now >= d.cooldownUntil && !d.cooldownAnnounced) {
    d.cooldownAnnounced = true; saveDay(d);
    say('Cooldown over. Only take A-plus setups, and run the checklist first.', 'good');
    app.markDirty('risk');
  }
  if (d.cooldownUntil > now) d.cooldownAnnounced = false;
  if (todayET() !== d.date) { app.day = freshDay(); app.checkInStarted = false; persistDay(); app.markDirty('all'); }
}

// ------------------------------------------------------------------ feed lifecycle
function restartFeed() {
  app.feed.stop();
  app.feed = new MarketFeed(app.settings);
  app.feed.start();
  alertMem.last = {}; alertMem.hod = {}; alertMem.lod = {};
  lastGexSweep = 0; lastFeedRev = -1; lastMode = null;
  app.markDirty('all');
}
app.applySettings = (prev) => {
  app.forceDemo = false;                       // the person just chose the data mode themselves
  app.levels = parseLevels(app.settings.levelsText);
  app.saveSettings();
  const changed = !prev || prev.f !== app.settings.finnhubKey || prev.syms !== app.settings.symbols.join(',') || prev.mode !== app.settings.dataMode;
  if (changed) restartFeed();
  app.slowVoice = false;
  app.indai.setMuted(!app.settings.voice);
  app.markDirty('all');
};

// ------------------------------------------------------------------ drawing and timers
// Views redraw only when their data changed, at most once per animation frame, and only while visible.
let raf = 0, later = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0;
  let wait = Infinity;
  for (const id of [...app.dirty]) {
    const v = app.views[id];
    if (!v) { app.dirty.delete(id); continue; }
    if (v.visible && !v.visible()) continue;                 // stays dirty; drawn when it is shown
    const due = (v.last || 0) + (v.gap || 0) - now;
    if (due > 0) { wait = Math.min(wait, due); continue; }
    app.dirty.delete(id); v.last = now;
    try { v.render(); } catch (e) { console.warn('render', id, e); }
  }
  if (wait < Infinity) { clearTimeout(later); later = setTimeout(schedule, wait); }
}
app.redraw = schedule;

const FEED_VIEWS = ['watch', 'chart', 'leadlag', 'levels', 'top', 'summary', 'deep', 'calc', 'today', 'ideabar', 'ideas'];
let lastFeedRev = -1, lastMode = null, lastSecond = 0, lastGex = 0, lastTV = 0, lastScan = 0, lastBridge = 0;
// The setup scan runs the moment new candles land (and every few seconds as a backstop), not on a slow timer.
const bootAt = Date.now();
let lastCatchUp = 0, scanTimer = 0;
function runScan() {
  if (Date.now() - bootAt < 2500) return;        // let the page finish laying itself out before anything can pop up
  lastScan = Date.now(); try { scanTick(); } catch (e) { console.warn('scan', e); }
}
function scanSoon() { clearTimeout(scanTimer); scanTimer = setTimeout(runScan, 120); }
function runCatchUp({ tell = true } = {}) {
  lastCatchUp = Date.now();
  runScan();                                    // the live scan goes first, so the newest candle alerts instead of being listed quietly
  let n = 0; try { n = catchUp(); } catch (e) { console.warn('catch up', e); }
  if (n && tell) app.toast(`${n} setup${n === 1 ? '' : 's'} confirmed earlier today ${n === 1 ? 'is' : 'are'} in Ideas`);
  return n;
}
app.runCatchUp = runCatchUp;
function tick() {
  if (app.locked) return;                       // behind the access lock nothing runs
  const now = Date.now();
  if (app.feed.rev !== lastFeedRev) { lastFeedRev = app.feed.rev; FEED_VIEWS.forEach(id => app.dirty.add(id)); schedule(); if (now - lastScan > 1500) scanSoon(); }
  if (app.feed.status.mode !== lastMode) {
    const was = lastMode; lastMode = app.feed.status.mode;
    // ideas belong to the data they came from: simulated ones never mix with real ones
    if (!was || (was === 'demo') !== (lastMode === 'demo')) {
      if (lastMode === 'demo') { app.signals = app.signals.filter(x => x.demo || x.practice); sigMem.scanned = new Set(); sigMem.last = {}; sigMem.hour = []; } else loadIdeas();
      app.forming = {}; sigMem.lastBar = {}; lastCatchUp = 0;
    }
    if (was && lastMode === 'demo' && was !== 'demo') say("I couldn't reach market data, so these are demo prices for now. Everything still works for practice.", 'alert', { speak: false });
    app.markDirty('all');
  }
  if (now - lastSecond < 950) return;
  lastSecond = now;
  app.markDirty('top');
  const rs = app.riskState().state;
  if (rs === 'cooldown' || rs !== tick.rs) { tick.rs = rs; app.markDirty('risk'); }
  if (app.focus === 'summary') app.markDirty('summary');
  try { checkAlerts(); } catch (e) { console.warn(e); }
  if (now - lastGex > 8000) { lastGex = now; try { gexTick(); } catch (e) { console.warn(e); } }
  if (now - lastTV > 12000) { lastTV = now; pollTradingView(); }
  if (now - lastBridge > bridgeGap()) { lastBridge = now; pollBridge(); }
  if (now - lastScan > 5000) runScan();
  app.markDirty('ideabar'); if (app.focus === 'ideas') app.markDirty('ideas');
  if (etParts().ymd !== ideasDay) { ideasDay = etParts().ymd; app.signals = app.signals.filter(x => x.practice); app.forming = {}; sigMem.scanned = new Set(); sigMem.last = {}; sigMem.hour = []; saveIdeas(); ideasChanged(); }
  // Ideas that confirmed before the page was opened: as soon as the candles are in, then again shortly after
  // (tickers load at different speeds), then every two minutes as a backstop.
  const barsIn = app.settings.symbols.some(x => app.feed.getBars(x, '5min').length >= 6);
  if (now - bootAt > 3000 && barsIn && now - lastCatchUp > (now - bootAt < 90e3 ? 12e3 : 120e3)) runCatchUp();
  if (now - lastProbe > 45000) reconnect();
  // a quote pull failed: try again in a few seconds rather than leaving stale prices up until the next scheduled one
  if (app.feed.status.mode !== 'demo' && app.feed.status.cboe === 'err' && !document.hidden && now - lastRefresh > 4000) refreshNow();
}
// If INDAI fell back to demo prices because the network was down at launch, keep trying and switch back by herself.
let lastProbe = Date.now();
async function reconnect() {
  lastProbe = Date.now();
  if (app.feed.status.mode !== 'demo' || app.settings.dataMode === 'demo' || document.hidden || navigator.onLine === false) return;
  try {
    const j = await relay.snapshot(['SPY']);
    if (!(j.quotes || []).some(q => q.ok)) return;
  } catch { return; }
  if (app.feed.status.mode !== 'demo') return;
  restartFeed();
  relay.brainStatus().then(b => { app.indai.brain = { ...b, checked: true }; app.markDirty('indai'); app.markDirty('settings'); });
  say('Market data is back. Switching from demo prices to real ones.', 'good', { speak: false });
}
window.addEventListener('online', () => { setTimeout(reconnect, 1500); refreshNow(); });
// Coming back to the app (phone unlocked, tab switched back, signal returned): pull fresh prices straight away
// instead of waiting for the next scheduled poll, and forget any request that died while it was away.
let lastRefresh = 0;
function refreshNow() {
  const f = app.feed;
  if (f.status.mode === 'demo' || document.hidden) return;
  lastRefresh = Date.now();
  f.lastSnap = 0; f.lastBarsMain = 0;            // these gate the shared feed's next quote and candle pull
  f.cboeTick();
  lastBridge = 0; lastTV = 0;
}
app.refreshNow = refreshNow;
window.addEventListener('pageshow', (e) => { if (e.persisted) { refreshNow(); app.wakeSound?.(); } });

// ------------------------------------------------------------------ boot
async function boot() {
  const qp = new URLSearchParams(location.search);
  if (qp.get('demo') === '1' && app.settings.dataMode !== 'demo') { app.savedDataMode = app.settings.dataMode; app.settings.dataMode = 'demo'; app.forceDemo = true; }
  if (qp.get('nocheckin') === '1') app.noAutoCheckIn = true;
  app.ui = initViews(app);
  initSheets(app);
  initRetro(app);
  initIdeas(app);
  initPush(app);
  // Behind the access lock nothing starts: no prices, no alerts, no voice. Unlocking reloads the page.
  if (initLock(app)) { window.__indai = { app, relay }; return; }
  app.feed.start();
  loadMorningGex();
  setInterval(loadMorningGex, 10 * 60e3);
  setInterval(tick, 250);
  app.markDirty('all');
  const st = app.feed.status;
  say(st.mode === 'demo'
    ? `Hi ${app.settings.name}, I'm INDAI. Running on demo data right now.`
    : `Hi ${app.settings.name}, I'm INDAI. Market data is connecting (delayed about 15 minutes).`, 'info', { speak: false });
  say('Ask me about a trade, like “QQQ calls expiring today, 665 strike”. Tap the mic, hold the space bar, or just type.', 'info', { speak: false });
  // audio is only allowed after a tap or key press: unlock it on the first one
  // (a touch only counts as a user action when the finger lifts, so listen for the end of the tap)
  const first = () => { const v = app.indai.voice; if (!firstGesture.done) firstGesture(); else { if (v.ctx && v.ctx.state !== 'running') v.unlock(); app.unlockSound(); app.wakeSound(true); maybeCheckIn(); } };
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, first, { passive: true });
  // keyboard push-to-talk: hold the space bar (when not typing in a field)
  const typing = () => /INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
  window.addEventListener('keydown', (ev) => { if (ev.code === 'Space' && !ev.repeat && !typing()) { ev.preventDefault(); if (!app.indai.listening) app.talk(); } });
  window.addEventListener('keyup', (ev) => { if (ev.code === 'Space' && !typing() && app.indai.voice.state.listening) { app._userStop = Date.now(); app.indai.voice.stop(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { app.markDirty('all'); refreshNow(); tick(); app.wakeSound(); setTimeout(runCatchUp, 3500); setTimeout(runCatchUp, 12000); if (Date.now() - lastProbe > 8000) reconnect(); } });
  if (document.fonts?.ready) document.fonts.ready.then(() => app.markDirty('all'));
  // another tab (or the Quest app in this same browser) logged a trade or locked a plan: pick it up
  window.addEventListener('storage', (e) => { if (e.key === 'jarvis.day.v1') { app.day = loadDay(); if (!app.indai.awaiting) app.planDraft = defaultDraft(); app.markDirty('all'); } });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') && qp.get('nosw') !== '1') {
    // The service worker switches on multi-core voice processing. The first time it takes over, reload once (only during start-up).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      let done = false; try { done = !!sessionStorage.getItem('indai.coi'); } catch { done = true; }
      if (!self.crossOriginIsolated && !done && performance.now() < 20000 && !firstGesture.done) { try { sessionStorage.setItem('indai.coi', '1'); } catch {} location.reload(); }
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // opened from a push notification while INDAI was closed: bring that ticker's idea up once today's list is in
  const want = (qp.get('idea') || '').toUpperCase();
  if (want) setTimeout(() => { if (app.locked) return; if (app.settings.symbols.includes(want)) app.selectSymbol(want); const hit = app.signals.find(x => x.sym === want); app.openIdeas(hit ? hit.id : null); }, 7000);
  if (qp.get('settings') === '1') app.openSettings();
  if (qp.get('calc') === '1') app.openCalc();
  if (qp.get('selftest') === '1') setTimeout(() => app.indai.selfTest(), 5000);
  window.__indai = { app, relay };
}
boot();
