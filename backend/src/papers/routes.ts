import { teacherOpen } from '../policy.js';
import express, { Router } from 'express';
import { db } from '../db.js';
import { requireAccess, requireRole } from '../auth.js';
import { hasDuty } from '../duties.js';
import { createRequests, listRequests, markPrinted, remind, review, submit, suggestFromExam, summary } from './service.js';

export const papersRouter = Router();
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const code = (m: string) => (m.endsWith('not found.') ? 404 : 400);
const isDept = (u: any) => ['director', 'principal', 'admin'].includes(u.role) || hasDuty(u, 'exam_dept');
const dept = requireAccess(['director', 'principal', 'admin'], 'exam_dept');
papersRouter.use(requireRole('director', 'principal', 'admin', 'teacher'));

papersRouter.get('/', (req, res) => {
  const rows = listRequests(req.user!, isDept(req.user!), { exam_id: Number(req.query.exam_id) || undefined, status: req.query.status as string, teacher: Number(req.query.teacher) || undefined });
  res.json({ dept: isDept(req.user!), summary: summary(rows), items: rows });
});
papersRouter.get('/options', dept, (req, res) => res.json({
  classes: db.prepare('SELECT id, name, grade FROM classes ORDER BY grade').all(), subjects: db.prepare('SELECT id, name FROM subjects ORDER BY name').all(),
  teachers: db.prepare("SELECT id, name FROM users WHERE role = 'teacher' AND active = 1 ORDER BY name").all(), exams: db.prepare("SELECT id, name, session, status FROM exams ORDER BY COALESCE(start_date,'9999') DESC, id DESC").all()
}));
papersRouter.get('/suggest', dept, (req, res) => res.json(suggestFromExam(Number(req.query.exam_id))));
papersRouter.post('/', dept, (req, res) => { const r = createRequests(req.body ?? {}, req.user!); typeof r === 'string' ? bad(res, r) : res.status(201).json(r); });
/** Open teaching: a teacher starts a paper of their own for any class and subject, then uploads and downloads it like a requested one. */
papersRouter.get('/my-options', (req, res) => {
  if (!isDept(req.user!) && !teacherOpen()) return bad(res, 'Papers are made on request. Ask the exam department.', 403);
  res.json({ classes: db.prepare('SELECT id, name, grade FROM classes ORDER BY grade').all(), subjects: db.prepare('SELECT id, name FROM subjects ORDER BY name').all(), exams: db.prepare("SELECT id, name, session, status FROM exams ORDER BY COALESCE(start_date,'9999') DESC, id DESC").all() });
});
papersRouter.post('/mine', (req, res) => {
  if (req.user!.role !== 'teacher' || !teacherOpen()) return bad(res, 'Only teachers can start their own paper, and only while open teaching is on.', 403);
  const b = req.body ?? {};
  const r = createRequests({ exam_id: b.exam_id || null, title: b.title, due_date: b.due_date, instructions: b.instructions, items: [{ class_id: b.class_id, subject_id: b.subject_id, teacher_user_id: req.user!.id, copies: b.copies }] }, req.user!);
  typeof r === 'string' ? bad(res, r) : res.status(201).json(r);
});
papersRouter.put('/:id/upload', express.raw({ type: () => true, limit: '11mb' }), (req, res) => {
  const r = submit(Number(req.params.id), req.user!, req.body, String(req.query.name ?? 'paper'), String(req.headers['content-type'] ?? '')); typeof r === 'string' ? bad(res, r, code(r)) : res.json(r);
});
papersRouter.get('/:id/file', (req, res) => {
  const f = db.prepare('SELECT teacher_user_id, filename, mime, data FROM paper_requests WHERE id = ? AND data IS NOT NULL').get(Number(req.params.id)) as any;
  if (!f || !(isDept(req.user!) || f.teacher_user_id === req.user!.id)) return bad(res, 'File not found.', 404);
  res.json({ filename: f.filename, mime: f.mime, base64: Buffer.from(f.data).toString('base64') });
});
papersRouter.put('/:id/review', dept, (req, res) => { const r = review(Number(req.params.id), String(req.body?.action ?? ''), req.body?.remark, req.user!); typeof r === 'string' ? bad(res, r, code(r)) : res.json(r); });
papersRouter.put('/:id/printed', dept, (req, res) => { const r = markPrinted(Number(req.params.id), req.user!, req.body?.copies); typeof r === 'string' ? bad(res, r, code(r)) : res.json(r); });
papersRouter.post('/:id/remind', dept, (req, res) => { const r = remind(Number(req.params.id), req.user!); typeof r === 'string' ? bad(res, r, code(r)) : res.json(r); });
papersRouter.delete('/:id', dept, (req, res) => {
  const r = db.prepare("DELETE FROM paper_requests WHERE id = ? AND status <> 'printed'").run(Number(req.params.id));
  r.changes ? res.json({ ok: true }) : bad(res, 'Not found, or already printed (a printed paper stays on record).', 404);
});
