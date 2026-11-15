import { Router } from 'express';
import { requireAccess } from '../auth.js';
import { classList, remindTeacher, tracker } from './service.js';

export const testDeptRouter = Router();
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
testDeptRouter.use(requireAccess(['director', 'principal', 'admin'], ['test_dept', 'exam_dept']));
testDeptRouter.get('/tracker', (req, res) => { const r = tracker(Number(req.query.exam_id)); r ? res.json(r) : bad(res, 'Exam not found.', 404); });
testDeptRouter.get('/list', (req, res) => { const r = classList(Number(req.query.exam_id), Number(req.query.section_id)); r ? res.json(r) : bad(res, 'Exam or class not found.', 404); });
testDeptRouter.post('/remind', (req, res) => { const r = remindTeacher(Number(req.body?.exam_id), Number(req.body?.teacher_id), req.user!); typeof r === 'string' ? bad(res, r) : res.json(r); });
