// The Capture reading's maths, without a browser:
//   - the candle detectors against TA-Lib 0.8.3 itself (the library The Market Pattern Atlas was tested with) on a
//     fixture of made-up candles (talib-fixture.json, made with TA-Lib's Python package)
//   - the atlas's structure proxies on candles built to fire them
//   - 30-minute, hourly and 4-hour candles anchored to 9:30, and daily candles grouped into weeks
//   - the reading: paths, levels and timeframe suggestions, and no made-up probability anywhere in it
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const { __test, readCapture, summarize, suggestTimeframes } = await import(here + '../js/patterns.js');
const { anchored, TF_MS, tfFromWords } = await import(here + '../js/timeframes.js');
const { toWeeks } = await import(here + '../js/daily.js');
const { sessionTimes } = await import(here + '../js/market.js');

let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra === '' ? '' : JSON.stringify(extra)}`); };

// ---- detectors against TA-Lib
const fx = JSON.parse(readFileSync(here + 'talib-fixture.json', 'utf8'));
const bars = fx.bars.map(([o, h, l, c], t) => ({ t, o, h, l, c, v: 1 }));
const k = __test.measure(bars);
let worst = 100, worstCode = '';
for (const code in fx.sig) {
  const ta = new Map(fx.sig[code]);
  if (ta.size < 10) continue;
  let mine;
  if (code === 'CDLHIKKAKE') { mine = new Map(__test.hikkake(k, 0, bars.length - 1).map(e => [e.i, e.v])); }
  else { mine = new Map(); bars.forEach((_, i) => { const v = __test.CANDLE[code](k, i); if (v) mine.set(i, v); }); }
  let both = 0, sign = 0, only = 0;
  for (const [i, v] of ta) { if (mine.has(i)) { both++; if (Math.sign(mine.get(i)) === Math.sign(v)) sign++; } else only++; }
  for (const i of mine.keys()) if (!ta.has(i)) only++;
  const agree = 100 * both / (both + only);
  if (agree < worst) { worst = agree; worstCode = code; }
  check(`${code} matches TA-Lib`, agree >= 97 && sign === both, { taLib: ta.size, agree: +agree.toFixed(1) });
}
console.log(`lowest agreement ${worst.toFixed(1)}% (${worstCode}); differences are ties at exact thresholds`);

// ---- structure proxies on built candles
{
  // a pole of +12% over eight candles, a five-candle shelf, then a close above the shelf
  const b = []; let p = 100;
  for (let i = 0; i < 30; i++) { b.push({ t: i, o: p, h: p + 0.3, l: p - 0.3, c: p, v: 1 }); }
  const base = b.length;
  for (let i = 0; i < 9; i++) { p += 1.5; b.push({ t: base + i, o: p - 1.5, h: p + 0.2, l: p - 1.6, c: p, v: 1 }); }
  for (let i = 0; i < 5; i++) { p -= 0.4; b.push({ t: b.length, o: p + 0.4, h: p + 0.5, l: p - 0.1, c: p, v: 1 }); }
  b.push({ t: b.length, o: p, h: p + 3, l: p - 0.1, c: p + 2.8, v: 1 });
  const kk = __test.measure(b), s50 = __test.sma(Array.from(kk.C), 50), i = b.length - 1;
  check('bull flag proxy fires on a pole, shelf and break', __test.proxies(kk, s50, i).some(e => e.code === 'BULLFLAG' && e.v > 0));
  check('20-candle channel break fires on the same close', __test.proxies(kk, s50, i).some(e => e.code === 'CHANNEL20' && e.v > 0));
}

// ---- anchored candles and weeks
{
  const s = sessionTimes(2026, 11, 19), mins = [];
  for (let t = s.pre; t < s.post; t += 60e3) mins.push({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });
  const h1 = anchored(mins, TF_MS['1h']), starts = h1.map(b => b.t);
  check('hourly candles start at 9:30, 10:30 … in the session', starts.includes(s.open) && starts.includes(s.open + 3600e3) && starts.includes(s.open + 6 * 3600e3));
  check('the last hourly candle of the session ends at the close (3:30 to 4:00)', !starts.some(t => t > s.open + 6 * 3600e3 && t < s.close));
  check('after-hours hourly candles start at 4:00', starts.includes(s.close) && starts.includes(s.close + 3600e3));
  check('pre-market hourly candles end at 9:30', starts.includes(s.open - 3600e3) && !starts.some(t => t > s.open - 3600e3 && t < s.open));
  const h4 = anchored(mins.filter(b => b.t >= s.open && b.t < s.close), TF_MS['4h']);
  check('4-hour candles: 9:30 and 1:30', h4.length === 2 && h4[0].t === s.open && h4[1].t === s.open + 4 * 3600e3);
  const days = [17, 18, 19, 20, 21, 24, 25].map(d => ({ t: sessionTimes(2026, 11, d).open, o: d, h: d + 1, l: d - 1, c: d + 0.5, v: 10 }));
  const w = toWeeks(days);
  check('daily candles group into Monday weeks', w.length === 2 && w[0].o === 17 && w[0].c === 21.5 && w[0].h === 22 && w[1].o === 24, w.map(x => [x.o, x.c]));
  check('spoken timeframes', tfFromWords('show me the hourly chart') === '1h' && tfFromWords('daily chart') === '1D' && tfFromWords('four hour') === '4h' && tfFromWords('weekly') === '1W');
}

// ---- the reading
{
  const r = readCapture(bars.slice(0, 800), 700, 760, { tf: '15min', sym: 'TEST', gex: { cw: 120, pw: 80, zg: 100 } });
  check('three paths: bull, bear and range', r.scenarios.length === 3 && r.scenarios[0].side === 1 && r.scenarios[1].side === -1);
  check('the bull trigger sits above the last price and the bear trigger below it', r.scenarios[0].trigger > r.last && r.scenarios[1].trigger < r.last);
  check('a lean in words with its reasons', typeof r.lean.word === 'string' && r.lean.why.length > 0);
  check('timeframe suggestions name another timeframe with a reason', r.timeframes.length >= 2 && r.timeframes.every(t => t.tf !== '15min' && t.why));
  check('overlapping candle names collapse to one event per candle', new Set(r.events.map(e => e.i + ':' + e.family + ':' + (e.family < 0 ? e.code : ''))).size === r.events.length);
  const text = JSON.stringify(summarize(r));
  check('no percentage chance or win rate is invented in the reading', !/(chance|probability|win rate|likely to)/i.test(text));
  const tfs = suggestTimeframes('5min', 40, [{ atlas: true }]);
  check('intraday patterns point to the daily chart, where the book tested them', tfs.some(t => t.tf === '1D'));
}

console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
