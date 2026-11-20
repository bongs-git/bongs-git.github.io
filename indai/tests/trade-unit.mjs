// The Trade page's price steps and stop geometry (js/trade-chart.js). node trade-unit.mjs
import assert from 'node:assert/strict';
import { autoStop, clampStop, roundTo, scale, span, tickFor } from '../js/trade-chart.js';
let n = 0; const ok = (name) => console.log(`ok ${++n} ${name}`);

assert.deepEqual([tickFor('SPY', 0.4), tickFor('SPY', 12), tickFor('QQQ', 5), tickFor('IWM', 3)], [0.01, 0.01, 0.01, 0.01]);
assert.deepEqual([tickFor('SPXW', 2.95), tickFor('SPXW', 3), tickFor('SPX', 40), tickFor('NDXP', 1)], [0.05, 0.1, 0.1, 0.05]);
assert.deepEqual([tickFor('AAPL', 2.99), tickFor('AAPL', 3), tickFor('TSLA', 15)], [0.01, 0.05, 0.05]);
ok('price steps: cents for SPY, QQQ and IWM, nickels and dimes for index options, cents then nickels for the rest');

assert.deepEqual([roundTo(1.234, 0.01), roundTo(1.236, 0.01), roundTo(3.13, 0.05), roundTo(3.12, 0.05), roundTo(3.14, 0.05, 'down'), roundTo(3.11, 0.05, 'up'), roundTo(7.25, 0.1, 'down'), roundTo(0.3, 0.05, 'down')], [1.23, 1.24, 3.15, 3.1, 3.1, 3.15, 7.2, 0.3]);
assert.deepEqual([roundTo((1.44 + 1.45) / 2, 0.01), roundTo(1.445, 0.01), roundTo(2.675, 0.05)], [1.45, 1.45, 2.7], 'a half goes up');
ok('rounding lands on a price step, without floating-point leftovers');

assert.deepEqual([autoStop('SPY', 1.45), autoStop('SPY', 1), autoStop('SPY', 0.05), autoStop('SPXW', 12), autoStop('SPXW', 3.5), autoStop('AAPL', 4), autoStop('AAPL', 3.6)], [1.16, 0.8, 0.04, 9.6, 2.8, 3.2, 2.88]);
assert.deepEqual([autoStop('SPY', 0.01), autoStop('SPXW', 0.05), autoStop('SPY', 0), autoStop('SPY', NaN)], [null, null, null, null], 'a price too small for a stop below it gets none');
for (const [root, limit] of [['SPY', 2.37], ['SPXW', 7.3], ['AAPL', 3.05], ['QQQ', 0.09]]) { const s = autoStop(root, limit); assert.ok(s < limit && s <= limit * 0.8 + 1e-9 && s > limit * 0.8 - tickFor(root, limit * 0.8) - 1e-9, `${root} ${limit} -> ${s}`); }
ok('the stop that goes with a buy is 20% under the limit, rounded down to a price step, and always below it');

assert.deepEqual([clampStop(1.234, 0.01, 1.5), clampStop(1.6, 0.01, 1.5), clampStop(1.5, 0.01, 1.5), clampStop(-3, 0.01, 1.5), clampStop(0, 0.05, 4), clampStop(9, 0.1, 7.25), clampStop(2, 0.05, null)], [1.23, 1.49, 1.49, 0.01, 0.05, 7.1, 2]);
ok('a dragged stop stays on a price step, above zero and under the option\'s price now');

assert.deepEqual(span([], []), [0, 1]);
const [lo, hi] = span([[0, 1, 1.5, 0.9, 1.2, 0], [60e3, 1.2, 1.3, 1.1, 1.25, 0]], [1.25, 1.24, 0.8, null]);
assert.ok(lo < 0.8 && lo > 0.6 && hi > 1.5 && hi < 1.7, `${lo} ${hi}`);
assert.ok(span([], [0.02])[0] >= 0);
const sc = scale([1, 2], 10, 110);
assert.deepEqual([sc.y(1), sc.y(2), sc.y(1.5), sc.p(10), sc.p(110), sc.p(60)], [110, 10, 60, 2, 1, 1.5]);
ok('the chart shows every level with room around it, and a place on it turns back into the same price');
console.log('all passed');
