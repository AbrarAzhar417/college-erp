import '../discipline/routes.js';
import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import '../attendance/schema.js';
import '../fee/schema.js';
import '../hr/schema.js';
import { todayISO } from '../attendance/service.js';
import { absentTeachers } from '../timetable/extras.js';

/** One look at what needs attention today. Counts only; the pages behind each line hold the detail. */
export const todayRouter = Router();
const count = (sql: string, ...p: any[]) => ((db.prepare(sql).get(...p) as any)?.n ?? 0) as number;

export function todaySummary(role: string, date = todayISO()) {
  const out: any = { date };
  const fee = {
    receipts: db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM payments WHERE paid_on = ? AND cancelled = 0").get(date) as { n: number; total: number },
    owing: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(b),0) AS total FROM (SELECT student_id, SUM(amount) AS b FROM ledger GROUP BY student_id HAVING b > 0)').get() as { n: number; total: number },
    overdueVouchers: count("SELECT COUNT(*) AS n FROM vouchers WHERE status = 'open' AND due_date < ?", date),
    dueToday: count("SELECT COUNT(*) AS n FROM vouchers WHERE status = 'open' AND due_date = ?", date)
  };
  out.fee = fee;
  if (role === 'accountant') return out;

  const isSunday = new Date(date + 'T00:00:00Z').getUTCDay() === 0, holiday = db.prepare('SELECT name FROM att_holidays WHERE date = ?').get(date) as { name: string } | undefined;
  out.holiday = holiday?.name ?? (isSunday ? 'Sunday' : null);
  const absent = absentTeachers(date);
  out.teachers = { absent, uncovered: absent.reduce((a, t) => a + t.uncovered, 0) };
  out.leaves = { staffPending: count("SELECT COUNT(*) AS n FROM hr_leaves WHERE status = 'pending'"), studentPending: count("SELECT COUNT(*) AS n FROM att_leaves WHERE status = 'pending'") };
  if (!out.holiday) {
    out.attendanceMissing = db.prepare(`SELECT c.name || '-' || s.name AS label FROM sections s JOIN classes c ON c.id = s.class_id
      WHERE EXISTS (SELECT 1 FROM students st WHERE st.section_id = s.id AND st.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM att_daily a JOIN students st ON st.id = a.student_id WHERE st.section_id = s.id AND a.date = ?) ORDER BY c.grade, s.name`).all(date).map((r: any) => r.label);
    out.studentsAbsent = count("SELECT COUNT(*) AS n FROM att_daily WHERE date = ? AND status = 'A'", date);
  }
  out.summonsPending = count("SELECT COUNT(*) AS n FROM disc_records WHERE kind = 'summon' AND status = 'open'");
  const soon = new Date(Date.parse(date + 'T00:00:00Z') + 14 * 86400000).toISOString().slice(0, 10);
  out.exams = db.prepare("SELECT id, name, start_date, end_date, status FROM exams WHERE status <> 'published' AND start_date IS NOT NULL AND start_date <= ? AND COALESCE(end_date, start_date) >= ? ORDER BY start_date").all(soon, date);
  return out;
}
todayRouter.get('/', requireRole('director', 'principal', 'admin', 'accountant'), (req, res) => res.json(todaySummary(req.user!.role)));
