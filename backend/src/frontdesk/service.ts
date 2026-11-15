import { db } from '../db.js';
import { addDays, isDate, todayISO } from '../attendance/service.js';

db.exec(`
CREATE TABLE IF NOT EXISTS fd_visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, cnic TEXT,
  purpose TEXT NOT NULL, meeting_with TEXT, badge_no TEXT,
  time_in TEXT NOT NULL, time_out TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fd_visitors_date ON fd_visitors(date);
CREATE TABLE IF NOT EXISTS fd_enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, child_name TEXT NOT NULL, parent_name TEXT NOT NULL, phone TEXT NOT NULL,
  grade INTEGER, source TEXT, category TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','visited','admitted','lost')),
  follow_up TEXT, notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS fd_gate_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  date TEXT NOT NULL, reason TEXT NOT NULL,
  taken_by TEXT NOT NULL, relation TEXT NOT NULL DEFAULT '', taker_cnic TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by INTEGER REFERENCES users(id), decided_at TEXT,
  left_at TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fd_pass_date ON fd_gate_passes(date);
`);

export const STATUSES = ['new', 'contacted', 'visited', 'admitted', 'lost'] as const;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const validTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const phoneOk = (s: string) => s.replace(/\D/g, '').length >= 10 && s.replace(/\D/g, '').length <= 13;

export function checkVisitor(b: any) {
  const name = str(b.name, 80), purpose = str(b.purpose, 200), phone = str(b.phone, 20);
  if (!name) return 'Visitor name is required.';
  if (!purpose) return 'Purpose of the visit is required.';
  if (phone && !phoneOk(phone)) return 'Phone number looks wrong.';
  const date = isDate(b.date) ? b.date : todayISO();
  if (b.time_in && !validTime(b.time_in)) return 'Time in must look like 09:30.';
  return { date, name, phone: phone || null, cnic: str(b.cnic, 20) || null, purpose, meeting_with: str(b.meeting_with, 80) || null, badge_no: str(b.badge_no, 20) || null, time_in: validTime(b.time_in) ? b.time_in : hhmm() };
}
export function signOut(id: number, time?: unknown) {
  const v = db.prepare('SELECT time_in, time_out FROM fd_visitors WHERE id = ?').get(id) as any;
  if (!v) return 'Visitor not found.';
  if (v.time_out) return 'This visitor is already signed out.';
  const t = validTime(time) ? time : hhmm();
  if (t < v.time_in) return 'Time out cannot be before time in.';
  db.prepare('UPDATE fd_visitors SET time_out = ? WHERE id = ?').run(t, id);
  return { time_out: t };
}

export function checkEnquiry(b: any) {
  const child = str(b.child_name, 80), parent = str(b.parent_name, 80), phone = str(b.phone, 20);
  if (!child || !parent) return 'Child name and parent name are required.';
  if (!phoneOk(phone)) return 'A valid phone number is required so the parent can be called back.';
  const grade = b.grade === null || b.grade === undefined || b.grade === '' ? null : Number(b.grade);
  if (grade !== null && !db.prepare('SELECT 1 FROM classes WHERE grade = ?').get(grade)) return 'That class does not exist.';
  const status = b.status ?? 'new';
  if (!STATUSES.includes(status)) return 'Unknown status.';
  const cat = b.category ? String(b.category).toUpperCase() : null;
  if (cat && !['A', 'B', 'C'].includes(cat)) return 'Category must be A, B or C.';
  if (b.follow_up && !isDate(b.follow_up)) return 'Follow-up date is not valid.';
  return { date: isDate(b.date) ? b.date : todayISO(), child_name: child, parent_name: parent, phone, grade, source: str(b.source, 40) || null, category: cat, status, follow_up: b.follow_up || null, notes: str(b.notes, 1000) };
}
/** Enquiries that need a call today or are overdue, oldest first. Closed ones never appear. */
export const followUpsDue = (today = todayISO()) => db.prepare("SELECT * FROM fd_enquiries WHERE follow_up IS NOT NULL AND follow_up <= ? AND status IN ('new','contacted','visited') ORDER BY follow_up, id").all(today);
export function enquirySummary() {
  const rows = db.prepare('SELECT status, COUNT(*) n FROM fd_enquiries GROUP BY status').all() as { status: string; n: number }[];
  const out: Record<string, number> = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export function checkPass(b: any) {
  const sid = Number(b.student_id);
  const st = db.prepare("SELECT id, status FROM students WHERE id = ?").get(sid) as any;
  if (!st) return 'Choose a student.';
  if (st.status !== 'active') return 'This student has left the school.';
  const taken = str(b.taken_by, 80), reason = str(b.reason, 200);
  if (!taken) return 'Write who is taking the student.';
  if (!reason) return 'Write the reason for leaving early.';
  return { student_id: sid, date: isDate(b.date) ? b.date : todayISO(), reason, taken_by: taken, relation: str(b.relation, 30), taker_cnic: str(b.taker_cnic, 20) || null };
}
export function decidePass(id: number, approve: boolean, userId: number) {
  const p = db.prepare('SELECT status FROM fd_gate_passes WHERE id = ?').get(id) as any;
  if (!p) return 'Gate pass not found.';
  if (p.status !== 'pending') return 'This pass has already been decided.';
  db.prepare("UPDATE fd_gate_passes SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(approve ? 'approved' : 'rejected', userId, id);
  return { status: approve ? 'approved' : 'rejected' };
}
/** The gate marks the student as gone only after approval, and only once. */
export function markLeft(id: number) {
  const p = db.prepare('SELECT status, left_at FROM fd_gate_passes WHERE id = ?').get(id) as any;
  if (!p) return 'Gate pass not found.';
  if (p.status !== 'approved') return 'Only an approved pass can be used at the gate.';
  if (p.left_at) return 'The student has already left on this pass.';
  const t = hhmm();
  db.prepare('UPDATE fd_gate_passes SET left_at = ? WHERE id = ?').run(t, id);
  return { left_at: t };
}
export const passesOn = (from: string, to: string) => db.prepare(`SELECT g.*, s.name student, s.reg_no, c.grade, sec.name section FROM fd_gate_passes g JOIN students s ON s.id = g.student_id JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id WHERE g.date BETWEEN ? AND ? ORDER BY g.date DESC, g.id DESC`).all(from, to);
export const rangeOf = (q: any) => { const to = isDate(q.to) ? q.to : isDate(q.date) ? q.date : todayISO(); const from = isDate(q.from) ? q.from : isDate(q.date) ? q.date : addDays(to, -7); return from <= to && Date.parse(to) - Date.parse(from) <= 93 * 86400000 ? { from, to } : null; };
