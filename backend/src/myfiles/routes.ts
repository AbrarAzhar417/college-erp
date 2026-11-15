import express, { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { canSeeFilesOf, checkStaffUpload } from './service.js';

export const myFilesRouter = Router();
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
myFilesRouter.use(requireRole('director', 'principal', 'admin', 'teacher', 'accountant'));

myFilesRouter.get('/', (req, res) => {
  const owner = req.query.user_id ? Number(req.query.user_id) : req.user!.id;
  if (!canSeeFilesOf(req.user!, owner)) return bad(res, 'These files are private to the teacher.', 403);
  res.json(db.prepare('SELECT id, title, kind, filename, mime, size, uploaded_at FROM staff_files WHERE user_id = ? ORDER BY id DESC').all(owner));
});
myFilesRouter.post('/', express.raw({ type: () => true, limit: '11mb' }), (req, res) => {
  const v = checkStaffUpload(req.body, req.query as any, String(req.headers['content-type'] ?? '')); if (typeof v === 'string') return bad(res, v);
  const r = db.prepare('INSERT INTO staff_files (user_id,title,kind,filename,mime,size,data) VALUES (?,?,?,?,?,?,?)').run(req.user!.id, v.title, v.kind, v.name, v.mime, (req.body as Buffer).length, req.body);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
myFilesRouter.get('/:id/file', (req, res) => {
  const f = db.prepare('SELECT user_id, filename, mime, data FROM staff_files WHERE id = ?').get(Number(req.params.id)) as any;
  if (!f || !canSeeFilesOf(req.user!, f.user_id)) return bad(res, 'File not found.', 404);
  res.json({ filename: f.filename, mime: f.mime, base64: Buffer.from(f.data).toString('base64') });
});
myFilesRouter.delete('/:id', (req, res) => {
  const r = db.prepare('DELETE FROM staff_files WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user!.id);
  r.changes ? res.json({ ok: true }) : bad(res, 'File not found.', 404);
});
