import { db } from '../db.js';
import { toCsv } from '../import/csv.js';
import { computeSection } from '../exam/service.js';
import { remindTask } from '../tasks/service.js';
import { sectionLabel } from '../attendance/service.js';
import type { AuthUser } from '../auth.js';

/** Which marks are in and which are still missing, per paper and per teacher, for one exam or test. */
export function tracker(examId: number) {
  const exam = db.prepare('SELECT id, name, kind, status FROM exams WHERE id = ?').get(examId) as any; if (!exam) return null;
  const papers = (db.prepare(`SELECT p.id, p.section_id, c.grade, c.name || '-' || s.name section, sub.name subject, p.test_date, p.max_marks, t.id teacher_id, t.name teacher, t.user_id,
    (SELECT COUNT(*) FROM exam_marks m WHERE m.paper_id = p.id) entered, (SELECT COUNT(*) FROM students st WHERE st.section_id = p.section_id AND st.status = 'active') total
    FROM exam_papers p JOIN sections s ON s.id = p.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = p.subject_id LEFT JOIN teachers t ON t.id = p.teacher_id
    WHERE p.exam_id = ? ORDER BY c.grade, s.name, sub.name`).all(examId) as any[]).map(p => ({ ...p, state: p.total === 0 ? 'empty' : p.entered === 0 ? 'none' : p.entered < p.total ? 'partial' : 'complete' }));
  const by = new Map<string, any>();
  for (const p of papers) { const k = String(p.teacher_id ?? 0), e = by.get(k) ?? by.set(k, { teacher_id: p.teacher_id, teacher: p.teacher ?? 'No teacher assigned', user_id: p.user_id, papers: 0, complete: 0, pending: 0 }).get(k)!; e.papers++; if (p.state === 'complete') e.complete++; else if (p.state !== 'empty') e.pending++; }
  return { exam, papers, teachers: [...by.values()].sort((a, b) => b.pending - a.pending || a.teacher.localeCompare(b.teacher)), summary: { papers: papers.length, complete: papers.filter(p => p.state === 'complete').length, partial: papers.filter(p => p.state === 'partial').length, none: papers.filter(p => p.state === 'none').length } };
}
/** The marks list of one class: every student, every subject, total and position. CSV for Excel as well. */
export function classList(examId: number, sectionId: number) {
  if (!db.prepare('SELECT 1 FROM exams WHERE id = ?').get(examId) || !db.prepare('SELECT 1 FROM sections WHERE id = ?').get(sectionId)) return null;
  const r = computeSection(examId, sectionId, false), subjects = r.papers.map(p => ({ id: p.subject_id, name: p.subject, max: p.max_marks }));
  const rows = r.students.map(s => ({ roll_no: s.roll_no, reg_no: s.reg_no, name: s.name, father_name: s.father_name, marks: subjects.map(x => { const m = s.marks[x.id]; return m?.status === 'A' ? 'A' : m?.status === 'L' ? 'L' : m?.marks ?? ''; }), total: s.max ? s.total : null, max: s.max || null, pct: s.pct, rank: s.rank, result: s.result }));
  const csv = toCsv([['Roll No', 'Reg No', 'Name', "Father's name", ...subjects.map(x => `${x.name} (${x.max})`), 'Total', 'Out of', '%', 'Position', 'Result'], ...rows.map(x => [x.roll_no ?? '', x.reg_no, x.name, x.father_name, ...x.marks, x.total ?? '', x.max ?? '', x.pct ?? '', x.rank ?? '', x.result])]);
  return { exam: r.exam.name, section: sectionLabel(sectionId), subjects, rows, csv, incomplete: r.stats.incomplete };
}
export function remindTeacher(examId: number, teacherId: number, by: AuthUser): { task_id: number } | string {
  const t = db.prepare('SELECT id, user_id, name FROM teachers WHERE id = ?').get(teacherId) as any, e = db.prepare('SELECT name FROM exams WHERE id = ?').get(examId) as any;
  if (!t || !e) return 'Teacher or exam not found.'; if (!t.user_id) return `${t.name} has no login, so a reminder cannot be sent. Tell them in person.`;
  const left = db.prepare(`SELECT c.name || '-' || s.name || ' ' || sub.name label FROM exam_papers p JOIN sections s ON s.id = p.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = p.subject_id
    WHERE p.exam_id = ? AND p.teacher_id = ? AND (SELECT COUNT(*) FROM exam_marks m WHERE m.paper_id = p.id) < (SELECT COUNT(*) FROM students st WHERE st.section_id = p.section_id AND st.status = 'active') ORDER BY c.grade, s.name`).all(examId, teacherId) as { label: string }[];
  if (!left.length) return `${t.name} has no marks pending for this exam.`;
  return { task_id: remindTask(`Enter marks: ${e.name}`, `Pending: ${left.map(l => l.label).join(', ')}. Enter them under Examination > My papers, or upload the marks file.`, t.user_id, by.id, null) };
}
