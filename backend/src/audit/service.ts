import { db } from '../db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER, user_name TEXT, role TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
`);

type Who = { id?: number; name?: string; role?: string } | undefined | null;

/** Writes one line to the audit log. Never throws: a logging problem must not stop real work. */
export function audit(who: Who, action: string, entity = '', entityId: string | number | null = null, detail: unknown = '', ip = '') {
  try {
    const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
    db.prepare('INSERT INTO audit_log (user_id, user_name, role, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?,?,?)')
      .run(who?.id ?? null, who?.name ?? null, who?.role ?? null, action.slice(0, 60), entity.slice(0, 60), entityId == null ? null : String(entityId).slice(0, 60), d.slice(0, 1000), ip.slice(0, 60));
  } catch { /* ignore */ }
}

export interface AuditFilter { action?: string; user?: string; from?: string; to?: string; q?: string; limit?: number; offset?: number }
export function listAudit(f: AuditFilter) {
  const w: string[] = [], p: any[] = [];
  if (f.action) { w.push('action LIKE ?'); p.push(f.action + '%'); }
  if (f.user) { w.push('user_name LIKE ?'); p.push('%' + f.user + '%'); }
  if (f.from) { w.push('at >= ?'); p.push(f.from); }
  if (f.to) { w.push('at < date(?, \'+1 day\')'); p.push(f.to); }
  if (f.q) { w.push('(detail LIKE ? OR entity_id LIKE ?)'); p.push('%' + f.q + '%', '%' + f.q + '%'); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const limit = Math.min(500, Math.max(1, f.limit || 100)), offset = Math.max(0, f.offset || 0);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${where}`).get(...p) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset);
  const actions = (db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all() as { action: string }[]).map(r => r.action);
  return { total, rows, actions };
}
