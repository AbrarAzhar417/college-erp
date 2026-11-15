import { db, getSetting } from '../db.js';
import { addDays, dowOf, isDate, sectionLabel, todayISO } from '../attendance/service.js';
import { computeSection } from '../exam/service.js';
import { phoneIntl } from '../ptm/service.js';
import { isFull, type AuthUser } from '../auth.js';

db.exec(`
CREATE TABLE IF NOT EXISTS comm_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('circular','meeting','order','datesheet','result','notice')),
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}',
  audience TEXT NOT NULL CHECK (audience IN ('all','staff','teachers','parents')),
  class_ids TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','withdrawn')),
  ref_no TEXT, issue_date TEXT NOT NULL, signed_by TEXT NOT NULL DEFAULT 'Principal',
  created_by INTEGER REFERENCES users(id), published_by INTEGER REFERENCES users(id), published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS comm_reads (notice_id INTEGER NOT NULL REFERENCES comm_notices(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), read_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (notice_id, user_id));
CREATE TABLE IF NOT EXISTS comm_parent_sent (notice_id INTEGER NOT NULL REFERENCES comm_notices(id) ON DELETE CASCADE, student_id INTEGER NOT NULL REFERENCES students(id), sent_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (notice_id, student_id));
`);

export const KINDS: Record<string, { label: string; code: string }> = {
  circular: { label: 'Circular', code: 'CIR' }, meeting: { label: 'Meeting points', code: 'MTG' }, order: { label: 'Office order', code: 'ORD' },
  datesheet: { label: 'Date sheet', code: 'DS' }, result: { label: 'Result notification', code: 'RES' }, notice: { label: 'Notice', code: 'NTC' }
};
const AUDIENCES = ['all', 'staff', 'teachers', 'parents'];
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
export const isApprover = (u: AuthUser) => isFull(u.role);

export function checkNotice(b: any): { v: any } | string {
  const kind = b.kind; if (!KINDS[kind]) return 'Choose what kind of notice this is.';
  const title = str(b.title, 150); if (!title) return 'A title is required.';
  const audience = b.audience; if (!AUDIENCES.includes(audience)) return 'Choose who should receive it.';
  const classIds = [...new Set((Array.isArray(b.class_ids) ? b.class_ids : []).map(Number))].filter(Boolean) as number[];
  for (const c of classIds) if (!db.prepare('SELECT 1 FROM classes WHERE id = ?').get(c)) return 'A chosen class does not exist.';
  if (audience === 'parents' && !classIds.length) return 'Choose the classes whose parents should receive it.';
  const body = str(b.body, 8000), d = b.data ?? {}; let data: any = {};
  if (kind === 'meeting') {
    const points = (Array.isArray(d.points) ? d.points : []).map((p: any) => ({ text: str(p?.text, 600), assignee: str(p?.assignee, 80), due: p?.due ? String(p.due) : '' })).filter((p: any) => p.text);
    if (!points.length) return 'Write at least one meeting point.';
    for (const p of points) if (p.due && !isDate(p.due)) return 'A due date is not valid.';
    if (d.meeting_date && !isDate(d.meeting_date)) return 'Meeting date is not valid.';
    data = { meeting_date: d.meeting_date || '', time: str(d.time, 20), venue: str(d.venue, 80), attendees: str(d.attendees, 600), points };
  } else if (kind === 'datesheet') {
    const rows = (Array.isArray(d.rows) ? d.rows : []).map((r: any) => ({ date: String(r?.date ?? ''), subject: str(r?.subject, 80), time: str(r?.time, 30), class_label: str(r?.class_label, 40) })).filter((r: any) => r.subject || r.date);
    if (!rows.length) return 'Add at least one row to the date sheet.';
    for (const r of rows) { if (!isDate(r.date)) return `The date of ${r.subject || 'a row'} is not valid.`; if (!r.subject) return 'Every row needs a subject.'; }
    rows.sort((a: any, b: any) => a.class_label.localeCompare(b.class_label, undefined, { numeric: true }) || a.date.localeCompare(b.date));
    data = { exam_name: str(d.exam_name, 100), rows };
  } else if (kind === 'result') {
    const lines = (Array.isArray(d.lines) ? d.lines : []).map((l: any) => ({ class_label: str(l?.class_label, 40), pass_pct: l?.pass_pct ?? null, avg: l?.avg ?? null, top: str(l?.top, 120) })).filter((l: any) => l.class_label);
    if (!body && !lines.length) return 'Write the message or add class results.';
    data = { exam_name: str(d.exam_name, 100), exam_id: Number(d.exam_id) || null, lines };
  } else if (!body) return 'Write the text of the notice.';
  const issue = b.issue_date ? (isDate(b.issue_date) ? b.issue_date : null) : todayISO(); if (!issue) return 'Issue date is not valid.';
  return { v: { kind, title, body, data: JSON.stringify(data), audience, class_ids: JSON.stringify(classIds), priority: b.priority === 'urgent' ? 'urgent' : 'normal', issue_date: issue, signed_by: str(b.signed_by, 80) || 'Principal' } };
}

export function nextRef(kind: string, issueDate: string): string {
  const short = getSetting('short_name') || 'KMCB', year = issueDate.slice(0, 4), prefix = `${short}/${KINDS[kind].code}/${year}/`;
  const last = (db.prepare("SELECT ref_no FROM comm_notices WHERE ref_no LIKE ? ORDER BY CAST(SUBSTR(ref_no, ?) AS INTEGER) DESC LIMIT 1").get(`${prefix}%`, prefix.length + 1) as any)?.ref_no as string | undefined;
  return `${prefix}${String((last ? Number(last.slice(prefix.length)) : 0) + 1).padStart(3, '0')}`;
}
export function publish(id: number, userId: number): { ref_no: string } | string {
  const n = db.prepare('SELECT * FROM comm_notices WHERE id = ?').get(id) as any;
  if (!n) return 'Notice not found.'; if (n.status !== 'draft') return 'Only a draft can be published.';
  const ref = nextRef(n.kind, n.issue_date);
  db.prepare("UPDATE comm_notices SET status = 'published', ref_no = ?, published_by = ?, published_at = datetime('now') WHERE id = ?").run(ref, userId, id);
  return { ref_no: ref };
}

const rolesFor = (audience: string) => (audience === 'teachers' ? ['teacher'] : ['director', 'principal', 'admin', 'teacher', 'accountant']);
/** What a staff member sees: published notices (everything the parents are told too); managers also see drafts and withdrawn ones. */
export function inboxFor(u: AuthUser) {
  const approver = u.role === 'director' || u.role === 'principal' || u.role === 'admin';
  const rows = db.prepare(`SELECT n.*, (SELECT read_at FROM comm_reads r WHERE r.notice_id = n.id AND r.user_id = ?) read_at,
    (SELECT COUNT(*) FROM comm_reads r WHERE r.notice_id = n.id) reads FROM comm_notices n ${approver ? '' : "WHERE n.status = 'published'"} ORDER BY n.issue_date DESC, n.id DESC LIMIT 300`).all(u.id) as any[];
  return rows.map(n => ({ ...n, data: JSON.parse(n.data), class_ids: JSON.parse(n.class_ids), needs_ack: n.status === 'published' && n.audience !== 'parents' && rolesFor(n.audience).includes(u.role) && !n.read_at }));
}
export const unreadCount = (u: AuthUser) => inboxFor(u).filter(n => n.needs_ack).length;
export function ackReport(id: number) {
  const n = db.prepare('SELECT audience FROM comm_notices WHERE id = ?').get(id) as any; if (!n) return null;
  if (n.audience === 'parents') return { applies: false, users: [] as any[] };
  const users = db.prepare(`SELECT u.id, u.name, u.role, r.read_at FROM users u LEFT JOIN comm_reads r ON r.notice_id = ? AND r.user_id = u.id WHERE u.active = 1 AND u.role IN (${rolesFor(n.audience).map(() => '?').join(',')}) ORDER BY r.read_at IS NULL DESC, u.name`).all(id, ...rolesFor(n.audience));
  return { applies: true, users };
}

export function parentClasses(id: number) {
  const n = db.prepare('SELECT class_ids FROM comm_notices WHERE id = ?').get(id) as any; if (!n) return null;
  const ids = JSON.parse(n.class_ids) as number[];
  const sql = `SELECT s.id section_id, c.grade, c.name || '-' || s.name label, COUNT(st.id) students, SUM(EXISTS(SELECT 1 FROM comm_parent_sent ps WHERE ps.notice_id = ? AND ps.student_id = st.id)) sent
    FROM sections s JOIN classes c ON c.id = s.class_id LEFT JOIN students st ON st.section_id = s.id AND st.status = 'active' ${ids.length ? `WHERE c.id IN (${ids.map(() => '?').join(',')})` : ''} GROUP BY s.id ORDER BY c.grade, s.name`;
  return (db.prepare(sql).all(id, ...ids) as any[]).filter(r => r.students > 0).map(r => ({ ...r, sent: r.sent ?? 0 }));
}
export function parentRecipients(id: number, sectionId: number) {
  const n = db.prepare('SELECT * FROM comm_notices WHERE id = ?').get(id) as any; if (!n) return null;
  const school = getSetting('institute_name') || 'School', ids = JSON.parse(n.class_ids) as number[];
  const sec = db.prepare('SELECT class_id FROM sections WHERE id = ?').get(sectionId) as any;
  if (!sec || (ids.length && !ids.includes(sec.class_id))) return [];
  const body = n.body.replace(/\s+/g, ' ').trim(), short = body.length > 280 ? `${body.slice(0, 277)}...` : body;
  const msg = (father: string) => `Assalam o Alaikum ${father}. ${school}${n.ref_no ? ` (${n.ref_no})` : ''}: ${n.title}.${short ? ` ${short}` : ''} Please see the copy sent with your son.`;
  return (db.prepare(`SELECT st.id student_id, st.name, st.father_name, st.roll_no, st.phone, st.father_phone, st.mother_phone, (SELECT sent_at FROM comm_parent_sent ps WHERE ps.notice_id = ? AND ps.student_id = st.id) sent_at
    FROM students st WHERE st.section_id = ? AND st.status = 'active' ORDER BY st.roll_no, st.name`).all(id, sectionId) as any[]).map(r => ({
    student_id: r.student_id, name: r.name, father_name: r.father_name, roll_no: r.roll_no, phone: phoneIntl(r.father_phone) ?? phoneIntl(r.phone) ?? phoneIntl(r.mother_phone), sent: !!r.sent_at, message: msg(r.father_name) }));
}

// ---------- generators: fill in a date sheet or a result notice from the exam module ----------
export function datesheetFromExam(examId: number, classId?: number) {
  const exam = db.prepare('SELECT id, name, status FROM exams WHERE id = ?').get(examId) as any; if (!exam) return null;
  const rows = db.prepare(`SELECT DISTINCT c.grade, c.name AS class_label, sub.name AS subject, p.test_date AS date FROM exam_papers p JOIN sections s ON s.id = p.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = p.subject_id
    WHERE p.exam_id = ? AND p.test_date IS NOT NULL ${classId ? 'AND c.id = ?' : ''} ORDER BY c.grade, p.test_date, sub.name`).all(...(classId ? [examId, classId] : [examId])) as any[];
  const missing = (db.prepare(`SELECT COUNT(*) n FROM exam_papers p JOIN sections s ON s.id = p.section_id WHERE p.exam_id = ? AND p.test_date IS NULL ${classId ? 'AND s.class_id = ?' : ''}`).get(...(classId ? [examId, classId] : [examId])) as any).n as number;
  return { exam, missing, rows: rows.map(r => ({ class_label: r.class_label, subject: r.subject, date: r.date, day: ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dowOf(r.date)], time: '' })) };
}
export function resultFromExam(examId: number) {
  const exam = db.prepare('SELECT id, name, status FROM exams WHERE id = ?').get(examId) as any; if (!exam) return null;
  const secs = db.prepare('SELECT s.id FROM sections s JOIN exam_classes ec ON ec.class_id = s.class_id AND ec.exam_id = ? JOIN classes c ON c.id = s.class_id ORDER BY c.grade, s.name').all(examId) as { id: number }[];
  const lines: any[] = []; let skipped = 0;
  for (const s of secs) {
    const r = computeSection(examId, s.id, false);
    if (!r.stats.complete) { skipped++; continue; }
    const top = r.students.filter(x => x.rank === 1)[0];
    lines.push({ class_label: sectionLabel(s.id), pass_pct: r.stats.passPct, avg: r.stats.avg, top: top ? `${top.name} (${top.pct}%)` : '' });
  }
  return { exam, skipped, lines };
}
export { addDays };
