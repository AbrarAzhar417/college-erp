import { db } from '../db.js';
import { isDate, todayISO } from '../attendance/service.js';
import { sniff } from '../myfiles/service.js';
import { remindTask } from '../tasks/service.js';
import type { AuthUser } from '../auth.js';

db.exec(`
CREATE TABLE IF NOT EXISTS paper_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER REFERENCES exams(id), title TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id), subject_id INTEGER NOT NULL REFERENCES subjects(id), teacher_user_id INTEGER NOT NULL REFERENCES users(id),
  due_date TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', copies INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','submitted','returned','approved','printed')),
  version INTEGER NOT NULL DEFAULT 0, filename TEXT, mime TEXT, size INTEGER, data BLOB, submitted_at TEXT,
  remark TEXT, reviewed_by INTEGER REFERENCES users(id), reviewed_at TEXT,
  print_count INTEGER NOT NULL DEFAULT 0, printed_at TEXT, printed_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_paper_req_teacher ON paper_requests(teacher_user_id, status);
`);
export const STATUS_LABEL: Record<string, string> = { requested: 'Waiting for teacher', submitted: 'Submitted', returned: 'Sent back', approved: 'Approved', printed: 'Printed' };
const MAX_PAPER = 10 * 1024 * 1024;
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function createRequests(b: any, by: AuthUser): { ids: number[] } | string {
  const exam = b.exam_id ? (db.prepare('SELECT id, name FROM exams WHERE id = ?').get(Number(b.exam_id)) as any) : null;
  if (b.exam_id && !exam) return 'That exam does not exist.';
  const title = str(b.title, 120) || (exam ? `${exam.name} paper` : ''); if (!title) return 'Give the paper request a title.';
  if (!isDate(b.due_date)) return 'Choose the last date to submit.'; if (b.due_date < todayISO()) return 'The last date is in the past.';
  const items = Array.isArray(b.items) ? b.items : []; if (!items.length) return 'Add at least one class and subject.'; if (items.length > 300) return 'Too many items in one go (limit 300).';
  const rows: { class_id: number; subject_id: number; teacher: number; copies: number }[] = [], seen = new Set<string>();
  for (const it of items) {
    const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(Number(it.class_id)) as any, sub = db.prepare('SELECT id, name FROM subjects WHERE id = ?').get(Number(it.subject_id)) as any;
    if (!cls || !sub) return 'A class or subject in the list does not exist.';
    if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'teacher' AND active = 1").get(Number(it.teacher_user_id))) return `Choose a teacher for ${cls.name} ${sub.name}.`;
    const key = `${cls.id}|${sub.id}`; if (seen.has(key)) return `${cls.name} ${sub.name} is in the list twice.`; seen.add(key);
    if (db.prepare("SELECT 1 FROM paper_requests WHERE COALESCE(exam_id,0) = ? AND class_id = ? AND subject_id = ?").get(exam?.id ?? 0, cls.id, sub.id)) return `${cls.name} ${sub.name} already has a paper request for this exam.`;
    const copies = it.copies === undefined || it.copies === '' ? (db.prepare("SELECT COUNT(*) n FROM students st JOIN sections s ON s.id = st.section_id WHERE s.class_id = ? AND st.status = 'active'").get(cls.id) as any).n : Math.round(Number(it.copies));
    if (!(copies >= 0 && copies <= 3000)) return 'Number of copies must be 0 to 3000.';
    rows.push({ class_id: cls.id, subject_id: sub.id, teacher: Number(it.teacher_user_id), copies });
  }
  const ins = db.prepare('INSERT INTO paper_requests (exam_id,title,class_id,subject_id,teacher_user_id,due_date,instructions,copies,created_by) VALUES (?,?,?,?,?,?,?,?,?)');
  const ids = db.transaction(() => rows.map(r => Number(ins.run(exam?.id ?? null, title, r.class_id, r.subject_id, r.teacher, b.due_date, str(b.instructions, 1000), r.copies, by.id).lastInsertRowid)))();
  return { ids };
}
/** Class, subject and teacher pairs already planned in the exam module; saves typing them again. */
export const suggestFromExam = (examId: number) => (db.prepare(`SELECT DISTINCT c.id class_id, c.name class_name, c.grade, sub.id subject_id, sub.name subject, u.id teacher_user_id, u.name teacher
  FROM exam_papers p JOIN sections s ON s.id = p.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = p.subject_id
  LEFT JOIN teachers t ON t.id = p.teacher_id LEFT JOIN users u ON u.id = t.user_id AND u.active = 1 AND u.role = 'teacher' WHERE p.exam_id = ? ORDER BY c.grade, sub.name`).all(examId) as any[])
  .filter((r, i, a) => a.findIndex(x => x.class_id === r.class_id && x.subject_id === r.subject_id) === i);

export function checkPaperFile(buf: Buffer, name: string, ctype: string): { name: string; mime: string } | string {
  if (Buffer.isBuffer(buf) && buf.length > MAX_PAPER) return 'The file is larger than 10 MB.';
  const clean = name.replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'paper', t = sniff(buf, clean, ctype); if (typeof t === 'string') return t;
  if (!/^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|image\/(jpeg|png))$/.test(t.mime)) return 'Upload the paper as PDF, Word, JPG or PNG.';
  return { name: clean, mime: t.mime };
}
const get = (id: number) => db.prepare('SELECT * FROM paper_requests WHERE id = ?').get(id) as any;
export function submit(id: number, u: AuthUser, buf: Buffer, name: string, ctype: string): { version: number } | string {
  const r = get(id); if (!r || r.teacher_user_id !== u.id) return 'Paper request not found.';
  if (r.status === 'approved' || r.status === 'printed') return 'This paper is already approved. Ask the Exam Department to send it back first.';
  const f = checkPaperFile(buf, name, ctype); if (typeof f === 'string') return f;
  db.prepare("UPDATE paper_requests SET filename=?, mime=?, size=?, data=?, version=version+1, status='submitted', submitted_at=datetime('now'), remark=NULL WHERE id=?").run(f.name, f.mime, buf.length, buf, id);
  return { version: r.version + 1 };
}
export function review(id: number, action: string, remark: unknown, u: AuthUser): { status: string } | string {
  const r = get(id); if (!r) return 'Paper request not found.';
  if (r.status !== 'submitted') return 'Only a submitted paper can be reviewed.';
  const rem = str(remark, 500); if (action === 'return' && !rem) return 'Write what the teacher should change.';
  if (action !== 'approve' && action !== 'return') return 'Unknown action.';
  const status = action === 'approve' ? 'approved' : 'returned';
  db.prepare("UPDATE paper_requests SET status=?, remark=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?").run(status, rem || null, u.id, id); return { status };
}
export function markPrinted(id: number, u: AuthUser, copies?: unknown): { print_count: number } | string {
  const r = get(id); if (!r) return 'Paper request not found.'; if (r.status !== 'approved' && r.status !== 'printed') return 'Only an approved paper can be printed.';
  const c = copies === undefined || copies === '' ? r.copies : Math.round(Number(copies)); if (!(c >= 0 && c <= 3000)) return 'Number of copies must be 0 to 3000.';
  db.prepare("UPDATE paper_requests SET status='printed', copies=?, print_count=print_count+1, printed_at=datetime('now'), printed_by=? WHERE id=?").run(c, u.id, id); return { print_count: r.print_count + 1 };
}
export function remind(id: number, u: AuthUser): { task_id: number } | string {
  const r = get(id); if (!r) return 'Paper request not found.'; if (r.status !== 'requested' && r.status !== 'returned') return 'The teacher has nothing pending on this paper.';
  const info = db.prepare('SELECT c.name cls, s.name sub FROM classes c, subjects s WHERE c.id = ? AND s.id = ?').get(r.class_id, r.subject_id) as any;
  return { task_id: remindTask(`Submit paper: ${info.cls} ${info.sub}`, `${r.title}. Last date ${r.due_date}.${r.remark ? ` Please change: ${r.remark}` : ''} Upload it under Paper Setting.`, r.teacher_user_id, u.id, r.due_date) };
}
export function listRequests(u: AuthUser, dept: boolean, q: { exam_id?: number; status?: string; teacher?: number }) {
  const where: string[] = [], args: any[] = [];
  if (!dept) { where.push('p.teacher_user_id = ?'); args.push(u.id); } else if (q.teacher) { where.push('p.teacher_user_id = ?'); args.push(q.teacher); }
  if (q.exam_id) { where.push('p.exam_id = ?'); args.push(q.exam_id); } if (q.status && STATUS_LABEL[q.status]) { where.push('p.status = ?'); args.push(q.status); }
  const today = todayISO();
  return (db.prepare(`SELECT p.id, p.exam_id, p.title, p.class_id, c.name class_name, c.grade, p.subject_id, sub.name subject, p.teacher_user_id, u.name teacher, p.due_date, p.instructions, p.copies, p.status, p.version, p.filename, p.size, p.submitted_at, p.remark, p.print_count, p.printed_at
    FROM paper_requests p JOIN classes c ON c.id = p.class_id JOIN subjects sub ON sub.id = p.subject_id JOIN users u ON u.id = p.teacher_user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.due_date, c.grade, sub.name LIMIT 600`).all(...args) as any[])
    .map(r => ({ ...r, overdue: (r.status === 'requested' || r.status === 'returned') && r.due_date < today, can_submit: (r.status === 'requested' || r.status === 'returned' || r.status === 'submitted') && r.teacher_user_id === u.id }));
}
export function summary(rows: { status: string; overdue: boolean }[]) {
  const n = (s: string) => rows.filter(r => r.status === s).length;
  return { total: rows.length, requested: n('requested'), submitted: n('submitted'), returned: n('returned'), approved: n('approved'), printed: n('printed'), overdue: rows.filter(r => r.overdue).length };
}
