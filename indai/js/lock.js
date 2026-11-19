// Access lock. When the backend has an owner passcode set (the "access token"), its thinking brain, memory,
// saved conversation, profile, speech-to-text and push answer nobody without it. This file is the website's side
// of that: one screen that asks for the token once per device and keeps the whole app shut until it is right.
// The token is checked by the backend, never here. A device that has not got it right sees nothing but this screen.
// What this cannot hide: the website's own files are public (GitHub Pages), and the backend's market-data
// endpoints serve the same public delayed quotes to anyone who calls them. Nothing personal or paid sits behind those.
import { relay } from './relay.js';

const KEY = 'indai.web.lock.v1';
const $ = (id) => document.getElementById(id);

export function initLock(app) {
  let st = { required: false, ok: false };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY)) || {}); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const el = $('lock'), form = $('lock-form'), input = $('lock-input'), msg = $('lock-msg'), btn = $('lock-go');
  const token = () => app.settings.researchPass || '';

  // Ask the backend whether this token opens it. true / false, or null when it cannot be reached.
  async function accepts(pass) {
    try { await relay.brain({ mode: 'memory', op: 'list' }, pass); return true; }
    catch (e) { return e.code === 'passcode' || e.code === 'unauthorized' ? false : e.code === 'sign_in_required' ? true : null; }
  }
  function lock(note = '') {
    if (!app.locked) {
      app.locked = true;
      document.body.classList.add('locked');
      try { app.feed.stop(); } catch {}
      try { app.indai.voice.cancel(); app.indai.voice.stopSpeaking(); } catch {}
      app.hideIdeaAlert?.();
    }
    el.hidden = false; msg.textContent = note;
    setTimeout(() => { try { input.focus({ preventScroll: true }); } catch {} }, 50);
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pass = input.value.trim();
    if (!pass) { msg.textContent = 'Type the access token first.'; return; }
    btn.disabled = true; msg.textContent = 'Checking…';
    const ok = await accepts(pass);
    btn.disabled = false;
    if (ok === null) { msg.textContent = "Can't reach INDAI right now. Check the connection and try again."; return; }
    if (!ok) { msg.textContent = 'That token was not accepted.'; input.select(); return; }
    app.settings.researchPass = pass; app.saveSettings();
    st = { required: true, ok: true }; save();
    msg.textContent = 'Unlocked.';
    location.reload();                      // start clean, with the token in place
  });

  // Look again: is a token required, and is the one on this device still good?
  let checking = false;
  async function check() {
    if (checking) return; checking = true;
    try { await look(); } finally { checking = false; }
  }
  async function look() {
    const s = await relay.brainStatus();
    if (!s || s.error) return;                                   // backend unreachable: nothing new is known
    if (!s.passcode) { if (st.required || !st.ok) { st = { required: false, ok: true }; save(); } return; }
    if (!st.required) { st.required = true; save(); }
    const pass = token();
    const ok = pass ? await accepts(pass) : false;
    if (ok === null) return;
    if (ok) { if (!st.ok) { st.ok = true; save(); } return; }
    st.ok = false; save();
    lock(pass ? 'The token saved on this device is no longer accepted. Enter the current one.' : '');
  }
  // The backend refused the token in the middle of something (it was changed since this device last checked).
  app.onTokenRejected = () => { if (!app.locked) check(); };
  // Settings: forget the token here and shut the app on this device.
  app.lockDevice = () => { app.settings.researchPass = ''; app.saveSettings(); st.ok = false; save(); location.reload(); };
  app.lockState = () => ({ ...st, locked: !!app.locked });

  const known = st.required && !(st.ok && token());
  if (known) lock();                       // a device that is already known to need the token never shows the app first
  setTimeout(check, known ? 0 : 900);
  return known;
}
