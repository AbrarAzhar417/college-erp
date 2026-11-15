import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { computeSection } from '../exam/service.js';

/**
 * Parents can look up a PUBLISHED result without a login, by giving the registration number AND the father's CNIC.
 * Safeguards: switched off until the principal turns it on; both values must match; the same generic answer is given
 * whether the number or the CNIC was wrong; attempts are limited per address and per registration number; only
 * published exams are shown; no phone, CNIC, fee or other child's data is ever returned.
 */
export const publicResultRouter = Router();

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const enabled = () => getSetting('public_results') === '1';

const byIp = new Map<string, { n: number; first: number }>();
const byReg = new Map<string, { n: number; first: number }>();
const WINDOW = 15 * 60_000;
function hit(map: Map<string, { n: number; first: number }>, key: string, max: number, count: boolean): boolean {
  const now = Date.now(); let a = map.get(key);
  if (!a || now - a.first > WINDOW) { a = { n: 0, first: now }; map.set(key, a); }
  if (count) a.n++;
  return a.n > max;
}
/** For tests. */
export const resetPublicLimits = () => { byIp.clear(); byReg.clear(); };

publicResultRouter.get('/result-info', (_req, res) => res.json({ enabled: enabled(), name: getSetting('institute_name'), short: getSetting('short_name') }));

publicResultRouter.post('/result', (req, res) => {
  if (!enabled()) return res.status(404).json({ message: 'Online result lookup is not available.' });
  const ip = req.ip || 'x', reg = String(req.body?.reg_no ?? '').trim().toUpperCase().slice(0, 40), cnic = digits(req.body?.cnic);
  if (hit(byIp, ip, 20, true) || (reg && hit(byReg, reg, 4, false))) return res.status(429).json({ message: 'Too many tries. Please wait a few minutes and try again.' });
  const generic = () => { if (reg) hit(byReg, reg, 5, true); return res.status(404).json({ message: 'No result was found for these details. Please check the registration number and the father\'s CNIC.' }); };
  if (!reg || cnic.length !== 13) return generic();
  const st = db.prepare("SELECT id, name, father_name, reg_no, roll_no, father_cnic FROM students WHERE UPPER(reg_no) = ?").get(reg) as any;
  if (!st || digits(st.father_cnic).length !== 13 || digits(st.father_cnic) !== cnic) return generic();

  const pairs = db.prepare(`SELECT DISTINCT p.exam_id, p.section_id FROM exam_marks m JOIN exam_papers p ON p.id = m.paper_id JOIN exams e ON e.id = p.exam_id
    WHERE m.student_id = ? AND e.status = 'published' ORDER BY p.exam_id DESC`).all(st.id) as { exam_id: number; section_id: number }[];
  const results = pairs.map(pr => {
    const c = computeSection(pr.exam_id, pr.section_id, false, [st.id]);
    const me = c.students.find(s => s.id === st.id);
    if (!me) return null;
    return {
      exam: c.exam.name, session: c.exam.session, class: c.section.label,
      subjects: c.papers.map(p => { const m = me.marks[p.subject_id]; return { subject: p.subject, max: p.max_marks, marks: m?.marks ?? null, status: m?.status ?? '', pass: m?.pass ?? null }; }),
      total: me.total, max: me.max, pct: me.pct, grade: me.grade, result: me.result, position: me.rank
    };
  }).filter(Boolean);
  byReg.delete(reg);
  audit(null, 'public.result', 'student', st.id, '', ip);
  res.json({ student: { name: st.name, father_name: st.father_name, reg_no: st.reg_no, roll_no: st.roll_no }, results });
});

// Switch on/off (principal and director only)
publicResultRouter.get('/result-setting', requireAuth, requireRole('director', 'principal'), (_req, res) => res.json({ enabled: enabled() }));
publicResultRouter.put('/result-setting', requireAuth, requireRole('director', 'principal'), (req, res) => {
  setSetting('public_results', req.body?.enabled ? '1' : '0');
  audit(req.user, 'public.result.setting', 'settings', null, req.body?.enabled ? 'on' : 'off');
  res.json({ enabled: enabled() });
});
