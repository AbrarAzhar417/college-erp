import { db } from '../db.js';
import { isFull, type AuthUser } from '../auth.js';
import { addDays, isDate, isManager, myTeacherId, todayISO } from '../attendance/service.js';

db.exec(`
-- What the class is told: homework, classwork, tests, notices. One row per subject per day per section.
CREATE TABLE IF NOT EXISTS diary_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  subject_id INTEGER REFERENCES subjects(id),
  kind TEXT NOT NULL CHECK (kind IN ('homework','classwork','test','notice')),
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', due_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_diary_section_date ON diary_entries(section_id, date);
-- The teacher's own daily record: what was taught, what comes next. The principal can review it.
CREATE TABLE IF NOT EXISTS teacher_diary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  section_id INTEGER REFERENCES sections(id),
  subject_id INTEGER REFERENCES subjects(id),
  topic TEXT NOT NULL, plan_next TEXT NOT NULL DEFAULT '', remarks TEXT NOT NULL DEFAULT '',
  reviewed_by INTEGER REFERENCES users(id), reviewed_at TEXT, review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tdiary_user_date ON teacher_diary(user_id, date);
-- A line about one student for the parents; the parent's signature is recorded as "seen".
CREATE TABLE IF NOT EXISTS diary_student_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('praise','concern','late','uniform','homework_missing','other')),
  note TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  parent_seen INTEGER NOT NULL DEFAULT 0, parent_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dnotes_student ON diary_student_notes(student_id, date);
`);

export const KINDS = ['homework', 'classwork', 'test', 'notice'] as const;
export const NOTE_KINDS = ['praise', 'concern', 'late', 'uniform', 'homework_missing', 'other'] as const;
const clean = (v: unknown, n: number) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);

/** Sections (with subjects) a user may write a class diary for. Managers: everything. Teachers: where they teach (timetable) or are class teacher. */
export function postingScope(u: AuthUser) {
  const sections = db.prepare(`SELECT s.id, c.grade, c.name || '-' || s.name AS label FROM sections s JOIN classes c ON c.id = s.class_id ORDER BY c.grade, s.name`).all() as { id: number; grade: number; label: string }[];
  const subjects = db.prepare('SELECT id, name FROM subjects ORDER BY name').all() as { id: number; name: string }[];
  if (isManager(u)) return sections.map(s => ({ ...s, class_teacher: false, subjects }));
  const t = myTeacherId(u.id); if (!t) return [];
  const ct = new Set((db.prepare('SELECT id FROM sections WHERE class_teacher_id = ?').all(t) as any[]).map(r => r.id));
  const taught = new Map<number, Set<number>>();
  for (const r of db.prepare('SELECT DISTINCT section_id, subject_id FROM tt_slots WHERE teacher_id = ?').all(t) as any[]) (taught.get(r.section_id) ?? taught.set(r.section_id, new Set()).get(r.section_id)!).add(r.subject_id);
  return sections.filter(s => ct.has(s.id) || taught.has(s.id)).map(s => ({ ...s, class_teacher: ct.has(s.id), subjects: ct.has(s.id) ? subjects : subjects.filter(x => taught.get(s.id)?.has(x.id)) }));
}
export const canPost = (u: AuthUser, sectionId: number, subjectId: number | null) => {
  const s = postingScope(u).find(x => x.id === sectionId);
  return !!s && (subjectId === null ? s.class_teacher || isManager(u) : s.subjects.some(x => x.id === subjectId));
};

export interface ClassBody { date?: string; section_id?: number; subject_id?: number | null; kind?: string; title?: string; body?: string; due_date?: string | null }
/** Checks and tidies a class diary entry. Returns the clean values or a message. */
export function checkClassEntry(b: ClassBody, u: AuthUser): string | { date: string; section_id: number; subject_id: number | null; kind: string; title: string; body: string; due_date: string | null } {
  if (!isDate(b.date)) return 'Choose the date.';
  const today = todayISO();
  if (b.date > addDays(today, 14)) return 'The date is too far ahead (at most 14 days).';
  if (!isManager(u) && b.date < addDays(today, -7)) return 'Teachers can write for the last 7 days and the coming days only.';
  const section_id = Number(b.section_id), subject_id = b.subject_id ? Number(b.subject_id) : null;
  if (!Number.isInteger(section_id) || !db.prepare('SELECT 1 FROM sections WHERE id = ?').get(section_id)) return 'Choose a class and section.';
  if (subject_id !== null && !db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(subject_id)) return 'That subject does not exist.';
  if (!KINDS.includes(b.kind as any)) return 'Choose homework, classwork, test or notice.';
  if (!canPost(u, section_id, subject_id)) return subject_id === null ? 'Only the class teacher can post a general notice.' : 'You do not teach this subject in this class.';
  const title = clean(b.title, 120); if (!title) return 'Write a short title.';
  let due: string | null = null;
  if (b.due_date) { if (!isDate(b.due_date)) return 'The due date is not valid.'; if (b.due_date < b.date) return 'The due date cannot be before the diary date.'; due = b.due_date; }
  return { date: b.date, section_id, subject_id, kind: b.kind!, title, body: clean(b.body, 2000), due_date: due };
}

export const canChangeEntry = (u: AuthUser, createdBy: number, date: string) => isManager(u) || (createdBy === u.id && date >= addDays(todayISO(), -7));

export function classEntries(sectionId: number, from: string, to: string, u: AuthUser) {
  const rows = db.prepare(`SELECT e.id, e.date, e.section_id, e.subject_id, sj.name AS subject, e.kind, e.title, e.body, e.due_date, e.created_by, us.name AS posted_by, e.created_at
    FROM diary_entries e LEFT JOIN subjects sj ON sj.id = e.subject_id JOIN users us ON us.id = e.created_by
    WHERE e.section_id = ? AND e.date BETWEEN ? AND ? ORDER BY e.date DESC, sj.name, e.id`).all(sectionId, from, to) as any[];
  return rows.map(r => ({ ...r, can_edit: canChangeEntry(u, r.created_by, r.date) }));
}

export interface TeacherBody { date?: string; section_id?: number | null; subject_id?: number | null; topic?: string; plan_next?: string; remarks?: string }
export function checkTeacherEntry(b: TeacherBody) {
  if (!isDate(b.date)) return 'Choose the date.';
  if (b.date > todayISO()) return 'A teacher diary line cannot be written for a future day.';
  const section_id = b.section_id ? Number(b.section_id) : null, subject_id = b.subject_id ? Number(b.subject_id) : null;
  if (section_id !== null && !db.prepare('SELECT 1 FROM sections WHERE id = ?').get(section_id)) return 'That section does not exist.';
  if (subject_id !== null && !db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(subject_id)) return 'That subject does not exist.';
  const topic = clean(b.topic, 300); if (!topic) return 'Write what was taught.';
  return { date: b.date, section_id, subject_id, topic, plan_next: clean(b.plan_next, 500), remarks: clean(b.remarks, 1000) };
}

/** Teachers only ever see their own lines. The director and principal can see everybody's. */
export function teacherEntries(u: AuthUser, from: string, to: string, userId?: number) {
  const reviewer = isFull(u.role);
  const who = reviewer ? userId : u.id;
  const rows = db.prepare(`SELECT d.*, us.name AS teacher, c.name || '-' || s.name AS section, sj.name AS subject, rv.name AS reviewed_by_name
    FROM teacher_diary d JOIN users us ON us.id = d.user_id LEFT JOIN sections s ON s.id = d.section_id LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN subjects sj ON sj.id = d.subject_id LEFT JOIN users rv ON rv.id = d.reviewed_by
    WHERE d.date BETWEEN ? AND ? ${who ? 'AND d.user_id = ?' : ''} ORDER BY d.date DESC, us.name, d.id`).all(...(who ? [from, to, who] : [from, to])) as any[];
  return rows.map(r => ({ ...r, can_edit: r.user_id === u.id && !r.reviewed_at }));
}

export interface NoteBody { date?: string; kind?: string; note?: string }
export function checkNote(b: NoteBody) {
  if (!isDate(b.date) || b.date > todayISO()) return 'Choose today or an earlier date.';
  if (!NOTE_KINDS.includes(b.kind as any)) return 'Choose the kind of note.';
  const note = clean(b.note, 500); if (!note) return 'Write the note.';
  return { date: b.date, kind: b.kind!, note };
}
/** The class teacher, a teacher of that section, or the office. */
export function canNoteStudent(u: AuthUser, studentId: number): boolean {
  if (isManager(u)) return true;
  const st = db.prepare('SELECT section_id FROM students WHERE id = ?').get(studentId) as { section_id: number } | undefined;
  return !!st && postingScope(u).some(s => s.id === st.section_id);
}

/** For a day: sections nobody wrote a class diary for, and teachers with lessons that day but no teacher diary line. */
export function missingOn(date: string) {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() || 7);
  const sections = db.prepare(`SELECT s.id, c.name || '-' || s.name AS label FROM sections s JOIN classes c ON c.id = s.class_id
    WHERE EXISTS (SELECT 1 FROM students st WHERE st.section_id = s.id AND st.status = 'active') AND EXISTS (SELECT 1 FROM tt_slots t WHERE t.section_id = s.id AND t.day = ?)
      AND NOT EXISTS (SELECT 1 FROM diary_entries e WHERE e.section_id = s.id AND e.date = ?) ORDER BY c.grade, s.name`).all(dow, date);
  const teachers = db.prepare(`SELECT DISTINCT t.id, t.name FROM teachers t JOIN tt_slots x ON x.teacher_id = t.id AND x.day = ? WHERE t.active = 1 AND t.user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM teacher_diary d WHERE d.user_id = t.user_id AND d.date = ?) ORDER BY t.name`).all(dow, date);
  return { date, sections, teachers };
}
