// Candles kept on this device (IndexedDB), so earlier days stay on the chart after the close, over the weekend,
// when the backend cannot answer, and further back than the TradingView bridge has stored:
//   m1   one-minute candles, regular and extended hours, the last 45 days per ticker
//   d1   daily candles, kept for good (small: about 250 a year per ticker)
//   cap  the trader's chart captures with their analysis, the newest 60
// Every call fails quietly (private browsing, storage full): the chart simply works from the network as before.
const DB = 'indai-candles', VER = 1, KEEP_MIN_DAYS = 45, KEEP_CAPTURES = 60;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('m1')) db.createObjectStore('m1', { keyPath: ['s', 't'] });
      if (!db.objectStoreNames.contains('d1')) db.createObjectStore('d1', { keyPath: ['s', 't'] });
      if (!db.objectStoreNames.contains('cap')) db.createObjectStore('cap', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const clean = (b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 });
const ok = (b) => Number.isFinite(+b.t) && +b.c > 0 && +b.o > 0 && +b.h >= +b.l;

async function putMany(store, sym, bars) {
  if (!bars || !bars.length) return 0;
  const db = await open(), tx = db.transaction(store, 'readwrite'), os = tx.objectStore(store);
  let n = 0;
  for (const b of bars) if (ok(b)) { os.put({ s: sym, ...clean(b) }); n++; }
  await done(tx);
  return n;
}
async function range(store, sym, from = 0, to = 8.64e15) {
  const db = await open(), tx = db.transaction(store, 'readonly');
  const rows = await req(tx.objectStore(store).getAll(IDBKeyRange.bound([sym, from], [sym, to])));
  return rows.map(clean);
}

let pruned = false;
export const candleStore = {
  async putMinutes(sym, bars) { try { return await putMany('m1', sym, bars); } catch { return 0; } },
  async minutes(sym, from, to) { try { return await range('m1', sym, from, to); } catch { return []; } },
  async putDaily(sym, bars) { try { return await putMany('d1', sym, bars); } catch { return 0; } },
  async daily(sym) { try { return await range('d1', sym); } catch { return []; } },
  // Drops one-minute candles older than the keep window, once per page load.
  async prune(now = Date.now()) {
    if (pruned) return; pruned = true;
    try {
      const db = await open(), tx = db.transaction('m1', 'readwrite'), os = tx.objectStore('m1'), cut = now - KEEP_MIN_DAYS * 864e5;
      const cursor = os.openCursor();
      await new Promise((resolve) => {
        cursor.onsuccess = () => { const c = cursor.result; if (!c) return resolve(); if (c.value.t < cut) c.delete(); c.continue(); };
        cursor.onerror = () => resolve();
      });
      await done(tx);
    } catch { /* nothing to prune */ }
  },
  async addCapture(rec) {
    try {
      const db = await open(), tx = db.transaction('cap', 'readwrite'), os = tx.objectStore('cap');
      os.put(rec);
      const keys = await req(os.getAllKeys());
      for (const k of keys.sort((a, b) => a - b).slice(0, Math.max(0, keys.length - KEEP_CAPTURES))) os.delete(k);
      await done(tx);
      return true;
    } catch { return false; }
  },
  async captures(n = 30) {
    try { const db = await open(); const all = await req(db.transaction('cap', 'readonly').objectStore('cap').getAll()); return all.sort((a, b) => b.id - a.id).slice(0, n); } catch { return []; }
  },
  async capture(id) { try { const db = await open(); return await req(db.transaction('cap', 'readonly').objectStore('cap').get(id)); } catch { return null; } },
  async removeCapture(id) { try { const db = await open(), tx = db.transaction('cap', 'readwrite'); tx.objectStore('cap').delete(id); await done(tx); return true; } catch { return false; } },
};
