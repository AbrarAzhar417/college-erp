import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { addDays, isDate, isManager, todayISO } from '../attendance/service.js';
import { canChangeEntry, canNoteStudent, checkClassEntry, checkNote, checkTeacherEntry, classEntries, missingOn, postingScope, teacherEntries } from './service.js';

export const diaryRouter = Router();
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const reviewer = requireRole('director', 'principal');
// Accountants have no diary access; everyone else on the staff does (what they may write is checked per entry).
diaryRouter.use(requireRole('director', 'principal', 'admin', 'teacher'));

const range = (q: any) => {
  const from = isDate(q.from) ? q.from : q.date && isDate(q.date) ? q.date : addDays(todayISO(), -7), to = isDate(q.to) ? q.to : q.date && isDate(q.date) ? q.date : addDays(todayISO(), 14);
  return from <= to && Date.parse(to) - Date.parse(from) <= 93 * 86400000 ? { from, to } : null;
};

diaryRouter.get('/scope', (req, res) => res.json({ today: todayISO(), sections: postingScope(req.user!) }));

// ---------- class diary ----------
diaryRouter.get('/class', (req, res) => {
  const sid = Number(req.query.section_id), r = range(req.query);
  if (!Number.isInteger(sid) || !sid) return bad(res, 'Choose a class and section.');
  if (!r) return bad(res, 'Choose a date range of up to 3 months.');
  res.json(classEntries(sid, r.from, r.to, req.user!));
});
diaryRouter.post('/class', (req, res) => {
  const v = checkClassEntry(req.body ?? {}, req.user!);
  if (typeof v === 'string') return bad(res, v, v.startsWith('Only the class teacher') || v.startsWith('You do not teach') ? 403 : 400);
  const r = db.prepare('INSERT INTO diary_entries (date, section_id, subject_id, kind, title, body, due_date, created_by) VALUES (?,?,?,?,?,?,?,?)').run(v.date, v.section_id, v.subject_id, v.kind, v.title, v.body, v.due_date, req.user!.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
diaryRouter.put('/class/:id', (req, res) => {
  const cur = db.prepare('SELECT created_by, date FROM diary_entries WHERE id = ?').get(Number(req.params.id)) as any;
  if (!cur) return bad(res, 'Entry not found.', 404);
  if (!canChangeEntry(req.user!, cur.created_by, cur.date)) return bad(res, 'You can change only your own recent entries.', 403);
  const v = checkClassEntry(req.body ?? {}, req.user!);
  if (typeof v === 'string') return bad(res, v);
  db.prepare("UPDATE diary_entries SET date=?, section_id=?, subject_id=?, kind=?, title=?, body=?, due_date=?, updated_at=datetime('now') WHERE id=?").run(v.date, v.section_id, v.subject_id, v.kind, v.title, v.body, v.due_date, Number(req.params.id));
  res.json({ ok: true });
});
diaryRouter.delete('/class/:id', (req, res) => {
  const cur = db.prepare('SELECT created_by, date FROM diary_entries WHERE id = ?').get(Number(req.params.id)) as any;
  if (!cur) return bad(res, 'Entry not found.', 404);
  if (!canChangeEntry(req.user!, cur.created_by, cur.date)) return bad(res, 'You can delete only your own recent entries.', 403);
  db.prepare('DELETE FROM diary_entries WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- teacher diary ----------
diaryRouter.get('/teacher', (req, res) => {
  const r = range(req.query); if (!r) return bad(res, 'Choose a date range of up to 3 months.');
  res.json(teacherEntries(req.user!, r.from, r.to, Number(req.query.user_id) || undefined));
});
diaryRouter.post('/teacher', (req, res) => {
  if (req.user!.role === 'admin') return bad(res, 'The teacher diary is for teachers, the principal and the director.', 403);
  const v = checkTeacherEntry(req.body ?? {}); if (typeof v === 'string') return bad(res, v);
  const r = db.prepare('INSERT INTO teacher_diary (user_id, date, section_id, subject_id, topic, plan_next, remarks) VALUES (?,?,?,?,?,?,?)').run(req.user!.id, v.date, v.section_id, v.subject_id, v.topic, v.plan_next, v.remarks);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
diaryRouter.put('/teacher/:id', (req, res) => {
  const cur = db.prepare('SELECT user_id, reviewed_at FROM teacher_diary WHERE id = ?').get(Number(req.params.id)) as any;
  if (!cur) return bad(res, 'Entry not found.', 404);
  if (cur.user_id !== req.user!.id) return bad(res, 'Only the author can change a diary line.', 403);
  if (cur.reviewed_at) return bad(res, 'This line was reviewed and is locked.', 409);
  const v = checkTeacherEntry(req.body ?? {}); if (typeof v === 'string') return bad(res, v);
  db.prepare("UPDATE teacher_diary SET date=?, section_id=?, subject_id=?, topic=?, plan_next=?, remarks=?, updated_at=datetime('now') WHERE id=?").run(v.date, v.section_id, v.subject_id, v.topic, v.plan_next, v.remarks, Number(req.params.id));
  res.json({ ok: true });
});
diaryRouter.delete('/teacher/:id', (req, res) => {
  const cur = db.prepare('SELECT user_id, reviewed_at FROM teacher_diary WHERE id = ?').get(Number(req.params.id)) as any;
  if (!cur) return bad(res, 'Entry not found.', 404);
  if (cur.user_id !== req.user!.id) return bad(res, 'Only the author can delete a diary line.', 403);
  if (cur.reviewed_at) return bad(res, 'This line was reviewed and is locked.', 409);
  db.prepare('DELETE FROM teacher_diary WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
diaryRouter.put('/teacher/:id/review', reviewer, (req, res) => {
  const note = String(req.body?.note ?? '').trim().slice(0, 300);
  const r = db.prepare("UPDATE teacher_diary SET reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?").run(req.user!.id, note || null, Number(req.params.id));
  if (!r.changes) return bad(res, 'Entry not found.', 404);
  res.json({ ok: true });
});

// ---------- notes about one student (for the parents) ----------
diaryRouter.get('/students/:id/notes', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) return bad(res, 'Student not found.', 404);
  if (!canNoteStudent(req.user!, id)) return bad(res, 'You do not teach this student.', 403);
  res.json(db.prepare('SELECT n.id, n.date, n.kind, n.note, n.parent_seen, n.parent_seen_at, u.name AS by_name FROM diary_student_notes n JOIN users u ON u.id = n.created_by WHERE n.student_id = ? ORDER BY n.date DESC, n.id DESC LIMIT 200').all(id));
});
diaryRouter.post('/students/:id/notes', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM students WHERE id = ? AND status = 'active'").get(id)) return bad(res, 'Student not found.', 404);
  if (!canNoteStudent(req.user!, id)) return bad(res, 'You do not teach this student.', 403);
  const v = checkNote(req.body ?? {}); if (typeof v === 'string') return bad(res, v);
  const r = db.prepare('INSERT INTO diary_student_notes (student_id, date, kind, note, created_by) VALUES (?,?,?,?,?)').run(id, v.date, v.kind, v.note, req.user!.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
diaryRouter.put('/notes/:id/seen', (req, res) => {
  const n = db.prepare('SELECT student_id FROM diary_student_notes WHERE id = ?').get(Number(req.params.id)) as any;
  if (!n) return bad(res, 'Note not found.', 404);
  if (!canNoteStudent(req.user!, n.student_id)) return bad(res, 'You do not teach this student.', 403);
  const seen = req.body?.seen === false ? 0 : 1;
  db.prepare("UPDATE diary_student_notes SET parent_seen = ?, parent_seen_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ?").run(seen, seen, Number(req.params.id));
  res.json({ ok: true });
});
diaryRouter.delete('/notes/:id', (req, res) => {
  const n = db.prepare('SELECT created_by FROM diary_student_notes WHERE id = ?').get(Number(req.params.id)) as any;
  if (!n) return bad(res, 'Note not found.', 404);
  if (n.created_by !== req.user!.id && !isManager(req.user!)) return bad(res, 'You can delete only your own notes.', 403);
  db.prepare('DELETE FROM diary_student_notes WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- who has not written ----------
diaryRouter.get('/missing', reviewer, (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : todayISO();
  res.json(missingOn(date));
});
