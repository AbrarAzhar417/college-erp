import type { NextFunction, Request, Response } from 'express';
import { db } from '../db.js';
import { audit } from './service.js';

export const BULK_ROWS = 100;
const biggest = (b: unknown): number => {
  if (Array.isArray(b)) return b.length;
  if (b && typeof b === 'object') { let m = 0; for (const v of Object.values(b as Record<string, unknown>)) if (Array.isArray(v)) m = Math.max(m, v.length); return m; }
  return 0;
};
const QUIET = /^\/(audit|today|dashboard|otp|auth)\b/;

export function bulkReadLog(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET' || QUIET.test(req.path)) return next();
  const json = res.json.bind(res);
  res.json = (body?: any) => {
    try { const n = biggest(body); if (n >= BULK_ROWS && res.statusCode < 400) audit(req.user, 'bulk.read', req.baseUrl.replace(/^\/api/, '') + req.path, null, `${n} rows`, req.ip || ''); } catch { /* never block the answer */ }
    return json(body);
  };
  next();
}

/** Who has read or exported how much data between two dates. "Unusual" = far above what most people read. */
export function downloadsReport(from?: string, to?: string) {
  const w = ["action IN ('bulk.read','export.students','backup.download') OR action LIKE 'cards.%'"], p: any[] = [];
  const range: string[] = []; if (from) { range.push('at >= ?'); p.push(from); } if (to) { range.push("at < date(?, '+1 day')"); p.push(to); }
  const where = `(${w[0]})${range.length ? ' AND ' + range.join(' AND ') : ''}`;
  const rows = db.prepare(`SELECT user_id, COALESCE(user_name, '(unknown)') AS user_name, role, action, entity, detail, at FROM audit_log WHERE ${where} ORDER BY id`).all(...p) as any[];
  const per = new Map<string, { user: string; role: string; events: number; rows: number; exports: number; backups: number; last: string; paths: Map<string, number> }>();
  for (const r of rows) {
    const k = String(r.user_id ?? r.user_name), n = Number(/^(\d+)/.exec(r.detail ?? '')?.[1] ?? 0);
    const u = per.get(k) ?? { user: r.user_name, role: r.role ?? '', events: 0, rows: 0, exports: 0, backups: 0, last: '', paths: new Map() };
    u.events++; u.rows += n; u.last = r.at;
    if (r.action === 'export.students' || r.action.startsWith('cards.')) u.exports++;
    if (r.action === 'backup.download') u.backups++;
    const path = r.action === 'bulk.read' ? r.entity : r.action; u.paths.set(path, (u.paths.get(path) ?? 0) + n);
    per.set(k, u);
  }
  const list = [...per.values()].map(u => ({ user: u.user, role: u.role, events: u.events, rows: u.rows, exports: u.exports, backups: u.backups, last: u.last, top: [...u.paths].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([path, rows]) => ({ path, rows })) }));
  const sorted = list.map(u => u.rows).sort((a, b) => a - b), median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  const threshold = Math.max(2000, median * 3);
  const users = list.map(u => ({ ...u, unusual: u.rows >= threshold || (u.backups > 0 && u.role !== "director") })).sort((a, b) => b.rows - a.rows);
  const daily = db.prepare(`SELECT substr(at,1,10) AS day, COUNT(*) AS events FROM audit_log WHERE ${where} GROUP BY day ORDER BY day`).all(...p);
  return { users, daily, totalRows: list.reduce((a, u) => a + u.rows, 0), threshold };
}
