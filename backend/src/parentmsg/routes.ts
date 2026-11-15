import { Router } from 'express';
import { requireRole } from '../auth.js';
import { autoFee, runAutoFee, saveAutoFee } from './auto.js';
import { DEFAULTS, msgLog, preview, send, smsReady, type Kind } from './service.js';

export const parentMsgRouter = Router();
const office = requireRole('director', 'principal', 'admin', 'accountant');
const kind = (v: unknown): Kind => (v === 'fee' || v === 'custom' ? v : 'absent');

parentMsgRouter.get('/status', office, (_req, res) => res.json({ sms_ready: smsReady(), defaults: DEFAULTS }));
parentMsgRouter.post('/preview', office, (req, res) => {
  const b = req.body ?? {};
  const k = kind(b.kind);
  if (k === 'absent' && req.user!.role === 'accountant') return res.status(403).json({ message: 'Absent messages are for the office.' });
  res.json(preview({ kind: k, sectionId: Number(b.sectionId) || undefined, classId: Number(b.classId) || undefined, studentIds: b.studentIds, text: b.text, date: b.date, min: Number(b.min) || 0 }));
});
parentMsgRouter.post('/send', office, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ message: 'Nothing to send.' });
  res.json(await send(items.map((i: any) => ({ student_id: Number(i.student_id) || 0, phone: String(i.phone ?? ''), text: String(i.text ?? '') })), kind(req.body?.kind), req.user));
});
parentMsgRouter.get('/log', office, (req, res) => res.json(msgLog(Math.min(500, Number(req.query.limit) || 200), Number(req.query.studentId) || undefined)));

const boss = requireRole('director', 'principal', 'accountant');
parentMsgRouter.get('/auto', boss, (_req, res) => res.json({ ...autoFee(), sms_ready: smsReady() }));
parentMsgRouter.put('/auto', boss, (req, res) => { try { res.json({ ...saveAutoFee(req.body ?? {}), sms_ready: smsReady() }); } catch (e: any) { res.status(400).json({ message: e.message }); } });
parentMsgRouter.post('/auto/run', boss, async (_req, res) => { res.json(await runAutoFee(new Date(), { force: true })); });
