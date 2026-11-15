import express, { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { canChange, checkUpload, listFiles } from './service.js';

export const downloadsRouter = Router();
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
// Staff only. Parents get these files as printed copies or through Communication.
downloadsRouter.use(requireRole('director', 'principal', 'admin', 'teacher', 'accountant'));

downloadsRouter.get('/', (req, res) => res.json(listFiles({ category: req.query.category as string, class_id: Number(req.query.class_id) || undefined, text: typeof req.query.q === 'string' ? req.query.q.trim() : '' })));
downloadsRouter.post('/', express.raw({ type: () => true, limit: '7mb' }), (req, res) => {
  const v = checkUpload(req.body, String(req.headers['content-type'] ?? ''), req.query as any, req.user!); if (typeof v === 'string') return bad(res, v, v.startsWith('Teachers') || v.startsWith('You cannot') ? 403 : 400);
  const r = db.prepare('INSERT INTO dl_files (title,category,class_id,subject,description,filename,mime,size,data,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(v.title, v.category, v.class_id, v.subject, v.description, v.name, v.mime, (req.body as Buffer).length, req.body, req.user!.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
downloadsRouter.get('/:id/file', (req, res) => {
  const d = db.prepare('SELECT filename, mime, data FROM dl_files WHERE id = ?').get(Number(req.params.id)) as any; if (!d) return bad(res, 'File not found.', 404);
  db.prepare('UPDATE dl_files SET downloads = downloads + 1 WHERE id = ?').run(Number(req.params.id));
  res.json({ filename: d.filename, mime: d.mime, base64: Buffer.from(d.data).toString('base64') });
});
downloadsRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id), f = db.prepare('SELECT uploaded_by FROM dl_files WHERE id = ?').get(id) as any; if (!f) return bad(res, 'File not found.', 404);
  if (!canChange(req.user!, f)) return bad(res, 'Only the person who uploaded it or the office can change this file.', 403);
  const title = String(req.body?.title ?? '').trim().slice(0, 120); if (!title) return bad(res, 'Give the file a title.');
  db.prepare('UPDATE dl_files SET title = ?, subject = ?, description = ? WHERE id = ?').run(title, String(req.body?.subject ?? '').trim().slice(0, 60) || null, String(req.body?.description ?? '').trim().slice(0, 300), id);
  res.json({ ok: true });
});
downloadsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id), f = db.prepare('SELECT uploaded_by FROM dl_files WHERE id = ?').get(id) as any; if (!f) return bad(res, 'File not found.', 404);
  if (!canChange(req.user!, f)) return bad(res, 'Only the person who uploaded it or the office can delete this file.', 403);
  db.prepare('DELETE FROM dl_files WHERE id = ?').run(id); res.json({ ok: true });
});
