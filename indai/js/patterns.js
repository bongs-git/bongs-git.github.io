// The reading behind Capture: what a stretch of candles shows, worked out on the device in a few milliseconds.
//   - candle patterns, by TA-Lib's rules and its default candle settings (the detector library The Market Pattern
//     Atlas was tested with), and the atlas's six structure proxies (bull and bear flag, cup and handle and its
//     inverse, the failed bear flag after an engulfing candle, the 20-candle channel break), each with the side the
//     atlas scored it on and the trend and volatility bin the atlas filed its results under
//   - shapes the eye looks for (double top or bottom, triangles, wedges, channels, ranges, V turns), from swing points
//   - trend, momentum (RSI, MACD and divergences found the atlas's way), support and resistance, GEX walls
//   - what would have to happen next, both ways: trigger, invalidation, objective, and how far each is in ATRs
//   - which other timeframes are worth a look, and why
// No probability is made up here. The atlas's tested numbers live on INDAI's server and are added to the reading
// when it answers (capture.js); a shape the atlas did not test is labelled as such.
import { TFS, TF_LABEL, TF_WORDS, isLong } from './timeframes.js';

// ------------------------------------------------------------------ candle measures
// TA-Lib's default candle settings: [range type, averaging period, factor].
const SET = {
  BodyLong: ['body', 10, 1], BodyVeryLong: ['body', 10, 3], BodyShort: ['body', 10, 1], BodyDoji: ['hl', 10, 0.1],
  ShadowLong: ['body', 0, 1], ShadowVeryLong: ['body', 0, 2], ShadowShort: ['sh', 10, 1], ShadowVeryShort: ['hl', 10, 0.1],
  Near: ['hl', 5, 0.2], Far: ['hl', 5, 0.6], Equal: ['hl', 5, 0.05],
};
function measure(bars) {
  const n = bars.length, O = new Float64Array(n), H = new Float64Array(n), L = new Float64Array(n), C = new Float64Array(n);
  const sum = { body: new Float64Array(n + 1), hl: new Float64Array(n + 1), sh: new Float64Array(n + 1) };
  bars.forEach((b, i) => {
    O[i] = b.o; H[i] = b.h; L[i] = b.l; C[i] = b.c;
    const body = Math.abs(b.c - b.o), hl = b.h - b.l;
    sum.body[i + 1] = sum.body[i] + body; sum.hl[i + 1] = sum.hl[i] + hl; sum.sh[i + 1] = sum.sh[i] + (hl - body);
  });
  const k = {
    n, O, H, L, C,
    body: (i) => Math.abs(C[i] - O[i]), hl: (i) => H[i] - L[i],
    up: (i) => H[i] - Math.max(O[i], C[i]), lo: (i) => Math.min(O[i], C[i]) - L[i],
    top: (i) => Math.max(O[i], C[i]), bot: (i) => Math.min(O[i], C[i]),
    col: (i) => (C[i] >= O[i] ? 1 : -1),
    // the average of a range type over the `period` candles before i (TA-Lib leaves the candle itself out)
    A(name, i) {
      const [type, period, f] = SET[name];
      if (i < period || i < 0) return NaN;
      const v = period === 0 ? (type === 'body' ? k.body(i) : type === 'hl' ? k.hl(i) : k.hl(i) - k.body(i)) : (sum[type][i] - sum[type][i - period]) / period;
      return f * v / (type === 'sh' ? 2 : 1);
    },
    gapUp: (a, b) => Math.min(O[a], C[a]) > Math.max(O[b], C[b]),   // real body of a above real body of b
    gapDown: (a, b) => Math.max(O[a], C[a]) < Math.min(O[b], C[b]),
  };
  return k;
}

// ------------------------------------------------------------------ TA-Lib candle detectors (+100 / -100, hikkake ±200)
// Neutral candles return +100; the atlas scored them as a fade of the prior trend (see sideOf).
const doji = (k, i) => k.body(i) <= k.A('BodyDoji', i);
const CANDLE = {
  CDLDOJI: (k, i) => (doji(k, i) ? 100 : 0),
  CDLDRAGONFLYDOJI: (k, i) => (doji(k, i) && k.up(i) < k.A('ShadowVeryShort', i) && k.lo(i) > k.A('ShadowVeryShort', i) ? 100 : 0),
  CDLGRAVESTONEDOJI: (k, i) => (doji(k, i) && k.lo(i) < k.A('ShadowVeryShort', i) && k.up(i) > k.A('ShadowVeryShort', i) ? 100 : 0),
  CDLLONGLEGGEDDOJI: (k, i) => (doji(k, i) && (k.lo(i) > k.A('ShadowLong', i) || k.up(i) > k.A('ShadowLong', i)) ? 100 : 0),
  CDLRICKSHAWMAN: (k, i) => {
    const mid = k.L[i] + k.hl(i) / 2, near = k.A('Near', i);
    return doji(k, i) && k.lo(i) > k.A('ShadowLong', i) && k.up(i) > k.A('ShadowLong', i) && k.bot(i) <= mid + near && k.top(i) >= mid - near ? 100 : 0;
  },
  CDLSPINNINGTOP: (k, i) => (k.body(i) < k.A('BodyShort', i) && k.up(i) > k.body(i) && k.lo(i) > k.body(i) ? 100 * k.col(i) : 0),
  CDLHIGHWAVE: (k, i) => (k.body(i) < k.A('BodyShort', i) && k.up(i) > k.A('ShadowVeryLong', i) && k.lo(i) > k.A('ShadowVeryLong', i) ? 100 * k.col(i) : 0),
  CDLSHORTLINE: (k, i) => (k.body(i) < k.A('BodyShort', i) && k.up(i) < k.A('ShadowShort', i) && k.lo(i) < k.A('ShadowShort', i) ? 100 * k.col(i) : 0),
  CDLLONGLINE: (k, i) => (k.body(i) > k.A('BodyLong', i) && k.up(i) < k.A('ShadowShort', i) && k.lo(i) < k.A('ShadowShort', i) ? 100 * k.col(i) : 0),
  CDLMARUBOZU: (k, i) => (k.body(i) > k.A('BodyLong', i) && k.up(i) < k.A('ShadowVeryShort', i) && k.lo(i) < k.A('ShadowVeryShort', i) ? 100 * k.col(i) : 0),
  CDLCLOSINGMARUBOZU: (k, i) => (k.body(i) > k.A('BodyLong', i) && (k.col(i) > 0 ? k.up(i) : k.lo(i)) < k.A('ShadowVeryShort', i) ? 100 * k.col(i) : 0),
  CDLBELTHOLD: (k, i) => (k.body(i) > k.A('BodyLong', i) && (k.col(i) > 0 ? k.lo(i) : k.up(i)) < k.A('ShadowVeryShort', i) ? 100 * k.col(i) : 0),
  CDLHAMMER: (k, i) => (i > 0 && k.body(i) < k.A('BodyShort', i) && k.lo(i) > k.A('ShadowLong', i) && k.up(i) < k.A('ShadowVeryShort', i) && k.bot(i) <= k.L[i - 1] + k.A('Near', i - 1) ? 100 : 0),
  CDLHANGINGMAN: (k, i) => (i > 0 && k.body(i) < k.A('BodyShort', i) && k.lo(i) > k.A('ShadowLong', i) && k.up(i) < k.A('ShadowVeryShort', i) && k.bot(i) >= k.H[i - 1] - k.A('Near', i - 1) ? -100 : 0),
  CDLINVERTEDHAMMER: (k, i) => (i > 0 && k.body(i) < k.A('BodyShort', i) && k.up(i) > k.A('ShadowLong', i) && k.lo(i) < k.A('ShadowVeryShort', i) && k.gapDown(i, i - 1) ? 100 : 0),
  CDLSHOOTINGSTAR: (k, i) => (i > 0 && k.body(i) < k.A('BodyShort', i) && k.up(i) > k.A('ShadowLong', i) && k.lo(i) < k.A('ShadowVeryShort', i) && k.gapUp(i, i - 1) ? -100 : 0),
  CDLTAKURI: (k, i) => (doji(k, i) && k.up(i) < k.A('ShadowVeryShort', i) && k.lo(i) > k.A('ShadowVeryLong', i) ? 100 : 0),
  CDLENGULFING: (k, i) => {
    if (i < 1) return 0;
    const { O, C } = k, a = i - 1;
    if (k.col(i) > 0 && k.col(a) < 0 && ((C[i] >= O[a] && O[i] < C[a]) || (C[i] > O[a] && O[i] <= C[a]))) return 100;
    if (k.col(i) < 0 && k.col(a) > 0 && ((O[i] >= C[a] && C[i] < O[a]) || (O[i] > C[a] && C[i] <= O[a]))) return -100;
    return 0;
  },
  CDLHARAMI: (k, i) => (i > 0 && k.body(i - 1) > k.A('BodyLong', i - 1) && k.body(i) <= k.A('BodyShort', i) && k.top(i) <= k.top(i - 1) && k.bot(i) >= k.bot(i - 1) ? -100 * k.col(i - 1) : 0),
  CDLHARAMICROSS: (k, i) => (i > 0 && k.body(i - 1) > k.A('BodyLong', i - 1) && doji(k, i) && k.top(i) <= k.top(i - 1) && k.bot(i) >= k.bot(i - 1) ? -100 * k.col(i - 1) : 0),
  CDLPIERCING: (k, i) => {
    const a = i - 1;
    return i > 0 && k.col(a) < 0 && k.body(a) > k.A('BodyLong', a) && k.col(i) > 0 && k.body(i) > k.A('BodyLong', i) && k.O[i] < k.L[a] && k.C[i] < k.O[a] && k.C[i] > k.C[a] + k.body(a) * 0.5 ? 100 : 0;
  },
  CDLDARKCLOUDCOVER: (k, i) => {
    const a = i - 1;
    return i > 0 && k.col(a) > 0 && k.body(a) > k.A('BodyLong', a) && k.col(i) < 0 && k.O[i] > k.H[a] && k.C[i] > k.O[a] && k.C[i] < k.C[a] - k.body(a) * 0.5 ? -100 : 0;
  },
  CDLCOUNTERATTACK: (k, i) => {
    const a = i - 1;
    return i > 0 && k.col(a) === -k.col(i) && k.body(a) > k.A('BodyLong', a) && k.body(i) > k.A('BodyLong', i) && Math.abs(k.C[i] - k.C[a]) <= k.A('Equal', a) ? 100 * k.col(i) : 0;
  },
  CDLMATCHINGLOW: (k, i) => (i > 0 && k.col(i - 1) < 0 && k.col(i) < 0 && Math.abs(k.C[i] - k.C[i - 1]) <= k.A('Equal', i - 1) ? 100 : 0),
  CDLHOMINGPIGEON: (k, i) => (i > 0 && k.col(i - 1) < 0 && k.col(i) < 0 && k.body(i - 1) > k.A('BodyLong', i - 1) && k.body(i) <= k.A('BodyShort', i) && k.O[i] < k.O[i - 1] && k.C[i] > k.C[i - 1] ? 100 : 0),
  CDLINNECK: (k, i) => (i > 0 && k.col(i - 1) < 0 && k.body(i - 1) > k.A('BodyLong', i - 1) && k.col(i) > 0 && k.O[i] < k.L[i - 1] && k.C[i] <= k.C[i - 1] + k.A('Equal', i - 1) && k.C[i] >= k.C[i - 1] ? -100 : 0),
  CDLONNECK: (k, i) => (i > 0 && k.col(i - 1) < 0 && k.body(i - 1) > k.A('BodyLong', i - 1) && k.col(i) > 0 && k.O[i] < k.L[i - 1] && Math.abs(k.C[i] - k.L[i - 1]) <= k.A('Equal', i - 1) ? -100 : 0),
  CDLTHRUSTING: (k, i) => (i > 0 && k.col(i - 1) < 0 && k.body(i - 1) > k.A('BodyLong', i - 1) && k.col(i) > 0 && k.O[i] < k.L[i - 1] && k.C[i] > k.C[i - 1] + k.A('Equal', i - 1) && k.C[i] <= k.C[i - 1] + k.body(i - 1) * 0.5 ? -100 : 0),
  CDLSEPARATINGLINES: (k, i) => (i > 0 && k.col(i - 1) === -k.col(i) && Math.abs(k.O[i] - k.O[i - 1]) <= k.A('Equal', i - 1) && k.body(i) > k.A('BodyLong', i) && (k.col(i) > 0 ? k.lo(i) : k.up(i)) < k.A('ShadowVeryShort', i) ? 100 * k.col(i) : 0),
  CDLDOJISTAR: (k, i) => (i > 0 && k.body(i - 1) > k.A('BodyLong', i - 1) && doji(k, i) && (k.col(i - 1) > 0 ? k.gapUp(i, i - 1) : k.gapDown(i, i - 1)) ? -100 * k.col(i - 1) : 0),
  CDLMORNINGSTAR: (k, i) => (i > 1 && k.col(i - 2) < 0 && k.body(i - 2) > k.A('BodyLong', i - 2) && k.body(i - 1) <= k.A('BodyShort', i - 1) && k.gapDown(i - 1, i - 2) && k.col(i) > 0 && k.body(i) > k.A('BodyShort', i) && k.C[i] > k.C[i - 2] + k.body(i - 2) * 0.3 ? 100 : 0),
  CDLEVENINGSTAR: (k, i) => (i > 1 && k.col(i - 2) > 0 && k.body(i - 2) > k.A('BodyLong', i - 2) && k.body(i - 1) <= k.A('BodyShort', i - 1) && k.gapUp(i - 1, i - 2) && k.col(i) < 0 && k.body(i) > k.A('BodyShort', i) && k.C[i] < k.C[i - 2] - k.body(i - 2) * 0.3 ? -100 : 0),
  CDLMORNINGDOJISTAR: (k, i) => (i > 1 && k.col(i - 2) < 0 && k.body(i - 2) > k.A('BodyLong', i - 2) && doji(k, i - 1) && k.gapDown(i - 1, i - 2) && k.col(i) > 0 && k.body(i) > k.A('BodyShort', i) && k.C[i] > k.C[i - 2] + k.body(i - 2) * 0.3 ? 100 : 0),
  CDLEVENINGDOJISTAR: (k, i) => (i > 1 && k.col(i - 2) > 0 && k.body(i - 2) > k.A('BodyLong', i - 2) && doji(k, i - 1) && k.gapUp(i - 1, i - 2) && k.col(i) < 0 && k.body(i) > k.A('BodyShort', i) && k.C[i] < k.C[i - 2] - k.body(i - 2) * 0.3 ? -100 : 0),
  CDLABANDONEDBABY: (k, i) => {
    if (i < 2 || k.body(i - 2) <= k.A('BodyLong', i - 2) || !doji(k, i - 1) || k.body(i) <= k.A('BodyShort', i)) return 0;
    if (k.col(i - 2) > 0 && k.col(i) < 0 && k.L[i - 1] > k.H[i - 2] && k.H[i] < k.L[i - 1] && k.C[i] < k.C[i - 2] - k.body(i - 2) * 0.3) return -100;
    if (k.col(i - 2) < 0 && k.col(i) > 0 && k.H[i - 1] < k.L[i - 2] && k.L[i] > k.H[i - 1] && k.C[i] > k.C[i - 2] + k.body(i - 2) * 0.3) return 100;
    return 0;
  },
  CDL3WHITESOLDIERS: (k, i) => {
    if (i < 2) return 0;
    const a = i - 2, b = i - 1;
    return k.col(a) > 0 && k.col(b) > 0 && k.col(i) > 0 && k.C[b] > k.C[a] && k.C[i] > k.C[b]
      && k.up(a) < k.A('ShadowVeryShort', a) && k.up(b) < k.A('ShadowVeryShort', b) && k.up(i) < k.A('ShadowVeryShort', i)
      && k.O[b] > k.O[a] && k.O[b] <= k.C[a] + k.A('Near', a) && k.O[i] > k.O[b] && k.O[i] <= k.C[b] + k.A('Near', b)
      && k.body(b) > k.body(a) - k.A('Far', a) && k.body(i) > k.body(b) - k.A('Far', b) && k.body(i) > k.A('BodyShort', i) ? 100 : 0;
  },
  CDL3BLACKCROWS: (k, i) => {
    if (i < 3) return 0;
    const a = i - 2, b = i - 1;
    return k.col(i - 3) > 0 && k.col(a) < 0 && k.col(b) < 0 && k.col(i) < 0
      && k.lo(a) < k.A('ShadowVeryShort', a) && k.lo(b) < k.A('ShadowVeryShort', b) && k.lo(i) < k.A('ShadowVeryShort', i)
      && k.O[b] < k.O[a] && k.O[b] > k.C[a] && k.O[i] < k.O[b] && k.O[i] > k.C[b] && k.H[i - 3] > k.C[a] && k.C[a] > k.C[b] && k.C[b] > k.C[i] ? -100 : 0;
  },
  CDL3INSIDE: (k, i) => {
    if (i < 2) return 0;
    const a = i - 2, b = i - 1;
    if (!(k.body(a) > k.A('BodyLong', a) && k.body(b) <= k.A('BodyShort', b) && k.top(b) < k.top(a) && k.bot(b) > k.bot(a))) return 0;
    if (k.col(a) > 0 && k.col(i) < 0 && k.C[i] < k.O[a]) return -100;
    if (k.col(a) < 0 && k.col(i) > 0 && k.C[i] > k.O[a]) return 100;
    return 0;
  },
  CDL3OUTSIDE: (k, i) => {
    if (i < 2) return 0;
    const a = i - 2, b = i - 1;
    if (k.col(b) > 0 && k.col(a) < 0 && k.C[b] > k.O[a] && k.O[b] < k.C[a] && k.C[i] > k.C[b]) return 100;
    if (k.col(b) < 0 && k.col(a) > 0 && k.O[b] > k.C[a] && k.C[b] < k.O[a] && k.C[i] < k.C[b]) return -100;
    return 0;
  },
  CDL2CROWS: (k, i) => (i > 1 && k.col(i - 2) > 0 && k.body(i - 2) > k.A('BodyLong', i - 2) && k.col(i - 1) < 0 && k.gapUp(i - 1, i - 2) && k.col(i) < 0 && k.O[i] < k.O[i - 1] && k.O[i] > k.C[i - 1] && k.C[i] > k.O[i - 2] && k.C[i] < k.C[i - 2] ? -100 : 0),
  CDLUPSIDEGAP2CROWS: (k, i) => (i > 1 && k.col(i - 2) > 0 && k.body(i - 2) > k.A('BodyLong', i - 2) && k.col(i - 1) < 0 && k.body(i - 1) <= k.A('BodyShort', i - 1) && k.gapUp(i - 1, i - 2) && k.col(i) < 0 && k.O[i] > k.O[i - 1] && k.C[i] < k.C[i - 1] && k.C[i] > k.C[i - 2] ? -100 : 0),
  CDLTASUKIGAP: (k, i) => {
    if (i < 2) return 0;
    const a = i - 2, b = i - 1, near = Math.abs(k.body(b) - k.body(i)) < k.A('Near', b);
    if (k.gapUp(b, a) && k.col(b) > 0 && k.col(i) < 0 && k.O[i] < k.C[b] && k.O[i] > k.O[b] && k.C[i] < k.O[b] && k.C[i] > k.top(a) && near) return 100;
    if (k.gapDown(b, a) && k.col(b) < 0 && k.col(i) > 0 && k.O[i] < k.O[b] && k.O[i] > k.C[b] && k.C[i] > k.O[b] && k.C[i] < k.bot(a) && near) return -100;
    return 0;
  },
  CDLXSIDEGAP3METHODS: (k, i) => {
    if (i < 2) return 0;
    const a = i - 2, b = i - 1;
    if (k.col(a) > 0 && k.col(b) > 0 && k.col(i) < 0 && k.gapUp(b, a) && k.O[i] < k.C[b] && k.O[i] > k.O[b] && k.C[i] < k.C[a] && k.C[i] > k.O[a]) return 100;
    if (k.col(a) < 0 && k.col(b) < 0 && k.col(i) > 0 && k.gapDown(b, a) && k.O[i] < k.O[b] && k.O[i] > k.C[b] && k.C[i] > k.C[a] && k.C[i] < k.O[a]) return -100;
    return 0;
  },
  CDLGAPSIDESIDEWHITE: (k, i) => {
    if (i < 2 || k.col(i - 1) < 0 || k.col(i) < 0) return 0;
    const same = Math.abs(k.body(i) - k.body(i - 1)) <= k.A('Near', i - 1) && Math.abs(k.O[i] - k.O[i - 1]) <= k.A('Equal', i - 1);
    if (!same) return 0;
    if (k.gapUp(i - 1, i - 2) && k.gapUp(i, i - 2)) return 100;
    if (k.gapDown(i - 1, i - 2) && k.gapDown(i, i - 2)) return -100;
    return 0;
  },
  CDLSTICKSANDWICH: (k, i) => (i > 1 && k.col(i - 2) < 0 && k.col(i - 1) > 0 && k.col(i) < 0 && k.L[i - 1] > k.C[i - 2] && Math.abs(k.C[i] - k.C[i - 2]) <= k.A('Equal', i - 2) ? 100 : 0),
  CDLRISEFALL3METHODS: (k, i) => {
    if (i < 4) return 0;
    const a = i - 4, c0 = k.col(a);
    if (!(k.body(a) > k.A('BodyLong', a) && k.body(i) > k.A('BodyLong', i) && k.col(i) === c0)) return 0;
    for (let j = i - 3; j < i; j++) if (!(k.body(j) < k.A('BodyShort', j) && k.col(j) === -c0 && k.bot(j) < k.H[a] && k.top(j) > k.L[a])) return 0;
    if (!(k.C[i - 2] * c0 < k.C[i - 3] * c0 && k.C[i - 1] * c0 < k.C[i - 2] * c0)) return 0;
    return k.O[i] * c0 > k.C[i - 1] * c0 && k.C[i] * c0 > k.C[a] * c0 ? 100 * c0 : 0;
  },
  CDL3LINESTRIKE: (k, i) => {
    if (i < 3) return 0;
    const c0 = k.col(i - 3), within = (j, a) => k.O[j] >= k.bot(a) - k.A('Near', a) && k.O[j] <= k.top(a) + k.A('Near', a);
    if (k.col(i - 2) !== c0 || k.col(i - 1) !== c0 || k.col(i) !== -c0 || !within(i - 2, i - 3) || !within(i - 1, i - 2)) return 0;
    if (!(k.C[i - 2] * c0 > k.C[i - 3] * c0 && k.C[i - 1] * c0 > k.C[i - 2] * c0)) return 0;
    return k.O[i] * c0 > k.C[i - 1] * c0 && k.C[i] * c0 < k.O[i - 3] * c0 ? 100 * c0 : 0;
  },
  CDLKICKING: (k, i) => {
    if (i < 1) return 0;
    const maru = (j) => k.body(j) > k.A('BodyLong', j) && k.up(j) < k.A('ShadowVeryShort', j) && k.lo(j) < k.A('ShadowVeryShort', j);
    if (!(maru(i - 1) && maru(i) && k.col(i) === -k.col(i - 1))) return 0;
    if (k.col(i) > 0 && k.L[i] > k.H[i - 1]) return 100;
    if (k.col(i) < 0 && k.H[i] < k.L[i - 1]) return -100;
    return 0;
  },
  CDLTRISTAR: (k, i) => {
    if (i < 2) return 0;
    const dj = k.A('BodyDoji', i - 2); // TA-Lib measures all three against the first candle's average
    if (!(k.body(i - 2) <= dj && k.body(i - 1) <= dj && k.body(i) <= dj)) return 0;
    if (k.gapUp(i - 1, i - 2) && k.top(i) < k.top(i - 1)) return -100;
    if (k.gapDown(i - 1, i - 2) && k.bot(i) > k.bot(i - 1)) return 100;
    return 0;
  },
};
// Confirmed hikkake only (the atlas counted the confirmed ±200 signal): an inside bar, a false break of it, then a
// close through its opposite edge within three candles.
// TA-Lib's state machine: a newer setup replaces an older one, and a setup confirms at most once.
function hikkake(k, i0, i1) {
  const out = [];
  let at = 0, res = 0;
  for (let i = 2; i < k.n; i++) {
    const inside = k.H[i - 1] < k.H[i - 2] && k.L[i - 1] > k.L[i - 2];
    if (inside && ((k.H[i] < k.H[i - 1] && k.L[i] < k.L[i - 1]) || (k.H[i] > k.H[i - 1] && k.L[i] > k.L[i - 1]))) { res = k.H[i] < k.H[i - 1] ? 100 : -100; at = i; continue; }
    if (at && i <= at + 3 && ((res > 0 && k.C[i] > k.H[at - 1]) || (res < 0 && k.C[i] < k.L[at - 1]))) {
      if (i >= i0 && i <= i1) out.push({ code: 'CDLHIKKAKE', i, v: res * 2, from: at - 1 });
      at = 0;
    }
  }
  return out;
}

// ------------------------------------------------------------------ the atlas's six structure proxies (p. 062)
function sma(C, n) { const out = new Array(C.length).fill(null); let s = 0; for (let i = 0; i < C.length; i++) { s += C[i]; if (i >= n) s -= C[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
const maxOf = (a, from, to) => { let m = -Infinity; for (let j = from; j <= to; j++) m = Math.max(m, a[j]); return m; };
const minOf = (a, from, to) => { let m = Infinity; for (let j = from; j <= to; j++) m = Math.min(m, a[j]); return m; };
function proxies(k, s50, i) {
  const out = [], { H, L, C } = k;
  for (const side of [1, -1]) {
    const p = (j) => side * C[j], hi = (j) => (side > 0 ? H[j] : -L[j]), lo = (j) => (side > 0 ? L[j] : -H[j]);
    if (i >= 14) { // flags: an eight-candle pole and a five-candle shelf against it
      const pole = p(i - 6) - p(i - 14);
      let floor = Infinity, roof = -Infinity;
      for (let j = i - 5; j <= i - 1; j++) { floor = Math.min(floor, lo(j)); roof = Math.max(roof, hi(j)); }
      if (pole > 0.04 * C[i - 14] && p(i - 1) < p(i - 6) && floor >= p(i - 6) - 0.6 * pole && roof - floor < 0.8 * pole && p(i) > roof) out.push({ code: side > 0 ? 'BULLFLAG' : 'BEARFLAG', i, v: 100 * side, from: i - 14 });
    }
    if (i >= 75) { // cup (or dome) and handle
      let left = -Infinity, bottom = Infinity, rim = -Infinity, handle = Infinity, lid = -Infinity;
      for (let j = i - 60; j <= i - 51; j++) left = Math.max(left, hi(j));
      for (let j = i - 50; j <= i - 21; j++) bottom = Math.min(bottom, lo(j));
      for (let j = i - 20; j <= i - 6; j++) rim = Math.max(rim, hi(j));
      for (let j = i - 5; j <= i - 1; j++) { handle = Math.min(handle, lo(j)); lid = Math.max(lid, hi(j)); }
      const depth = left - bottom;
      if (left - p(i - 75) > 0.03 * C[i - 75] && depth > 0.08 * C[i - 51] && depth < 0.4 * C[i - 51] && Math.abs(left - rim) < 0.25 * depth && rim - handle > 0.06 * depth && rim - handle < 0.5 * depth && p(i) > Math.max(rim, lid)) out.push({ code: side > 0 ? 'CUPHANDLE' : 'INVERSECUP', i, v: 100 * side, from: i - 60 });
    }
  }
  if (i >= 20) { // the 20-candle channel break
    const top = maxOf(H, i - 20, i - 1), bot = minOf(L, i - 20, i - 1);
    if (C[i] > top) out.push({ code: 'CHANNEL20', i, v: 100, from: i - 20 }); else if (C[i] < bot) out.push({ code: 'CHANNEL20', i, v: -100, from: i - 20 });
  }
  if (i >= 16 && s50[i - 3] != null && CANDLE.CDLENGULFING(k, i - 2) < 0) { // the failed bear flag after a bearish engulfing candle
    const roof = maxOf(H, i - 7, i - 3), floor = minOf(L, i - 7, i - 3);
    if (C[i - 3] > s50[i - 3] && C[i - 8] > C[i - 16] && C[i - 3] < C[i - 8] && L[i - 2] < floor && C[i - 1] > floor && C[i] > Math.max(roof, H[i - 2])) out.push({ code: 'TRAPFLAG', i, v: 100, from: i - 7 });
  }
  return out;
}

// ------------------------------------------------------------------ names, and what confirms or breaks each one
export const NAMES = {
  CDLDOJI: 'Doji', CDLDRAGONFLYDOJI: 'Dragonfly doji', CDLGRAVESTONEDOJI: 'Gravestone doji', CDLLONGLEGGEDDOJI: 'Long-legged doji', CDLRICKSHAWMAN: 'Rickshaw man',
  CDLSPINNINGTOP: 'Spinning top', CDLHIGHWAVE: 'High-wave candle', CDLSHORTLINE: 'Short line', CDLLONGLINE: 'Long line', CDLMARUBOZU: 'Marubozu',
  CDLCLOSINGMARUBOZU: 'Closing marubozu', CDLBELTHOLD: 'Belt hold', CDLHAMMER: 'Hammer', CDLHANGINGMAN: 'Hanging man', CDLINVERTEDHAMMER: 'Inverted hammer',
  CDLSHOOTINGSTAR: 'Shooting star', CDLTAKURI: 'Takuri', CDLENGULFING: 'Engulfing', CDLHARAMI: 'Harami', CDLHARAMICROSS: 'Harami cross', CDLPIERCING: 'Piercing line',
  CDLDARKCLOUDCOVER: 'Dark cloud cover', CDLCOUNTERATTACK: 'Counterattack lines', CDLMATCHINGLOW: 'Matching low', CDLHOMINGPIGEON: 'Homing pigeon', CDLINNECK: 'In-neck line',
  CDLONNECK: 'On-neck line', CDLTHRUSTING: 'Thrusting line', CDLSEPARATINGLINES: 'Separating lines', CDLDOJISTAR: 'Doji star', CDLMORNINGSTAR: 'Morning star',
  CDLEVENINGSTAR: 'Evening star', CDLMORNINGDOJISTAR: 'Morning doji star', CDLEVENINGDOJISTAR: 'Evening doji star', CDLABANDONEDBABY: 'Abandoned baby',
  CDL3WHITESOLDIERS: 'Three advancing soldiers', CDL3BLACKCROWS: 'Three black crows', CDL3INSIDE: 'Three inside', CDL3OUTSIDE: 'Three outside', CDL2CROWS: 'Two crows',
  CDLUPSIDEGAP2CROWS: 'Upside-gap two crows', CDLTASUKIGAP: 'Tasuki gap', CDLXSIDEGAP3METHODS: 'Gap three methods', CDLGAPSIDESIDEWHITE: 'Gap side-by-side white lines',
  CDLSTICKSANDWICH: 'Stick sandwich', CDLRISEFALL3METHODS: 'Rising / falling three methods', CDL3LINESTRIKE: 'Three-line strike', CDLKICKING: 'Kicker', CDLTRISTAR: 'Tri-star',
  CDLHIKKAKE: 'Hikkake (confirmed)', BULLFLAG: 'Bull flag', BEARFLAG: 'Bear flag', CUPHANDLE: 'Cup & handle', INVERSECUP: 'Inverted cup & handle',
  TRAPFLAG: 'Failed bear flag after engulfing', CHANNEL20: '20-candle channel break',
};
const NEUTRAL = new Set(['CDLDOJI', 'CDLLONGLEGGEDDOJI', 'CDLRICKSHAWMAN', 'CDLHIGHWAVE', 'CDLSPINNINGTOP', 'CDLSHORTLINE']);
// Candles that fire together for the same reason count once (the atlas: three names on one candle are not three confirmations).
const FAMILY = [
  ['CDLDOJI', 'CDLLONGLEGGEDDOJI', 'CDLRICKSHAWMAN', 'CDLDRAGONFLYDOJI', 'CDLGRAVESTONEDOJI', 'CDLTAKURI', 'CDLHIGHWAVE', 'CDLSPINNINGTOP', 'CDLSHORTLINE'],
  ['CDLHAMMER', 'CDLHANGINGMAN'], ['CDLINVERTEDHAMMER', 'CDLSHOOTINGSTAR'],
  ['CDLMARUBOZU', 'CDLCLOSINGMARUBOZU', 'CDLLONGLINE', 'CDLBELTHOLD'],
  ['CDLENGULFING', 'CDL3OUTSIDE'], ['CDLHARAMI', 'CDLHARAMICROSS', 'CDL3INSIDE'],
  ['CDLMORNINGSTAR', 'CDLMORNINGDOJISTAR', 'CDLEVENINGSTAR', 'CDLEVENINGDOJISTAR', 'CDLDOJISTAR', 'CDLABANDONEDBABY'],
];
const familyOf = (code) => FAMILY.findIndex(f => f.includes(code));
// Single-candle shapes TA-Lib finds on a large share of all candles. They are counted, not listed one by one.
export const COMMON = new Set(['CDLSHORTLINE', 'CDLLONGLINE', 'CDLBELTHOLD', 'CDLCLOSINGMARUBOZU', 'CDLSPINNINGTOP', 'CDLHIGHWAVE', 'CDLMARUBOZU', 'CDLLONGLEGGEDDOJI', 'CDLRICKSHAWMAN']);
// The side the atlas scored: the detector's sign, except the six neutral candles, which fade the prior trend.
function sideOf(code, v, k, s50, i) {
  if (NEUTRAL.has(code)) { const ref = s50[i - 1]; if (ref == null) return 0; return k.C[i - 1] >= ref ? -1 : 1; }
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

// ------------------------------------------------------------------ indicators
export function atrSeries(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  let a = null, s = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], tr = i ? Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)) : b.h - b.l;
    if (i < n) { s += tr; if (i === n - 1) { a = s / n; out[i] = a; } continue; }
    a = (a * (n - 1) + tr) / n; out[i] = a;
  }
  return out;
}
function emaArr(v, n) { const k = 2 / (n + 1); const out = []; let e = null; for (let i = 0; i < v.length; i++) { e = e == null ? v[i] : k * v[i] + (1 - k) * e; out.push(i >= n - 1 ? e : null); } return out; }
function rsiArr(C, n = 14) {
  const out = new Array(C.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < C.length; i++) {
    const d = C[i] - C[i - 1];
    if (i <= n) { g += Math.max(d, 0); l += Math.max(-d, 0); if (i === n) { g /= n; l /= n; out[i] = l ? 100 - 100 / (1 + g / l) : 100; } continue; }
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out[i] = l ? 100 - 100 / (1 + g / l) : 100;
  }
  return out;
}
function macdArr(C) {
  const f = emaArr(C, 12), s = emaArr(C, 26), M = C.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
  const start = M.findIndex(x => x != null), S = new Array(C.length).fill(null);
  if (start >= 0) { const e = emaArr(M.slice(start), 9); e.forEach((v, j) => { S[start + j] = v; }); }
  return { M, S, H: M.map((m, i) => (m != null && S[i] != null ? m - S[i] : null)) };
}
// Trend and volatility bins exactly as the atlas filed its results: prior close against its 50-candle average, and
// the prior 14-candle ATR as a share of price against the terciles of the 126 before that.
function bins(k, s50, atr, i) {
  if (i < 2 || s50[i - 1] == null || atr[i - 1] == null) return null;
  const trend = k.C[i - 1] >= s50[i - 1] ? 'above' : 'below', ratio = atr[i - 1] / k.C[i - 1];
  const hist = [];
  for (let j = Math.max(0, i - 2 - 125); j <= i - 2; j++) if (atr[j] != null) hist.push(atr[j] / k.C[j]);
  if (hist.length < 60) return { trend, vol: null };
  hist.sort((a, b) => a - b);
  const q = (p) => { const x = (hist.length - 1) * p, a = Math.floor(x), b = Math.ceil(x); return hist[a] + (hist[b] - hist[a]) * (x - a); };
  return { trend, vol: ratio > q(2 / 3) ? 'high' : ratio > q(1 / 3) ? 'mid' : 'low' };
}

// ------------------------------------------------------------------ swing points, shapes and levels
function pivots(k, i0, i1, w = 2) {
  const hi = [], lo = [];
  for (let i = Math.max(w, i0); i <= Math.min(k.n - 1 - w, i1); i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= w; j++) { if (!(k.H[i] > k.H[i - j] && k.H[i] >= k.H[i + j])) isH = false; if (!(k.L[i] < k.L[i - j] && k.L[i] <= k.L[i + j])) isL = false; }
    if (isH) hi.push({ i, p: k.H[i] }); if (isL) lo.push({ i, p: k.L[i] });
  }
  return { hi, lo };
}
function fit(points) { // least squares p = a + b·i
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const q of points) { sx += q.i; sy += q.p; sxx += q.i * q.i; sxy += q.i * q.p; }
  const d = n * sxx - sx * sx;
  if (!d) return null;
  const b = (n * sxy - sx * sy) / d, a = (sy - b * sx) / n;
  return { a, b, at: (i) => a + b * i };
}
function regress(C, i0, i1) {
  const pts = []; for (let i = i0; i <= i1; i++) pts.push({ i, p: C[i] });
  const f = fit(pts); if (!f) return { slope: 0, r2: 0 };
  const m = pts.reduce((s, q) => s + q.p, 0) / pts.length;
  let ss = 0, sr = 0; for (const q of pts) { ss += (q.p - m) ** 2; sr += (q.p - f.at(q.i)) ** 2; }
  return { slope: f.b, r2: ss ? 1 - sr / ss : 0 };
}
function shapes(k, i0, i1, atr, last) {
  const out = [], piv = pivots(k, i0, i1), H = piv.hi.slice(-4), L = piv.lo.slice(-4), A = atr || (k.H[i1] - k.L[i1]) || 1;
  const tol = Math.max(0.35 * A, 0.0015 * last);
  const hiBox = maxOf(k.H, i0, i1), loBox = minOf(k.L, i0, i1), height = hiBox - loBox;
  // double top / bottom: the last two swing highs (lows) about level, with a real dip (bounce) between
  if (H.length >= 2) {
    const [a, b] = H.slice(-2), mid = minOf(k.L, a.i, b.i);
    if (Math.abs(a.p - b.p) <= tol && Math.max(a.p, b.p) - mid > 1.2 * A) out.push({ name: 'Double top', bias: -1, trigger: mid, triggerWord: 'close below the dip between the peaks', fail: Math.max(a.p, b.p), target: mid - (Math.max(a.p, b.p) - mid), at: b.i });
  }
  if (L.length >= 2) {
    const [a, b] = L.slice(-2), mid = maxOf(k.H, a.i, b.i);
    if (Math.abs(a.p - b.p) <= tol && mid - Math.min(a.p, b.p) > 1.2 * A) out.push({ name: 'Double bottom', bias: 1, trigger: mid, triggerWord: 'close above the bounce between the lows', fail: Math.min(a.p, b.p), target: mid + (mid - Math.min(a.p, b.p)), at: b.i });
  }
  // triangles, wedges and channels from lines through the swing highs and the swing lows
  if (H.length >= 2 && L.length >= 2) {
    const fh = fit(H), fl = fit(L), sH = fh.b / A, sL = fl.b / A, flat = 0.03, end = i1;
    const top = fh.at(end), bot = fl.at(end), wide = fh.at(Math.min(H[0].i, L[0].i)) - fl.at(Math.min(H[0].i, L[0].i));
    let name = null, bias = 0;
    if (Math.abs(sH) < flat && sL > flat) { name = 'Ascending triangle'; bias = 1; }
    else if (sH < -flat && Math.abs(sL) < flat) { name = 'Descending triangle'; bias = -1; }
    else if (sH < -flat && sL > flat) { name = 'Symmetrical triangle'; bias = 0; }
    else if (sH > flat && sL > flat && sL > sH * 1.25) { name = 'Rising wedge'; bias = -1; }
    else if (sH < -flat && sL < -flat && sH < sL * 1.25) { name = 'Falling wedge'; bias = 1; }
    else if (sH > flat && sL > flat) { name = 'Rising channel'; bias = 1; }
    else if (sH < -flat && sL < -flat) { name = 'Falling channel'; bias = -1; }
    else if (Math.abs(sH) < flat && Math.abs(sL) < flat && top > bot) { name = 'Range (rectangle)'; bias = 0; }
    if (name && top > bot) out.push({ name, bias, upper: top, lower: bot, trigger: bias >= 0 ? top : bot, fail: bias >= 0 ? bot : top, target: bias > 0 ? top + Math.max(wide, top - bot) : bias < 0 ? bot - Math.max(wide, top - bot) : null, at: end, lines: true });
  }
  // a V turn: a fast leg one way and a fast leg back, each over three ATRs
  const iMin = (() => { let m = i0; for (let i = i0; i <= i1; i++) if (k.L[i] < k.L[m]) m = i; return m; })();
  const iMax = (() => { let m = i0; for (let i = i0; i <= i1; i++) if (k.H[i] > k.H[m]) m = i; return m; })();
  if (iMin > i0 + 2 && iMin < i1 - 2 && k.H[i0] - k.L[iMin] > 3 * A && k.C[i1] - k.L[iMin] > 3 * A) out.push({ name: 'V bottom', bias: 1, trigger: maxOf(k.H, i0, iMin), fail: k.L[iMin], target: null, at: iMin });
  if (iMax > i0 + 2 && iMax < i1 - 2 && k.H[iMax] - k.L[i0] > 3 * A && k.H[iMax] - k.C[i1] > 3 * A) out.push({ name: 'V top', bias: -1, trigger: minOf(k.L, i0, iMax), fail: k.H[iMax], target: null, at: iMax });
  return { list: out, piv, hiBox, loBox, height };
}
// Price levels where swings bunched up, nearest first above and below the last price.
function levels(k, iFrom, iTo, atr, last) {
  const piv = pivots(k, iFrom, iTo), pts = [...piv.hi.map(q => ({ p: q.p, i: q.i })), ...piv.lo.map(q => ({ p: q.p, i: q.i }))].sort((a, b) => a.p - b.p);
  const tol = Math.max(0.3 * (atr || 0), last * 0.0012), groups = [];
  for (const q of pts) { const g = groups[groups.length - 1]; if (g && q.p - g.max <= tol) { g.list.push(q); g.max = q.p; } else groups.push({ list: [q], max: q.p }); }
  const lv = groups.map(g => ({ p: g.list.reduce((s, q) => s + q.p, 0) / g.list.length, touches: g.list.length, lastAt: Math.max(...g.list.map(q => q.i)) }));
  const above = lv.filter(l => l.p > last).sort((a, b) => a.p - b.p), below = lv.filter(l => l.p < last).sort((a, b) => b.p - a.p);
  return { above: above.slice(0, 3), below: below.slice(0, 3) };
}
// MACD divergence found the atlas's way: close pivots (two closes each side), consecutive same-type pivots 5 to 40
// candles apart, MACD read on the pivot candles. Known only two closes after the second pivot.
function divergences(C, M, i0, i1) {
  const out = [];
  for (const low of [true, false]) {
    const piv = [];
    for (let i = Math.max(2, i0); i <= Math.min(C.length - 3, i1); i++) {
      const c = C[i], s = low ? 1 : -1;
      if (s * c < s * C[i - 1] && s * c < s * C[i - 2] && s * c < s * C[i + 1] && s * c < s * C[i + 2]) piv.push(i);
    }
    for (let n = 1; n < piv.length; n++) {
      const a = piv[n - 1], b = piv[n];
      if (b - a < 5 || b - a > 40 || M[a] == null || M[b] == null) continue;
      const px = C[b] - C[a], mo = M[b] - M[a];
      if (low && px < 0 && mo > 0) out.push({ kind: 'Regular bullish divergence', bias: 1, a, b, known: b + 2 });
      if (low && px > 0 && mo < 0) out.push({ kind: 'Hidden bullish divergence', bias: 1, a, b, known: b + 2 });
      if (!low && px > 0 && mo < 0) out.push({ kind: 'Regular bearish divergence', bias: -1, a, b, known: b + 2 });
      if (!low && px < 0 && mo > 0) out.push({ kind: 'Hidden bearish divergence', bias: -1, a, b, known: b + 2 });
    }
  }
  return out.sort((x, y) => x.b - y.b);
}

// ------------------------------------------------------------------ timeframes to look at next
export function suggestTimeframes(tf, count, found) {
  const i = TFS.indexOf(tf), out = [];
  const add = (t, why) => { if (t && t !== tf && !out.some(o => o.tf === t)) out.push({ tf: t, label: TF_LABEL[t], why }); };
  if (count < 12) add(TFS[i - 1], `Only ${count} candles are inside the box. ${TF_LABEL[TFS[i - 1]] || ''} puts more of them in the same stretch.`);
  add(TFS[i + 1], `One step up shows whether this ${TF_WORDS[tf]} move fits the bigger trend.`);
  add(TFS[Math.min(TFS.length - 1, i + 2)], 'Two steps up gives the backdrop: where the larger trend and levels sit.');
  if (count > 160) add(TFS[i + 1], `${count} candles is a lot of noise; a larger candle size reads the shape more cleanly.`);
  if (!isLong(tf) && found.some(f => f.atlas)) add('1D', 'Your book tested candle patterns on daily candles. The daily chart is where its numbers apply as tested.');
  if (i > 0 && count >= 12) add(TFS[i - 1], `One step down shows the entry detail: how price is behaving right at the trigger.`);
  return out.slice(0, 4);
}

// ------------------------------------------------------------------ the whole reading
// bars: everything available at this timeframe, oldest first. i0..i1: the captured candles. ctx: { tf, sym, gex, vwap }
export function readCapture(bars, i0, i1, ctx = {}) {
  const k = measure(bars), n = bars.length, tf = ctx.tf || '5min';
  i0 = Math.max(0, Math.min(n - 1, i0)); i1 = Math.max(i0, Math.min(n - 1, i1));
  const C = Array.from(k.C), s50 = sma(C, 50), atr = atrSeries(bars), rsi = rsiArr(C), md = macdArr(C);
  const last = C[i1], A = atr[i1] || atr.filter(Boolean).slice(-1)[0] || (k.H[i1] - k.L[i1]) || last * 0.005;
  // candle patterns and structure proxies on the captured candles
  const raw = [];
  for (let i = i0; i <= i1; i++) {
    for (const code in CANDLE) { const v = CANDLE[code](k, i); if (v) raw.push({ code, i, v }); }
    raw.push(...proxies(k, s50, i));
  }
  raw.push(...hikkake(k, i0, i1));
  const found = raw.map(r => {
    const side = sideOf(r.code, r.v, k, s50, r.i), b = bins(k, s50, atr, r.i);
    const span = r.from != null ? r.from : r.i - (/STAR|3|CROWS|SOLDIERS|INSIDE|OUTSIDE|SANDWICH|TASUKI|GAP|BABY|TRISTAR/.test(r.code) ? 2 : /ENGULF|HARAMI|PIERC|CLOUD|COUNTER|MATCH|PIGEON|NECK|THRUST|SEPAR|KICK|DOJISTAR/.test(r.code) ? 1 : 0);
    const hiP = maxOf(k.H, Math.max(0, span), r.i), loP = minOf(k.L, Math.max(0, span), r.i);
    return {
      code: r.code, name: NAMES[r.code] || r.code, i: r.i, t: bars[r.i].t, side, neutral: NEUTRAL.has(r.code), family: familyOf(r.code),
      atlas: true, trend: b && b.trend, vol: b && b.vol, cell: b && b.vol ? `${b.trend}/${b.vol}` : null,
      confirm: side >= 0 ? hiP : loP, fail: side >= 0 ? loP : hiP,
    };
  });
  // overlapping names on one candle count once: keep the most specific of each family per candle
  const groups = new Map();
  for (const f of found) { const key = f.i + ':' + (f.family >= 0 ? 'f' + f.family : f.code); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(f); }
  // the most telling name of each group: a named pattern before a plain candle shape
  const events = [...groups.values()].map(list => { const pick = list.find(f => !COMMON.has(f.code)) || list[list.length - 1]; return { ...pick, common: COMMON.has(pick.code), also: list.filter(f => f !== pick).map(f => f.name) }; }).sort((a, b) => a.i - b.i);
  const notable = events.filter(e => !e.common), commonCounts = {};
  for (const e of events) if (e.common) commonCounts[e.name] = (commonCounts[e.name] || 0) + 1;
  // trend inside the box, and the swings
  const reg = regress(C, i0, i1), move = C[i1] - k.O[i0], movePct = (C[i1] / k.O[i0] - 1) * 100;
  const sh = shapes(k, i0, i1, A, last), piv = sh.piv;
  const hh = piv.hi.slice(-3), ll = piv.lo.slice(-3);
  const higherHighs = hh.length >= 2 && hh.every((q, j) => !j || q.p > hh[j - 1].p), higherLows = ll.length >= 2 && ll.every((q, j) => !j || q.p > ll[j - 1].p);
  const lowerHighs = hh.length >= 2 && hh.every((q, j) => !j || q.p < hh[j - 1].p), lowerLows = ll.length >= 2 && ll.every((q, j) => !j || q.p < ll[j - 1].p);
  const slopeAtr = reg.slope / A;
  const trendWord = reg.r2 > 0.55 && Math.abs(slopeAtr) > 0.04 ? (reg.slope > 0 ? 'Clean uptrend' : 'Clean downtrend')
    : reg.r2 > 0.25 && Math.abs(slopeAtr) > 0.02 ? (reg.slope > 0 ? 'Choppy uptrend' : 'Choppy downtrend') : 'Sideways';
  const structure = higherHighs && higherLows ? 'Higher highs and higher lows' : lowerHighs && lowerLows ? 'Lower highs and lower lows' : higherLows && lowerHighs ? 'Highs falling, lows rising: coiling' : 'Mixed swings';
  // momentum at the last captured candle
  const mom = { rsi: rsi[i1], macd: md.M[i1], signal: md.S[i1], hist: md.H[i1], histRising: md.H[i1] != null && md.H[i1 - 1] != null && md.H[i1] > md.H[i1 - 1], cross: null };
  for (let i = i1; i > Math.max(i0, i1 - 5); i--) if (md.H[i] != null && md.H[i - 1] != null && Math.sign(md.H[i]) !== Math.sign(md.H[i - 1]) && md.H[i]) { mom.cross = { dir: md.H[i] > 0 ? 1 : -1, ago: i1 - i }; break; }
  const divs = divergences(C, md.M, Math.max(0, i0 - 40), i1).filter(d => d.b >= i0 && d.known <= Math.max(i1, n - 1));
  // where price sits in the box, and the levels around it
  const pos = sh.height ? (last - sh.loBox) / sh.height : 0.5;
  const lv = levels(k, Math.max(0, i1 - 300), i1, A, last);
  const gex = ctx.gex || null;
  // the lean: structure, momentum and where price sits, said in words. Not a probability.
  const why = []; let score = 0;
  const vote = (s, text) => { score += s; why.push({ s, text }); };
  if (/up/.test(trendWord)) vote(trendWord.startsWith('Clean') ? 2 : 1, `${trendWord} across the box (${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%).`);
  else if (/down/.test(trendWord)) vote(trendWord.startsWith('Clean') ? -2 : -1, `${trendWord} across the box (${movePct.toFixed(2)}%).`);
  else vote(0, `No clear direction across the box (${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%).`);
  if (higherHighs && higherLows) vote(1, 'Swings are stepping higher.'); else if (lowerHighs && lowerLows) vote(-1, 'Swings are stepping lower.');
  if (mom.hist != null) vote(mom.hist > 0 ? (mom.histRising ? 1 : 0.5) : (mom.histRising ? -0.5 : -1), `MACD histogram ${mom.hist > 0 ? 'above' : 'below'} zero and ${mom.histRising ? 'rising' : 'falling'}.`);
  if (mom.rsi != null) { if (mom.rsi >= 70) vote(-0.5, `RSI ${mom.rsi.toFixed(0)}: stretched up.`); else if (mom.rsi <= 30) vote(0.5, `RSI ${mom.rsi.toFixed(0)}: stretched down.`); }
  if (pos >= 0.8) vote(0.5, 'Price is pressing the top of the box.'); else if (pos <= 0.2) vote(-0.5, 'Price is sitting at the bottom of the box.');
  for (const d of divs.slice(-1)) vote(d.bias * 0.5, `${d.kind} (MACD) inside the box.`);
  for (const s of sh.list) if (s.bias) vote(s.bias * 0.5, `${s.name} shape.`);
  const lean = score >= 2 ? 'Leaning bullish' : score <= -2 ? 'Leaning bearish' : score >= 1 ? 'Slightly bullish' : score <= -1 ? 'Slightly bearish' : 'Balanced';
  // the paths from here, both ways
  const res = lv.above[0]?.p ?? sh.hiBox, sup = lv.below[0]?.p ?? sh.loBox;
  const upTrig = Math.max(res, last + 0.1 * A), dnTrig = Math.min(sup, last - 0.1 * A);
  const upObj = [upTrig + sh.height, lv.above[1]?.p, gex?.cw].filter(v => v != null && v > upTrig).sort((a, b) => a - b);
  const dnObj = [dnTrig - sh.height, lv.below[1]?.p, gex?.pw].filter(v => v != null && v < dnTrig).sort((a, b) => b - a);
  const inA = (v) => Math.abs(v - last) / A;
  const scenarios = [
    { side: 1, name: 'Bull path', trigger: upTrig, triggerWord: `a ${TF_LABEL[tf]} close above ${upTrig.toFixed(2)}`, invalid: Math.min(sup, last - 0.5 * A), targets: upObj.slice(0, 2), dist: inA(upTrig) },
    { side: -1, name: 'Bear path', trigger: dnTrig, triggerWord: `a ${TF_LABEL[tf]} close below ${dnTrig.toFixed(2)}`, invalid: Math.max(res, last + 0.5 * A), targets: dnObj.slice(0, 2), dist: inA(dnTrig) },
    { side: 0, name: 'Range path', trigger: null, triggerWord: `no close outside ${dnTrig.toFixed(2)}–${upTrig.toFixed(2)}`, invalid: null, targets: [], dist: 0 },
  ];
  // what to watch next: the nearest triggers, pattern confirmations still open, and walls in reach
  const watch = [];
  for (const e of notable.slice(-4).reverse()) {
    if (e.i < i1 - 6) continue;
    if (e.neutral) watch.push(`${e.name}: a break of ${e.confirm.toFixed(2)} or ${e.fail.toFixed(2)} decides it (the atlas scored it as a ${e.side > 0 ? 'long' : 'short'}, fading the trend).`);
    else watch.push(`${e.name}: ${e.side > 0 ? 'above' : 'below'} ${e.confirm.toFixed(2)} confirms it; ${e.side > 0 ? 'below' : 'above'} ${e.fail.toFixed(2)} breaks it.`);
  }
  for (const s of sh.list.slice(-2)) watch.push(`${s.name}: ${s.bias > 0 ? 'above' : s.bias < 0 ? 'below' : 'a close beyond'} ${s.trigger.toFixed(2)} ${s.bias ? 'triggers it' : 'picks a side'}; ${s.fail != null ? `${s.bias > 0 ? 'below' : 'above'} ${s.fail.toFixed(2)} cancels it` : ''}.`);
  if (gex) for (const [key, name] of [['cw', 'call wall'], ['pw', 'put wall'], ['zg', 'gamma flip']]) if (gex[key] != null && inA(gex[key]) < 4) watch.push(`GEX ${name} ${gex[key].toFixed(2)} is ${inA(gex[key]).toFixed(1)} ATR away.`);
  const count = i1 - i0 + 1;
  return {
    tf, sym: ctx.sym, count, t0: bars[i0].t, t1: bars[i1].t, first: bars[i0], lastBar: bars[i1], last, atr: A,
    box: { hi: sh.hiBox, lo: sh.loBox, height: sh.height, pos },
    trend: { word: trendWord, structure, slopeAtr, r2: reg.r2, move, movePct },
    momentum: mom, divergences: divs, events, notable, commonCounts, shapes: sh.list, levels: lv, gex,
    lean: { word: lean, score, why }, scenarios, watch: watch.slice(0, 6),
    timeframes: suggestTimeframes(tf, count, notable),
    intraday: !isLong(tf),
  };
}

// A compact, plain version for INDAI's brain and for storing with a capture.
export function summarize(r) {
  const f2 = (v) => (v == null ? null : +(+v).toFixed(2));
  return {
    symbol: r.sym, timeframe: TF_LABEL[r.tf], candles: r.count, from: new Date(r.t0).toISOString(), to: new Date(r.t1).toISOString(),
    last: f2(r.last), atr: f2(r.atr), box: { high: f2(r.box.hi), low: f2(r.box.lo), position: +(r.box.pos * 100).toFixed(0) + '%' },
    trend: `${r.trend.word}; ${r.trend.structure}; ${r.trend.movePct.toFixed(2)}% across the box`,
    momentum: { rsi: f2(r.momentum.rsi), macdHist: f2(r.momentum.hist), macdHistRising: r.momentum.histRising, recentCross: r.momentum.cross },
    commonCandles: r.commonCounts,
    patterns: r.notable.map(e => ({ code: e.code, name: e.name, at: new Date(e.t).toISOString(), side: e.side > 0 ? 'long' : e.side < 0 ? 'short' : 'none', trendBin: e.trend, volBin: e.vol, confirm: f2(e.confirm), fail: f2(e.fail), alsoFired: e.also })),
    divergences: r.divergences.map(d => d.kind), shapes: r.shapes.map(s => ({ name: s.name, trigger: f2(s.trigger), cancel: f2(s.fail), objective: f2(s.target) })),
    levels: { resistance: r.levels.above.map(l => f2(l.p)), support: r.levels.below.map(l => f2(l.p)) }, gex: r.gex,
    lean: r.lean.word, paths: r.scenarios.map(s => ({ path: s.name, trigger: s.triggerWord, invalid: f2(s.invalid), objectives: s.targets.map(f2) })),
    watch: r.watch,
  };
}

// For the tests: the detectors on their own.
export const __test = { measure, CANDLE, hikkake, proxies, sma };
