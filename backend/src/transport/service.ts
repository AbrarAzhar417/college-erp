import { db } from '../db.js';
import { todayISO } from '../attendance/service.js';

export class TransportError extends Error {}
export const MODES = ['both', 'pickup', 'drop'];

/** The "Transport Fee" of the fee module: charged on the monthly voucher to students who use transport. */
export function transportHeadId(): number {
  const h = db.prepare("SELECT id FROM fee_heads WHERE lower(name) = 'transport fee'").get() as { id: number } | undefined;
  if (h) { db.prepare('UPDATE fee_heads SET active = 1 WHERE id = ?').run(h.id); return h.id; }
  const sort = (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM fee_heads').get() as any).n;
  return Number(db.prepare("INSERT INTO fee_heads (name, frequency, optional, concessionable, sort) VALUES ('Transport Fee', 'monthly', 1, 0, ?)").run(sort).lastInsertRowid);
}

export const feeFor = (route: any, stop: any, mode: string): number => {
  const both = stop?.fee_both ?? route.fee_both ?? 0;
  return mode === 'both' ? both : (stop?.fee_one ?? route.fee_one ?? both);
};

export function seats(routeId: number) {
  const used = (db.prepare("SELECT COUNT(*) AS n FROM students WHERE tr_route_id = ? AND status = 'active'").get(routeId) as any).n as number;
  const cap = (db.prepare('SELECT v.capacity AS n FROM tr_routes r LEFT JOIN tr_vehicles v ON v.id = r.vehicle_id WHERE r.id = ?').get(routeId) as any)?.n as number | null;
  return { used, capacity: cap ?? 0, left: cap ? cap - used : 0 };
}

/** Puts a student on a bus (or takes him off it) and keeps the monthly transport fee in step. */
export function assignTransport(studentId: number, routeId: number | null, stopId: number | null, mode?: string | null) {
  const head = transportHeadId();
  if (!routeId) {
    db.prepare('UPDATE students SET tr_route_id = NULL, tr_stop_id = NULL, tr_mode = NULL WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM student_heads WHERE student_id = ? AND head_id = ?').run(studentId, head);
    return { fee: 0, warning: null as string | null };
  }
  const route = db.prepare('SELECT * FROM tr_routes WHERE id = ? AND active = 1').get(routeId) as any;
  if (!route) throw new TransportError('Choose a bus route that is in use.');
  const stop = stopId ? db.prepare('SELECT * FROM tr_stops WHERE id = ? AND route_id = ?').get(stopId, routeId) as any : null;
  if (stopId && !stop) throw new TransportError('That stop does not belong to the chosen route.');
  const m = MODES.includes(String(mode)) ? String(mode) : 'both', fee = feeFor(route, stop, m);
  db.prepare('UPDATE students SET tr_route_id = ?, tr_stop_id = ?, tr_mode = ? WHERE id = ?').run(routeId, stop?.id ?? null, m, studentId);
  db.prepare('INSERT INTO student_heads (student_id, head_id, amount) VALUES (?,?,?) ON CONFLICT(student_id, head_id) DO UPDATE SET amount = excluded.amount').run(studentId, head, fee > 0 ? fee : null);
  const s = seats(routeId);
  return { fee, warning: s.capacity && s.used > s.capacity ? `${route.name} now has ${s.used} students for ${s.capacity} seats.` : null };
}

/** After a fee on a route or stop changes, every student on that route gets the new amount on the next voucher. */
export function syncRouteFees(routeId: number) {
  for (const s of db.prepare("SELECT id, tr_stop_id, tr_mode FROM students WHERE tr_route_id = ? AND status = 'active'").all(routeId) as any[]) assignTransport(s.id, routeId, s.tr_stop_id, s.tr_mode);
}

// ---------- reminders ----------
const daysLeft = (iso: string) => Math.round((Date.parse(iso) - Date.parse(todayISO())) / 86400000);
export interface Alert { level: 'expired' | 'soon' | 'warning'; text: string; days: number | null; link: string }
export function alerts(): Alert[] {
  const out: Alert[] = [], docs: [string, string][] = [['fitness_expiry', 'fitness certificate'], ['permit_expiry', 'route permit'], ['insurance_expiry', 'insurance'], ['tax_expiry', 'token tax'], ['next_service', 'service']];
  const lbl = (d: number) => (d < 0 ? `expired ${-d} day(s) ago` : d === 0 ? 'expires today' : `expires in ${d} day(s)`);
  for (const v of db.prepare('SELECT * FROM tr_vehicles WHERE active = 1').all() as any[]) {
    for (const [f, name] of docs) if (v[f]) { const d = daysLeft(v[f]); if (d <= 30) out.push({ level: d < 0 ? 'expired' : 'soon', text: `${v.number}: ${name} ${f === 'next_service' ? (d < 0 ? `was due ${-d} day(s) ago` : `due in ${d} day(s)`) : lbl(d)} (${v[f]})`, days: d, link: '/transport/vehicles' }); }
    if (!v.driver_id) out.push({ level: 'warning', text: `${v.number} has no driver`, days: null, link: '/transport/vehicles' });
  }
  for (const r of db.prepare('SELECT id, name, vehicle_id FROM tr_routes WHERE active = 1').all() as any[]) {
    if (!r.vehicle_id) { out.push({ level: 'warning', text: `${r.name} route has no bus`, days: null, link: `/transport/route/${r.id}` }); continue; }
    const s = seats(r.id); if (s.capacity && s.used > s.capacity) out.push({ level: 'warning', text: `${r.name}: ${s.used} students for ${s.capacity} seats`, days: null, link: `/transport/route/${r.id}` });
  }
  return out.sort((a, b) => (a.days ?? 999) - (b.days ?? 999));
}
