import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { ackReport, checkNotice, datesheetFromExam, inboxFor, isApprover, parentClasses, parentRecipients, publish, resultFromExam, unreadCount } from './service.js';

export const commRouter = Router();
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const author = requireRole('director', 'principal', 'admin');
const approver = requireRole('director', 'principal');
commRouter.use(requireRole('director', 'principal', 'admin', 'teacher', 'accountant'));

commRouter.get('/', (req, res) => res.json(inboxFor(req.user!)));
commRouter.get('/unread', (req, res) => res.json({ count: unreadCount(req.user!) }));
commRouter.get('/generate/datesheet', author, (req, res) => { const r = datesheetFromExam(Number(req.query.exam_id), Number(req.query.class_id) || undefined); r ? res.json(r) : bad(res, 'Exam not found.', 404); });
commRouter.get('/generate/result', author, (req, res) => { const r = resultFromExam(Number(req.query.exam_id)); r ? res.json(r) : bad(res, 'Exam not found.', 404); });

commRouter.post('/', author, (req, res) => {
  const v = checkNotice(req.body ?? {}); if (typeof v === 'string') return bad(res, v);
  const x = v.v, r = db.prepare('INSERT INTO comm_notices (kind,title,body,data,audience,class_ids,priority,issue_date,signed_by,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(x.kind, x.title, x.body, x.data, x.audience, x.class_ids, x.priority, x.issue_date, x.signed_by, req.user!.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
commRouter.put('/:id', author, (req, res) => {
  const id = Number(req.params.id), n = db.prepare('SELECT status, created_by FROM comm_notices WHERE id = ?').get(id) as any;
  if (!n) return bad(res, 'Notice not found.', 404);
  if (n.status !== 'draft' && !isApprover(req.user!)) return bad(res, 'A published notice can be changed by the principal or the admin only.', 403);
  if (n.created_by !== req.user!.id && !isApprover(req.user!)) return bad(res, 'Only the writer, the principal or the admin can change this draft.', 403);
  const v = checkNotice(req.body ?? {}); if (typeof v === 'string') return bad(res, v);
  const x = v.v; db.prepare("UPDATE comm_notices SET kind=?,title=?,body=?,data=?,audience=?,class_ids=?,priority=?,issue_date=?,signed_by=?,updated_at=datetime('now') WHERE id=?").run(x.kind, x.title, x.body, x.data, x.audience, x.class_ids, x.priority, x.issue_date, x.signed_by, id);
  if (n.status !== 'draft') audit(req.user, 'communication.edit', 'comm_notice', id, `changed a ${n.status} notice`);
  res.json({ ok: true });
});
commRouter.delete('/:id', author, (req, res) => {
  const id = Number(req.params.id), n = db.prepare('SELECT status, created_by FROM comm_notices WHERE id = ?').get(id) as any;
  if (!n) return bad(res, 'Notice not found.', 404);
  if (n.status !== 'draft' && !isApprover(req.user!)) return bad(res, 'Only the principal or the admin can delete a published notice.', 403);
  if (n.created_by !== req.user!.id && !isApprover(req.user!)) return bad(res, 'Only the writer, the principal or the admin can delete this draft.', 403);
  const t = db.prepare('SELECT title FROM comm_notices WHERE id = ?').get(id) as any;
  db.prepare('DELETE FROM comm_notices WHERE id = ?').run(id);
  if (n.status !== 'draft') audit(req.user, 'communication.delete', 'comm_notice', id, `${n.status}: ${t?.title ?? ''}`);
  res.json({ ok: true });
});
commRouter.put('/:id/publish', approver, (req, res) => { const r = publish(Number(req.params.id), req.user!.id); typeof r === 'string' ? bad(res, r, r === 'Notice not found.' ? 404 : 409) : res.json(r); });
commRouter.put('/:id/withdraw', approver, (req, res) => {
  const id = Number(req.params.id), n = db.prepare('SELECT status FROM comm_notices WHERE id = ?').get(id) as any;
  if (!n) return bad(res, 'Notice not found.', 404); if (n.status !== 'published') return bad(res, 'Only a published notice can be withdrawn.', 409);
  db.prepare("UPDATE comm_notices SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?").run(id); res.json({ ok: true });
});

commRouter.get('/:id', (req, res) => {
  const n = inboxFor(req.user!).find(x => x.id === Number(req.params.id)); n ? res.json(n) : bad(res, 'Notice not found.', 404);
});
commRouter.post('/:id/read', (req, res) => {
  const id = Number(req.params.id), n = db.prepare("SELECT 1 FROM comm_notices WHERE id = ? AND status = 'published'").get(id);
  if (!n) return bad(res, 'Notice not found.', 404);
  db.prepare('INSERT OR IGNORE INTO comm_reads (notice_id, user_id) VALUES (?,?)').run(id, req.user!.id); res.json({ ok: true });
});
commRouter.get('/:id/acks', author, (req, res) => { const r = ackReport(Number(req.params.id)); r ? res.json(r) : bad(res, 'Notice not found.', 404); });
commRouter.get('/:id/parent-classes', author, (req, res) => { const r = parentClasses(Number(req.params.id)); r ? res.json(r) : bad(res, 'Notice not found.', 404); });
commRouter.get('/:id/recipients', author, (req, res) => { const r = parentRecipients(Number(req.params.id), Number(req.query.section_id)); r ? res.json(r) : bad(res, 'Notice not found.', 404); });
commRouter.put('/:id/students/:sid/sent', author, (req, res) => { db.prepare('INSERT OR IGNORE INTO comm_parent_sent (notice_id, student_id) VALUES (?,?)').run(Number(req.params.id), Number(req.params.sid)); res.json({ ok: true }); });
