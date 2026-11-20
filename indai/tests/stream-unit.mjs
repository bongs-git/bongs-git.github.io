// Schwab's live stream client (js/schwab-stream.js) against a stand-in socket and a hand-turned clock.
// node stream-unit.mjs
import assert from 'node:assert/strict';
import { schwabStream } from '../js/schwab-stream.js';

function rig({ infoFails = null } = {}) {
  const r = { sockets: [], states: [], quotes: [], infoCalls: 0, clock: 1_795_200_000_000, pending: [], symbols: ['SPY', 'QQQ', 'SPX'], infoFails };
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; r.sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text).requests[0]); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen && this.onopen(); }
    say(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
    drop(code = 1006) { this.readyState = 3; this.onclose && this.onclose({ code }); }
  }
  const timers = { set: (f, ms) => { const t = { f, at: r.clock + ms }; r.pending.push(t); return t; }, clear: (t) => { r.pending = r.pending.filter((x) => x !== t); } };
  r.advance = async (ms) => {
    const end = r.clock + ms;
    for (;;) { const next = r.pending.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]; if (!next) break; r.clock = next.at; r.pending = r.pending.filter((x) => x !== next); next.f(); await null; await null; await null; }
    r.clock = end;
  };
  r.stream = schwabStream({
    Socket, timers, now: () => r.clock, symbols: () => r.symbols,
    info: async () => { r.infoCalls++; if (r.infoFails) { const e = new Error(r.infoFails.message); e.status = r.infoFails.status; throw e; } return { socket: 'wss://streamer-api.schwab.com/ws', customer: 'CUST', correl: 'CORREL', channel: 'N9', fn: 'APIAPP', token: 'access-' + r.infoCalls }; },
    onState: (s) => r.states.push(s.state + (s.detail ? ': ' + s.detail : '')), onQuote: (q) => r.quotes.push(q),
  });
  r.loginOk = (sock) => sock.say({ response: [{ service: 'ADMIN', command: 'LOGIN', requestid: '1', content: { code: 0, msg: 'server=s1;status=NP' } }] });
  return r;
}
const settle = async () => { for (let i = 0; i < 6; i++) await null; };
let n = 0; const ok = (name) => console.log(`ok ${++n} ${name}`);

{ // signing in and subscribing
  const r = rig(); r.stream.start(); await settle();
  const s = r.sockets[0]; assert.equal(s.url, 'wss://streamer-api.schwab.com/ws'); s.open();
  assert.deepEqual(s.sent[0], { requestid: '1', service: 'ADMIN', command: 'LOGIN', SchwabClientCustomerId: 'CUST', SchwabClientCorrelId: 'CORREL', parameters: { Authorization: 'access-1', SchwabClientChannel: 'N9', SchwabClientFunctionId: 'APIAPP' } });
  assert.equal(s.sent.length, 1, 'nothing is asked for before Schwab accepts the sign-in');
  r.loginOk(s);
  assert.deepEqual(s.sent[1], { requestid: '2', service: 'LEVELONE_EQUITIES', command: 'SUBS', SchwabClientCustomerId: 'CUST', SchwabClientCorrelId: 'CORREL', parameters: { keys: 'SPY,QQQ,$SPX', fields: '0,1,2,3,8,9,34,35' } });
  assert.ok(r.stream.live && r.states.includes('live: server=s1;status=NP'));
  ok('signs in with the account\'s stream details, then subscribes (indexes by Schwab\'s names)');

  // quotes: the first message is the whole picture, later ones only what changed
  s.say({ data: [{ service: 'LEVELONE_EQUITIES', command: 'SUBS', content: [{ key: 'SPY', delayed: false, 1: 700.41, 2: 700.44, 3: 700.42, 8: 68991302, 9: 100, 34: r.clock - 20, 35: r.clock - 40 }, { key: '$SPX', 3: 7020.34, 35: r.clock - 900 }] }] });
  s.say({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'SPY', 1: 700.43 }] }] });
  s.say({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'SPY', 3: 700.47, 9: 250, 35: r.clock }] }, { service: 'OTHER', content: [{ key: 'SPY', 3: 1 }] }] });
  s.say({ notify: [{ heartbeat: String(r.clock) }] });
  s.onmessage({ data: 'not json' });
  assert.deepEqual(r.quotes.map((q) => [q.symbol, q.last, q.bid, q.size, q.traded]), [['SPY', 700.42, 700.41, 100, true], ['SPX', 7020.34, undefined, 0, true], ['SPY', 700.42, 700.43, 0, false], ['SPY', 700.47, 700.43, 250, true]]);
  assert.equal(r.quotes[3].volume, 68991302, 'what did not change is remembered');
  ok('quotes: each update is filled in from what is already known, and marked as a trade or not');

  // the watchlist changes
  r.stream.setSymbols(); assert.equal(s.sent.length, 2, 'the same list is not sent twice');
  r.symbols = ['SPY', 'TSLA']; r.stream.setSymbols();
  assert.deepEqual(s.sent[2].parameters.keys, 'SPY,TSLA');
  ok('a changed watchlist is subscribed once');

  // the connection drops: it comes back with fresh details, waiting longer each time
  s.drop(); await settle();
  assert.ok(!r.stream.live && r.states.at(-1) === 'waiting: The stream closed (1006)');
  await r.advance(1999); assert.equal(r.sockets.length, 1);
  await r.advance(2); await settle(); assert.equal(r.sockets.length, 2);
  r.sockets[1].open(); assert.equal(r.sockets[1].sent[0].parameters.Authorization, 'access-2');
  r.sockets[1].drop(); await settle(); await r.advance(4999); assert.equal(r.sockets.length, 2); await r.advance(2); await settle(); assert.equal(r.sockets.length, 3);
  r.sockets[2].open(); r.loginOk(r.sockets[2]); assert.deepEqual(r.sockets[2].sent[1].parameters.keys, 'SPY,TSLA');
  r.sockets[2].drop(); await settle(); await r.advance(2001); await settle(); assert.equal(r.sockets.length, 4, 'after a good sign-in the wait starts short again');
  ok('a dropped stream reconnects with a fresh token, backing off, and resubscribes');
  { // a stream that never gets as far as signing in is tried less and less often: 12 tries in the first hour at most
    const b = rig(); b.stream.start(); await settle();
    const t0 = b.clock; let opened = 1;
    while (b.clock - t0 < 3600_000) { b.sockets.at(-1).drop(); await settle(); await b.advance(1000); await settle(); if (b.sockets.length > opened) opened = b.sockets.length; }
    assert.ok(opened >= 8 && opened <= 18, 'tries in an hour: ' + opened); assert.equal(b.infoCalls, opened);
    b.stream.stop();
  }
  ok('a stream that keeps failing settles at one try every five minutes');

  // silence
  r.sockets[3].open(); r.loginOk(r.sockets[3]);
  await r.advance(44000); assert.equal(r.sockets.length, 4);
  await r.advance(20000); await settle(); assert.ok(r.states.includes('waiting: Schwab went quiet'));
  ok('a stream that goes silent for 45 seconds is replaced');
  r.stream.stop(); const count = r.sockets.length; await r.advance(600000); await settle(); assert.equal(r.sockets.length, count); assert.equal(r.states.at(-1), 'off: stopped');
  ok('stop means stop');
}
{ // another device takes the stream
  const r = rig(); r.stream.start(); await settle(); r.sockets[0].open(); r.loginOk(r.sockets[0]);
  r.sockets[0].say({ response: [{ service: 'ADMIN', command: 'LOGIN', content: { code: 12, msg: 'CLOSE_CONNECTION' } }] });
  assert.deepEqual([r.states.at(-1), r.stream.live, r.sockets[0].readyState], ['elsewhere: The stream was opened on another device', false, 3]);
  const r2 = rig(); r2.stream.start(); await settle(); r2.sockets[0].open(); r2.loginOk(r2.sockets[0]);
  r2.sockets[0].say({ response: [{ service: 'LEVELONE_EQUITIES', command: 'SUBS', content: { code: 12, msg: 'Stream taken over' } }] });
  assert.equal(r2.states.at(-1), 'elsewhere: The stream was opened on another device');
  await r2.advance(299000); assert.equal(r2.sockets.length, 1, 'it does not fight for the stream');
  await r2.advance(2000); await settle(); assert.equal(r2.sockets.length, 2);
  r2.sockets[1].open(); r2.loginOk(r2.sockets[1]); r2.sockets[1].drop(); await settle();
  assert.equal(r2.states.at(-1), 'waiting: The stream closed (1006)', 'an ordinary drop afterwards is an ordinary drop');
  // coming back to the page (stop, then start) takes the stream back at once
  r.stream.stop(); r.stream.start(); await settle(); assert.equal(r.sockets.length, 2);
  ok('when another device opens the stream this one waits five minutes; coming back to the page takes it back at once');
}
{ // Schwab refuses the sign-in
  const r = rig(); r.stream.start(); await settle(); r.sockets[0].open();
  r.sockets[0].say({ response: [{ service: 'ADMIN', command: 'LOGIN', content: { code: 3, msg: 'Login Denied.: token is invalid.' } }] });
  assert.ok(!r.stream.live && r.states.at(-1) === 'refused: Schwab refused the stream (3): Login Denied.: token is invalid.', r.states.at(-1));
  assert.equal(r.sockets[0].sent.length, 1, 'no subscription after a refused sign-in');
  await r.advance(59000); assert.equal(r.sockets.length, 1); await r.advance(2000); await settle(); assert.equal(r.sockets.length, 2);
  ok('a refused sign-in is reported and retried after a minute');
}
for (const [status, word] of [[409, 'off'], [503, 'off'], [401, 'off'], [500, 'waiting'], [undefined, 'waiting']]) { // INDAI has nothing to hand over
  const r = rig({ infoFails: { status, message: 'Schwab is not connected.' } }); r.stream.start(); await settle();
  assert.deepEqual([r.sockets.length, r.states.at(-1)], [0, word + ': Schwab is not connected.']);
  await r.advance(word === 'off' ? 299000 : 1900); assert.equal(r.infoCalls, 1);
  await r.advance(word === 'off' ? 2000 : 200); await settle(); assert.equal(r.infoCalls, 2);
}
ok('not connected, not set up or a wrong passcode: no stream, and a look again in five minutes; an outage is retried soon');
console.log('all passed');
