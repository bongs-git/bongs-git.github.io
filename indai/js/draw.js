// Device drawings retain their original format. Profiles carry records and deletion markers by id.
import { profileSync } from './profile-sync.js';
const KEY = 'indai.web.draw.v1';
const DELETED = KEY + '.deleted';
const KEEP = 31 * 864e5;
const copy = (value) => JSON.parse(JSON.stringify(value));
const validSymbol = (sym) => /^[A-Z.]{1,8}$/.test(sym);
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
const point = (p) => p && Number.isFinite(p.t) && Number.isFinite(p.p);
function valid(d) {
  if (!d || !validId(d.id)) return false;
  if (d.type === 'level') return Number.isFinite(d.p);
  if (d.type === 'ray') return point(d.a);
  return ['line', 'rect'].includes(d.type) && point(d.a) && point(d.b) && Number.isFinite(d.day) && Date.now() - d.day < KEEP;
}
function load() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}'), out = {};
    for (const [sym, list] of Object.entries(value)) {
      if (!validSymbol(sym) || !Array.isArray(list)) continue;
      out[sym] = list.filter(valid).map(d => ({ ...d, updatedAt: d.updatedAt || 1 }));
    }
    return out;
  } catch { return {}; }
}
let state = load(), deleted = {}, notify = () => {};
try { const value = JSON.parse(localStorage.getItem(DELETED) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) deleted = value; } catch {}
const edits = new Map(), undo = new Map();
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(DELETED, JSON.stringify(deleted)); } catch {}
}
export function drawingsFor(sym) { return state[sym] || []; }
export function startDrawingEdit(sym) {
  if (!edits.has(sym)) edits.set(sym, copy(drawingsFor(sym)));
}
export function finishDrawingEdit(sym, commit = true) {
  const before = edits.get(sym);
  if (!before) return;
  edits.delete(sym);
  if (!commit) { state[sym] = before; return; }
  const after = drawingsFor(sym);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const history = undo.get(sym) || [];
  history.push({ before, after: copy(after) }); undo.set(sym, history.slice(-40));
  stampChanges(sym, before, after);
  persist(); notify();
}
function stampChanges(sym, before, after) {
  const at = Math.max(Date.now(), ...before.map(d => (d.updatedAt || 0) + 1), ...after.map(d => (d.updatedAt || 0) + 1), ...[...before, ...after].map(d => (deleted[d.id]?.updatedAt || 0) + 1));
  for (const d of before) if (!after.some(x => x.id === d.id)) deleted[d.id] = { id: d.id, symbol: sym, deleted: true, updatedAt: at };
  for (const d of after) {
    const previous = before.find(x => x.id === d.id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(d)) d.updatedAt = at;
    delete deleted[d.id];
  }
}
function change(sym, action) {
  const own = !edits.has(sym);
  startDrawingEdit(sym);
  const result = action();
  if (own) finishDrawingEdit(sym);
  return result;
}
export function addDrawing(sym, d) {
  return change(sym, () => {
    const item = { ...d, id: crypto.randomUUID(), updatedAt: Date.now() };
    (state[sym] ||= []).push(item);
    return item;
  });
}
export function removeDrawing(sym, id) {
  return change(sym, () => { const list = drawingsFor(sym); state[sym] = list.filter(d => d.id !== id); return list.length !== state[sym].length; });
}
export function clearDrawings(sym) { change(sym, () => { delete state[sym]; }); }
export function canUndoDrawing(sym) { return !!undo.get(sym)?.length; }
export function undoDrawing(sym) {
  const operation = undo.get(sym)?.pop();
  if (!operation) return false;
  const ids = new Set([...operation.before, ...operation.after].map(d => d.id));
  const changed = new Set([...ids].filter(id => JSON.stringify(operation.before.find(d => d.id === id)) !== JSON.stringify(operation.after.find(d => d.id === id))));
  // Undo only this operation; another device may have added an unrelated drawing since then.
  const previous = [...drawingsFor(sym).filter(d => !changed.has(d.id)), ...copy(operation.before.filter(d => changed.has(d.id)))];
  stampChanges(sym, drawingsFor(sym), previous);
  state[sym] = previous;
  persist(); notify();
  return true;
}
export function saveDrawings() {
  for (const sym of [...edits.keys()]) finishDrawingEdit(sym);
  persist();
}
export function reloadDrawings() { state = load(); edits.clear(); undo.clear(); }
export function drawingProfile() {
  const items = { ...deleted };
  for (const [symbol, list] of Object.entries(state)) for (const d of list) items[d.id] = { ...d, symbol };
  return { version: 1, items };
}
export function mergeDrawings(value) {
  if (value?.version !== 1 || !value.items || typeof value.items !== 'object' || edits.size) return;
  const local = drawingProfile().items;
  for (const [id, incoming] of Object.entries(value.items)) {
    if (!validId(id) || incoming?.id !== id || !validSymbol(incoming.symbol) || !Number.isFinite(incoming.updatedAt) || incoming.updatedAt < 0) continue;
    if (!incoming.deleted && !valid(incoming)) continue;
    const current = local[id];
    // A deterministic tie-break preserves a deletion when two devices use the same millisecond.
    if (current && (current.updatedAt > incoming.updatedAt || (current.updatedAt === incoming.updatedAt && (current.deleted || JSON.stringify(current) >= JSON.stringify(incoming))))) continue;
    for (const sym of Object.keys(state)) state[sym] = state[sym].filter(d => d.id !== id);
    if (incoming.deleted) deleted[id] = { id, symbol: incoming.symbol, deleted: true, updatedAt: incoming.updatedAt };
    else {
      const { symbol, ...drawing } = incoming;
      (state[symbol] ||= []).push(copy(drawing)); delete deleted[id];
    }
  }
  persist();
}
export function initDrawingSync(app) {
  const sync = profileSync(app, 'drawings', () => edits.size ? null : drawingProfile(), value => { mergeDrawings(value); app.markDirty('chart'); app.chart?.ui(); });
  notify = () => sync.queue();
  app.drawSync = sync;
  if (Object.keys(drawingProfile().items).length) sync.queue();
}
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const k = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}
