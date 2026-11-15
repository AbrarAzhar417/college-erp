import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { addComment, createTask, editTask, isManager, listTasks, people, setStatus, summary, taskDetail, workload } from './service.js';

export const tasksRouter = Router();
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const code = (m: string) => (m === 'Task not found.' ? 404 : m.startsWith('Only') ? 403 : 400);
tasksRouter.use(requireRole('director', 'principal', 'admin', 'teacher', 'accountant'));

tasksRouter.get('/', (req, res) => res.json(listTasks(req.user!, String(req.query.scope ?? 'mine'), typeof req.query.status === 'string' ? req.query.status : undefined)));
tasksRouter.get('/summary', (req, res) => res.json(summary(req.user!)));
tasksRouter.get('/people', (req, res) => res.json(people(req.user!)));
tasksRouter.get('/workload', (req, res) => (isManager(req.user!) ? res.json(workload()) : bad(res, 'Only the office can see everyone\'s workload.', 403)));
tasksRouter.post('/', (req, res) => { const r = createTask(req.body ?? {}, req.user!); typeof r === 'string' ? bad(res, r, code(r)) : res.status(201).json(r); });
tasksRouter.get('/:id', (req, res) => { const r = taskDetail(Number(req.params.id), req.user!); r ? res.json(r) : bad(res, 'Task not found.', 404); });
tasksRouter.put('/:id', (req, res) => { const r = editTask(Number(req.params.id), req.body ?? {}, req.user!); typeof r === 'string' ? bad(res, r, code(r)) : res.json(r); });
tasksRouter.put('/:id/status', (req, res) => { const r = setStatus(Number(req.params.id), String(req.body?.status ?? ''), req.user!, req.body?.note); typeof r === 'string' ? bad(res, r, code(r)) : res.json(r); });
tasksRouter.post('/:id/comments', (req, res) => { const r = addComment(Number(req.params.id), req.body?.text, req.user!); typeof r === 'string' ? bad(res, r, code(r)) : res.status(201).json(r); });
tasksRouter.delete('/:id', (req, res) => {
  const t = db.prepare('SELECT assigned_by, status FROM tasks WHERE id = ?').get(Number(req.params.id)) as any; if (!t) return bad(res, 'Task not found.', 404);
  if (!isManager(req.user!) && t.assigned_by !== req.user!.id) return bad(res, 'Only the person who assigned the task can delete it.', 403);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true });
});
