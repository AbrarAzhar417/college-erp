import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { isDate, todayISO } from '../attendance/service.js';
import { MODES, TransportError, alerts, assignTransport, seats, syncRouteFees, transportHeadId } from './service.js';

export const transportRouter = Router();
transportRouter.use(requireRole('director', 'principal', 'admin', 'accountant'));
const manage = requireRole('director', 'principal', 'admin');
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const t = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n) || null;
const num = (v: unknown) => (v === '' || v === null || v === undefined ? null : Math.max(0, Math.round(Number(v)) || 0));
const date = (v: unknown) => (isDate(v) ? String(v) : null);
const time = (v: unknown) => (/^\d{2}:\d{2}$/.test(String(v ?? '')) ? String(v) : null);
const run = (res: any, fn: () => any) => { try { res.json(fn()); } catch (e: any) { if (e instanceof TransportError) bad(res, e.message); else throw e; } };

const studentCols = `st.id, st.name, st.father_name, st.roll_no, st.reg_no, st.phone, st.father_phone, st.category, c.name AS class_name, s.name AS section_name, st.tr_route_id, st.tr_stop_id, st.tr_mode`;
const studentJoin = 'FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id';

// ---------- what the admission form needs ----------
transportRouter.get('/lookup', (_req, res) => {
  const routes = db.prepare(`SELECT r.id, r.name, r.area, r.morning_time, r.afternoon_time, r.fee_both, r.fee_one, v.number AS bus, v.capacity FROM tr_routes r LEFT JOIN tr_vehicles v ON v.id = r.vehicle_id WHERE r.active = 1 ORDER BY r.name`).all() as any[];
  res.json(routes.map(r => ({ ...r, used: seats(r.id).used, stops: db.prepare('SELECT id, name, pickup_time, drop_time, fee_both, fee_one FROM tr_stops WHERE route_id = ? ORDER BY sort, id').all(r.id) })));
});

// ---------- overview ----------
transportRouter.get('/overview', (_req, res) => {
  const head = transportHeadId();
  const routes = (db.prepare(`SELECT r.id, r.name, r.area, r.morning_time, r.afternoon_time, r.fee_both, v.number AS bus, v.capacity, d.name AS driver, d.phone AS driver_phone FROM tr_routes r
    LEFT JOIN tr_vehicles v ON v.id = r.vehicle_id LEFT JOIN tr_staff d ON d.id = v.driver_id WHERE r.active = 1 ORDER BY r.name`).all() as any[]).map(r => {
    const s = seats(r.id);
    return { ...r, used: s.used, stops: (db.prepare('SELECT COUNT(*) AS n FROM tr_stops WHERE route_id = ?').get(r.id) as any).n,
      monthly: (db.prepare(`SELECT COALESCE(SUM(sh.amount), 0) AS n FROM students st JOIN student_heads sh ON sh.student_id = st.id AND sh.head_id = ? WHERE st.tr_route_id = ? AND st.status = 'active'`).get(head, r.id) as any).n };
  });
  res.json({
    routes, alerts: alerts(),
    totals: { students: (db.prepare("SELECT COUNT(*) AS n FROM students WHERE tr_route_id IS NOT NULL AND status = 'active'").get() as any).n, active: (db.prepare("SELECT COUNT(*) AS n FROM students WHERE status = 'active'").get() as any).n,
      vehicles: (db.prepare('SELECT COUNT(*) AS n FROM tr_vehicles WHERE active = 1').get() as any).n, routes: routes.length, seats: routes.reduce((a, r) => a + (r.capacity ?? 0), 0), monthly: routes.reduce((a, r) => a + r.monthly, 0) }
  });
});

// ---------- drivers and conductors ----------
transportRouter.get('/staff', (_req, res) => res.json(db.prepare(`SELECT s.*, (SELECT GROUP_CONCAT(number) FROM tr_vehicles v WHERE v.driver_id = s.id OR v.conductor_id = s.id) AS vehicles FROM tr_staff s WHERE s.active = 1 ORDER BY s.role, s.name`).all()));
function staffBody(b: any) {
  const name = t(b?.name, 60); if (!name) return { error: 'Enter the name.' };
  if (!['driver', 'conductor'].includes(b?.role)) return { error: 'Choose driver or conductor.' };
  return { v: [name, b.role, t(b.phone, 20), t(b.cnic, 20), t(b.address, 120)] };
}
transportRouter.post('/staff', manage, (req, res) => { const s = staffBody(req.body); if (s.error) return bad(res, s.error); res.status(201).json({ id: Number(db.prepare('INSERT INTO tr_staff (name, role, phone, cnic, address) VALUES (?,?,?,?,?)').run(...s.v!).lastInsertRowid) }); });
transportRouter.put('/staff/:id', manage, (req, res) => { const s = staffBody(req.body); if (s.error) return bad(res, s.error); db.prepare('UPDATE tr_staff SET name=?, role=?, phone=?, cnic=?, address=? WHERE id=?').run(...s.v!, Number(req.params.id)); res.json({ ok: true }); });
transportRouter.delete('/staff/:id', manage, (req, res) => {
  const id = Number(req.params.id);
  db.transaction(() => { db.prepare('UPDATE tr_vehicles SET driver_id = NULL WHERE driver_id = ?').run(id); db.prepare('UPDATE tr_vehicles SET conductor_id = NULL WHERE conductor_id = ?').run(id); db.prepare('UPDATE tr_staff SET active = 0 WHERE id = ?').run(id); })();
  res.json({ ok: true });
});

// ---------- buses ----------
transportRouter.get('/vehicles', (_req, res) => res.json((db.prepare(`SELECT v.*, d.name AS driver, c.name AS conductor, r.id AS route_id, r.name AS route FROM tr_vehicles v LEFT JOIN tr_staff d ON d.id = v.driver_id LEFT JOIN tr_staff c ON c.id = v.conductor_id
  LEFT JOIN tr_routes r ON r.vehicle_id = v.id AND r.active = 1 WHERE v.active = 1 ORDER BY v.number`).all() as any[]).map(v => ({ ...v, used: v.route_id ? seats(v.route_id).used : 0 }))));
function vehicleBody(b: any) {
  const number = t(b?.number, 30), cap = Math.round(Number(b?.capacity));
  if (!number) return { error: 'Enter the bus name or number (like Bus 1).' };
  if (!(cap >= 1 && cap <= 200)) return { error: 'Enter the number of seats (1 to 200).' };
  return { v: [number, t(b.reg_no, 20), t(b.kind, 20) ?? 'bus', cap, t(b.make_model, 40), num(b.year), num(b.driver_id), num(b.conductor_id), date(b.fitness_expiry), date(b.permit_expiry), date(b.insurance_expiry), date(b.tax_expiry), date(b.next_service), t(b.notes, 200)] };
}
const VCOLS = 'number, reg_no, kind, capacity, make_model, year, driver_id, conductor_id, fitness_expiry, permit_expiry, insurance_expiry, tax_expiry, next_service, notes';
transportRouter.post('/vehicles', manage, (req, res) => {
  const v = vehicleBody(req.body); if (v.error) return bad(res, v.error);
  try { res.status(201).json({ id: Number(db.prepare(`INSERT INTO tr_vehicles (${VCOLS}) VALUES (${v.v!.map(() => '?').join(',')})`).run(...v.v!).lastInsertRowid) }); } catch { bad(res, 'A bus with this name already exists.', 409); }
});
transportRouter.put('/vehicles/:id', manage, (req, res) => {
  const v = vehicleBody(req.body); if (v.error) return bad(res, v.error);
  try { db.prepare(`UPDATE tr_vehicles SET ${VCOLS.split(', ').map(c => c + ' = ?').join(', ')} WHERE id = ?`).run(...v.v!, Number(req.params.id)); res.json({ ok: true }); } catch { bad(res, 'A bus with this name already exists.', 409); }
});
transportRouter.delete('/vehicles/:id', manage, (req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT 1 FROM tr_routes WHERE vehicle_id = ? AND active = 1').get(id)) return bad(res, 'This bus is on a route. Give that route another bus first.', 409);
  db.prepare('UPDATE tr_vehicles SET active = 0 WHERE id = ?').run(id); res.json({ ok: true });
});

// ---------- routes and stops ----------
transportRouter.get('/routes', (_req, res) => res.json((db.prepare(`SELECT r.*, v.number AS bus, v.capacity FROM tr_routes r LEFT JOIN tr_vehicles v ON v.id = r.vehicle_id WHERE r.active = 1 ORDER BY r.name`).all() as any[]).map(r => ({ ...r, used: seats(r.id).used }))));
function routeBody(b: any) {
  const name = t(b?.name, 60); if (!name) return { error: 'Enter the name of the route (like Model Town).' };
  return { v: [name, t(b.area, 120), num(b.vehicle_id), time(b.morning_time), time(b.afternoon_time), num(b.fee_both) ?? 0, num(b.fee_one), t(b.note, 200)] };
}
transportRouter.post('/routes', manage, (req, res) => {
  const r = routeBody(req.body); if (r.error) return bad(res, r.error);
  try { res.status(201).json({ id: Number(db.prepare('INSERT INTO tr_routes (name, area, vehicle_id, morning_time, afternoon_time, fee_both, fee_one, note) VALUES (?,?,?,?,?,?,?,?)').run(...r.v!).lastInsertRowid) }); } catch { bad(res, 'A route with this name already exists.', 409); }
});
transportRouter.put('/routes/:id', manage, (req, res) => {
  const r = routeBody(req.body), id = Number(req.params.id); if (r.error) return bad(res, r.error);
  try {
    db.transaction(() => { db.prepare('UPDATE tr_routes SET name=?, area=?, vehicle_id=?, morning_time=?, afternoon_time=?, fee_both=?, fee_one=?, note=? WHERE id=?').run(...r.v!, id); syncRouteFees(id); })();
    res.json({ ok: true });
  } catch (e: any) { e instanceof TransportError ? bad(res, e.message) : bad(res, 'A route with this name already exists.', 409); }
});
transportRouter.delete('/routes/:id', manage, (req, res) => {
  const id = Number(req.params.id);
  if (seats(id).used) return bad(res, 'Students are still on this route. Move them to another bus first.', 409);
  db.prepare('DELETE FROM tr_routes WHERE id = ?').run(id); res.json({ ok: true });
});

function stopBody(b: any) { const name = t(b?.name, 60); return name ? { v: [name, time(b.pickup_time), time(b.drop_time), num(b.fee_both), num(b.fee_one)] } : { error: 'Enter the name of the stop.' }; }
transportRouter.post('/routes/:id/stops', manage, (req, res) => {
  const s = stopBody(req.body); if (s.error) return bad(res, s.error);
  const rid = Number(req.params.id), sort = (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM tr_stops WHERE route_id = ?').get(rid) as any).n;
  res.status(201).json({ id: Number(db.prepare('INSERT INTO tr_stops (route_id, name, sort, pickup_time, drop_time, fee_both, fee_one) VALUES (?,?,?,?,?,?,?)').run(rid, s.v![0], sort, s.v![1], s.v![2], s.v![3], s.v![4]).lastInsertRowid) });
});
transportRouter.put('/stops/:id', manage, (req, res) => {
  const s = stopBody(req.body); if (s.error) return bad(res, s.error);
  const id = Number(req.params.id), st = db.prepare('SELECT route_id FROM tr_stops WHERE id = ?').get(id) as any; if (!st) return bad(res, 'Stop not found.', 404);
  db.transaction(() => { db.prepare('UPDATE tr_stops SET name = ?, pickup_time = ?, drop_time = ?, fee_both = ?, fee_one = ?, sort = COALESCE(?, sort) WHERE id = ?').run(...s.v!, num(req.body?.sort), id); syncRouteFees(st.route_id); })();
  res.json({ ok: true });
});
transportRouter.delete('/stops/:id', manage, (req, res) => {
  const id = Number(req.params.id), st = db.prepare('SELECT route_id FROM tr_stops WHERE id = ?').get(id) as any; if (!st) return bad(res, 'Stop not found.', 404);
  db.transaction(() => { db.prepare('UPDATE students SET tr_stop_id = NULL WHERE tr_stop_id = ?').run(id); db.prepare('DELETE FROM tr_stops WHERE id = ?').run(id); syncRouteFees(st.route_id); })();
  res.json({ ok: true });
});

/** The page of one bus: who rides it, stop by stop. */
transportRouter.get('/routes/:id', (req, res) => {
  const id = Number(req.params.id), r = db.prepare('SELECT * FROM tr_routes WHERE id = ?').get(id) as any; if (!r) return bad(res, 'Route not found.', 404);
  const vehicle = r.vehicle_id ? db.prepare(`SELECT v.*, d.name AS driver, d.phone AS driver_phone, c.name AS conductor, c.phone AS conductor_phone FROM tr_vehicles v LEFT JOIN tr_staff d ON d.id = v.driver_id LEFT JOIN tr_staff c ON c.id = v.conductor_id WHERE v.id = ?`).get(r.vehicle_id) : null;
  const head = transportHeadId();
  const students = (db.prepare(`SELECT ${studentCols}, COALESCE(sh.amount, 0) AS fee, (SELECT COALESCE(SUM(amount), 0) FROM ledger WHERE student_id = st.id) AS dues
    ${studentJoin} LEFT JOIN student_heads sh ON sh.student_id = st.id AND sh.head_id = ? WHERE st.tr_route_id = ? AND st.status = 'active' ORDER BY c.grade, s.name, st.roll_no`).all(head, id) as any[]).map(s => ({ ...s, dues: Math.max(0, s.dues) }));
  const stops = (db.prepare('SELECT * FROM tr_stops WHERE route_id = ? ORDER BY sort, id').all(id) as any[]).map(s => ({ ...s, students: students.filter(x => x.tr_stop_id === s.id) }));
  const s = seats(id);
  res.json({ route: r, vehicle, stops, noStop: students.filter(x => !x.tr_stop_id || !stops.some(p => p.id === x.tr_stop_id)),
    totals: { students: students.length, capacity: s.capacity, left: s.left, monthly: students.reduce((a, x) => a + x.fee, 0), dues: students.reduce((a, x) => a + x.dues, 0) } });
});

// ---------- students on buses ----------
transportRouter.get('/students', (req, res) => {
  const q = req.query as Record<string, string | undefined>, where = ["st.status = 'active'", 'st.tr_route_id IS NOT NULL']; const p: any[] = [transportHeadId()];
  if (q.routeId) { where.push('st.tr_route_id = ?'); p.push(Number(q.routeId)); }
  if (q.classId) { where.push('c.id = ?'); p.push(Number(q.classId)); }
  if (q.q?.trim()) { where.push('(st.name LIKE ? OR st.father_name LIKE ? OR st.reg_no LIKE ? OR CAST(st.roll_no AS TEXT) = ?)'); const l = `%${q.q.trim()}%`; p.push(l, l, l, q.q.trim()); }
  res.json(db.prepare(`SELECT ${studentCols}, r.name AS route, v.number AS bus, sp.name AS stop, COALESCE(sh.amount, 0) AS fee FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
    JOIN tr_routes r ON r.id = st.tr_route_id LEFT JOIN tr_vehicles v ON v.id = r.vehicle_id LEFT JOIN tr_stops sp ON sp.id = st.tr_stop_id LEFT JOIN student_heads sh ON sh.student_id = st.id AND sh.head_id = ?
    WHERE ${where.join(' AND ')} ORDER BY r.name, sp.sort, c.grade, s.name, st.roll_no LIMIT 1500`).all(...p));
});
transportRouter.get('/students/search', manage, (req, res) => {
  const q = String(req.query.q ?? '').trim(); if (!q) return res.json([]);
  const l = `%${q}%`;
  res.json(db.prepare(`SELECT ${studentCols}, (SELECT name FROM tr_routes WHERE id = st.tr_route_id) AS route ${studentJoin} WHERE st.status = 'active' AND (st.name LIKE ? OR st.father_name LIKE ? OR st.reg_no LIKE ? OR CAST(st.roll_no AS TEXT) = ?) ORDER BY st.name LIMIT 12`).all(l, l, l, q));
});
transportRouter.post('/assign', manage, (req, res) => {
  const b = req.body ?? {};
  if (!db.prepare("SELECT 1 FROM students WHERE id = ? AND status = 'active'").get(Number(b.student_id))) return bad(res, 'Choose a student.');
  if (b.mode && !MODES.includes(b.mode)) return bad(res, 'Choose pick and drop, pick only or drop only.');
  run(res, () => db.transaction(() => assignTransport(Number(b.student_id), b.route_id ? Number(b.route_id) : null, b.stop_id ? Number(b.stop_id) : null, b.mode))());
});
/** Everybody (or the chosen students) of one bus moves to another, for example when a bus breaks down. */
transportRouter.post('/assign/move', manage, (req, res) => {
  const from = Number(req.body?.from_route_id), to = Number(req.body?.to_route_id);
  if (!from || !to || from === to) return bad(res, 'Choose two different routes.');
  const ids = Array.isArray(req.body?.student_ids) && req.body.student_ids.length ? req.body.student_ids.map(Number) : (db.prepare("SELECT id FROM students WHERE tr_route_id = ? AND status = 'active'").all(from) as any[]).map(r => r.id);
  run(res, () => db.transaction(() => { let n = 0; for (const id of ids) { const s = db.prepare('SELECT tr_mode FROM students WHERE id = ? AND tr_route_id = ?').get(id, from) as any; if (!s) continue; assignTransport(id, to, null, s.tr_mode); n++; } return { moved: n, seats: seats(to) }; })());
});

// ---------- who boarded ----------
transportRouter.get('/boarding', (req, res) => {
  const routeId = Number(req.query.routeId), d = isDate(req.query.date) ? String(req.query.date) : todayISO(), trip = req.query.trip === 'afternoon' ? 'afternoon' : 'morning';
  if (!db.prepare('SELECT 1 FROM tr_routes WHERE id = ?').get(routeId)) return bad(res, 'Choose a route.', 404);
  const modes = trip === 'morning' ? "('both','pickup')" : "('both','drop')";
  const marks = new Map((db.prepare('SELECT student_id, status FROM tr_boarding WHERE route_id = ? AND date = ? AND trip = ?').all(routeId, d, trip) as any[]).map(m => [m.student_id, m.status]));
  const absent = new Set((db.prepare("SELECT student_id FROM att_daily WHERE date = ? AND status IN ('A','L')").all(d) as any[]).map(r => r.student_id));
  res.json({ date: d, trip, students: (db.prepare(`SELECT ${studentCols}, sp.name AS stop ${studentJoin} LEFT JOIN tr_stops sp ON sp.id = st.tr_stop_id WHERE st.tr_route_id = ? AND st.status = 'active' AND st.tr_mode IN ${modes} ORDER BY COALESCE(sp.sort, 999), c.grade, s.name, st.roll_no`).all(routeId) as any[])
    .map(s => ({ ...s, status: marks.get(s.id) ?? null, absentFromSchool: absent.has(s.id) })), marked: marks.size > 0 });
});
transportRouter.post('/boarding', manage, (req, res) => {
  const { route_id, date: d, trip, entries } = req.body ?? {};
  if (!isDate(d) || d > todayISO()) return bad(res, 'Choose today or an earlier date.');
  if (!['morning', 'afternoon'].includes(trip)) return bad(res, 'Choose morning or afternoon.');
  const valid = new Set((db.prepare("SELECT id FROM students WHERE tr_route_id = ? AND status = 'active'").all(Number(route_id)) as any[]).map(r => r.id));
  const list = (Array.isArray(entries) ? entries : []).filter((e: any) => valid.has(e.student_id) && ['boarded', 'absent'].includes(e.status));
  if (!list.length) return bad(res, 'There are no students to save.');
  db.transaction(() => { for (const e of list) db.prepare(`INSERT INTO tr_boarding (route_id, student_id, date, trip, status, marked_by) VALUES (?,?,?,?,?,?) ON CONFLICT(student_id, date, trip) DO UPDATE SET status = excluded.status, route_id = excluded.route_id, marked_by = excluded.marked_by`).run(Number(route_id), e.student_id, d, trip, e.status, req.user!.id); })();
  res.json({ saved: list.length });
});

// ---------- seats, fee income and who came on each bus ----------
transportRouter.get('/report', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : todayISO().slice(0, 7), head = transportHeadId();
  const rows = (db.prepare(`SELECT r.id, r.name, r.vehicle_id, v.number AS bus, v.capacity FROM tr_routes r LEFT JOIN tr_vehicles v ON v.id = r.vehicle_id WHERE r.active = 1 ORDER BY r.name`).all() as any[]).map(r => {
    const students = seats(r.id).used, income = (db.prepare(`SELECT COALESCE(SUM(sh.amount), 0) AS n FROM students st JOIN student_heads sh ON sh.student_id = st.id AND sh.head_id = ? WHERE st.tr_route_id = ? AND st.status = 'active'`).get(head, r.id) as any).n;
    const trips = (db.prepare("SELECT COUNT(*) AS n, SUM(status = 'boarded') AS b FROM tr_boarding WHERE route_id = ? AND substr(date, 1, 7) = ?").get(r.id, month) as any);
    return { ...r, students, income, boardedPct: trips.n ? Math.round((trips.b / trips.n) * 1000) / 10 : null, fill: r.capacity ? Math.round((students / r.capacity) * 100) : null };
  });
  res.json({ month, rows, totals: { students: rows.reduce((a, r) => a + r.students, 0), income: rows.reduce((a, r) => a + r.income, 0) } });
});
