// The retrospective's arithmetic, on hand-made candles and results where the right answer is known.
import { evalIdea, evalPullback, summarize, groups, propose, tuneIdea, tunedScore, keysOf, fmtR, GRID, BASE, NO_TUNING, sameTuning, record, dayFacts, metrics, backtest, walkForward, tvCode, plainFlag } from '/home/claude/bongs-git.github.io/indai/js/retro.js';
let failed = 0; const check = (l, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${l} ${ok ? '' : x}`); };
const T0 = Date.UTC(2026, 10, 19, 15, 0);                       // 10:00 New York
const bar = (i, h, l, c = (h + l) / 2) => ({ t: T0 + i * 60e3, o: c, h, l, c, v: 1000 });
const call = { dir: 1, price: 100, stop: 99, target: 102 }, put = { dir: -1, price: 100, stop: 101, target: 98 };
const J = JSON.stringify;

let e = evalIdea(call, [bar(0, 100.5, 99.5, 100.2), bar(1, 102.1, 100.1, 102)]);
check('call reaches target: win of 2R, two minutes, excursions right', e.res === 'W' && e.R === 2 && e.mins === 2 && e.mfe === 2.1 && e.mae === 0.5 && !e.near, J(e));
e = evalIdea(call, [bar(0, 100.2, 98.9), bar(1, 100.4, 99.2), bar(2, 102.5, 100)]);
check('stop first: loss of 1R, and it went on to the target', e.res === 'L' && e.R === -1 && e.mins === 1 && e.stopThenTarget === true, J(e));
e = evalIdea(call, [bar(0, 102.5, 98.5)]);
check('stop and target inside one candle counts as the stop', e.res === 'L' && e.R === -1, J(e));
e = evalIdea(call, [bar(0, 100.9, 99.6, 100.3), bar(1, 100.8, 99.7, 100.6)]);
check('neither by the close: counted at the closing price', e.res === 'O' && e.R === 0.6 && e.mins === null, J(e));
e = evalIdea(call, [bar(0, 101.7, 99.8), bar(1, 100.5, 98.9)]);
check('got most of the way and turned back is flagged', e.res === 'L' && e.near === true && e.stopThenTarget === false, J(e));
e = evalIdea(put, [bar(0, 100.6, 99.2), bar(1, 100.1, 97.9)]);
check('put reaches target: win of 2R', e.res === 'W' && e.R === 2 && e.mae === 0.6, J(e));
e = evalIdea(put, [bar(0, 101.05, 99.5)]);
check('put stopped', e.res === 'L' && e.R === -1, J(e));
const wide = GRID.find(v => v.stop === 1.5 && v.target === 1), tight = GRID.find(v => v.stop === 1 && v.target === 0.75);
const dip = [bar(0, 100.3, 98.8), bar(1, 102.2, 99.4)];
check('a wider stop survives the dip that stops the idea as called', evalIdea(call, dip).res === 'L' && evalIdea(call, dip, wide).res === 'W' && evalIdea(call, dip, wide).R === 2, J([evalIdea(call, dip), evalIdea(call, dip, wide)]));
check('a wider stop loses more when it is hit', evalIdea(call, [bar(0, 100.1, 98.4)], wide).R === -1.5);
check('a closer target is reached sooner and pays less', evalIdea(call, [bar(0, 101.6, 99.8), bar(1, 100.2, 98.9)], tight).R === 1.5 && evalIdea(call, [bar(0, 101.6, 99.8), bar(1, 100.2, 98.9)]).res === 'L');
check('no risk or no candles gives nothing', evalIdea({ dir: 1, price: 100, stop: 100, target: 102 }, dip) === null && evalIdea(call, []) === null);

let p = evalPullback(call, [bar(0, 100.4, 99.9), bar(1, 100.2, 99.6), bar(2, 102.3, 99.9)]);
check('pullback entry: filled a third of the way back, then the target', p.filled && p.res === 'W' && p.R === 2.33, J(p));
p = evalPullback(call, [bar(0, 100.4, 99.9), bar(1, 100.2, 98.9)]);
check('pullback entry: filled and stopped loses two thirds of R', p.filled && p.res === 'L' && p.R === -0.67, J(p));
p = evalPullback(call, [bar(0, 101, 99.9), bar(1, 102.2, 100.8)]);
check('pullback entry: price left without coming back means no trade', p.filled === false, J(p));
p = evalPullback(call, [...Array(12)].map((_, i) => bar(i, 100.5, 99.9)).concat([bar(12, 100.2, 99.5)]));
check('pullback entry: only waits ten minutes', p.filled === false, J(p));

// records, groups and summaries
const mk = (i, o = {}) => ({ id: 'x' + i, sym: 'SPY', strat: 'ema', dir: 1, title: 'pullback held the fast cloud', raw: 72, t: T0 + i * 60e3, min: 600, flags: [], rr: 2, res: 'W', R: 2, mfe: 2, mae: 0.3, mins: 10, stopThenTarget: false, near: false, grid: GRID.map(() => 2), pb: null, ...o });
const lose = (i, o = {}) => mk(i, { res: 'L', R: -1, mins: 5, grid: GRID.map(v => -v.stop), ...o });
let s = summarize([mk(1), mk(2), lose(3), mk(4, { res: 'O', R: 0.4 })]);
check('summary: counts, win rate over decided ideas, total and average R', s.n === 4 && s.W === 2 && s.L === 1 && s.O === 1 && s.winRate === 67 && s.R === 3.4 && s.avgR === 0.85, J(s));
const ks = keysOf(mk(1, { min: 720, flags: ['below VWAP', 'lunch chop window'], title: 'crossed the gamma flip 755', strat: 'gex', dir: -1, sym: 'TSLA', raw: 81 })).map(k => k.key);
check('groups: lunch window, setup kind without its number, direction, ticker, warning, score band', J(ks) === J(['time:lunch', 'kind:gex|crossed the gamma flip', 'dir:-1', 'sym:TSLA', 'flag:below VWAP', 'band:80']), J(ks));
check('time windows', ['open', 'mid', 'lunch', 'pm', 'close'].every((w, i) => keysOf(mk(1, { min: [575, 640, 720, 850, 930][i] }))[0].key === 'time:' + w));

// learning
check('under 20 ideas: not ready, proposes nothing', (() => { const P = propose([{ ymd: 'a', recs: [...Array(19)].map((_, i) => lose(i, { min: 720 })) }], 64); return !P.ready && !Object.keys(P.adj).length && P.minAdd === 0 && P.stop === 1; })());
// three days, 20 ideas each: lunch-window ideas all lose; the rest win 2 of 3
const day = (d) => ({ ymd: '2026-11-1' + d, recs: [...Array(20)].map((_, i) => i < 6 ? lose(d * 100 + i, { min: 720, sym: 'QQQ' }) : (i % 3 === 0 ? lose(d * 100 + i) : mk(d * 100 + i))) });
let P = propose([day(1), day(2), day(3)], 64);
check('lunch-window losers are marked down, with what it rests on', P.ready && P.adj['time:lunch'] <= -4 && P.adj['time:lunch'] >= -10 && /Lunch window.*points/.test(P.why.find(w => w.key === 'time:lunch').text) && /0 won, 18 lost/.test(P.why.find(w => w.key === 'time:lunch').basis), J(P.adj));
check('the ticker those ideas were on is marked down too, the good groups are not marked down', P.adj['sym:QQQ'] < 0 && !(P.adj['time:open'] < 0) && !(P.adj['sym:SPY'] < 0), J(P.adj));
check('a group under 8 ideas is left alone', (() => { const d = [{ ymd: 'a', recs: [...Array(25)].map((_, i) => i < 7 ? lose(i, { min: 720 }) : mk(i)) }]; const Q = propose(d, 64); return Q.ready && !('time:lunch' in Q.adj); })());
check('adjustments are capped at minus ten', (() => { const d = [{ ymd: 'a', recs: [...Array(200)].map((_, i) => i < 100 ? lose(i, { min: 720, R: -1 }) : mk(i, { R: 5 })) }]; return propose(d, 64).adj['time:lunch'] === -10; })());
check('everything alike: nothing proposed', (() => { const Q = propose([{ ymd: 'a', recs: [...Array(40)].map((_, i) => i % 2 ? mk(i) : lose(i)) }], 64); return Q.ready && !Object.keys(Q.adj).length && Q.minAdd === 0 && Q.stop === 1 && Q.target === 1 && !Q.why.length; })(), J(propose([{ ymd: 'a', recs: [...Array(40)].map((_, i) => i % 2 ? mk(i) : lose(i)) }], 64)));
// score line: ideas under 70 lose, 70 and up win
const band = (d) => ({ ymd: 'b' + d, recs: [...Array(20)].map((_, i) => i < 8 ? lose(d * 100 + i, { raw: 65 + (i % 4) }) : mk(d * 100 + i, { raw: 72 + (i % 10) })) });
P = propose([band(1), band(2)], 64);
check('weak ideas just above the line raise the line, one step at a time', P.minAdd === 3 && P.why.some(w => w.kind === 'min' && /Only alert at 67 and up \(was 64\)/.test(w.text)), J({ minAdd: P.minAdd, adj: P.adj, why: P.why }));
check('the next retrospective can take it one step further, no more', propose([band(1), band(2)], 64, { ...NO_TUNING, minAdd: 3 }).minAdd === 6 && propose([band(1), band(2)], 64, { ...NO_TUNING, minAdd: 6 }).minAdd <= 9);
check('the line stays put when what it would cut has not been losing', (() => { const d = [{ ymd: 'a', recs: [...Array(40)].map((_, i) => i % 2 ? mk(i, { raw: 65 + (i % 20) }) : lose(i, { raw: 65 + (i % 20) })) }]; return propose(d, 64).minAdd === 0; })());
check('a group that made money is never marked down, even when it made less than the rest', (() => { const d = [{ ymd: 'a', recs: [...Array(60)].map((_, i) => i < 30 ? mk(i, { min: 600, R: 5 }) : (i % 2 ? mk(i, { min: 850, R: 1 }) : lose(i, { min: 850, R: -0.5 }))) }]; const Q = propose(d, 64); return !('time:pm' in Q.adj) && Q.adj['time:open'] === 3; })());
check('marking up is capped at three points', (() => { const d = [{ ymd: 'a', recs: [...Array(60)].map((_, i) => i < 30 ? mk(i, { min: 600, R: 5 }) : lose(i, { min: 850 })) }]; const Q = propose(d, 64); return Q.adj['time:open'] === 3 && Q.adj['time:pm'] <= -4; })());
// stops: half the stop-outs would have survived a stop 1.5 times as far and reached the target
const gi = GRID.findIndex(v => v.stop === 1.5 && v.target === 1);
const win = (v) => (v.target > 1 ? 1 : 2 * v.target);          // winners reach the called target, not one half as far again
const stopDay = (d) => ({ ymd: 'c' + d, recs: [...Array(15)].map((_, i) => i < 8 ? lose(d * 100 + i, { grid: GRID.map(v => v.stop >= 1.5 ? win(v) : -1) }) : mk(d * 100 + i, { grid: GRID.map(win) })) });
P = propose([stopDay(1), stopDay(2), stopDay(3)], 64);
check('stops too tight on every day: a wider stop is proposed', P.stop === 1.5 && P.why.some(w => w.kind === 'levels' && /stops 1\.5 times/i.test(w.text) && /better on 3 of 3 days/.test(w.basis)), J({ stop: P.stop, target: P.target, why: P.why.filter(w => w.kind === 'levels') }));
P = propose([stopDay(1), { ymd: 'c2', recs: stopDay(2).recs.map(r => ({ ...r, grid: GRID.map(v => r.res === 'L' ? -v.stop : win(v)) })) }, { ymd: 'c3', recs: stopDay(3).recs.map(r => ({ ...r, grid: GRID.map(v => r.res === 'L' ? -v.stop : win(v)) })) }], 64);
check('better on one day of three only: stops stay as they are', P.stop === 1, J({ stop: P.stop, target: P.target }));
check('fewer than 30 ideas: stops stay as they are', propose([stopDay(1)], 64).stop === 1 && propose([{ ymd: 'z', recs: stopDay(1).recs.concat(stopDay(2).recs.slice(0, 6)) }], 64).stop === 1);

// applying it to a fresh setup
const tuning = { adj: { 'time:lunch': -6, 'flag:below VWAP': -4, 'dir:1': 3, 'sym:TSLA': -9, 'kind:ema|pullback held the fast cloud': -9 }, labels: {}, minAdd: 3, stop: 1.5, target: 0.75 };
const fresh = () => ({ sym: 'SPY', strat: 'vwap', dir: 1, type: 'C', title: 'VWAP reclaim', why: [], against: ['below VWAP', 'RSI stretched (78)'], score: 74, price: 100, stop: 99, target: 102, rr: 2, barT: 0 });
let c = tuneIdea(fresh(), tuning, Date.UTC(2026, 10, 19, 17, 30));         // 12:30 New York
check('tuning: score moved by the groups it is in, the scanner’s own numbers kept', c.score === 74 - 6 - 4 + 3 && c.raw.score === 74 && c.raw.stop === 99 && c.learned.length === 3, J([c.score, c.raw, c.learned]));
check('tuning: stop and target moved, reward to risk recomputed', c.stop === 98.5 && c.target === 101.5 && c.rr === 1, J([c.stop, c.target, c.rr]));
check('tuning: never applied twice', tuneIdea(c, tuning).score === c.score && c.stop === 98.5);
c = tuneIdea({ ...fresh(), sym: 'TSLA', strat: 'ema', title: 'pullback held the fast cloud', dir: -1 }, tuning, Date.UTC(2026, 10, 19, 17, 30));
check('tuning: total markdown is capped at fifteen', c.score === 74 - 15, String(c.score));
check('tuning: nothing learned leaves the setup alone', (() => { const x = tuneIdea(fresh(), NO_TUNING, T0); return x.score === 74 && x.stop === 99 && !x.learned; })());
check('tuned score of a kept record matches (and is capped)', tunedScore(mk(1, { min: 720, flags: ['below VWAP'] }), tuning) === 72 - 15 && tunedScore(mk(1, { min: 720, strat: 'vwap', title: 'VWAP reclaim' }), tuning) === 72 - 6 + 3);
check('same tuning is recognised; a one-point wobble is not a change, two points or a new group is', sameTuning(tuning, { ...tuning, adj: { ...tuning.adj } }) && !sameTuning(tuning, { ...tuning, minAdd: 0 }) && sameTuning(tuning, { ...tuning, adj: { ...tuning.adj, 'dir:1': 2 } }) && !sameTuning(tuning, { ...tuning, adj: { ...tuning.adj, 'dir:1': 1 } }) && !sameTuning(tuning, { ...tuning, adj: { ...tuning.adj, 'sym:AMZN': -4 } }) && !sameTuning(tuning, { ...tuning, stop: 1 }));
// a record from candles, and the day's facts
const rec = record({ sym: 'SPY', strat: 'ema', dir: 1, title: 'pullback held the fast cloud', against: ['RSI stretched (78)'], score: 72, price: 100, stop: 99, target: 102, rr: 2, barT: T0 - 300e3, at: T0 }, dip);
check('record: result, all nine stop and target combinations, pullback, plain warning', rec.res === 'L' && rec.grid.length === 9 && rec.grid[BASE] === -1 && rec.grid[gi] === 2 && rec.flags[0] === 'RSI stretched' && rec.raw === 72 && rec.min === 600 && rec.id === `SPY|ema|1|${T0 - 300e3}`, J(rec));
const f = dayFacts([mk(1, { mae: 0.4 }), mk(2, { mae: 0.2 }), lose(3, { stopThenTarget: true }), lose(4), lose(5, { near: true, min: 720 }), lose(6, { min: 720 }), lose(7, { min: 720 })]);
check('day facts: stop-outs that went on to target, near misses, winners’ heat, worst group first', f.losses === 5 && f.stt === 1 && f.near === 1 && f.winMae === 0.3 && f.missed[0].R <= f.missed[f.missed.length - 1].R && f.missed.some(g => g.key === 'time:lunch' && g.L === 3) && f.winMins === 10 && f.lossMins === 5, J({ stt: f.stt, near: f.near, winMae: f.winMae, missed: f.missed.map(g => [g.key, g.R]) }));
check('R is written plainly', fmtR(2) === '+2R' && fmtR(-1.5) === '−1.5R' && fmtR(0) === '0R' && fmtR(0.33) === '+0.33R' && fmtR(12.34) === '+12.3R' && fmtR(-10) === '−10R', [fmtR(2), fmtR(-1.5), fmtR(0), fmtR(0.33), fmtR(12.34), fmtR(-10)].join(' '));
// warnings keep their words; only the changing number goes
const texts = ['against the 34/50 trend', 'below VWAP', 'above VWAP', 'MACD disagrees', 'RSI stretched (78)', 'RSI stretched (21)', 'light volume', 'SPY and QQQ moving the other way', 'only 0.7:1 reward to risk', 'only 0.3:1 reward to risk', 'a GEX wall sits right in front', 'lunch chop window', 'last 20 minutes'];
check('warnings are grouped by their words, exactly as the TradingView script spells them', J(texts.map(plainFlag)) === J(['against the 34/50 trend', 'below VWAP', 'above VWAP', 'MACD disagrees', 'RSI stretched', 'RSI stretched', 'light volume', 'SPY and QQQ moving the other way', 'low reward to risk', 'low reward to risk', 'a GEX wall sits right in front', 'lunch chop window', 'last 20 minutes']), J(texts.map(plainFlag)));
check('time-of-day warnings are not counted twice (the time window already covers them)', (() => { const c = tuneIdea({ sym: 'SPY', strat: 'vwap', dir: 1, title: 'VWAP reclaim', against: texts, score: 70, price: 100, stop: 99, target: 102, rr: 2 }, { adj: { 'flag:last 20 minutes': -9, 'flag:lunch chop window': -9, 'flag:against the 34/50 trend': -4 }, labels: {}, minAdd: 0, stop: 1, target: 1 }, T0); return c.score === 66; })());
// every flag key the script looks up exists in the app's spelling
import { readFileSync } from 'node:fs';
const pine = readFileSync('/home/claude/bongs-git.github.io/indai/tradingview/indai-backtest.pine', 'utf8');
const pineFlags = [...pine.matchAll(/"flag:([^"]+)"/g)].map(x => x[1]).sort(), appFlags = [...new Set(texts.map(plainFlag))].filter(f => !/lunch chop|last 20/.test(f)).sort();
check('the TradingView script looks up the same warning names the app writes', J(pineFlags) === J(appFlags), J({ pineFlags, appFlags }));
const pineKinds = [...pine.matchAll(/rate\(\d, [^,]+, [\d.]+, "([^"]+)"\)/g)].map(x => x[1]);
check('the TradingView script has all 14 setups with the app\'s names', new Set(pineKinds).size === 14 && pineKinds.length === 15 && ['fast EMA cloud flipped bullish', 'fast EMA cloud flipped bearish', 'pullback held the fast cloud', 'VWAP reclaim', 'lost VWAP', 'VWAP rejection', 'VWAP bounce', 'bounce off the put wall', 'rejected at the call wall', 'broke the call wall', 'broke the put wall', 'crossed the gamma flip', 'broke the opening range high', 'broke the opening range low'].every(k => pineKinds.includes(k)), J(pineKinds));
check('the TradingView script never reads an array behind an "and" (version 5 evaluates both sides)', !/\band\b[^\n]*array\.get\(/.test(pine.split('\n').filter(l => !/^\s*(if|bool) .*array\.size\(cScore\) > 0$/.test(l)).join('\n')) || pine.split('\n').every(l => !/array\.size\([^)]*\) > 0 and .*array\.get/.test(l)));
// all the numbers
const seq = [2, -1, -1, 2, -1, -1, -1, 2, 2].map((R, i) => mk(i, { R, res: R > 0 ? 'W' : 'L' }));
let m = metrics(seq);
check('metrics: profit factor, deepest drawdown in order of time, longest losing run', m.n === 9 && m.W === 4 && m.L === 5 && m.R === 3 && m.grossWin === 8 && m.grossLoss === 5 && m.pf === 1.6 && m.maxDD === 3 && m.losingRun === 3 && m.winRate === 44, J(m));
m = metrics([mk(1), mk(2)]);
check('metrics: no losses and nothing at all are both handled', m.pf === Infinity && m.maxDD === 0 && metrics([]).pf === null && metrics([]).n === 0);
check('metrics: drawdown is measured from the highest point reached, in time order whatever order they are given in', metrics([mk(3, { R: -1, res: 'L' }), mk(1, { R: 3 }), mk(2, { R: -2, res: 'L' })]).maxDD === 3);
// back-test of a set of changes on kept days
const lunchDays = [day(1), day(2), day(3)];
const PL = propose(lunchDays, 64), bt = backtest(lunchDays, 64, PL);
check('back-test: the scanner column is every setup; the changes column drops what she would skip', bt.base.n === 60 && bt.base.W === 27 && bt.base.L === 33 && bt.tuned.n < bt.base.n && bt.tuned.winRate > bt.base.winRate && bt.tuned.R > bt.base.R && bt.skipped.n === bt.base.n - bt.tuned.n && bt.skipped.R < 0 && bt.perDay.length === 3 && bt.perDay.every(d => d.tuned.n <= d.base.n), J({ base: bt.base, tuned: bt.tuned, skipped: bt.skipped }));
check('back-test: no changes means both columns are the same', (() => { const b = backtest(lunchDays, 64, NO_TUNING); return b.tuned.n === b.base.n && b.tuned.R === b.base.R && b.skipped.n === 0; })());
const wideT = { ...NO_TUNING, stop: 1.5 }, bs = backtest([stopDay(1), stopDay(2)], 64, wideT);
check('back-test: a wider stop is counted with its own results', bs.base.R === 2 * (7 * 2 - 8) && bs.tuned.R === 2 * 15 * 2 && bs.tuned.n === 30, J([bs.base.R, bs.tuned.R]));
// the fair test: day 3 judged with what days 1 and 2 taught
const wf = walkForward(lunchDays, 64);
check('fair test: later days are judged only with what earlier days taught', wf && wf.days === 2 && wf.base.n === 40 && wf.tuned.n < 40 && wf.tuned.R > wf.base.R, J(wf));
check('fair test: not available from one day, or when earlier days proposed nothing', walkForward([day(1)], 64) === null && walkForward([{ ymd: 'a', recs: [...Array(30)].map((_, i) => i % 2 ? mk(i) : lose(i)) }, { ymd: 'b', recs: [...Array(30)].map((_, i) => i % 2 ? mk(i) : lose(i)) }], 64) === null);
// the line that goes to TradingView
const code = tvCode({ adj: { 'time:lunch': -9, 'kind:ema|pullback held the fast cloud': -4, 'dir:-1': -3, 'sym:TSLA': -8, 'flag:RSI stretched': -6, 'band:lo': -2, 'bad;key': 1 }, minAdd: 3, stop: 1.5, target: 1 });
check('TradingView line: plain keys and numbers, nothing it cannot read', code === 'minadd=3;stop=1.5;target=1;dir:-1=-3;flag:RSI stretched=-6;kind:ema|pullback held the fast cloud=-4;sym:TSLA=-8;time:lunch=-9' && /^[\x20-\x7e]+$/.test(code) && tvCode(NO_TUNING) === 'minadd=0;stop=1;target=1', code);
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
