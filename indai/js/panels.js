// Website stand-in for the Quest app's panels.js (which is all 3D canvas panels).
// indai.js (shared, copied as-is) imports levelSourceLabel from here, so keep that name.
// The website's own screens live in views.js, sheets.js and chart.js.

export const RAG_CLASS = { GREEN: 'good', AMBER: 'alert', RED: 'risk' };

export function nearestLevel(price, lv) {
  const names = { cw: ['Call wall', 'CW'], pw: ['Put wall', 'PW'], zg: ['Gamma flip', 'FLIP'] };
  let best = null;
  for (const k of ['cw', 'pw', 'zg']) {
    if (lv[k] == null) continue;
    const dist = ((lv[k] - price) / price) * 100;
    if (!best || Math.abs(dist) < Math.abs(best.dist)) best = { key: k, name: names[k][0], short: names[k][1], level: lv[k], dist };
  }
  return best;
}

export function levelSourceLabel(lv) {
  if (!lv) return '';
  if (lv.source === 'manual') return 'Levels: pasted in Settings';
  if (lv.source === 'morning') return `Levels: Morning GEX refresh ${lv.asof ? lv.asof.slice(11) : ''}`;
  if (lv.source === 'morning-stale') return `Levels: Morning GEX refresh (${lv.asof ? lv.asof.slice(5, 10) : 'older'})`;
  if (lv.source === 'live') return 'Levels: live from options chain';
  if (lv.source === 'tradingview') return `Levels: TradingView alert ${lv.asof ? lv.asof.slice(11) : ''}`;
  return 'Demo levels';
}

export function expLabel(exp) {
  if (!exp) return '';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  if (exp === today) return 'today (0DTE)';
  const d = new Date(exp + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function expLabelDays(exp) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const d = new Date(exp + 'T12:00:00Z');
  const days = Math.round((Date.parse(exp + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${days === 0 ? '0DTE' : days + 'd'}`;
}
export function ideaLabel(idea) {
  return `${idea.sym} ${idea.strike ?? ''}${idea.type === 'P' ? 'P' : 'C'}${idea.side < 0 ? ' (short)' : ''} · ${expLabel(idea.expiry)}`;
}
