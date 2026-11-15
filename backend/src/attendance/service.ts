import { teacherOpen } from '../policy.js';
import { db, getSetting } from '../db.js';
import { getSettings } from '../timetable/schema.js';
import type { AuthUser } from '../auth.js';

export const MANAGE = ['director', 'principal', 'admin'];
const pad = (n: number) => String(n).padStart(2, '0');
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dowOf = (iso: string) => { const g = new Date(`${iso}T00:00:00Z`).getUTCDay(); return g === 0 ? 7 : g; };
export const dateRange = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d); return out; };
export const monthOf = (iso: string) => iso.slice(0, 7);
export const addMonths = (month: string, n: number) => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };

export const STATUSES = ['P', 'A', 'L', 'LT'];

export function attConfig() {
  return {
    edit_days: Number(getSetting('att_edit_days') || 2),
    low_pct: Number(getSetting('att_low_pct') || 75),
    leave_counts: getSetting('att_leave_counts') === '1'
  };
}

// ---------- calendar ----------
export interface DayInfo { date: string; day: number; dow: number; off: boolean; holiday: string | null; working: boolean }

export function holidaysBetween(from: string, to: string): Map<string, string> {
  return new Map((db.prepare('SELECT date, name FROM att_holidays WHERE date BETWEEN ? AND ?').all(from, to) as any[]).map(r => [r.date, r.name]));
}

export function monthDays(month: string): DayInfo[] {
  const schoolDays = getSettings().days;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const hol = holidaysBetween(`${month}-01`, `${month}-${pad(last)}`);
  return Array.from({ length: last }, (_, i) => {
    const date = `${month}-${pad(i + 1)}`, dow = dowOf(date), off = !schoolDays.includes(dow), holiday = hol.get(date) ?? null;
    return { date, day: i + 1, dow, off, holiday, working: !off && !holiday };
  });
}
/** School days of the month that have already happened (or all of them for a past month). */
export const workingDates = (month: string, upTo = todayISO()) => monthDays(month).filter(d => d.working && d.date <= upTo).map(d => d.date);

export function dayInfo(date: string): DayInfo { return monthDays(monthOf(date))[Number(date.slice(8, 10)) - 1]; }

// ---------- statistics ----------
export interface Stats { present: number; late: number; absent: number; leave: number; recorded: number; pct: number | null; source: 'daily' | 'totals' | 'none'; workingDays: number }
const empty = (): Stats => ({ present: 0, late: 0, absent: 0, leave: 0, recorded: 0, pct: null, source: 'none', workingDays: 0 });

export function pctOf(s: { present: number; late: number; absent: number; leave: number }, leaveCounts = attConfig().leave_counts): number | null {
  const recorded = s.present + s.late + s.absent + s.leave;
  if (!recorded) return null;
  return Math.round(((s.present + s.late + (leaveCounts ? s.leave : 0)) / recorded) * 1000) / 10;
}

/** Counts per student for a month. Day by day records win; month totals are used when there are none. */
export function monthStats(studentIds: number[], month: string): Map<number, Stats> {
  const out = new Map<number, Stats>(studentIds.map(id => [id, empty()]));
  const first = `${month}-01`, last = `${month}-31`, today = todayISO();
  const wd = workingDates(month).length;
  const cfg = attConfig();
  for (let i = 0; i < studentIds.length; i += 500) {
    const c = studentIds.slice(i, i + 500), q = c.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT student_id, status, COUNT(*) AS n FROM att_daily WHERE date BETWEEN ? AND ? AND date <= ? AND student_id IN (${q}) GROUP BY student_id, status`).all(first, last, today, ...c) as any[]) {
      const s = out.get(r.student_id)!; s.source = 'daily'; s.workingDays = wd;
      if (r.status === 'P') s.present = r.n; else if (r.status === 'LT') s.late = r.n; else if (r.status === 'A') s.absent = r.n; else s.leave = r.n;
    }
    for (const r of db.prepare(`SELECT * FROM att_month_totals WHERE month = ? AND student_id IN (${q})`).all(month, ...c) as any[]) {
      const s = out.get(r.student_id)!;
      if (s.source === 'daily') continue;
      Object.assign(s, { source: 'totals', workingDays: r.working_days, present: r.present, late: r.late, absent: r.absent, leave: r.leave });
    }
  }
  for (const s of out.values()) { s.recorded = s.present + s.late + s.absent + s.leave; s.pct = pctOf(s, cfg.leave_counts); }
  return out;
}

// ---------- who may do what ----------
export const myTeacherId = (userId: number): number | null =>
  ((db.prepare('SELECT id FROM teachers WHERE user_id = ? AND active = 1').get(userId) as any)?.id) ?? null;

export const isManager = (u: AuthUser) => MANAGE.includes(u.role);

/** Who may take attendance for a section: the office, the class teacher, or (open teaching) any teacher. */
export function canMark(u: AuthUser, sectionId: number): boolean {
  return canSection(u, sectionId) || (u.role === 'teacher' && teacherOpen());
}

export function canSection(u: AuthUser, sectionId: number): boolean {
  if (isManager(u)) return true;
  if (u.role !== 'teacher') return false;
  const t = myTeacherId(u.id);
  return !!t && !!db.prepare('SELECT 1 FROM sections WHERE id = ? AND class_teacher_id = ?').get(sectionId, t);
}

/** Teachers can only change recent days; the office can change any past day. Nobody can mark the future. */
export function dateRule(u: AuthUser, date: string): { ok: boolean; reason?: string } {
  const today = todayISO();
  if (date > today) return { ok: false, reason: 'Attendance cannot be marked for a future date.' };
  if (!isManager(u)) {
    const days = attConfig().edit_days;
    if (date < addDays(today, -days)) return { ok: false, reason: `This day is locked. Teachers can change only the last ${days} day(s). Ask the office.` };
  }
  return { ok: true };
}

export const sectionStudents = (sectionId: number) =>
  db.prepare("SELECT id, name, father_name, roll_no, reg_no, phone FROM students WHERE section_id = ? AND status = 'active' ORDER BY roll_no, name").all(sectionId) as
    { id: number; name: string; father_name: string; roll_no: number | null; reg_no: string; phone: string | null }[];

export const sectionLabel = (sectionId: number) => {
  const r = db.prepare('SELECT c.name AS class_name, s.name AS section_name FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = ?').get(sectionId) as any;
  return r ? `${r.class_name}-${r.section_name}` : '';
};

// ---------- approved leaves become "L" in the register ----------
export function applyLeave(leaveId: number, by: number | null) {
  const l = db.prepare('SELECT * FROM att_leaves WHERE id = ?').get(leaveId) as any;
  if (!l) return 0;
  const schoolDays = getSettings().days;
  const hol = holidaysBetween(l.from_date, l.to_date);
  let n = 0;
  db.transaction(() => {
    for (const d of dateRange(l.from_date, l.to_date)) {
      if (!schoolDays.includes(dowOf(d)) || hol.has(d)) continue;
      const ex = db.prepare('SELECT status FROM att_daily WHERE student_id = ? AND date = ?').get(l.student_id, d) as any;
      if (!ex) { db.prepare("INSERT INTO att_daily (student_id, date, status, note, leave_id, marked_by) VALUES (?,?,'L',?,?,?)").run(l.student_id, d, l.reason || 'Leave', leaveId, by); n++; }
      else if (ex.status === 'A') { db.prepare("UPDATE att_daily SET status = 'L', note = ?, leave_id = ?, marked_by = ? WHERE student_id = ? AND date = ?").run(l.reason || 'Leave', leaveId, by, l.student_id, d); n++; }
    }
  })();
  return n;
}
export const removeLeaveMarks = (leaveId: number) => db.prepare('DELETE FROM att_daily WHERE leave_id = ?').run(leaveId).changes;
