import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, db, getSetting } from '../db.js';
import { addDays, dateRange, dayInfo, isDate, isMonth, monthDays, todayISO } from '../attendance/service.js';
import type { Role } from '../auth.js';
import './schema.js';

export class HrError extends Error {}

export const MANAGE: Role[] = ['director', 'principal', 'admin'];
export const PAY: Role[] = ['director', 'principal', 'admin', 'accountant'];
export const KINDS = ['teaching', 'non_teaching', 'transport'];
export const STAFF_TYPES = ['teacher', 'office', 'accounts', 'driver', 'conductor', 'support', 'lab_attendant'];
export const kindOfType = (type: string) => (type === 'teacher' ? 'teaching' : type === 'driver' || type === 'conductor' ? 'transport' : 'non_teaching');
export const DEPARTMENT_OF: Record<string, string> = { teacher: 'Teaching', office: 'Administration', accounts: 'Accounts', driver: 'Transport', conductor: 'Transport', support: 'Support', lab_attendant: 'Support' };
export const EMPLOYMENT = ['permanent', 'contract', 'part_time', 'probation'];
export const STAGES = ['applied', 'shortlisted', 'interview', 'offered', 'hired', 'rejected'];
export const ATT_STATUSES = ['P', 'A', 'L', 'LT', 'HD'];

export const t = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n) || null;
export const int = (v: unknown, def = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : def; };
export const date = (v: unknown) => (isDate(v) ? String(v) : null);
/** Office rules kept in Settings. late_per_day 0 = late is never cut (only absent days cost pay). */
export function hrConfig() {
  return {
    day_divisor: getSetting('hr_day_divisor') === 'working' ? 'working' as const : '30' as const,
    late_per_day: Math.max(0, Math.round(Number(getSetting('hr_late_per_day') || 0))),
    late_after: /^\d{2}:\d{2}$/.test(getSetting('hr_late_after')) ? getSetting('hr_late_after') : '08:00',
    contract_alert_days: Math.max(1, Math.round(Number(getSetting('hr_alert_days') || 30)))
  };
}
export const isActive = (s: any) => s.status === 'active';
export const canSeePay = (role: string) => (PAY as string[]).includes(role);

// ---------- staff ----------
export function nextEmpNo(): string {
  const n = (db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(emp_no, 3) AS INTEGER)), 0) + 1 AS n FROM hr_staff WHERE emp_no LIKE 'E-%'").get() as any).n as number;
  return `E-${String(n).padStart(3, '0')}`;
}

export const SALARY_FIELDS = ['basic_salary', 'house_allow', 'medical_allow', 'conveyance_allow', 'other_allow', 'fixed_deduction'] as const;
export const grossOf = (s: any) => (s.basic_salary || 0) + (s.house_allow || 0) + (s.medical_allow || 0) + (s.conveyance_allow || 0) + (s.other_allow || 0);

/** Keeps the Timetable teacher / Transport driver in step with the HR record (name, phone, active). */
export function syncLinked(staffId: number) {
  const s = db.prepare('SELECT * FROM hr_staff WHERE id = ?').get(staffId) as any;
  if (!s) return;
  const active = s.status === 'active' ? 1 : 0;
  if (s.kind === 'teaching') {
    if (s.teacher_id && db.prepare('SELECT 1 FROM teachers WHERE id = ?').get(s.teacher_id)) db.prepare('UPDATE teachers SET name = ?, phone = ?, active = ?, user_id = COALESCE(?, user_id) WHERE id = ?').run(s.name, s.phone, active, s.user_id, s.teacher_id);
    else if (active) {
      const id = Number(db.prepare('INSERT INTO teachers (name, phone, user_id) VALUES (?,?,?)').run(s.name, s.phone, s.user_id).lastInsertRowid);
      db.prepare('UPDATE hr_staff SET teacher_id = ? WHERE id = ?').run(id, staffId);
    }
  } else if (s.kind === 'transport') {
    const role = /conductor/i.test(s.designation ?? '') ? 'conductor' : 'driver';
    if (s.tr_staff_id && db.prepare('SELECT 1 FROM tr_staff WHERE id = ?').get(s.tr_staff_id)) db.prepare('UPDATE tr_staff SET name=?, role=?, phone=?, cnic=?, license_no=?, license_expiry=?, address=?, active=? WHERE id=?').run(s.name, role, s.phone, s.cnic, s.license_no, s.license_expiry, s.address, active, s.tr_staff_id);
    else if (active) {
      const id = Number(db.prepare('INSERT INTO tr_staff (name, role, phone, cnic, license_no, license_expiry, address) VALUES (?,?,?,?,?,?,?)').run(s.name, role, s.phone, s.cnic, s.license_no, s.license_expiry, s.address).lastInsertRowid);
      db.prepare('UPDATE hr_staff SET tr_staff_id = ? WHERE id = ?').run(id, staffId);
    }
  }
}

/** Brings the teachers and drivers that already exist into HR (safe to run again). */
export function importExisting(): { teachers: number; drivers: number } {
  let teachers = 0, drivers = 0;
  db.transaction(() => {
    for (const tc of db.prepare('SELECT * FROM teachers WHERE active = 1 AND id NOT IN (SELECT teacher_id FROM hr_staff WHERE teacher_id IS NOT NULL)').all() as any[]) {
      db.prepare("INSERT INTO hr_staff (emp_no, name, phone, staff_type, kind, department, designation, teacher_id, user_id) VALUES (?,?,?,'teacher','teaching','Teaching','Teacher',?,?)").run(nextEmpNo(), tc.name, tc.phone, tc.id, tc.user_id); teachers++;
    }
    for (const d of db.prepare('SELECT * FROM tr_staff WHERE active = 1 AND id NOT IN (SELECT tr_staff_id FROM hr_staff WHERE tr_staff_id IS NOT NULL)').all() as any[]) {
      db.prepare("INSERT INTO hr_staff (emp_no, name, phone, cnic, address, staff_type, kind, department, designation, license_no, license_expiry, tr_staff_id) VALUES (?,?,?,?,?,?,'transport','Transport',?,?,?,?)")
        .run(nextEmpNo(), d.name, d.phone, d.cnic, d.address, d.role, d.role === 'conductor' ? 'Conductor' : 'Driver', d.license_no, d.license_expiry, d.id); drivers++;
    }
  })();
  return { teachers, drivers };
}

// ---------- calendar helpers for staff ----------
/** Working days (school days, no holidays) of a month. */
export const workingDays = (month: string) => monthDays(month).filter(d => d.working).map(d => d.date);

export function leaveDays(from: string, to: string): number {
  return dateRange(from, to).filter(d => dayInfo(d).working).length;
}

export interface Balance { type_id: number; name: string; paid: number; quota: number; used: number; pending: number; left: number | null }
export function leaveBalances(staffId: number, year = todayISO().slice(0, 4)): Balance[] {
  return (db.prepare('SELECT * FROM hr_leave_types WHERE active = 1 ORDER BY id').all() as any[]).map(lt => {
    const sum = (status: string) => (db.prepare("SELECT COALESCE(SUM(days), 0) AS n FROM hr_leaves WHERE staff_id = ? AND type_id = ? AND status = ? AND substr(from_date, 1, 4) = ?").get(staffId, lt.id, status, year) as any).n as number;
    const used = sum('approved'), pending = sum('pending');
    return { type_id: lt.id, name: lt.name, paid: lt.paid, quota: lt.yearly_quota, used, pending, left: lt.yearly_quota ? lt.yearly_quota - used : null };
  });
}

/** Puts an approved leave on the attendance register (school days only). */
export function applyLeaveToRegister(leaveId: number, userId: number) {
  const l = db.prepare('SELECT * FROM hr_leaves WHERE id = ?').get(leaveId) as any;
  const ins = db.prepare("INSERT INTO hr_att (staff_id, date, status, leave_id, marked_by) VALUES (?,?, 'L', ?, ?) ON CONFLICT(staff_id, date) DO UPDATE SET status = 'L', leave_id = excluded.leave_id, marked_by = excluded.marked_by, marked_at = datetime('now')");
  for (const d of dateRange(l.from_date, l.to_date)) if (dayInfo(d).working) ins.run(l.staff_id, d, leaveId, userId);
}
export const removeLeaveFromRegister = (leaveId: number) => db.prepare('DELETE FROM hr_att WHERE leave_id = ?').run(leaveId);

// ---------- payroll ----------
export interface Figures { working_days: number; absent_days: number; unpaid_days: number; notjoined_days: number; late_count: number; unmarked: number }
const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/**
 * Days of the month that cost the employee pay:
 *  - absent days (A) and half days (HD counts 0.5)
 *  - approved leave of an unpaid type
 *  - days before joining / after leaving (calendar days, at most one month's worth)
 * Late costs nothing unless Settings has a late rule (see computePayslip). Days nobody marked are not cut:
 * they are counted in `unmarked` so the office can fix them before the salary is approved.
 */
export function monthFigures(s: any, month: string): Figures {
  const all = workingDays(month);
  const first = `${month}-01`, last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const from = s.joining_date && s.joining_date > first ? s.joining_date : null;
  const to = !isActive(s) && s.left_date && s.left_date < last ? s.left_date : null;
  const inJob = (d: string) => (!from || d >= from) && (!to || d <= to);
  const mine = all.filter(inJob);
  const rows = db.prepare(`SELECT a.date, a.status, COALESCE(lt.paid, 1) AS paid FROM hr_att a LEFT JOIN hr_leaves l ON l.id = a.leave_id LEFT JOIN hr_leave_types lt ON lt.id = l.type_id WHERE a.staff_id = ? AND a.date BETWEEN ? AND ?`).all(s.id, first, last) as any[];
  const byDate = new Map(rows.map(r => [r.date, r]));
  let absent = 0, unpaid = 0, late = 0;
  for (const d of mine) {
    const r = byDate.get(d);
    if (!r) continue;
    if (r.status === 'A') absent += 1;
    else if (r.status === 'HD') absent += 0.5;
    else if (r.status === 'LT') late += 1;
    else if (r.status === 'L' && !r.paid) unpaid += 1;
  }
  const today = todayISO();
  const unmarked = mine.filter(d => d <= today && !byDate.has(d)).length;
  // calendar days outside the job period
  const dim = daysInMonth(month);
  const startDay = from ? Number(from.slice(8, 10)) : 1, endDay = to ? Number(to.slice(8, 10)) : dim;
  const outside = Math.max(0, startDay - 1) + Math.max(0, dim - endDay);
  return { working_days: all.length, absent_days: absent, unpaid_days: unpaid, notjoined_days: Math.min(outside, 30), late_count: late, unmarked };
}

/** What is still owed on a loan before `month` starts, and this month's instalment. */
export function loanInstallments(staffId: number, month: string): { loan_id: number; amount: number }[] {
  const out: { loan_id: number; amount: number }[] = [];
  for (const l of db.prepare('SELECT * FROM hr_loans WHERE staff_id = ? AND active = 1 AND start_month <= ?').all(staffId, month) as any[]) {
    const done = (db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM hr_loan_deductions WHERE loan_id = ? AND month < ?').get(l.id, month) as any).n as number;
    const amount = Math.min(l.installment, l.total - done);
    if (amount > 0) out.push({ loan_id: l.id, amount });
  }
  return out;
}

export function computePayslip(s: any, month: string) {
  const cfg = hrConfig();
  const f = monthFigures(s, month);
  const allowances = (s.house_allow || 0) + (s.medical_allow || 0) + (s.conveyance_allow || 0) + (s.other_allow || 0);
  const gross = (s.basic_salary || 0) + allowances;
  const divisor = cfg.day_divisor === '30' ? 30 : f.working_days;
  const perDay = divisor ? gross / divisor : 0;
  const lateCut = cfg.late_per_day ? Math.floor(f.late_count / cfg.late_per_day) : 0;
  const cut = Math.round(perDay * (f.absent_days + f.unpaid_days + f.notjoined_days + lateCut));
  const adj = (kind: string) => (db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM hr_adjustments WHERE staff_id = ? AND month = ? AND kind = ?').get(s.id, month, kind) as any).n as number;
  const advance = adj('advance'), other = adj('deduction'), bonus = adj('bonus'), overtime = adj('overtime'), arrears = adj('arrears');
  const loans = loanInstallments(s.id, month);
  const loan = loans.reduce((a, l) => a + l.amount, 0);
  const net = Math.max(0, gross - cut - (s.fixed_deduction || 0) - advance - loan - other + bonus + overtime + arrears);
  return { basic: s.basic_salary || 0, allowances, gross, ...f, late_cut_days: lateCut, per_day: Math.round(perDay), cut_amount: cut, fixed_deduction: s.fixed_deduction || 0, advance, loan, other_deduction: other, bonus, overtime, arrears, net, loans };
}

/** Staff who are on the payroll in a month: joined by its last day and not left before its first day. */
export function payrollStaff(month: string) {
  return db.prepare("SELECT * FROM hr_staff WHERE (joining_date IS NULL OR joining_date <= ?) AND (status = 'active' OR (left_date IS NOT NULL AND left_date >= ?)) ORDER BY kind, name").all(`${month}-31`, `${month}-01`) as any[];
}

export function generatePayroll(month: string): { created: number; updated: number; skippedLocked: number; removed: number } {
  if (!isMonth(month)) throw new HrError('Choose a month.');
  const out = { created: 0, updated: 0, skippedLocked: 0, removed: 0 };
  const staff = payrollStaff(month);
  const ids = new Set(staff.map(s => s.id));
  db.transaction(() => {
    for (const s of staff) {
      const ex = db.prepare('SELECT id, status FROM hr_payslips WHERE month = ? AND staff_id = ?').get(month, s.id) as any;
      if (ex && ex.status !== 'draft') { out.skippedLocked++; continue; }   // approved and paid sheets are locked
      const p = computePayslip(s, month);
      const vals = [p.basic, p.allowances, p.gross, p.working_days, p.absent_days, p.unpaid_days, p.notjoined_days, p.per_day, p.cut_amount, p.late_count, p.late_cut_days, p.fixed_deduction, p.advance, p.loan, p.other_deduction, p.bonus, p.overtime, p.arrears, p.net, p.unmarked];
      const cols = 'basic, allowances, gross, working_days, absent_days, unpaid_days, notjoined_days, per_day, cut_amount, late_count, late_cut_days, fixed_deduction, advance, loan, other_deduction, bonus, overtime, arrears, net, unmarked';
      if (ex) { db.prepare(`UPDATE hr_payslips SET ${cols.split(', ').map(c => c + '=?').join(', ')} WHERE id=?`).run(...vals, ex.id); out.updated++; }
      else { db.prepare(`INSERT INTO hr_payslips (month, staff_id, ${cols}) VALUES (?,?,${vals.map(() => '?').join(',')})`).run(month, s.id, ...vals); out.created++; }
      // remember this month's instalments so the next month knows what is left
      db.prepare('DELETE FROM hr_loan_deductions WHERE month = ? AND loan_id IN (SELECT id FROM hr_loans WHERE staff_id = ?)').run(month, s.id);
      for (const l of p.loans) db.prepare('INSERT INTO hr_loan_deductions (loan_id, month, amount) VALUES (?,?,?)').run(l.loan_id, month, l.amount);
    }
    for (const r of db.prepare("SELECT id, staff_id FROM hr_payslips WHERE month = ? AND status = 'draft'").all(month) as any[]) if (!ids.has(r.staff_id)) { db.prepare('DELETE FROM hr_payslips WHERE id = ?').run(r.id); out.removed++; }
  })();
  return out;
}

// ---------- recruitment ----------
export const TEMPLATE_KINDS = ['interview', 'shortlist', 'reject', 'offer', 'general'] as const;
export const DEFAULT_TEMPLATES: Record<string, string> = {
  interview: 'Assalam o Alaikum {name}, aap ne {college} mein {post} ke liye apply kiya tha. Aap ko interview ke liye bulaya ja raha hai.\nDate: {date}\nTime: {time}\nJagah: {venue}\nBarae meharbani CNIC, CV aur degrees ki copies saath layen. Shukriya.\n- {college}',
  shortlist: 'Assalam o Alaikum {name}, {college} mein {post} ke liye aap ka CV shortlist hua hai. Interview ki tareekh jaldi bata di jaye gi. Shukriya.\n- {college}',
  reject: 'Assalam o Alaikum {name}, {college} mein {post} ke liye apply karne ka shukriya. Is martaba aap ka intikhab nahi ho saka. Hum aap ke mustaqbil ke liye dua go hain.\n- {college}',
  offer: 'Assalam o Alaikum {name}, mubarak ho! {college} mein {post} ke liye aap ka intikhab ho gaya hai. Tankhwah: Rs {salary}. Joining date: {joining}. Barae meharbani office aa kar offer letter wasool karen.\n- {college}',
  general: 'Assalam o Alaikum {name}, {college} ki taraf se aap se rabta kiya ja raha hai ({post}). Barae meharbani is number par jawab den. Shukriya.\n- {college}'
};
export function templates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of TEMPLATE_KINDS) out[k] = getSetting(`hr_tpl_${k}`) || DEFAULT_TEMPLATES[k];
  return out;
}

export const addDaysISO = addDays;

// ---------- uploaded files (data/hr_files) ----------
export const FILE_DIR = path.join(DATA_DIR, 'hr_files');
fs.mkdirSync(FILE_DIR, { recursive: true });

/** Removes a file record, and the file on disk when no other record (a hired candidate's copy) still uses it. */
export function deleteFileRow(id: number) {
  const f = db.prepare('SELECT * FROM hr_files WHERE id = ?').get(id) as any;
  if (!f) return;
  db.prepare('DELETE FROM hr_files WHERE id = ?').run(id);
  if (!db.prepare('SELECT 1 FROM hr_files WHERE stored = ?').get(f.stored)) fs.rmSync(path.join(FILE_DIR, f.stored), { force: true });
}
