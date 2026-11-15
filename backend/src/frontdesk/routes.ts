import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { checkEnquiry, checkPass, checkVisitor, decidePass, enquirySummary, followUpsDue, markLeft, passesOn, rangeOf, signOut } from './service.js';

export const frontdeskRouter = Router();
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const approver = requireRole('director', 'principal');
frontdeskRouter.use(requireRole('director', 'principal', 'admin'));

// visitors
frontdeskRouter.get('/visitors', (req, res) => { const r = rangeOf(req.query); if (!r) return bad(res, 'Choose a date range of up to 3 months.'); res.json(db.prepare('SELECT * FROM fd_visitors WHERE date BETWEEN ? AND ? ORDER BY date DESC, time_in DESC, id DESC').all(r.from, r.to)); });
frontdeskRouter.post('/visitors', (req, res) => {
  const v = checkVisitor(req.body ?? {}); if (typeof v === 'string') return bad(res, v);
  const r = db.prepare('INSERT INTO fd_visitors (date,name,phone,cnic,purpose,meeting_with,badge_no,time_in,created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(v.date, v.name, v.phone, v.cnic, v.purpose, v.meeting_with, v.badge_no, v.time_in, req.user!.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
frontdeskRouter.put('/visitors/:id/out', (req, res) => { const r = signOut(Number(req.params.id), req.body?.time); typeof r === 'string' ? bad(res, r, r === 'Visitor not found.' ? 404 : 400) : res.json(r); });
frontdeskRouter.delete('/visitors/:id', approver, (req, res) => { db.prepare('DELETE FROM fd_visitors WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// enquiries
frontdeskRouter.get('/enquiries', (req, res) => {
  const s = typeof req.query.status === 'string' ? req.query.status : '';
  res.json({ summary: enquirySummary(), due: followUpsDue(), items: s ? db.prepare('SELECT * FROM fd_enquiries WHERE status = ? ORDER BY id DESC LIMIT 500').all(s) : db.prepare('SELECT * FROM fd_enquiries ORDER BY id DESC LIMIT 500').all() });
});
frontdeskRouter.post('/enquiries', (req, res) => {
  const v = checkEnquiry(req.body ?? {}); if (typeof v === 'string') return bad(res, v);
  const r = db.prepare('INSERT INTO fd_enquiries (date,child_name,parent_name,phone,grade,source,category,status,follow_up,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(v.date, v.child_name, v.parent_name, v.phone, v.grade, v.source, v.category, v.status, v.follow_up, v.notes, req.user!.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
frontdeskRouter.put('/enquiries/:id', (req, res) => {
  const id = Number(req.params.id); if (!db.prepare('SELECT 1 FROM fd_enquiries WHERE id = ?').get(id)) return bad(res, 'Enquiry not found.', 404);
  const v = checkEnquiry(req.body ?? {}); if (typeof v === 'string') return bad(res, v);
  db.prepare("UPDATE fd_enquiries SET child_name=?,parent_name=?,phone=?,grade=?,source=?,category=?,status=?,follow_up=?,notes=?,updated_at=datetime('now') WHERE id=?").run(v.child_name, v.parent_name, v.phone, v.grade, v.source, v.category, v.status, v.follow_up, v.notes, id);
  res.json({ ok: true });
});
frontdeskRouter.delete('/enquiries/:id', approver, (req, res) => { db.prepare('DELETE FROM fd_enquiries WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// gate passes: office writes the request, principal/director approve, the gate marks the exit
frontdeskRouter.get('/passes', (req, res) => { const r = rangeOf(req.query); if (!r) return bad(res, 'Choose a date range of up to 3 months.'); res.json(passesOn(r.from, r.to)); });
frontdeskRouter.post('/passes', (req, res) => {
  const v = checkPass(req.body ?? {}); if (typeof v === 'string') return bad(res, v);
  const r = db.prepare('INSERT INTO fd_gate_passes (student_id,date,reason,taken_by,relation,taker_cnic,created_by) VALUES (?,?,?,?,?,?,?)').run(v.student_id, v.date, v.reason, v.taken_by, v.relation, v.taker_cnic, req.user!.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
frontdeskRouter.put('/passes/:id/decision', approver, (req, res) => { const r = decidePass(Number(req.params.id), req.body?.approve === true, req.user!.id); typeof r === 'string' ? bad(res, r, r.includes('not found') ? 404 : 400) : res.json(r); });
frontdeskRouter.put('/passes/:id/left', (req, res) => { const r = markLeft(Number(req.params.id)); typeof r === 'string' ? bad(res, r, r.includes('not found') ? 404 : 400) : res.json(r); });

// A pass can be corrected while it is still waiting, and removed by the principal or director (the removal is logged).
frontdeskRouter.put('/passes/:id', (req, res) => {
  const id = Number(req.params.id), p = db.prepare('SELECT status FROM fd_gate_passes WHERE id = ?').get(id) as any;
  if (!p) return bad(res, 'Gate pass not found.', 404);
  if (p.status !== 'pending') return bad(res, 'Only a pass that is still waiting can be changed.');
  const cur = db.prepare('SELECT student_id FROM fd_gate_passes WHERE id = ?').get(id) as any;
  const v = checkPass({ student_id: cur.student_id, ...(req.body ?? {}) }); if (typeof v === 'string') return bad(res, v);
  db.prepare('UPDATE fd_gate_passes SET date = ?, reason = ?, taken_by = ?, relation = ?, taker_cnic = ? WHERE id = ?').run(v.date, v.reason, v.taken_by, v.relation, v.taker_cnic, id);
  res.json({ ok: true });
});
frontdeskRouter.delete('/passes/:id', approver, (req, res) => {
  const id = Number(req.params.id), p = db.prepare('SELECT student_id, date, status FROM fd_gate_passes WHERE id = ?').get(id) as any;
  if (!p) return bad(res, 'Gate pass not found.', 404);
  db.prepare('DELETE FROM fd_gate_passes WHERE id = ?').run(id);
  audit(req.user, 'frontdesk.pass.delete', 'fd_gate_passes', id, `${p.status} pass of ${p.date}`);
  res.json({ ok: true });
});
