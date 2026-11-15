import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { canSection, isManager, sectionLabel } from '../attendance/service.js';
import { institute } from '../fee/service.js';
import { addLateStudents, checkSlotUpdate, classReport, createMeeting, invitations, slotOf, studentReport, syncFollowup } from './service.js';

export const ptmRouter = Router();
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const manager = requireRole('director', 'principal', 'admin');
// Class teachers work on their own class; the office sees everything. Accountants have no access.
ptmRouter.use(requireRole('director', 'principal', 'admin', 'teacher'));

ptmRouter.get('/', (req, res) => {
  const rows = db.prepare(`SELECT m.*, e.name exam_name, (SELECT COUNT(*) FROM ptm_slots WHERE meeting_id = m.id) total,
    (SELECT COUNT(*) FROM ptm_slots WHERE meeting_id = m.id AND status = 'attended') attended, (SELECT COUNT(*) FROM ptm_slots WHERE meeting_id = m.id AND status = 'no_show') no_show
    FROM ptm_meetings m LEFT JOIN exams e ON e.id = m.exam_id ORDER BY m.date DESC, m.id DESC`).all() as any[];
  res.json(isManager(req.user!) ? rows : rows.filter(m => (db.prepare('SELECT section_id FROM ptm_slots WHERE meeting_id = ?').all(m.id) as any[]).some(s => canSection(req.user!, s.section_id))));
});
ptmRouter.post('/', manager, (req, res) => { const r = createMeeting(req.body ?? {}, req.user!.id); typeof r === 'string' ? bad(res, r) : res.status(201).json(r); });
ptmRouter.put('/:id', manager, (req, res) => {
  const id = Number(req.params.id), m = db.prepare('SELECT id FROM ptm_meetings WHERE id = ?').get(id);
  if (!m) return res.status(404).json({ message: 'Meeting not found.' });
  const b = req.body ?? {}, title = typeof b.title === 'string' ? b.title.trim().slice(0, 100) : '', date = b.date, venue = typeof b.venue === 'string' ? b.venue.trim().slice(0, 100) : null;
  if (!title) return res.status(400).json({ message: 'Write a title for the meeting.' });
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return res.status(400).json({ message: 'Choose the meeting date.' });
  db.prepare('UPDATE ptm_meetings SET title = ?, date = ?, venue = ? WHERE id = ?').run(title, date, venue || null, id);
  res.json({ ok: true });
});
ptmRouter.delete('/:id', manager, (req, res) => { db.prepare('DELETE FROM ptm_meetings WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

ptmRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id), m = db.prepare('SELECT m.*, e.name exam_name FROM ptm_meetings m LEFT JOIN exams e ON e.id = m.exam_id WHERE m.id = ?').get(id) as any;
  if (!m) return bad(res, 'Meeting not found.', 404);
  const secs = (db.prepare(`SELECT section_id id, COUNT(*) total, SUM(status='attended') attended, SUM(status='no_show') no_show FROM ptm_slots WHERE meeting_id = ? GROUP BY section_id`).all(id) as any[])
    .filter(s => canSection(req.user!, s.id)).map(s => ({ ...s, label: sectionLabel(s.id) }));
  res.json({ ...m, sections: secs });
});
ptmRouter.post('/:id/add-late', manager, (req, res) => res.json({ added: addLateStudents(Number(req.params.id)) }));

ptmRouter.get('/:id/sections/:sid/report', (req, res) => {
  const sid = Number(req.params.sid); if (!canSection(req.user!, sid)) return bad(res, 'This is not your class.', 403);
  const r = classReport(Number(req.params.id), sid); r ? res.json(r) : bad(res, 'Nothing scheduled for this class.', 404);
});
ptmRouter.get('/:id/sections/:sid/invites', (req, res) => {
  const sid = Number(req.params.sid); if (!canSection(req.user!, sid)) return bad(res, 'This is not your class.', 403);
  res.json(invitations(Number(req.params.id), sid, institute().name || 'School'));
});
/** All students of a class in one go, for printing a sheet per parent. */
ptmRouter.get('/:id/sections/:sid/student-reports', (req, res) => {
  const id = Number(req.params.id), sid = Number(req.params.sid); if (!canSection(req.user!, sid)) return bad(res, 'This is not your class.', 403);
  const slots = db.prepare('SELECT student_id FROM ptm_slots WHERE meeting_id = ? AND section_id = ? ORDER BY slot_time').all(id, sid) as { student_id: number }[];
  res.json(slots.map(s => studentReport(id, s.student_id)).filter(Boolean));
});
ptmRouter.get('/:id/students/:stid/report', (req, res) => {
  const id = Number(req.params.id), stid = Number(req.params.stid);
  const sl = db.prepare('SELECT section_id FROM ptm_slots WHERE meeting_id = ? AND student_id = ?').get(id, stid) as any;
  if (!sl) return bad(res, 'This student is not in the meeting.', 404);
  if (!canSection(req.user!, sl.section_id)) return bad(res, 'This is not your class.', 403);
  res.json(studentReport(id, stid));
});

ptmRouter.put('/slots/:slotId', (req, res) => {
  const slot = slotOf(Number(req.params.slotId)); if (!slot) return bad(res, 'Slot not found.', 404);
  if (!canSection(req.user!, slot.section_id)) return bad(res, 'This is not your class.', 403);
  const v = checkSlotUpdate(req.body ?? {}, slot); if (typeof v === 'string') return bad(res, v);
  const keys = Object.keys(v.sets);
  db.prepare(`UPDATE ptm_slots SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).run(...keys.map(k => v.sets[k]), req.user!.id, slot.id);
  if (v.sets.status) syncFollowup(slot, v.sets.status, (db.prepare('SELECT date FROM ptm_meetings WHERE id = ?').get(slot.meeting_id) as any).date);
  res.json({ ok: true });
});
ptmRouter.put('/slots/:slotId/notified', (req, res) => {
  const slot = slotOf(Number(req.params.slotId)); if (!slot) return bad(res, 'Slot not found.', 404);
  if (!canSection(req.user!, slot.section_id)) return bad(res, 'This is not your class.', 403);
  db.prepare("UPDATE ptm_slots SET notified_at = datetime('now') WHERE id = ?").run(slot.id); res.json({ ok: true });
});
