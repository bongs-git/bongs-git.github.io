import { profileSync } from './profile-sync.js';
// Retrospective: after the close, go back over the day's trade ideas, see what won and what lost and why, and
// let INDAI adjust what she alerts on. Doing this day after day is how the ideas get tighter.
//
// How it stays honest:
//   - It measures every setup the scanner found at the plan's score level that day (replayed from the day's candles
//     with the scanner's own rules), including ones INDAI had already learned to skip. Otherwise a setup she has
//     marked down could never earn its way back, and the learning could only ever tighten.
//   - A result is the stock reaching the target before the stop (win), the stop first (loss), or neither by the close
//     (counted at the closing price). It is measured in R: 1R is the distance from entry to the stop. It is the idea's
//     result on the stock, not an option fill and not your own trades.
//   - Nothing changes by itself. She proposes; you apply. Proposals need enough ideas behind them (20 overall, 8 in a
//     group), are pulled toward the average when a group is small, and are capped. They are worked out afresh from
//     all the kept days each time, so a change that stops being true goes away again.
import { scanSetups, STRATEGIES } from './signals.js';
import { etParts, etToMs, isTradingDay, chartSession } from './market.js';
import { relay } from './relay.js';

// ---------------------------------------------------------------- pure parts (also run by the tests in Node)
export const GRID = [];
for (const stop of [1, 1.5, 2]) for (const target of [0.75, 1, 1.5]) GRID.push({ stop, target });
export const BASE = GRID.findIndex(v => v.stop === 1 && v.target === 1);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(v * 100) / 100;
const minsET = (ms) => { const p = etParts(ms); return p.h * 60 + p.mi; };

// What happened to one idea. bars: one-minute candles from the minute it confirmed to the close, oldest first.
// v widens the stop or moves the target, as multiples of the idea's own risk and reward.
export function evalIdea(idea, bars, v = GRID[BASE]) {
  const d = idea.dir, risk = Math.abs(idea.price - idea.stop), reward = Math.abs(idea.target - idea.price);
  if (!(risk > 0) || !(reward > 0) || !bars || !bars.length) return null;
  const stopAt = idea.price - d * risk * v.stop, targetAt = idea.price + d * reward * v.target;
  let res = 'O', R = 0, at = 0, mfe = 0, mae = 0, k = 0;
  for (; k < bars.length; k++) {
    const b = bars[k], fav = (d > 0 ? b.h - idea.price : idea.price - b.l) / risk, adv = (d > 0 ? idea.price - b.l : b.h - idea.price) / risk;
    if (fav > mfe) mfe = fav; if (adv > mae) mae = adv;
    const stopHit = d > 0 ? b.l <= stopAt : b.h >= stopAt, targetHit = d > 0 ? b.h >= targetAt : b.l <= targetAt;
    if (stopHit) { res = 'L'; R = -v.stop; at = b.t; break; }        // both inside one candle: count the stop
    if (targetHit) { res = 'W'; R = reward * v.target / risk; at = b.t; break; }
  }
  if (res === 'O') R = clamp((bars[bars.length - 1].c - idea.price) * d / risk, -v.stop, reward * v.target / risk);
  // after a stop-out: did price go on to the target anyway (the idea was right, the stop was too tight)?
  let stopThenTarget = false;
  if (res === 'L') for (let j = k + 1; j < bars.length; j++) { if (d > 0 ? bars[j].h >= targetAt : bars[j].l <= targetAt) { stopThenTarget = true; break; } }
  const near = res !== 'W' && mfe >= 0.8 * reward * v.target / risk;       // got most of the way to the target and turned back
  return { res, R: r2(R), mfe: r2(Math.min(mfe, 20)), mae: r2(Math.min(mae, 20)), mins: at ? Math.round((at + 60e3 - bars[0].t) / 60e3) : null, stopThenTarget, near };
}
// The same idea entered on a small pullback instead of at the close of its candle: a third of the way back toward
// the stop, within ten minutes. Not filled (price never came back) means no trade.
export function evalPullback(idea, bars, frac = 1 / 3, waitMin = 10) {
  const d = idea.dir, risk = Math.abs(idea.price - idea.stop), reward = Math.abs(idea.target - idea.price);
  if (!(risk > 0) || !(reward > 0) || !bars || !bars.length) return null;
  const entry = idea.price - d * frac * risk, t0 = bars[0].t;
  for (let k = 0; k < bars.length && bars[k].t - t0 < waitMin * 60e3; k++) {
    const b = bars[k];
    if (d > 0 ? b.h >= idea.target : b.l <= idea.target) return { filled: false };          // it left without you
    if (!(d > 0 ? b.l <= entry : b.h >= entry)) continue;
    for (let j = k; j < bars.length; j++) {
      const c = bars[j];
      if (d > 0 ? c.l <= idea.stop : c.h >= idea.stop) return { filled: true, res: 'L', R: r2(-(1 - frac)) };
      if (j > k && (d > 0 ? c.h >= idea.target : c.l <= idea.target)) return { filled: true, res: 'W', R: r2((reward + frac * risk) / risk) };
    }
    return { filled: true, res: 'O', R: r2((bars[bars.length - 1].c - entry) * d / risk) };
  }
  return { filled: false };
}

const WINDOWS = [['open', 630, 'First hour (9:30 to 10:30)'], ['mid', 705, 'Mid-morning (10:30 to 11:45)'], ['lunch', 810, 'Lunch window (11:45 to 1:30)'], ['pm', 900, 'Afternoon (1:30 to 3:00)'], ['close', 9999, 'Last hour (3:00 to 4:00)']];
const plainTitle = (t) => String(t || '').replace(/\s*\d[\d.,]*\s*$/, '').replace(/\s+\d[\d.,]*/g, '').trim();
// A warning without its changing number: "RSI stretched (78)" and "only 0.7:1 reward to risk" each become one group.
// (The others keep their words exactly: "against the 34/50 trend", "last 20 minutes".)
export const plainFlag = (f) => /reward to risk/.test(f) ? 'low reward to risk' : String(f || '').replace(/\s*\(.*?\)\s*/g, '').trim();
// Days kept by the first version wrote two warnings wrongly; put them right when they are read back.
const OLD_FLAGS = { 'against the/50 trend': 'against the 34/50 trend', 'last minutes': 'last 20 minutes' };
const fixFlag = (f) => OLD_FLAGS[f] || f;
const TIME_FLAGS = new Set(['lunch chop window', 'last 20 minutes']);
// The groups an idea belongs to: time of day, kind of setup, direction, ticker, each warning it carried, score band.
export function keysOf(r) {
  const m = r.min ?? minsET(r.t), w = WINDOWS.find(x => m < x[1]) || WINDOWS[4];
  const out = [
    { key: 'time:' + w[0], label: w[2] },
    { key: `kind:${r.strat}|${plainTitle(r.title)}`, label: `${plainTitle(r.title)} (${STRATEGIES[r.strat]?.short || r.strat})` },
    { key: 'dir:' + r.dir, label: r.dir > 0 ? 'Call setups' : 'Put setups' },
    { key: 'sym:' + r.sym, label: r.sym },
  ];
  for (const f of r.flags || []) if (!TIME_FLAGS.has(f)) out.push({ key: 'flag:' + f, label: `Carried the warning “${f}”` });
  const s = r.raw;
  out.push(s >= 80 ? { key: 'band:80', label: 'Scored 80 and up' } : s >= 70 ? { key: 'band:70', label: 'Scored 70 to 79' } : { key: 'band:lo', label: 'Scored under 70' });
  return out;
}
export function summarize(recs, pick = (r) => r.R) {
  const s = { n: recs.length, W: 0, L: 0, O: 0, R: 0 };
  for (const r of recs) { s[r.res]++; s.R += pick(r); }
  s.R = r2(s.R); s.avgR = s.n ? r2(s.R / s.n) : 0; s.winRate = s.W + s.L ? Math.round(s.W / (s.W + s.L) * 100) : null;
  return s;
}
export function groups(recs) {
  const m = new Map();
  for (const r of recs) for (const k of keysOf(r)) { let g = m.get(k.key); if (!g) m.set(k.key, g = { ...k, recs: [] }); g.recs.push(r); }
  return [...m.values()].map(g => ({ key: g.key, label: g.label, ...summarize(g.recs) }));
}
// The score an idea gets after what she has learned, and whether she would still list it.
export function tunedScore(r, tuning) {
  let sum = 0; for (const k of keysOf(r)) sum += tuning.adj[k.key] || 0;
  return clamp(r.raw + clamp(sum, -15, 8), 0, 100);
}
export const NO_TUNING = Object.freeze({ adj: {}, labels: {}, minAdd: 0, stop: 1, target: 1 });
const TUNABLE = /^(time|kind|dir|sym|flag):/;
export const MIN_IDEAS = 20, MIN_GROUP = 8;

// What the kept days say should change. days: [{ ymd, recs }]. Worked out from scratch every time; `current` is
// only used to keep the score line from moving more than one step at a time.
export function propose(days, minScore, current = NO_TUNING) {
  const recs = days.flatMap(d => d.recs), n = recs.length, out = { ready: n >= MIN_IDEAS, n, days: days.length, adj: {}, labels: {}, minAdd: 0, stop: 1, target: 1, why: [] };
  if (!out.ready) return out;
  const all = summarize(recs), mu = all.avgR;
  for (const g of groups(recs)) {
    if (!TUNABLE.test(g.key) || g.n < MIN_GROUP) continue;
    // pulled toward the average when the group is small; marking down goes further than marking up
    const pts = clamp(Math.round((g.avgR - mu) * (g.n / (g.n + 12)) * 12), -10, 3);
    if (Math.abs(pts) < 2) continue;
    if ((pts < 0 && g.avgR >= 0) || (pts > 0 && g.avgR <= 0)) continue;      // only mark down what lost, only mark up what won
    out.adj[g.key] = pts; out.labels[g.key] = g.label;
    out.why.push({ kind: 'adj', key: g.key, pts, text: `${g.label}: ${pts > 0 ? '+' : '−'}${Math.abs(pts)} points`, basis: `${g.W} won, ${g.L} lost${g.O ? `, ${g.O} open at the close` : ''}, ${fmtR(g.R)} over ${g.n} ideas` });
  }
  // the score an idea must reach: raise it only if the ideas just above the line have been dragging the rest down
  const scored = recs.map(r => ({ r, s: tunedScore(r, out) }));
  const at = (T) => summarize(scored.filter(x => x.s >= T).map(x => x.r));
  const base = at(minScore); let best = { add: 0, s: base };
  for (const add of [3, 6, 9]) {
    if (add > (current.minAdd || 0) + 3) break;                                           // one step at a time
    const s = at(minScore + add), cut = summarize(scored.filter(x => x.s >= minScore && x.s < minScore + add).map(x => x.r));
    // it must keep at least half, what it cuts must have been losing, and what is left must be clearly better
    if (s.n >= Math.max(15, 0.5 * base.n) && cut.n >= 5 && cut.avgR < -0.05 && s.avgR - base.avgR >= 0.15 && s.avgR > best.s.avgR) best = { add, s };
  }
  if (best.add) {
    out.minAdd = best.add;
    out.why.push({ kind: 'min', text: `Only alert at ${minScore + best.add} and up (was ${minScore})`, basis: `after the changes above, the ${best.s.n} setups scoring ${minScore + best.add} and up averaged ${fmtR(best.s.avgR)} each, against ${fmtR(base.avgR)} for the ${base.n} at ${minScore} and up` });
  }
  // stop and target: the combination that would have done best, if it is clearly and consistently better
  const total = (i, list = recs) => list.reduce((a, r) => a + (r.grid?.[i] ?? r.R), 0);
  let bi = BASE; for (let i = 0; i < GRID.length; i++) if (total(i) > total(bi) + 1e-9) bi = i;
  if (bi !== BASE) {
    const gain = total(bi) - total(BASE), judged = days.filter(d => d.recs.length >= 5), better = judged.filter(d => total(bi, d.recs) > total(BASE, d.recs)).length;
    const steady = judged.length >= 2 ? better / judged.length >= 0.6 : n >= 40;
    if (n >= 30 && gain / n >= 0.1 && steady) {
      const v = GRID[bi]; out.stop = v.stop; out.target = v.target;
      const parts = [v.stop !== 1 ? `stops ${v.stop} times as far from entry` : '', v.target !== 1 ? `targets ${v.target < 1 ? 'closer' : 'further'} (${v.target} times the distance)` : ''].filter(Boolean).join(' and ');
      out.why.push({ kind: 'levels', text: parts.charAt(0).toUpperCase() + parts.slice(1), basis: `${fmtR(total(bi))} instead of ${fmtR(total(BASE))} over ${n} ideas${judged.length >= 2 ? `, better on ${better} of ${judged.length} days` : ''}` });
    }
  }
  return out;
}
export const fmtR = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 1 : 2).replace(/\.?0+$/, '') || '0'}R`;
// Is a proposal the same as what is in force, for practical purposes? A one-point wobble in a group is not a change.
export const sameTuning = (a, b) => a.minAdd === b.minAdd && a.stop === b.stop && a.target === b.target
  && [...new Set([...Object.keys(a.adj), ...Object.keys(b.adj)])].every(k => Math.abs((a.adj[k] || 0) - (b.adj[k] || 0)) < 2);
// Apply what she has learned to a setup fresh from the scanner (a score change, and where the stop and target go).
export function tuneIdea(c, tuning, at = c.at) {
  if (!tuning || c.raw) return c;
  c.raw = { score: c.score, stop: c.stop, target: c.target, rr: c.rr };
  const hits = keysOf({ t: at, strat: c.strat, title: c.title, dir: c.dir, sym: c.sym, flags: (c.against || []).map(plainFlag), raw: c.score }).filter(k => tuning.adj[k.key]);
  const sum = clamp(hits.reduce((a, k) => a + tuning.adj[k.key], 0), -15, 8);
  if (sum) { c.score = clamp(c.score + sum, 0, 100); c.learned = hits.map(k => ({ label: tuning.labels?.[k.key] || k.label, pts: tuning.adj[k.key] })); }
  if (tuning.stop !== 1 || tuning.target !== 1) {
    const risk = Math.abs(c.price - c.stop), reward = Math.abs(c.target - c.price);
    c.stop = +(c.price - c.dir * risk * tuning.stop).toFixed(2); c.target = +(c.price + c.dir * reward * tuning.target).toFixed(2);
    c.rr = +((reward * tuning.target) / (risk * tuning.stop || 1e-9)).toFixed(2);
  }
  return c;
}
// One idea as the retrospective keeps it.
export function record(c, bars) {
  const raw = c.raw || c, idea = { dir: c.dir, price: c.price, stop: raw.stop, target: raw.target };
  const e = evalIdea(idea, bars); if (!e) return null;
  const pb = evalPullback(idea, bars);
  return { id: `${c.sym}|${c.strat}|${c.dir}|${c.barT}`, sym: c.sym, strat: c.strat, dir: c.dir, title: c.title, raw: raw.score, t: c.at, min: minsET(c.at), flags: (c.against || []).map(plainFlag), rr: raw.rr,
    ...e, grid: GRID.map(v => evalIdea(idea, bars, v).R), pb: pb && pb.filled ? { R: pb.R, res: pb.res } : null };
}

// Has today's session closed (early closes included)? False on weekends, holidays and before the open.
export function dayIsOver(now = Date.now()) {
  const p = etParts(now); if (!isTradingDay(p.y, p.m, p.d)) return false;
  const s = chartSession(now);
  return s.open === etToMs(p.y, p.m, p.d, 9, 30) && now >= s.close;
}
// ---------------------------------------------------------------- the part that lives in the app
const KEY = 'indai.web.retro.v1';
const KEEP_DAYS = 20;

export function initRetro(app) {
  let st = { days: {}, tuning: null, log: [] };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY)) || {}); } catch {}
  for (const d of Object.values(st.days)) for (const r of d.recs || []) if (r.flags) r.flags = r.flags.map(fixFlag);
  if (st.tuning) for (const k of Object.keys(st.tuning.adj || {})) { const nk = k.startsWith('flag:') ? 'flag:' + fixFlag(k.slice(5)) : k; if (nk !== k) { if (!TIME_FLAGS.has(nk.slice(5))) { st.tuning.adj[nk] = st.tuning.adj[k]; if (st.tuning.labels?.[k]) st.tuning.labels[nk] = st.tuning.labels[k].replace(k.slice(5), nk.slice(5)); } delete st.tuning.adj[k]; delete st.tuning.labels?.[k]; } }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const tuning = () => st.tuning || NO_TUNING;
  const demo = () => app.feed.status.mode === 'demo';
  const profile = () => ({ version: 1, ...tuning(), at: st.tuning?.at || st.clearedAt || 0 });
  const sync = profileSync(app, 'tuning', profile, value => {
    if (value?.version !== 1 || !Number.isFinite(value.at) || value.at <= profile().at || !value.adj || typeof value.adj !== 'object' || Array.isArray(value.adj)) return;
    if (![value.minAdd, value.stop, value.target].every(Number.isFinite) || value.minAdd < 0 || value.minAdd > 30 || value.stop <= 0 || value.stop > 3 || value.target <= 0 || value.target > 3) return;
    if (Object.entries(value.adj).some(([key, points]) => !/^(time|kind|dir|sym|flag):/.test(key) || !Number.isFinite(points) || points < -10 || points > 3)) return;
    st.tuning = { adj: value.adj, labels: value.labels || {}, minAdd: value.minAdd, stop: value.stop, target: value.target, at: value.at, basis: value.basis };
    save(); app.markDirty('ideas'); app.markDirty('ideabar');
  });
  app.tuningSync = sync;

  // Every setup the scanner found today at the plan's level (her own rules, nothing she has learned applied), with its result.
  function buildDay() {
    const p = etParts(), now = Date.now();
    if (!isTradingDay(p.y, p.m, p.d)) return null;
    const sess = chartSession(now), open = etToMs(p.y, p.m, p.d, 9, 30);
    if (sess.open !== open || now < open + 35 * 60e3) return null;
    const plan = app.activePlan(), found = new Map();
    let lastBar = 0;
    for (const sym of app.settings.symbols) {
      const five = app.completedBars(sym).filter(b => b.t >= open);
      if (five.length < 6) continue;
      const one = app.feed.getBars(sym, '1min'), lv = app.levelsFor(sym), last = {};
      if (one.length) lastBar = Math.max(lastBar, one[one.length - 1].t);
      for (let i = 6; i <= five.length; i++) {
        const sub = five.slice(0, i), barT = sub[i - 1].t, at = barT + 300e3;
        const c = scanSetups(sym, sub, { levels: lv, leadDir: 0, now: at, enabled: plan.strategies })
          .filter(x => x.score >= plan.minScore && at - (last[x.strat + x.dir] || 0) > 20 * 60e3).sort((a, b) => b.score - a.score)[0];
        if (!c) continue;
        last[c.strat + c.dir] = at;
        let after = one.filter(b => b.t >= at); if (!after.length) after = five.filter(b => b.t >= at);
        const rec = record({ ...c, at }, after);
        if (rec) found.set(rec.id, rec);
      }
    }
    // ideas she listed that the replay did not land on (it replays without the lead from SPY and QQQ)
    for (const s of app.signals) {
      if (s.practice || !!s.demo !== demo() || s.barT < open) continue;
      const id = `${s.sym}|${s.strat}|${s.dir}|${s.barT}`; if (found.has(id)) continue;
      if ([...found.values()].some(r => r.sym === s.sym && r.strat === s.strat && r.dir === s.dir && Math.abs(r.t - (s.barT + 300e3)) < 20 * 60e3)) continue;
      const at = s.barT + 300e3; let after = app.feed.getBars(s.sym, '1min').filter(b => b.t >= at); if (!after.length) after = app.feed.getBars(s.sym, '5min').filter(b => b.t >= at);
      const rec = record({ ...s, at }, after); if (rec) found.set(rec.id, rec);
    }
    const recs = [...found.values()].sort((a, b) => a.t - b.t);
    const final = now >= sess.close && (lastBar >= sess.close - 3 * 60e3 || now >= sess.close + 20 * 60e3);
    return { ymd: p.ymd, at: now, final, recs, minScore: plan.minScore, demo: demo() };
  }
  // Keep today's results once the day is over (real data only), so the learning has more than one day to go on.
  function bank(day = buildDay()) {
    if (!day || !day.final || day.demo || !day.recs.length) return false;
    st.days[day.ymd] = { at: day.at, recs: day.recs, minScore: day.minScore };
    for (const k of Object.keys(st.days).sort().slice(0, -KEEP_DAYS)) delete st.days[k];
    save(); return true;
  }
  const history = () => Object.keys(st.days).sort().map(ymd => ({ ymd, ...st.days[ymd] }));
  // Today plus the kept days: what she would change.
  function review() {
    const today = buildDay(), kept = demo() ? [] : history().filter(d => !today || d.ymd !== today.ymd);
    const days = today && today.recs.length ? [...kept, today] : kept;
    const plan = app.activePlan();
    return { today, days, proposal: propose(days, plan.minScore, tuning()), tuning: tuning(), minScore: plan.minScore, riskPerTrade: plan.riskPerTrade, log: st.log.slice(-6), demo: demo(), at: Date.now() };
  }
  function apply(proposal) {
    const t = { adj: proposal.adj, labels: proposal.labels, minAdd: proposal.minAdd, stop: proposal.stop, target: proposal.target, at: Math.max(Date.now(), profile().at + 1), basis: { ideas: proposal.n, days: proposal.days } };
    st.tuning = Object.keys(t.adj).length || t.minAdd || t.stop !== 1 || t.target !== 1 ? t : null;
    const text = proposal.why.length ? proposal.why.map(w => w.text).join('; ') : 'back to the scanner as it comes';
    st.log.push({ at: Date.now(), ymd: etParts().ymd, text, ideas: proposal.n, days: proposal.days }); st.log = st.log.slice(-20);
    save(); sync.queue();
    // she keeps the lesson in her long-term memory too, so what she says matches what she alerts on
    if (proposal.why.length && !demo()) relay.brain({ mode: 'memory', op: 'add', kind: 'rule', text: `Retrospective ${etParts().ymd}, from ${proposal.n} trade ideas over ${proposal.days} day${proposal.days === 1 ? '' : 's'}: ${text}.`.slice(0, 480) }, app.settings.researchPass).catch(() => {});
    for (const v of ['ideas', 'ideabar', 'today']) app.markDirty(v);
  }
  function reset() { const at = Math.max(Date.now(), profile().at + 1); st.tuning = null; st.clearedAt = at; sync.queue(); st.log.push({ at: Date.now(), ymd: etParts().ymd, text: 'everything she learned was cleared', ideas: 0, days: 0 }); save(); for (const v of ['ideas', 'ideabar']) app.markDirty(v); }
  // Used by the scan on every fresh setup.
  app.tune = (c, at) => (st.tuning && !demo() ? tuneIdea(c, st.tuning, at) : c);
  app.retro = { buildDay, bank, review, apply, reset, tuning, history, banked: (ymd) => !!st.days[ymd] };

  // once the day is over and its last candles are in, keep it (if INDAI is open then) and say it is ready
  let told = '';
  setInterval(() => {
    if (app.locked || document.hidden || demo()) return;
    const p = etParts(); if (!dayIsOver() || st.days[p.ymd]) return;
    const sess = chartSession(), one = app.feed.getBars(app.settings.symbols[0], '1min'), lastT = one.length ? one[one.length - 1].t : 0;
    if (!(lastT >= sess.close - 3 * 60e3 || Date.now() >= sess.close + 20 * 60e3)) return;      // the last candles are still coming in
    const day = buildDay(); if (!day || !day.final) return;
    if (bank(day) && told !== p.ymd) {
      told = p.ymd; const s = summarize(day.recs);
      app.indai.say(`Today's retrospective is ready: ${s.n} setup${s.n === 1 ? '' : 's'}, ${s.W} won, ${s.L} lost${s.winRate != null ? ` (${s.winRate}%)` : ''}, ${fmtR(s.R)}. Open Ideas and tap Retrospective.`, 'info', { speak: false });
      app.markDirty('ideabar'); app.markDirty('ideas');
    }
  }, 60e3);
}

// ---------------------------------------------------------------- back-testing a set of changes on the kept days
// All the numbers for a list of results, in the order they happened.
export function metrics(recs, pick = (r) => r.R) {
  const list = [...recs].sort((a, b) => a.t - b.t), s = summarize(list, pick);
  let win = 0, loss = 0, eq = 0, peak = 0, dd = 0, run = 0, worstRun = 0;
  for (const r of list) {
    const v = pick(r);
    if (v > 0) win += v; else loss -= v;
    eq += v; if (eq > peak) peak = eq; if (peak - eq > dd) dd = peak - eq;
    run = v < 0 ? run + 1 : 0; if (run > worstRun) worstRun = run;
  }
  return { ...s, grossWin: r2(win), grossLoss: r2(loss), pf: loss > 0 ? r2(win / loss) : (win > 0 ? Infinity : null), maxDD: r2(dd), losingRun: worstRun };
}
// The same days with and without a set of changes: which setups she would still alert on, and how those did
// with the proposed stop and target distances.
export function backtest(days, minScore, T) {
  const gi = Math.max(0, GRID.findIndex(v => v.stop === (T.stop || 1) && v.target === (T.target || 1)));
  const keep = (recs) => recs.filter(r => tunedScore(r, T) >= minScore + (T.minAdd || 0));
  const pick = (r) => r.grid?.[gi] ?? r.R;
  const all = days.flatMap(d => d.recs);
  return { base: metrics(all), tuned: metrics(keep(all), pick), skipped: metrics(all.filter(r => !keep([r]).length)),
    perDay: days.map(d => ({ ymd: d.ymd, base: metrics(d.recs), tuned: metrics(keep(d.recs), pick) })) };
}
// The fair test: each day is judged with only what she could have learned from the days before it.
export function walkForward(days, minScore) {
  const base = [], tuned = []; let judged = 0;
  for (let i = 1; i < days.length; i++) {
    const P = propose(days.slice(0, i), minScore);
    if (!P.ready || !P.why.length) continue;
    judged++;
    const gi = Math.max(0, GRID.findIndex(v => v.stop === P.stop && v.target === P.target));
    for (const r of days[i].recs) { base.push(r); if (tunedScore(r, P) >= minScore + P.minAdd) tuned.push({ ...r, R: r.grid?.[gi] ?? r.R }); }
  }
  return judged ? { days: judged, base: metrics(base), tuned: metrics(tuned) } : null;
}
// The changes as one line to paste into the TradingView strategy (indai/tradingview/indai-backtest.pine reads it).
export function tvCode(T) {
  const parts = [`minadd=${T.minAdd || 0}`, `stop=${T.stop || 1}`, `target=${T.target || 1}`];
  for (const [k, v] of Object.entries(T.adj || {}).sort()) if (/^(time|kind|dir|sym|flag):/.test(k) && !/[;=]/.test(k)) parts.push(`${k}=${v}`);
  return parts.join(';');
}

// ---------------------------------------------------------------- what the Retrospective screen shows
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wl = (g) => `${g.W} won, ${g.L} lost${g.O ? `, ${g.O} open` : ''}`;
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const dayLabel = (ymd) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// The facts of one day, in the order the screen tells them. Also used for the spoken summary.
export function dayFacts(recs) {
  const all = summarize(recs), gs = groups(recs).filter(g => g.n >= 3);
  const missed = gs.filter(g => g.R < 0).sort((a, b) => a.R - b.R).slice(0, 5), worked = gs.filter(g => g.R > 0).sort((a, b) => b.R - a.R).slice(0, 3);
  const losses = recs.filter(r => r.res === 'L'), wins = recs.filter(r => r.res === 'W');
  const stt = losses.filter(r => r.stopThenTarget).length, near = recs.filter(r => r.near).length;
  const winMae = wins.length ? r2(wins.reduce((a, r) => a + r.mae, 0) / wins.length) : null;
  const pb = recs.filter(r => r.pb), pbSum = summarize(pb.map(r => ({ res: r.pb.res, R: r.pb.R })));
  let bi = BASE; const tot = (i) => recs.reduce((a, r) => a + r.grid[i], 0);
  for (let i = 0; i < GRID.length; i++) if (tot(i) > tot(bi) + 1e-9) bi = i;
  return { all, missed, worked, losses: losses.length, stt, near, winMae, pb: { filled: pb.length, ...pbSum }, winMins: median(wins.map(r => r.mins).filter(Number.isFinite)), lossMins: median(losses.map(r => r.mins).filter(Number.isFinite)), best: { ...GRID[bi], R: r2(tot(bi)), base: bi === BASE } };
}
export function retroHtml(rv, armed = '') {
  const t = rv.today, P = rv.proposal, T = rv.tuning, recs = t ? t.recs : [];
  const out = [];
  const state = rv.demo ? ['Demo data', 'alert'] : !t ? ['No session yet today', ''] : t.final ? ['Final', 'good'] : ['So far today', 'alert'];
  out.push(`<div class="retro-top"><button type="button" class="btn mini" data-retro="back">‹ Ideas</button><span class="pill ${state[1]}">${state[0]}</span><span class="spacer"></span><span class="when">${t ? esc(dayLabel(t.ymd)) : ''}</span></div>`);
  if (!recs.length) out.push(`<p class="idea-none">${t ? 'The scanner found no setups at your plan’s level today, so there is nothing to go over.' : 'Nothing to go over yet. Come back after the first half hour of a trading day, and best of all after the close.'}</p>`);
  else {
    const f = dayFacts(recs), a = f.all;
    out.push(`<div class="rtiles"><div><b>${a.n}</b><span>setups</span></div><div><b>${a.winRate == null ? '—' : a.winRate + '%'}</b><span>win rate</span></div><div><b class="${cls(a.R)}">${fmtR(a.R)}</b><span>result</span></div><div><b>${a.W}<i>–</i>${a.L}${a.O ? `<i>–</i>${a.O}` : ''}</b><span>won–lost${a.O ? '–open' : ''}</span></div></div>`);
    out.push(`<p class="note">Every setup the scanner found today at your plan’s level (${rv.minScore}+), scored the way it comes before anything she has learned. A win is the stock reaching the target before the stop. 1R is the distance from entry to the stop${a.O ? '; setups still open at the close are counted at the closing price' : ''}.</p>`);
    // what she has learned, checked against a day it was not learned from
    if (Object.keys(T.adj).length || T.minAdd) {
      const kept = recs.filter(r => tunedScore(r, T) >= rv.minScore + T.minAdd), cut = recs.filter(r => !kept.includes(r)), k = summarize(kept), c = summarize(cut);
      const fresh = T.at && t && T.at < etToMs(...t.ymd.split('-').map(Number), 9, 30);
      out.push(`<div class="rbox"><h4>What she has learned, on today’s setups${fresh ? '' : ' (today was part of what she learned from)'}</h4><p>She alerted on <b>${k.n}</b>: ${wl(k)}, <b class="${cls(k.R)}">${fmtR(k.R)}</b>.${c.n ? ` She skipped <b>${c.n}</b>: ${wl(c)}, <b class="${cls(c.R)}">${fmtR(c.R)}</b>.` : ' She skipped none.'}${c.n && c.R > 0.5 ? ' The ones she skipped did well, so she may be holding back too much.' : ''}</p></div>`);
    }
    const rows = (list) => list.map(g => `<div class="rrow"><span>${esc(g.label)}</span><i>${wl(g)}</i><b class="${cls(g.R)}">${fmtR(g.R)}</b></div>`).join('');
    out.push(`<h3>Where it missed most</h3>${f.missed.length ? rows(f.missed) : '<p class="note">No group of three or more setups lost on the day.</p>'}`);
    if (f.worked.length) out.push(`<h3>Where it worked</h3>${rows(f.worked)}`);
    const li = [];
    if (f.losses) li.push(`<li><b>Stops.</b> ${f.stt} of ${f.losses} stop-out${f.losses === 1 ? '' : 's'} went on to the target afterwards.${f.stt / f.losses >= 0.4 && f.losses >= 4 ? ' The ideas were right; the stops were too tight.' : ''}</li>`);
    li.push(`<li><b>Targets.</b> ${f.near ? `${f.near} setup${f.near === 1 ? '' : 's'} got at least four fifths of the way to the target and turned back.` : 'None got most of the way to the target and turned back.'}</li>`);
    if (f.winMae != null) li.push(`<li><b>Entries.</b> The winners first went ${f.winMae.toFixed(2).replace(/0$/, '')}R against you on average. Waiting for a small pullback (a third of the way back to the stop, within ten minutes) would have got you into ${f.pb.filled} of ${a.n}, for <b class="${cls(f.pb.R)}">${fmtR(f.pb.R)}</b> against <b class="${cls(a.R)}">${fmtR(a.R)}</b> taking every one as its candle closed.</li>`);
    if (f.winMins != null || f.lossMins != null) li.push(`<li><b>Timing.</b> ${f.winMins != null ? `Wins took about ${f.winMins} minute${f.winMins === 1 ? '' : 's'}` : 'No wins to time'}${f.lossMins != null ? `, losses about ${f.lossMins}` : ''}.</li>`);
    li.push(`<li><b>Stop and target together.</b> ${f.best.base ? 'As called was the best of the nine combinations tried.' : `Best of the nine combinations tried: stops ${f.best.stop === 1 ? 'as called' : f.best.stop + ' times as far'}, targets ${f.best.target === 1 ? 'as called' : f.best.target + ' times the distance'}, for <b class="${cls(f.best.R)}">${fmtR(f.best.R)}</b> against <b class="${cls(a.R)}">${fmtR(a.R)}</b>.`}</li>`);
    out.push(`<h3>Entry, stop and target</h3><ul class="rlist">${li.join('')}</ul>`);
  }
  // what she would change
  out.push('<h3>What INDAI would change</h3>');
  const nDays = `${P.n} setup${P.n === 1 ? '' : 's'} over ${P.days} day${P.days === 1 ? '' : 's'}`;
  if (rv.demo) out.push('<p class="note">This is demo data, so nothing is kept and nothing changes. On real data she proposes changes here.</p>');
  else if (!P.ready) out.push(`<p class="note">She needs about ${MIN_IDEAS} setups before changing anything, and ${MIN_GROUP} of one kind before judging that kind. So far: ${nDays}. Run this after the close each day and it builds up.</p>`);
  else if (sameTuning(P, T)) out.push(`<p class="note">Nothing new. ${Object.keys(T.adj).length || T.minAdd || T.stop !== 1 || T.target !== 1 ? 'What she has learned still fits' : 'Nothing stands out enough to change'} (${nDays}).</p>`);
  else {
    const dropped = Object.keys(T.adj).filter(k => !(k in P.adj)).map(k => T.labels?.[k] || k);
    out.push(`<ul class="rlist changes">${P.why.map(w => `<li><b>${esc(w.text)}</b><span>${esc(w.basis)}</span></li>`).join('')}${dropped.map(d => `<li><b>Stop adjusting: ${esc(d)}</b><span>it no longer stands out</span></li>`).join('')}${!P.why.length ? '<li><b>Go back to the scanner as it comes</b><span>nothing she had learned still stands out</span></li>' : ''}</ul>`);
    out.push(backtestHtml(rv, P, 'Back-test of these changes'));
    out.push(`<div class="pin-actions"><button type="button" class="btn primary" data-retro="apply">Apply these changes</button><button type="button" class="btn" data-retro="keep">Keep things as they are</button></div>`);
  }
  // with nothing new proposed, the back-test is of what is in force
  if (!rv.demo && (!P.ready || sameTuning(P, T)) && (Object.keys(T.adj).length || T.minAdd || T.stop !== 1 || T.target !== 1) && rv.days.length) out.push(backtestHtml(rv, T, 'Back-test of what is in force'));
  if (!rv.demo) out.push(tradingViewHtml(rv, P.ready && !sameTuning(P, T) ? P : T));
  // in force now
  const act = Object.entries(T.adj).sort((x, y) => x[1] - y[1]).map(([k, v]) => `<li><b>${esc(T.labels?.[k] || k)}</b><span>${v > 0 ? '+' : '−'}${Math.abs(v)} points</span></li>`);
  if (T.minAdd) act.push(`<li><b>Alerts start at ${rv.minScore + T.minAdd}</b><span>plan level ${rv.minScore}</span></li>`);
  if (T.stop !== 1) act.push(`<li><b>Stops ${T.stop} times as far from entry</b><span></span></li>`);
  if (T.target !== 1) act.push(`<li><b>Targets at ${T.target} times the distance</b><span></span></li>`);
  out.push(`<h3>In force now</h3>${act.length ? `<ul class="rlist changes">${act.join('')}</ul><p class="note">Applied ${T.at ? esc(dayLabel(etParts(T.at).ymd)) : ''}${T.basis ? `, from ${T.basis.ideas} setups over ${T.basis.days} day${T.basis.days === 1 ? '' : 's'}` : ''}. Push notifications from the backend do not use these yet.</p><div class="pin-actions"><button type="button" class="btn" data-retro="reset">${armed === 'reset' ? 'Tap again to clear it all' : 'Clear what she has learned'}</button></div>` : '<p class="note">Nothing yet. She alerts exactly as the scanner scores.</p>'}`);
  // day by day
  const hist = rv.days.slice(-10).reverse();
  if (hist.length) out.push(`<h3>Day by day</h3>${hist.map(d => { const s = summarize(d.recs); return `<div class="rrow"><span>${esc(dayLabel(d.ymd))}${t && d.ymd === t.ymd && !t.final ? ' (so far)' : ''}</span><i>${s.n} setups · ${s.winRate ?? '—'}%</i><b class="${cls(s.R)}">${fmtR(s.R)}</b></div>`; }).join('')}`);
  if (recs.length && !rv.demo) out.push('<div class="pin-actions" style="margin-top:14px"><button type="button" class="btn" data-retro="talk">Talk it through with INDAI</button></div>');
  out.push('<p class="fine">Results are the stock against the idea’s stop and target, replayed from the day’s one-minute candles. They are not option fills and not your own trades. A handful of days is a small sample: what worked last week can stop working, which is why every change is shown with what it rests on and can be cleared. This is information, not financial advice.</p>');
  return out.join('');
}
// A short version for her to talk through (the backend takes a question of up to 600 characters).
export function retroQuestion(rv) {
  const f = dayFacts(rv.today.recs), a = f.all;
  const g = (x) => `${x.label.replace(/\s*\(.*?\)/, '')} ${x.W}-${x.L} ${fmtR(x.R)}`;
  return `Retrospective for today. ${a.n} setups: ${a.W} won, ${a.L} lost, ${a.O} open, result ${fmtR(a.R)}. Missed most: ${f.missed.slice(0, 3).map(g).join('; ') || 'nothing stood out'}. Worked: ${f.worked.slice(0, 2).map(g).join('; ') || 'nothing stood out'}. ${f.stt} of ${f.losses} stop-outs went on to the target. What should I take from this for tomorrow? Keep it to a few sentences.`.slice(0, 590);
}

const money = (v) => `${v < 0 ? '−' : v > 0 ? '+' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
const pfText = (m) => (m.pf == null ? '—' : m.pf === Infinity ? 'no losses' : m.pf.toFixed(2));
// All the numbers, side by side: every setup as the scanner scores it, and the ones she would alert on with the changes.
function backtestHtml(rv, T, title) {
  const bt = backtest(rv.days, rv.minScore, T), a = bt.base, b = bt.tuned, nDays = rv.days.length;
  const row = (label, x, y, c = '') => `<tr><th>${label}</th><td>${x}</td><td class="${c}">${y}</td></tr>`;
  const rows = [
    row('Setups alerted', a.n, b.n),
    row('Won – lost – open', `${a.W} – ${a.L} – ${a.O}`, `${b.W} – ${b.L} – ${b.O}`),
    row('Win rate', a.winRate == null ? '—' : a.winRate + '%', b.winRate == null ? '—' : b.winRate + '%', b.winRate != null && a.winRate != null ? cls(b.winRate - a.winRate) : ''),
    row('Result', `<b class="${cls(a.R)}">${fmtR(a.R)}</b>`, `<b class="${cls(b.R)}">${fmtR(b.R)}</b>`),
    row('Average per setup', fmtR(a.avgR), fmtR(b.avgR), cls(b.avgR - a.avgR)),
    row(`At $${rv.riskPerTrade} a trade`, money(a.R * rv.riskPerTrade), money(b.R * rv.riskPerTrade)),
    row('Profit factor', pfText(a), pfText(b)),
    row('Deepest drawdown', fmtR(-a.maxDD), fmtR(-b.maxDD), cls(a.maxDD - b.maxDD)),
    row('Longest losing run', a.losingRun, b.losingRun, cls(a.losingRun - b.losingRun)),
  ];
  const perDay = bt.perDay.slice(-10).reverse().map(d => `<tr><th>${esc(dayLabel(d.ymd))}</th><td>${d.base.n} · ${d.base.winRate ?? '—'}% · ${fmtR(d.base.R)}</td><td class="${cls(d.tuned.R - d.base.R)}">${d.tuned.n} · ${d.tuned.winRate ?? '—'}% · ${fmtR(d.tuned.R)}</td></tr>`).join('');
  const verdict = b.n < 5 ? 'Too few setups are left to judge it.' : b.R > a.R && b.maxDD <= a.maxDD ? 'On these days the changes made more and drew down less.' : b.R > a.R ? 'On these days the changes made more, with a deeper drawdown on the way.' : b.avgR > a.avgR ? 'On these days the changes made less in total but more per setup, by taking fewer.' : 'On these days the changes did not help. Think twice before applying them.';
  const wf = walkForward(rv.days, rv.minScore);
  const fair = wf ? `<p class="note"><b>The fair test.</b> Each day judged with only what she could have learned from the days before it (${wf.days} day${wf.days === 1 ? '' : 's'}): as the scanner scores, ${wf.base.n} setups, ${wf.base.winRate ?? '—'}%, <b class="${cls(wf.base.R)}">${fmtR(wf.base.R)}</b>; with what she had learned by then, ${wf.tuned.n} setups, ${wf.tuned.winRate ?? '—'}%, <b class="${cls(wf.tuned.R)}">${fmtR(wf.tuned.R)}</b>.</p>`
    : `<p class="note"><b>The fair test</b> (each day judged with only what she learned from earlier days) needs at least two kept days with enough setups before the later one. It is not available yet${nDays > 1 ? '' : ': this is the first day'}.</p>`;
  return `<h3>${esc(title)}</h3>
    <table class="rtable"><thead><tr><th></th><td>As the scanner scores</td><td>With the changes</td></tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="note">${verdict} These are the ${a.n} setups from the ${nDays} day${nDays === 1 ? '' : 's'} she learned from, so the right-hand column flatters itself: expect less on new days. Skipped by the changes: ${bt.skipped.n} setups, ${bt.skipped.winRate ?? '—'}%, ${fmtR(bt.skipped.R)}.</p>
    ${nDays > 1 ? `<table class="rtable days"><thead><tr><th>Day by day</th><td>Scanner</td><td>With the changes</td></tr></thead><tbody>${perDay}</tbody></table>` : ''}
    ${fair}`;
}
// Months of real candles and candle-by-candle replay are in TradingView: hand it the changes.
function tradingViewHtml(rv, T) {
  const has = Object.keys(T.adj || {}).length || T.minAdd || (T.stop && T.stop !== 1) || (T.target && T.target !== 1);
  return `<h3>Back-test on months of data, and live simulation</h3>
    <p class="note">The app only has the days it has kept. TradingView has months of candles, a Strategy Tester with every number (net profit, win rate, profit factor, drawdown, each trade) and Bar Replay, which plays a day forward one candle at a time. The INDAI Backtest strategy is this scanner, line for line, for a 5-minute chart.</p>
    <ol class="rlist steps"><li>Add the <b>INDAI Backtest</b> strategy to a 5-minute chart (copy the script below into the Pine Editor once and save it).</li><li>${has ? 'Copy the changes and paste them into the strategy’s <b>Changes</b> setting.' : 'Leave the <b>Changes</b> setting empty to test the scanner as it comes.'} Untick <b>Apply the changes</b> to compare.</li><li>Read the <b>Strategy Tester</b> for the numbers. Use <b>Bar Replay</b> to watch it trade a day candle by candle.</li></ol>
    <div class="pin-actions">${has ? `<button type="button" class="btn primary" data-retro="copycode" data-code="${esc(tvCode(T))}">Copy the changes for TradingView</button>` : ''}<button type="button" class="btn" data-retro="copyscript">Copy the script</button><a class="btn" href="./tradingview/" target="_blank" rel="noopener">Open the script page</a></div>
    <p class="note">It takes one trade at a time on the ticker and has no GEX levels unless you type them in, so its numbers will not equal the app’s. Send me a screenshot of the Strategy Tester and I will read it with you.</p>`;
}
