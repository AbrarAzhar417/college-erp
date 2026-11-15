import express, { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, setSetting } from '../db.js';
import { requireRole } from '../auth.js';
import { dayInfo, isDate, isMonth, monthDays, todayISO } from '../attendance/service.js';
import {
  ATT_STATUSES, DEPARTMENT_OF, EMPLOYMENT, FILE_DIR, HrError, MANAGE, PAY, SALARY_FIELDS, STAFF_TYPES, applyLeaveToRegister, canSeePay, date, deleteFileRow, generatePayroll,
  hrConfig, importExisting, int, kindOfType, leaveBalances, leaveDays, monthFigures, nextEmpNo, payrollStaff, removeLeaveFromRegister, syncLinked, t
} from './service.js';
import { leaveCover } from '../timetable/extras.js';
import { indexCandidateCv, recruitRouter } from './recruit.js';

export const hrRouter = Router();
const manage = requireRole(...MANAGE);
const leadership = requireRole('director', 'principal');
const pay = requireRole(...PAY);
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const wrap = (res: any, fn: () => any) => { try { res.json(fn()); } catch (e: any) { if (e instanceof HrError) bad(res, e.message); else throw e; } };
const staffRow = (id: number) => db.prepare('SELECT * FROM hr_staff WHERE id = ?').get(id) as any;
const stripPay = (s: any, role: string) => { if (canSeePay(role)) return s; const o = { ...s }; for (const f of SALARY_FIELDS) delete o[f]; delete o.bank_name; delete o.account_no; return o; };
const myStaff = (userId: number) => db.prepare('SELECT * FROM hr_staff WHERE user_id = ?').get(userId) as any;

// =====================================================================
// lookups and overview
// =====================================================================
hrRouter.get('/lookup', manage, (_req, res) => res.json({
  departments: db.prepare('SELECT name FROM hr_departments ORDER BY name').all().map((r: any) => r.name),
  designations: db.prepare('SELECT name FROM hr_designations ORDER BY name').all().map((r: any) => r.name),
  leaveTypes: db.prepare('SELECT * FROM hr_leave_types WHERE active = 1 ORDER BY id').all(),
  config: hrConfig()
}));

hrRouter.get('/overview', requireRole('director', 'principal', 'admin'), (req, res) => {
  const today = todayISO(), role = req.user!.role, cfg = hrConfig();
  const active = db.prepare("SELECT staff_type, COUNT(*) AS n FROM hr_staff WHERE status = 'active' GROUP BY staff_type").all() as any[];
  const byStatus: Record<string, number> = { P: 0, LT: 0, A: 0, L: 0, HD: 0 };
  for (const r of db.prepare("SELECT a.status, COUNT(*) AS n FROM hr_att a JOIN hr_staff s ON s.id = a.staff_id WHERE a.date = ? AND s.status = 'active' GROUP BY a.status").all(today) as any[]) byStatus[r.status] = r.n;
  const total = active.reduce((a, r) => a + r.n, 0);
  const marked = Object.values(byStatus).reduce((a, n) => a + n, 0);
  const alerts: { level: 'expired' | 'soon'; text: string; days: number; link: string }[] = [];
  const addAlert = (text: string, iso: string | null, link: string) => {
    if (!iso) return;
    const d = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
    if (d <= cfg.contract_alert_days) alerts.push({ level: d < 0 ? 'expired' : 'soon', text, days: d, link });
  };
  for (const s of db.prepare("SELECT id, name, employment, contract_end, license_expiry, designation FROM hr_staff WHERE status = 'active'").all() as any[]) {
    if (s.contract_end) addAlert(`${s.name}: ${s.employment === 'probation' ? 'probation' : 'contract'} ends ${s.contract_end}`, s.contract_end, `/hr/staff/${s.id}`);
    if (s.license_expiry) addAlert(`${s.name}: driving licence expires ${s.license_expiry}`, s.license_expiry, `/hr/staff/${s.id}`);
  }
  for (const f of db.prepare("SELECT f.expires, f.label, f.name, s.id, s.name AS staff FROM hr_files f JOIN hr_staff s ON s.id = f.owner_id WHERE f.owner_type = 'staff' AND f.expires IS NOT NULL AND s.status = 'active'").all() as any[]) addAlert(`${f.staff}: ${f.label || f.name} expires ${f.expires}`, f.expires, `/hr/staff/${f.id}`);
  alerts.sort((a, b) => a.days - b.days);
  const out: any = {
    total, byType: Object.fromEntries(active.map(r => [r.staff_type, r.n])), today: { ...byStatus, unmarked: Math.max(0, total - marked) },
    pendingLeaves: (db.prepare("SELECT COUNT(*) AS n FROM hr_leaves WHERE status = 'pending'").get() as any).n, alerts,
    recruitment: {
      openJobs: (db.prepare("SELECT COUNT(*) AS n FROM hr_jobs WHERE status = 'open'").get() as any).n,
      stages: Object.fromEntries((db.prepare("SELECT stage, COUNT(*) AS n FROM hr_candidates GROUP BY stage").all() as any[]).map(r => [r.stage, r.n])),
      interviewsToday: (db.prepare("SELECT COUNT(*) AS n FROM hr_interviews WHERE date = ? AND status = 'scheduled'").get(today) as any).n
    }
  };
  if (canSeePay(role)) {
    const m = today.slice(0, 7);
    out.payroll = db.prepare("SELECT COUNT(*) AS staff, COALESCE(SUM(net), 0) AS net, SUM(status = 'paid') AS paid, SUM(status = 'approved') AS approved FROM hr_payslips WHERE month = ?").get(m);
  }
  res.json(out);
});

// =====================================================================
// staff
// =====================================================================
hrRouter.get('/staff', manage, (req, res) => {
  const { status = 'active', type, q } = req.query as Record<string, string>;
  const where: string[] = [], args: any[] = [];
  if (status === 'active') where.push("status = 'active'"); else if (status === 'former') where.push("status != 'active'");
  if (type && STAFF_TYPES.includes(type)) { where.push('staff_type = ?'); args.push(type); }
  if (q?.trim()) { where.push('(name LIKE ? OR emp_no LIKE ? OR cnic LIKE ? OR phone LIKE ?)'); const l = `%${q.trim()}%`; args.push(l, l, l, l); }
  const rows = db.prepare(`SELECT * FROM hr_staff ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY status, name LIMIT 500`).all(...args) as any[];
  res.json(rows.map(r => stripPay(r, req.user!.role)));
});

function staffBody(b: any, role: string, existing?: any): { error?: string; v?: Record<string, any> } {
  const name = t(b?.name, 80); if (!name) return { error: 'Enter the name.' };
  const type = STAFF_TYPES.includes(b?.staff_type) ? b.staff_type : null; if (!type) return { error: 'Choose the staff type.' };
  const employment = EMPLOYMENT.includes(b?.employment) ? b.employment : 'permanent';
  let photo: string | null | undefined = undefined;
  if (b?.photo === null || b?.photo === '') photo = null;
  else if (typeof b?.photo === 'string' && b.photo.startsWith('data:')) {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.photo)) return { error: 'The photo must be a PNG, JPG or WEBP picture.' };
    if (b.photo.length > 120_000) return { error: 'The photo is too big.' };
    photo = b.photo;
  }
  const v: Record<string, any> = {
    name, father_name: t(b.father_name, 80), gender: ['male', 'female'].includes(b.gender) ? b.gender : null, cnic: t(b.cnic, 20), dob: date(b.dob), phone: t(b.phone, 20), email: t(b.email, 80), address: t(b.address, 160),
    emergency_name: t(b.emergency_name, 80), emergency_phone: t(b.emergency_phone, 20), qualification: t(b.qualification, 120),
    staff_type: type, kind: kindOfType(type), department: t(b.department, 60) ?? DEPARTMENT_OF[type], designation: t(b.designation, 60),
    employment, joining_date: date(b.joining_date), contract_end: date(b.contract_end), license_no: t(b.license_no, 30), license_expiry: date(b.license_expiry)
  };
  if (photo !== undefined) v.photo = photo;
  for (const f of SALARY_FIELDS) v[f] = canSeePay(role) ? int(b[f]) : (existing?.[f] ?? 0);
  if (canSeePay(role)) { v.bank_name = t(b.bank_name, 60); v.account_no = t(b.account_no, 40); }
  return { v };
}

hrRouter.post('/staff', manage, (req, res) => {
  const s = staffBody(req.body, req.user!.role); if (s.error) return bad(res, s.error);
  const v = s.v!;
  const id = db.transaction(() => {
    const cols = Object.keys(v);
    const newId = Number(db.prepare(`INSERT INTO hr_staff (emp_no, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(nextEmpNo(), ...cols.map(c => v[c])).lastInsertRowid);
    syncLinked(newId);
    return newId;
  })();
  res.status(201).json({ id });
});

hrRouter.get('/staff/:id', manage, (req, res) => {
  const s = staffRow(Number(req.params.id)); if (!s) return bad(res, 'Staff member not found.', 404);
  res.json({
    staff: stripPay(s, req.user!.role),
    files: db.prepare("SELECT id, label, name, mime, size, expires, created_at FROM hr_files WHERE owner_type = 'staff' AND owner_id = ? ORDER BY id").all(s.id),
    balances: leaveBalances(s.id),
    leaves: db.prepare('SELECT l.*, lt.name AS type FROM hr_leaves l JOIN hr_leave_types lt ON lt.id = l.type_id WHERE l.staff_id = ? ORDER BY l.from_date DESC LIMIT 20').all(s.id),
    month: attendanceSummary(s, todayISO().slice(0, 7)),
    login: s.user_id ? db.prepare('SELECT username, role, active FROM users WHERE id = ?').get(s.user_id) : null
  });
});

hrRouter.put('/staff/:id', manage, (req, res) => {
  const id = Number(req.params.id), ex = staffRow(id); if (!ex) return bad(res, 'Staff member not found.', 404);
  const s = staffBody(req.body, req.user!.role, ex); if (s.error) return bad(res, s.error);
  const v = s.v!, cols = Object.keys(v);
  db.transaction(() => { db.prepare(`UPDATE hr_staff SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).run(...cols.map(c => v[c]), id); syncLinked(id); })();
  res.json({ ok: true });
});

hrRouter.post('/staff/:id/exit', manage, (req, res) => {
  const id = Number(req.params.id), s = staffRow(id); if (!s) return bad(res, 'Staff member not found.', 404);
  const status = req.body?.status === 'resigned' ? 'resigned' : 'left', when = date(req.body?.date) ?? todayISO();
  db.transaction(() => {
    db.prepare('UPDATE hr_staff SET status = ?, left_date = ?, left_reason = ? WHERE id = ?').run(status, when, t(req.body?.reason, 200), id);
    syncLinked(id);
    if (s.user_id) db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(s.user_id);
    if (s.tr_staff_id) { db.prepare('UPDATE tr_vehicles SET driver_id = NULL WHERE driver_id = ?').run(s.tr_staff_id); db.prepare('UPDATE tr_vehicles SET conductor_id = NULL WHERE conductor_id = ?').run(s.tr_staff_id); }
  })();
  res.json({ ok: true });
});

hrRouter.post('/staff/:id/rejoin', manage, (req, res) => {
  const id = Number(req.params.id), s = staffRow(id); if (!s) return bad(res, 'Staff member not found.', 404);
  db.transaction(() => {
    db.prepare("UPDATE hr_staff SET status = 'active', left_date = NULL, left_reason = NULL WHERE id = ?").run(id);
    syncLinked(id);
    if (s.user_id) db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(s.user_id);
  })();
  res.json({ ok: true });
});

hrRouter.post('/staff/:id/login', leadership, (req, res) => {
  const id = Number(req.params.id), s = staffRow(id); if (!s) return bad(res, 'Staff member not found.', 404);
  if (s.user_id) return bad(res, 'This person already has a login.', 409);
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return bad(res, 'Username: 3 to 30 letters or numbers (no spaces).');
  const role = ['teacher', 'admin', 'accountant'].includes(req.body?.role) ? req.body.role : 'teacher';
  const password = String(req.body?.password ?? '') || 'ChangeMe@123';
  if (password.length < 8) return bad(res, 'Password must be at least 8 characters.');
  try {
    db.transaction(() => {
      const uid = Number(db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,?)').run(s.name, username, bcrypt.hashSync(password, 10), role).lastInsertRowid);
      db.prepare('UPDATE hr_staff SET user_id = ? WHERE id = ?').run(uid, id);
      if (s.teacher_id) db.prepare('UPDATE teachers SET user_id = ? WHERE id = ?').run(uid, s.teacher_id);
    })();
  } catch { return bad(res, 'This username is already taken.', 409); }
  res.status(201).json({ username, password });
});

hrRouter.post('/import-existing', manage, (_req, res) => res.json(importExisting()));

// =====================================================================
// documents (CNIC copy, degree, contract ...) - files live in data/hr_files
// =====================================================================
const EXT_MIME: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

hrRouter.post('/files/:type/:id', manage, express.raw({ type: () => true, limit: '9mb' }), async (req, res) => {
  const type = req.params.type, id = Number(req.params.id);
  if (!['staff', 'candidate'].includes(type)) return bad(res, 'Unknown owner.');
  if (!db.prepare(`SELECT 1 FROM ${type === 'staff' ? 'hr_staff' : 'hr_candidates'} WHERE id = ?`).get(id)) return bad(res, 'Record not found.', 404);
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !body.length) return bad(res, 'Choose a file first.');
  const name = (t(req.query.name, 120) ?? 'file').replace(/[\\/:*?"<>|]/g, '_');
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (!EXT_MIME[ext]) return bad(res, 'Only PDF, Word (doc, docx), JPG and PNG files are allowed.');
  const stored = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(FILE_DIR, stored), body);
  const fid = Number(db.prepare('INSERT INTO hr_files (owner_type, owner_id, label, name, stored, mime, size, expires) VALUES (?,?,?,?,?,?,?,?)').run(type, id, t(req.query.label, 40), name, stored, EXT_MIME[ext], body.length, date(req.query.expires)).lastInsertRowid);
  if (type === 'candidate') await indexCandidateCv(id, body, ext).catch(() => 0);
  res.status(201).json({ id: fid });
});

hrRouter.get('/files/:id', manage, (req, res) => {
  const f = db.prepare('SELECT * FROM hr_files WHERE id = ?').get(Number(req.params.id)) as any;
  const file = f && path.join(FILE_DIR, f.stored);
  if (!f || !fs.existsSync(file)) return bad(res, 'File not found.', 404);
  res.set({ 'Content-Type': f.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=60' });
  res.send(fs.readFileSync(file));
});

hrRouter.delete('/files/:id', manage, (req, res) => { deleteFileRow(Number(req.params.id)); res.json({ ok: true }); });

// =====================================================================
// attendance
// =====================================================================
function attendanceSummary(s: any, month: string) {
  const f = monthFigures(s, month);
  const c = { P: 0, LT: 0, A: 0, L: 0, HD: 0 } as Record<string, number>;
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM hr_att WHERE staff_id = ? AND date BETWEEN ? AND ? GROUP BY status').all(s.id, `${month}-01`, `${month}-31`) as any[]) c[r.status] = r.n;
  return { month, working_days: f.working_days, ...c, unmarked: f.unmarked };
}

hrRouter.get('/attendance', manage, (req, res) => {
  const d = isDate(req.query.date) ? String(req.query.date) : todayISO();
  const info = dayInfo(d);
  const rows = db.prepare(`SELECT s.id, s.emp_no, s.name, s.designation, s.staff_type, s.photo, a.status, a.note, a.time_in, a.time_out, a.leave_id
    FROM hr_staff s LEFT JOIN hr_att a ON a.staff_id = s.id AND a.date = ?
    WHERE s.status = 'active' AND (s.joining_date IS NULL OR s.joining_date <= ?) ORDER BY s.kind, s.name`).all(d, d);
  res.json({ date: d, working: info.working, off: info.off, holiday: info.holiday, late_after: hrConfig().late_after, rows });
});

hrRouter.put('/attendance', manage, (req, res) => {
  const d = req.body?.date;
  if (!isDate(d)) return bad(res, 'Choose the date.');
  if (d > todayISO()) return bad(res, 'You cannot mark attendance for a future day.');
  const marks = Array.isArray(req.body?.marks) ? req.body.marks : [];
  const late = hrConfig().late_after;
  const up = db.prepare(`INSERT INTO hr_att (staff_id, date, status, note, time_in, time_out, leave_id, marked_by) VALUES (?,?,?,?,?,?,NULL,?)
    ON CONFLICT(staff_id, date) DO UPDATE SET status = excluded.status, note = excluded.note, time_in = excluded.time_in, time_out = excluded.time_out, leave_id = NULL, marked_by = excluded.marked_by, marked_at = datetime('now')`);
  const ok = db.prepare("SELECT 1 FROM hr_staff WHERE id = ? AND status = 'active'");
  let n = 0;
  db.transaction(() => {
    for (const m of marks) {
      if (!ATT_STATUSES.includes(m?.status) || !ok.get(Number(m.staff_id))) continue;
      const tin = /^\d{2}:\d{2}$/.test(m.time_in ?? '') ? m.time_in : null, tout = /^\d{2}:\d{2}$/.test(m.time_out ?? '') ? m.time_out : null;
      const status = m.status === 'P' && tin && tin > late ? 'LT' : m.status;   // arriving after the late time counts as late
      up.run(Number(m.staff_id), d, status, t(m.note, 120), tin, tout, req.user!.id); n++;
    }
  })();
  res.json({ saved: n });
});

hrRouter.get('/attendance/month', manage, (req, res) => {
  const month = isMonth(req.query.month) ? String(req.query.month) : todayISO().slice(0, 7);
  const days = monthDays(month);
  const staff = payrollStaff(month);
  const marks = new Map<number, Record<string, string>>();
  for (const r of db.prepare('SELECT staff_id, date, status FROM hr_att WHERE date BETWEEN ? AND ?').all(`${month}-01`, `${month}-31`) as any[]) { if (!marks.has(r.staff_id)) marks.set(r.staff_id, {}); marks.get(r.staff_id)![r.date] = r.status; }
  res.json({
    month, days,
    rows: staff.map(s => { const m = marks.get(s.id) ?? {}; const c: Record<string, number> = { P: 0, LT: 0, A: 0, L: 0, HD: 0 }; for (const v of Object.values(m)) c[v]++; return { id: s.id, emp_no: s.emp_no, name: s.name, designation: s.designation, marks: m, totals: c }; })
  });
});

// =====================================================================
// leaves
// =====================================================================
function createLeave(staffId: number, b: any, userId: number) {
  const type = db.prepare('SELECT * FROM hr_leave_types WHERE id = ? AND active = 1').get(Number(b?.type_id)) as any;
  if (!type) throw new HrError('Choose the leave type.');
  if (!isDate(b?.from_date) || !isDate(b?.to_date) || b.to_date < b.from_date) throw new HrError('Choose the dates (the last day cannot be before the first).');
  const days = leaveDays(b.from_date, b.to_date);
  if (!days) throw new HrError('There is no working day between these dates (they are holidays or off days).');
  if (db.prepare("SELECT 1 FROM hr_leaves WHERE staff_id = ? AND status IN ('pending','approved') AND from_date <= ? AND to_date >= ?").get(staffId, b.to_date, b.from_date)) throw new HrError('This staff member already has a leave on these dates.');
  return Number(db.prepare('INSERT INTO hr_leaves (staff_id, type_id, from_date, to_date, days, reason, applied_by) VALUES (?,?,?,?,?,?,?)').run(staffId, type.id, b.from_date, b.to_date, days, t(b.reason, 200), userId).lastInsertRowid);
}

hrRouter.get('/leaves', manage, (req, res) => {
  const { status, staff_id } = req.query as Record<string, string>;
  const where: string[] = [], args: any[] = [];
  if (['pending', 'approved', 'rejected'].includes(status)) { where.push('l.status = ?'); args.push(status); }
  if (staff_id) { where.push('l.staff_id = ?'); args.push(Number(staff_id)); }
  const rows = (db.prepare(`SELECT l.*, s.name, s.emp_no, s.designation, lt.name AS type, lt.paid, lt.yearly_quota FROM hr_leaves l JOIN hr_staff s ON s.id = l.staff_id JOIN hr_leave_types lt ON lt.id = l.type_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (l.status = 'pending') DESC, l.from_date DESC LIMIT 300`).all(...args) as any[]).map(r => {
    const bal = leaveBalances(r.staff_id, r.from_date.slice(0, 4)).find(b => b.type_id === r.type_id);
    return { ...r, balance_left: bal?.left ?? null };
  });
  res.json(rows);
});

hrRouter.post('/leaves', manage, (req, res) => {
  const sid = Number(req.body?.staff_id);
  if (!staffRow(sid)) return bad(res, 'Choose the staff member.');
  wrap(res, () => ({ id: createLeave(sid, req.body, req.user!.id) }));
});

hrRouter.put('/leaves/:id/decision', leadership, (req, res) => {
  const id = Number(req.params.id), l = db.prepare('SELECT * FROM hr_leaves WHERE id = ?').get(id) as any;
  if (!l) return bad(res, 'Leave not found.', 404);
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) return bad(res, 'Choose approve or reject.');
  db.transaction(() => {
    db.prepare("UPDATE hr_leaves SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(status, req.user!.id, id);
    removeLeaveFromRegister(id);
    if (status === 'approved') applyLeaveToRegister(id, req.user!.id);
  })();
  // Tell the person who approved how many lessons of that teacher now have no replacement.
  res.json({ ok: true, cover: status === 'approved' ? leaveCover(l.staff_id, l.from_date, l.to_date) : null });
});

hrRouter.delete('/leaves/:id', manage, (req, res) => {
  const id = Number(req.params.id), l = db.prepare('SELECT status FROM hr_leaves WHERE id = ?').get(id) as any;
  if (!l) return bad(res, 'Leave not found.', 404);
  if (l.status !== 'pending') return bad(res, 'Only a leave that is still waiting can be cancelled.');
  db.prepare('DELETE FROM hr_leaves WHERE id = ?').run(id);
  res.json({ ok: true });
});

// =====================================================================
// payroll
// =====================================================================
const slipCols = `p.*, s.name, s.emp_no, s.designation, s.department, s.kind, s.staff_type, s.cnic, s.joining_date`;

/** What the bank needs to pay the salaries: one row per approved or paid payslip. */
hrRouter.get('/payroll/bank', pay, (req, res) => {
  const month = isMonth(req.query.month) ? String(req.query.month) : todayISO().slice(0, 7);
  const rows = db.prepare(`SELECT s.emp_no, s.name, s.cnic, s.bank_name, s.account_no, p.net, p.status FROM hr_payslips p JOIN hr_staff s ON s.id = p.staff_id WHERE p.month = ? AND p.status IN ('approved','paid') AND p.net > 0 ORDER BY s.name`).all(month);
  res.json({ month, rows });
});

hrRouter.get('/payroll', pay, (req, res) => {
  const month = isMonth(req.query.month) ? String(req.query.month) : todayISO().slice(0, 7);
  const rows = db.prepare(`SELECT ${slipCols} FROM hr_payslips p JOIN hr_staff s ON s.id = p.staff_id WHERE p.month = ? ORDER BY s.kind, s.name`).all(month) as any[];
  const sum = (k: string) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  res.json({
    month, rows, config: hrConfig(),
    totals: { count: rows.length, gross: sum('gross'), cut: sum('cut_amount'), additions: sum('bonus') + sum('overtime') + sum('arrears'), other: sum('fixed_deduction') + sum('advance') + sum('loan') + sum('other_deduction'), net: sum('net'),
      draft: rows.filter(r => r.status === 'draft').length, approved: rows.filter(r => r.status === 'approved').length, paid: rows.filter(r => r.status === 'paid').length, unmarked: sum('unmarked') },
    adjustments: db.prepare('SELECT a.*, s.name FROM hr_adjustments a JOIN hr_staff s ON s.id = a.staff_id WHERE a.month = ? ORDER BY a.id DESC').all(month)
  });
});

hrRouter.post('/payroll/generate', pay, (req, res) => wrap(res, () => generatePayroll(String(req.body?.month))));

const idsOf = (b: any) => (Array.isArray(b?.ids) ? b.ids.map(Number).filter(Number.isFinite) : null);
function moveSlips(res: any, month: any, ids: number[] | null, from: string, to: string, extra: (stmt: string) => [string, any[]]) {
  if (!isMonth(month)) return bad(res, 'Choose a month.');
  const [setSql, setArgs] = extra(to);
  const where = ids ? `AND id IN (${ids.map(() => '?').join(',') || 'NULL'})` : '';
  const r = db.prepare(`UPDATE hr_payslips SET ${setSql} WHERE month = ? AND status = ? ${where}`).run(...setArgs, month, from, ...(ids ?? []));
  res.json({ changed: r.changes });
}
hrRouter.post('/payroll/approve', leadership, (req, res) => moveSlips(res, req.body?.month, idsOf(req.body), 'draft', 'approved', s => ['status = ?, approved_by = ?', [s, req.user!.id]]));
hrRouter.post('/payroll/reopen', leadership, (req, res) => moveSlips(res, req.body?.month, idsOf(req.body), 'approved', 'draft', s => ['status = ?, approved_by = NULL', [s]]));
hrRouter.post('/payroll/pay', pay, (req, res) => moveSlips(res, req.body?.month, idsOf(req.body), 'approved', 'paid', s => ['status = ?, paid_date = ?, paid_by = ?', [s, date(req.body?.date) ?? todayISO(), req.user!.id]]));

function slipOpen(month: string, staffId: number) {
  const p = db.prepare('SELECT status FROM hr_payslips WHERE month = ? AND staff_id = ?').get(month, staffId) as any;
  return !p || p.status === 'draft';
}
hrRouter.post('/adjustments', pay, (req, res) => {
  const b = req.body, sid = Number(b?.staff_id);
  if (!staffRow(sid)) return bad(res, 'Choose the staff member.');
  if (!isMonth(b?.month)) return bad(res, 'Choose the month.');
  if (!['bonus', 'overtime', 'arrears', 'advance', 'deduction'].includes(b?.kind)) return bad(res, 'Choose what kind of entry this is.');
  const amount = int(b?.amount); if (amount < 1) return bad(res, 'Enter the amount.');
  if (!slipOpen(b.month, sid)) return bad(res, 'This salary is already approved. Ask the principal to reopen it first.', 409);
  res.status(201).json({ id: Number(db.prepare('INSERT INTO hr_adjustments (staff_id, month, kind, amount, note) VALUES (?,?,?,?,?)').run(sid, b.month, b.kind, amount, t(b.note, 120)).lastInsertRowid) });
});
hrRouter.delete('/adjustments/:id', pay, (req, res) => {
  const a = db.prepare('SELECT * FROM hr_adjustments WHERE id = ?').get(Number(req.params.id)) as any;
  if (!a) return bad(res, 'Entry not found.', 404);
  if (!slipOpen(a.month, a.staff_id)) return bad(res, 'This salary is already approved. Ask the principal to reopen it first.', 409);
  db.prepare('DELETE FROM hr_adjustments WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

// advance / loan with monthly instalments
hrRouter.get('/loans', pay, (_req, res) => res.json((db.prepare('SELECT l.*, s.name, s.emp_no FROM hr_loans l JOIN hr_staff s ON s.id = l.staff_id ORDER BY l.active DESC, l.id DESC').all() as any[]).map(l => {
  const done = (db.prepare('SELECT COALESCE(SUM(d.amount), 0) AS n FROM hr_loan_deductions d JOIN hr_payslips p ON p.staff_id = ? AND p.month = d.month AND p.status != \'draft\' WHERE d.loan_id = ?').get(l.staff_id, l.id) as any).n as number;
  return { ...l, recovered: done, remaining: l.total - done };
})));
hrRouter.post('/loans', pay, (req, res) => {
  const b = req.body, sid = Number(b?.staff_id);
  if (!staffRow(sid)) return bad(res, 'Choose the staff member.');
  const total = int(b?.total), inst = int(b?.installment);
  if (total < 1 || inst < 1) return bad(res, 'Enter the total amount and the monthly instalment.');
  if (inst > total) return bad(res, 'The instalment cannot be more than the total.');
  if (!isMonth(b?.start_month)) return bad(res, 'Choose the month the cutting starts from.');
  res.status(201).json({ id: Number(db.prepare('INSERT INTO hr_loans (staff_id, kind, total, installment, start_month, note) VALUES (?,?,?,?,?,?)').run(sid, b.kind === 'loan' ? 'loan' : 'advance', total, inst, b.start_month, t(b.note, 120)).lastInsertRowid) });
});
hrRouter.put('/loans/:id/close', pay, (req, res) => { db.prepare('UPDATE hr_loans SET active = 0 WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// salary structure (basic, allowances, fixed deduction): director, principal and accountant
hrRouter.get('/structure', pay, (_req, res) => res.json(db.prepare("SELECT id, emp_no, name, designation, department, staff_type, employment, joining_date, basic_salary, house_allow, medical_allow, conveyance_allow, other_allow, fixed_deduction FROM hr_staff WHERE status = 'active' ORDER BY kind, name").all()));
hrRouter.put('/structure/:id', pay, (req, res) => {
  const id = Number(req.params.id); if (!staffRow(id)) return bad(res, 'Staff member not found.', 404);
  db.prepare(`UPDATE hr_staff SET ${SALARY_FIELDS.map(f => f + ' = ?').join(', ')} WHERE id = ?`).run(...SALARY_FIELDS.map(f => int(req.body?.[f])), id);
  res.json({ ok: true });
});

// =====================================================================
// reports
// =====================================================================
hrRouter.get('/reports/attendance', manage, (req, res) => {
  const month = isMonth(req.query.month) ? String(req.query.month) : todayISO().slice(0, 7);
  res.json({ month, rows: payrollStaff(month).map(s => ({ id: s.id, emp_no: s.emp_no, name: s.name, designation: s.designation, department: s.department, ...attendanceSummary(s, month) })) });
});
hrRouter.get('/reports/salary', pay, (req, res) => {
  const month = isMonth(req.query.month) ? String(req.query.month) : todayISO().slice(0, 7);
  const rows = db.prepare(`SELECT s.department, s.kind, COUNT(*) AS staff, SUM(p.gross) AS gross, SUM(p.cut_amount) AS cut, SUM(p.net) AS net FROM hr_payslips p JOIN hr_staff s ON s.id = p.staff_id WHERE p.month = ? GROUP BY s.department, s.kind ORDER BY s.department`).all(month) as any[];
  const months = db.prepare("SELECT month, COUNT(*) AS staff, SUM(gross) AS gross, SUM(cut_amount) AS cut, SUM(net) AS net, SUM(status = 'paid') AS paid FROM hr_payslips GROUP BY month ORDER BY month DESC LIMIT 12").all();
  res.json({ month, byDepartment: rows, months });
});
hrRouter.get('/reports/leaves', manage, (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year)) ? String(req.query.year) : todayISO().slice(0, 4);
  const types = db.prepare('SELECT id, name FROM hr_leave_types WHERE active = 1 ORDER BY id').all() as any[];
  const rows = (db.prepare("SELECT id, emp_no, name, designation FROM hr_staff WHERE status = 'active' ORDER BY name").all() as any[]).map(s => {
    const used: Record<number, number> = {};
    for (const r of db.prepare("SELECT type_id, SUM(days) AS n FROM hr_leaves WHERE staff_id = ? AND status = 'approved' AND substr(from_date, 1, 4) = ? GROUP BY type_id").all(s.id, year) as any[]) used[r.type_id] = r.n;
    return { ...s, used, total: Object.values(used).reduce((a, n) => a + n, 0) };
  });
  res.json({ year, types, rows });
});
hrRouter.get('/reports/movement', manage, (req, res) => {
  const from = isDate(req.query.from) ? String(req.query.from) : `${todayISO().slice(0, 4)}-01-01`, to = isDate(req.query.to) ? String(req.query.to) : todayISO();
  res.json({
    from, to,
    joined: db.prepare('SELECT id, emp_no, name, designation, department, joining_date FROM hr_staff WHERE joining_date BETWEEN ? AND ? ORDER BY joining_date').all(from, to),
    left: db.prepare("SELECT id, emp_no, name, designation, department, status, left_date, left_reason FROM hr_staff WHERE status != 'active' AND left_date BETWEEN ? AND ? ORDER BY left_date").all(from, to)
  });
});

// =====================================================================
// settings
// =====================================================================
const settingsView = () => ({
  departments: db.prepare('SELECT * FROM hr_departments ORDER BY name').all(), designations: db.prepare('SELECT * FROM hr_designations ORDER BY name').all(),
  leaveTypes: db.prepare('SELECT * FROM hr_leave_types ORDER BY id').all(), config: hrConfig()
});
hrRouter.get('/settings', manage, (_req, res) => res.json(settingsView()));

hrRouter.put('/settings/config', leadership, (req, res) => {
  const b = req.body ?? {};
  if (b.day_divisor !== undefined) { if (!['30', 'working'].includes(b.day_divisor)) return bad(res, 'Choose how a day of salary is worked out.'); setSetting('hr_day_divisor', b.day_divisor); }
  if (b.late_per_day !== undefined) { const n = Math.round(Number(b.late_per_day)); if (!(n >= 0 && n <= 31)) return bad(res, 'Late rule: enter 0 to 31.'); setSetting('hr_late_per_day', String(n)); }
  if (b.late_after !== undefined) { if (!/^\d{2}:\d{2}$/.test(b.late_after)) return bad(res, 'Enter the late time like 08:00.'); setSetting('hr_late_after', b.late_after); }
  if (b.contract_alert_days !== undefined) { const n = Math.round(Number(b.contract_alert_days)); if (!(n >= 1 && n <= 180)) return bad(res, 'Alert days: 1 to 180.'); setSetting('hr_alert_days', String(n)); }
  res.json(hrConfig());
});

const listTable = (table: 'hr_departments' | 'hr_designations') => {
  hrRouter.post(`/settings/${table === 'hr_departments' ? 'departments' : 'designations'}`, manage, (req, res) => {
    const name = t(req.body?.name, 60); if (!name) return bad(res, 'Enter the name.');
    try { db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name); res.status(201).json({ ok: true }); } catch { bad(res, 'This name already exists.', 409); }
  });
  hrRouter.delete(`/settings/${table === 'hr_departments' ? 'departments' : 'designations'}/:id`, manage, (req, res) => { db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(req.params.id)); res.json({ ok: true }); });
};
listTable('hr_departments'); listTable('hr_designations');

function leaveTypeBody(b: any) {
  const name = t(b?.name, 40); if (!name) return { error: 'Enter the leave name.' };
  const quota = int(b?.yearly_quota); if (quota > 366) return { error: 'Yearly days: 0 to 366 (0 means no limit).' };
  return { v: [name, quota, b.paid ? 1 : 0] };
}
hrRouter.post('/settings/leave-types', leadership, (req, res) => {
  const s = leaveTypeBody(req.body); if (s.error) return bad(res, s.error);
  try { res.status(201).json({ id: Number(db.prepare('INSERT INTO hr_leave_types (name, yearly_quota, paid) VALUES (?,?,?)').run(...s.v!).lastInsertRowid) }); } catch { bad(res, 'A leave with this name already exists.', 409); }
});
hrRouter.put('/settings/leave-types/:id', leadership, (req, res) => {
  const s = leaveTypeBody(req.body); if (s.error) return bad(res, s.error);
  db.prepare('UPDATE hr_leave_types SET name = ?, yearly_quota = ?, paid = ? WHERE id = ?').run(...s.v!, Number(req.params.id));
  res.json({ ok: true });
});
hrRouter.delete('/settings/leave-types/:id', leadership, (req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT 1 FROM hr_leaves WHERE type_id = ?').get(id)) db.prepare('UPDATE hr_leave_types SET active = 0 WHERE id = ?').run(id);   // used before: hide it, keep the history
  else db.prepare('DELETE FROM hr_leave_types WHERE id = ?').run(id);
  res.json({ ok: true });
});

// =====================================================================
// "My HR": every staff member (teachers included) sees only their own record
// =====================================================================
hrRouter.get('/me', (req, res) => {
  const s = myStaff(req.user!.id);
  if (!s) return res.json({ staff: null });
  const month = todayISO().slice(0, 7);
  res.json({
    staff: stripPay(s, 'teacher'), balances: leaveBalances(s.id), month: attendanceSummary(s, month),
    attendance: db.prepare('SELECT date, status, time_in, time_out FROM hr_att WHERE staff_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(s.id, `${month}-01`, `${month}-31`),
    leaves: db.prepare('SELECT l.*, lt.name AS type FROM hr_leaves l JOIN hr_leave_types lt ON lt.id = l.type_id WHERE l.staff_id = ? ORDER BY l.from_date DESC LIMIT 30').all(s.id),
    leaveTypes: db.prepare('SELECT id, name, paid FROM hr_leave_types WHERE active = 1 ORDER BY id').all(),
    payslips: db.prepare("SELECT p.*, s.name, s.emp_no, s.designation, s.department, s.cnic, s.joining_date FROM hr_payslips p JOIN hr_staff s ON s.id = p.staff_id WHERE p.staff_id = ? AND p.status != 'draft' ORDER BY p.month DESC LIMIT 12").all(s.id)
  });
});
hrRouter.post('/me/leaves', (req, res) => {
  const s = myStaff(req.user!.id);
  if (!s || s.status !== 'active') return bad(res, 'Your login is not linked to a staff record. Ask the office.', 403);
  wrap(res, () => ({ id: createLeave(s.id, req.body, req.user!.id) }));
});
hrRouter.delete('/me/leaves/:id', (req, res) => {
  const s = myStaff(req.user!.id);
  const l = s && db.prepare('SELECT * FROM hr_leaves WHERE id = ? AND staff_id = ?').get(Number(req.params.id), s.id) as any;
  if (!l) return bad(res, 'Leave not found.', 404);
  if (l.status !== 'pending') return bad(res, 'Only a leave that is still waiting can be cancelled.');
  db.prepare('DELETE FROM hr_leaves WHERE id = ?').run(l.id);
  res.json({ ok: true });
});

hrRouter.use('/recruit', manage, recruitRouter);
