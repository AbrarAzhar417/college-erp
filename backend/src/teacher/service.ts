import { db } from '../db.js';
import { dowOf, myTeacherId, todayISO } from '../attendance/service.js';
import { summary as taskSummary } from '../tasks/service.js';
import type { AuthUser } from '../auth.js';

/** Everything a teacher needs on one page: their classes and subjects, today's lessons, and what is waiting for them. */
export function portal(u: AuthUser) {
  const tid = myTeacherId(u.id), today = todayISO(), dow = dowOf(today);
  const teacher = tid ? db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(tid) as any : null;
  const slots = tid ? db.prepare(`SELECT sl.day, sl.period, sub.id subject_id, sub.name subject, c.id class_id, c.name || '-' || s.name section, s.id section_id FROM tt_slots sl JOIN sections s ON s.id = sl.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = sl.subject_id WHERE sl.teacher_id = ? ORDER BY sl.day, sl.period`).all(tid) as any[] : [];
  const subjects = new Map<string, any>();
  for (const s of slots) { const k = `${s.subject_id}|${s.section_id}`; const e = subjects.get(k) ?? subjects.set(k, { subject: s.subject, section: s.section, periods: 0 }).get(k)!; e.periods++; }
  const classTeacherOf = tid ? (db.prepare("SELECT c.name || '-' || s.name label FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.class_teacher_id = ? ORDER BY c.grade").all(tid) as { label: string }[]).map(r => r.label) : [];
  const marksToEnter = tid ? (db.prepare(`SELECT COUNT(*) n FROM exam_papers p JOIN exams e ON e.id = p.exam_id WHERE p.teacher_id = ? AND e.status = 'open' AND (SELECT COUNT(*) FROM exam_marks m WHERE m.paper_id = p.id) < (SELECT COUNT(*) FROM students st WHERE st.section_id = p.section_id AND st.status = 'active')`).get(tid) as any).n as number : 0;
  const papersToSet = (db.prepare("SELECT COUNT(*) n FROM paper_requests WHERE teacher_user_id = ? AND status IN ('requested','returned')").get(u.id) as any).n as number;
  const slip = (() => { try { return db.prepare("SELECT ps.month FROM hr_payslips ps JOIN hr_staff st ON st.id = ps.staff_id WHERE st.user_id = ? ORDER BY ps.month DESC LIMIT 1").get(u.id) as any; } catch { return null; } })();
  return { teacher, classTeacherOf, subjects: [...subjects.values()], today: slots.filter(s => s.day === dow).map(s => ({ period: s.period, subject: s.subject, section: s.section })), linked: !!tid,
    waiting: { marksToEnter, papersToSet, tasks: taskSummary(u) }, latestSlip: slip?.month ?? null, duties: u.duties ?? [] };
}
