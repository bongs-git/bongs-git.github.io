// The owner's own market data. When his passcode is saved on this device, every request to INDAI's price service
// carries it, and the server may then answer from his Schwab account (live quotes, option chains, candles) instead
// of the public sources. Schwab's data is for the account holder only, so the server gives it to nobody else.
// Without a saved passcode nothing here changes anything. The passcode is added to requests for the price service
// and to nothing else.
import { RELAY_URL } from './relay.js';

const MARKET = `${RELAY_URL}/functions/v1/indai-market?`;

export function initOwnerFeed(app) {
  const plain = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const pass = app.settings && app.settings.researchPass;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : '';
    if (!pass || !url.startsWith(MARKET)) return plain(input, init);
    const headers = new Headers((init && init.headers) || {});
    headers.set('x-indai-pass', pass);
    return plain(input, { ...(init || {}), headers });
  };
}
