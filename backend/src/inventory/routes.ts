import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';

/**
 * Furniture, lab equipment and other counted things. Each item keeps how many are good, damaged, lost or written off; a change
 * is always an event (damaged, repaired, lost, disposed, added), never a typed-over number, so the history explains the count.
 * Teachers can report damage; the office manages the rest.
 */
db.exec(`CREATE TABLE IF NOT EXISTS inv_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'other', location TEXT, unit TEXT DEFAULT 'pcs',
  qty_good INTEGER NOT NULL DEFAULT 0, qty_damaged INTEGER NOT NULL DEFAULT 0, qty_lost INTEGER NOT NULL DEFAULT 0, qty_disposed INTEGER NOT NULL DEFAULT 0,
  purchase_date TEXT, cost INTEGER, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS inv_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE, date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('added','damaged','repaired','lost','disposed')), qty INTEGER NOT NULL, note TEXT, by_user INTEGER, by_name TEXT
)`);

export const CATEGORIES = ['furniture', 'lab', 'electronics', 'sports', 'library', 'other'];
const today = () => new Date().toISOString().slice(0, 10);
const bad = (res: any, m: string, c = 400) => res.status(c).json({ message: m });
const office = requireRole('director', 'principal', 'admin');
const int = (v: any) => Math.round(Number(v));

/** Moves quantities between the buckets. Returns an error text when the move is not possible. */
export function applyEvent(itemId: number, kind: string, qty: number, note: string | null, by: { id?: number; name?: string } | undefined, date = today()): string | null {
  const it = db.prepare('SELECT * FROM inv_items WHERE id = ?').get(itemId) as any;
  if (!it) return 'Item not found.';
  if (!Number.isInteger(qty) || qty < 1) return 'Quantity must be a whole number of 1 or more.';
  const t = { good: it.qty_good, damaged: it.qty_damaged, lost: it.qty_lost, disposed: it.qty_disposed };
  if (kind === 'added') t.good += qty;
  else if (kind === 'damaged') { if (qty > t.good) return `Only ${t.good} are in good condition.`; t.good -= qty; t.damaged += qty; }
  else if (kind === 'repaired') { if (qty > t.damaged) return `Only ${t.damaged} are damaged.`; t.damaged -= qty; t.good += qty; }
  else if (kind === 'lost') { if (qty > t.good) return `Only ${t.good} are in good condition.`; t.good -= qty; t.lost += qty; }
  else if (kind === 'disposed') { if (qty > t.damaged) return `Only ${t.damaged} are damaged. Mark it damaged first.`; t.damaged -= qty; t.disposed += qty; }
  else return 'Unknown event.';
  db.transaction(() => {
    db.prepare('UPDATE inv_items SET qty_good = ?, qty_damaged = ?, qty_lost = ?, qty_disposed = ? WHERE id = ?').run(t.good, t.damaged, t.lost, t.disposed, itemId);
    db.prepare('INSERT INTO inv_events (item_id, date, kind, qty, note, by_user, by_name) VALUES (?,?,?,?,?,?,?)').run(itemId, date, kind, qty, note, by?.id ?? null, by?.name ?? null);
  })();
  return null;
}

export const inventoryRouter = Router();
inventoryRouter.get('/categories', (_req, res) => res.json(CATEGORIES));

inventoryRouter.get('/', (req, res) => {
  const q = req.query as any, w = ['active = 1'], p: any[] = [];
  if (q.category) { w.push('category = ?'); p.push(String(q.category)); }
  if (q.location) { w.push('location = ?'); p.push(String(q.location)); }
  if (q.q) { w.push('(name LIKE ? OR code LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`); }
  if (q.problem) w.push('(qty_damaged > 0 OR qty_lost > 0)');
  res.json(db.prepare(`SELECT *, qty_good + qty_damaged + qty_lost + qty_disposed AS qty_total FROM inv_items WHERE ${w.join(' AND ')} ORDER BY category, name`).all(...p));
});

inventoryRouter.post('/', office, (req, res) => {
  const b = req.body ?? {}, name = String(b.name ?? '').trim(), qty = int(b.qty ?? 1);
  if (!name) return bad(res, 'Give the item a name.');
  if (!(qty >= 0 && qty <= 100000)) return bad(res, 'Quantity is not valid.');
  const cat = CATEGORIES.includes(b.category) ? b.category : 'other';
  const r = db.prepare('INSERT INTO inv_items (code, name, category, location, unit, purchase_date, cost, notes) VALUES (?,?,?,?,?,?,?,?)')
    .run(b.code ? String(b.code).trim().slice(0, 40) : null, name.slice(0, 120), cat, b.location ? String(b.location).trim().slice(0, 80) : null, String(b.unit || 'pcs').slice(0, 20),
      b.purchase_date || null, b.cost != null && b.cost !== '' ? int(b.cost) : null, b.notes ? String(b.notes).slice(0, 300) : null);
  const id = Number(r.lastInsertRowid);
  if (qty > 0) applyEvent(id, 'added', qty, 'Opening stock', req.user);
  audit(req.user, 'inventory.add', 'inv_item', id, { name, qty });
  res.status(201).json({ id });
});

inventoryRouter.put('/:id', office, (req, res) => {
  const id = Number(req.params.id), b = req.body ?? {};
  if (!db.prepare('SELECT 1 FROM inv_items WHERE id = ?').get(id)) return bad(res, 'Item not found.', 404);
  const name = String(b.name ?? '').trim(); if (!name) return bad(res, 'Give the item a name.');
  db.prepare('UPDATE inv_items SET code = ?, name = ?, category = ?, location = ?, unit = ?, purchase_date = ?, cost = ?, notes = ? WHERE id = ?')
    .run(b.code || null, name.slice(0, 120), CATEGORIES.includes(b.category) ? b.category : 'other', b.location || null, String(b.unit || 'pcs').slice(0, 20), b.purchase_date || null, b.cost != null && b.cost !== '' ? int(b.cost) : null, b.notes || null, id);
  audit(req.user, 'inventory.edit', 'inv_item', id); res.json({ ok: true });
});

inventoryRouter.delete('/:id', office, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM inv_items WHERE id = ?').get(id)) return bad(res, 'Item not found.', 404);
  db.prepare('UPDATE inv_items SET active = 0 WHERE id = ?').run(id); audit(req.user, 'inventory.remove', 'inv_item', id); res.json({ ok: true });
});

inventoryRouter.get('/:id/events', (req, res) =>
  res.json(db.prepare('SELECT * FROM inv_events WHERE item_id = ? ORDER BY date DESC, id DESC LIMIT 200').all(Number(req.params.id))));

inventoryRouter.post('/:id/event', (req, res) => {
  const id = Number(req.params.id), kind = String(req.body?.kind);
  if (req.user!.role === 'teacher' && kind !== 'damaged') return bad(res, 'Teachers can only report damage.', 403);
  if (!['director', 'principal', 'admin', 'teacher'].includes(req.user!.role)) return bad(res, 'You do not have permission for this.', 403);
  const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
  if (kind === 'damaged' && !note) return bad(res, 'Write what is damaged and how it happened.');
  const err = applyEvent(id, kind, int(req.body?.qty ?? 1), note, req.user);
  if (err) return bad(res, err, err === 'Item not found.' ? 404 : 409);
  audit(req.user, 'inventory.' + kind, 'inv_item', id, { qty: req.body?.qty, note }); res.json({ ok: true });
});

/** Damage and loss report: what is damaged or lost now, its value, and recent events. */
inventoryRouter.get('/report/damage', office, (_req, res) => {
  const items = db.prepare(`SELECT id, code, name, category, location, qty_damaged, qty_lost, cost, COALESCE(cost,0) * (qty_damaged + qty_lost) AS value FROM inv_items WHERE active = 1 AND (qty_damaged > 0 OR qty_lost > 0) ORDER BY location, name`).all() as any[];
  const events = db.prepare(`SELECT e.date, e.kind, e.qty, e.note, e.by_name, i.name, i.location FROM inv_events e JOIN inv_items i ON i.id = e.item_id WHERE e.kind IN ('damaged','lost','disposed','repaired') ORDER BY e.date DESC, e.id DESC LIMIT 100`).all();
  res.json({ items, events, totals: { damaged: items.reduce((a, i) => a + i.qty_damaged, 0), lost: items.reduce((a, i) => a + i.qty_lost, 0), value: items.reduce((a, i) => a + i.value, 0) } });
});
