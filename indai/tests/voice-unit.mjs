// How the hosted voice cuts her words into pieces to fetch (js/cloud-voice.js). node voice-unit.mjs
import assert from 'node:assert/strict';
import { pieces } from '../js/cloud-voice.js';
let n = 0; const ok = (name) => console.log(`ok ${++n} ${name}`);

assert.deepEqual(pieces(''), []); assert.deepEqual(pieces('   \n '), []); assert.deepEqual(pieces(null), []);
assert.deepEqual(pieces('Good morning.'), ['Good morning.']);
assert.deepEqual(pieces('  Q Q Q is at 663.20,\n down 0.4 percent.  '), ['Q Q Q is at 663.20, down 0.4 percent.']);
ok('one sentence is one piece, tidied; a decimal point is not the end of a sentence');

const verdict = 'This one is amber. Price is below V-wap and the 665 calls need a 0.6 percent move by the close. Theta is costing about 12 dollars an hour per contract. Watch 664.50: above it the odds improve. If it loses 662 the idea is done!';
const p = pieces(verdict);
assert.equal(p[0], 'This one is amber.', 'the first sentence goes alone so she starts talking quickly');
assert.equal(p.join(' '), verdict, 'nothing is lost or reordered');
assert.ok(p.length === 2 && p.slice(1).every((x) => x.length <= 260), JSON.stringify(p.map((x) => x.length)));
assert.deepEqual(pieces(verdict + ' ' + verdict).map((x) => x.length <= 260), [true, true, true]);
ok('a longer reply: the first sentence alone, then the rest a few sentences at a time');

assert.deepEqual(pieces('Okay. Here is the plan for today. Start small.'), ['Okay. Here is the plan for today.', 'Start small.']);
assert.deepEqual(pieces('Really?! Yes... it is. Done'), ['Really?! Yes... it is.', 'Done']);
ok('a very short opener is joined to the next sentence; runs of marks stay together; no final mark is fine');

const long = ('word '.repeat(400)).trim() + '.';
const lp = pieces(long);
assert.ok(lp.length >= 3 && lp.every((x) => x.length <= 780) && lp.join(' ') === long, JSON.stringify(lp.map((x) => x.length)));
assert.ok(pieces('x'.repeat(2000)).every((x) => x.length <= 780), 'even one unbroken run is cut to what the back end takes');
ok('no piece is longer than the back end accepts');
console.log('all passed');
