import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';

/**
 * The extra particulars the printed application forms ask for (religion, father's qualification, last school, health, SSC marks and
 * so on) that the student record itself does not hold. They are kept as one small record per student and are only for the office,
 * because some of it is health and income information.
 */
db.exec(`CREATE TABLE IF NOT EXISTS admission_info (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE, data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

export const FIELDS = [
  'apply_session', 'issue_date', 'student_bform', 'religion', 'nationality', 'place_of_birth', 'father_qualification', 'father_designation', 'father_division', 'father_pno', 'father_sps_bps',
  'father_income', 'office_phone', 'res_phone', 'permanent_address', 'mother_qual_occ', 'prev_school', 'dues_paid_upto', 'prev_class', 'medium', 'distinction', 'cocurricular',
  'sports', 'subject_group', 'ssc_year', 'ssc_roll', 'ssc_marks', 'ssc_total', 'ssc_grade', 'ssc_subjects', 'ssc_board', 'hssc1_year', 'hssc1_roll', 'hssc1_marks', 'hssc1_total',
  'hssc1_grade', 'hssc1_subjects', 'hssc1_board', 'health_issue', 'disease', 'doctor', 'disease_status', 'future_plan', 'category_fee', 'test_date', 'house', 'decision', 'decision_date',
  'fee_received', 'receipt_no', 'receipt_date',
  'blood_group', 'official_address', 'admit_class', 'reported_test', 'res_urdu', 'res_english', 'res_maths', 'res_science', 'res_total', 'ret_urdu', 'ret_english', 'ret_maths', 'ret_science', 'ret_total', 'remarks'
] as const;
const LONG = new Set(['official_address', 'remarks', 'permanent_address', 'prev_school', 'distinction', 'cocurricular', 'sports', 'ssc_subjects', 'hssc1_subjects', 'disease', 'doctor', 'future_plan']);

export interface Sib { name: string; class_session: string }
export function clean(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) {
    if (body?.[k] === undefined || body[k] === null) continue;
    out[k] = String(body[k]).trim().slice(0, LONG.has(k) ? 300 : 80);
  }
  if (out.health_issue && !['yes', 'no'].includes(String(out.health_issue))) delete out.health_issue;
  if (out.reported_test && !['yes', 'no'].includes(String(out.reported_test))) delete out.reported_test;
  if (out.decision && !['granted', 'not_granted', 'recommended'].includes(String(out.decision))) delete out.decision;
  if (Array.isArray(body?.siblings)) out.siblings = body.siblings.slice(0, 5).map((s: any) => ({ name: String(s?.name ?? '').trim().slice(0, 80), class_session: String(s?.class_session ?? '').trim().slice(0, 60) })).filter((s: Sib) => s.name || s.class_session);
  return out;
}

export const applicationRouter = Router();
const office = requireRole('director', 'principal', 'admin');
applicationRouter.get('/:id/application', office, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) return res.status(404).json({ message: 'Student not found.' });
  const r = db.prepare('SELECT data FROM admission_info WHERE student_id = ?').get(id) as { data: string } | undefined;
  res.json(r ? JSON.parse(r.data) : {});
});
applicationRouter.put('/:id/application', office, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) return res.status(404).json({ message: 'Student not found.' });
  const data = clean(req.body);
  db.prepare("INSERT INTO admission_info (student_id, data, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(student_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").run(id, JSON.stringify(data));
  audit(req.user, 'student.application', 'student', id, { fields: Object.keys(data).length });
  res.json(data);
});
