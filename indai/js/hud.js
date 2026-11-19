// Website stand-in for the Quest app's hud.js.
// The headset version draws canvas panels on 3D meshes; the website only needs the number formatters.
// indai.js (shared, copied as-is) imports fmtPrice and fmtMoney from here, so keep those names.

export function fmtPrice(p) { if (p == null || !isFinite(p)) return '—'; return p >= 1000 ? p.toFixed(1) : p.toFixed(2); }
export function fmtPct(p) { if (p == null || !isFinite(p)) return '—'; return (p >= 0 ? '+' : '') + p.toFixed(2) + '%'; }
export function fmtMoney(v, sign = false) {
  if (v == null || !isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (v < 0 ? '−$' : (sign && v > 0 ? '+$' : '$')) + s;
}
export function fmtVol(v) { if (!v) return '0'; if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'; return String(Math.round(v)); }
export function fmtBig(v) { if (v == null) return '—'; const a = Math.abs(v); const s = a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0); return (v < 0 ? '−$' : '$') + s; }
export function fmtMMSS(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export const pct0 = (v) => v == null || !isFinite(v) ? '—' : `${Math.round(v * 100)}%`;

// Colours used by the canvas charts (kept in step with css/app.css).
export const C = {
  ink: '#050709', text: '#f3f1ea', dim: '#9aa3b2', faint: '#5f6a7a', grid: 'rgba(255,255,255,0.055)',
  gold: '#dcbf6e', up: '#3ecf8e', down: '#f2706b', amber: '#f0b34a', sky: '#6ec3f2', violet: '#a99bf5', white: '#fcfbf5',
};
export const F = {
  sans: "Geist, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
};
export const colorFor = (v) => (v > 0 ? C.up : v < 0 ? C.down : C.dim);
export function hexA(hex, a) {
  if (hex.startsWith('rgba')) return hex;
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
