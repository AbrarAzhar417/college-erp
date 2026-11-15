import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { requireRole } from '../auth.js';
import { feeSettings, generateVouchers, pad } from '../fee/service.js';
import { digits, norm } from '../import/values.js';

export const DEFAULT_FORMAT = '{YYYY}-{SEQ4}';
export function admissionSettings() {
  return { reg_format: getSetting('reg_format') || DEFAULT_FORMAT, campus_code: getSetting('campus_code') || '', first_voucher: getSetting('first_voucher') === '1', declaration_urdu: getSetting('declaration_urdu') === '1' };
}
export function formatError(f: string): string | null {
  if (!/^[A-Za-z0-9{}\-/_. ]{3,40}$/.test(f)) return 'Use letters, numbers, - / _ . and the tokens only (3 to 40 characters).';
  if (!/\{SEQ[345]?\}/.test(f)) return 'The format must contain {SEQ}, {SEQ3}, {SEQ4} or {SEQ5} (the running number).';
  if (/\{(?!YYYY\}|YY\}|CLASS\}|CAMPUS\}|SEQ[345]?\})/.test(f)) return 'Unknown token. Allowed: {YYYY} {YY} {CLASS} {CAMPUS} {SEQ} {SEQ3} {SEQ4} {SEQ5}.';
  return null;
}

/** The next free admission number, e.g. "{CAMPUS}-{YY}-{CLASS}-{SEQ3}" -> "MAIN-26-07-014". The running number counts students already given a number of the same shape. */
export function makeRegNo(sectionId: number, now = new Date()): string {
  const st = admissionSettings();
  const cls = db.prepare('SELECT c.grade FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = ?').get(sectionId) as { grade: number } | undefined;
  const fill = (seq: number) => st.reg_format
    .replace('{YYYY}', String(now.getFullYear())).replace('{YY}', String(now.getFullYear()).slice(2)).replace('{CLASS}', pad(cls?.grade ?? 0, 2)).replace('{CAMPUS}', st.campus_code)
    .replace(/\{SEQ(\d?)\}/, (_m, w) => (w ? pad(seq, Number(w)) : String(seq)));
  const probe = fill(0).replace(/0+$/, ''), like = probe.replace(/[%_]/g, '');
  let n = (db.prepare('SELECT COUNT(*) AS n FROM students WHERE reg_no LIKE ?').get(like + '%') as any).n + 1;
  while (db.prepare('SELECT 1 FROM students WHERE reg_no = ?').get(fill(n))) n++;
  return fill(n);
}

/** Father CNIC: empty is allowed; otherwise exactly 13 digits, saved as 12345-1234567-1. */
export function cnicCheck(v: unknown): { value: string | null; error: string | null } {
  const raw = String(v ?? '').trim(); if (!raw) return { value: null, error: null };
  const d = digits(raw);
  return d.length === 13 ? { value: `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`, error: null } : { value: null, error: 'Father CNIC must have 13 digits (for example 37405-1234567-1).' };
}

export function findDuplicate(name: unknown, father: unknown, dob: unknown, exceptId = 0) {
  const n = norm(name), f = norm(father), d = String(dob ?? '').trim();
  if (!n || !f || !d) return null;
  const rows = db.prepare(`SELECT st.id, st.name, st.father_name, st.reg_no, st.status, c.name AS class_name, s.name AS section_name FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE st.dob = ? AND st.id <> ?`).all(d, exceptId) as any[];
  return rows.find(r => norm(r.name) === n && norm(r.father_name) === f) ?? null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Admission fee (one-time heads) plus the first month, as one voucher. Does nothing when switched off or when no fee is set. */
export function firstVoucher(studentId: number, by: number | null): { voucherId: number | null; note: string | null } {
  if (!admissionSettings().first_voucher) return { voucherId: null, note: null };
  const now = new Date(), today = now.toISOString().slice(0, 10), fs = feeSettings();
  const due = new Date(now.getFullYear(), now.getMonth(), Math.min(28, fs.due_day)); if (due < now) due.setDate(now.getDate() + 7);
  const heads = (db.prepare("SELECT id FROM fee_heads WHERE active = 1 AND frequency = 'one_time'").all() as { id: number }[]).map(h => h.id);
  try {
    const r = generateVouchers({ period: today.slice(0, 7), label: `${MONTHS[now.getMonth()]} ${now.getFullYear()} (admission)`, issueDate: today, dueDate: due.toISOString().slice(0, 10), scope: { studentId }, includeMonthly: true, includeHeadIds: heads, lateFine: fs.late_fine, createdBy: by });
    return r.created.length ? { voucherId: r.created[0], note: null } : { voucherId: null, note: r.skipped[0]?.reason ?? 'No voucher was made.' };
  } catch (e) { return { voucherId: null, note: (e as Error).message }; }
}

export function registerAdmission(api: Router) {
  api.get('/students/admission-settings', (_req, res) => res.json(admissionSettings()));
  api.put('/students/admission-settings', requireRole('director', 'principal'), (req, res) => {
    const b = req.body ?? {}, f = String(b.reg_format ?? DEFAULT_FORMAT).trim(), err = formatError(f);
    if (err) return res.status(400).json({ message: err });
    const campus = String(b.campus_code ?? '').trim().slice(0, 10);
    if (!/^[A-Za-z0-9-]*$/.test(campus)) return res.status(400).json({ message: 'Campus code can have letters, numbers and - only.' });
    setSetting('reg_format', f); setSetting('campus_code', campus); setSetting('first_voucher', b.first_voucher ? '1' : '0'); setSetting('declaration_urdu', b.declaration_urdu ? '1' : '0');
    res.json({ ...admissionSettings(), next_example: makeRegNo(Number((db.prepare('SELECT id FROM sections ORDER BY id LIMIT 1').get() as any)?.id ?? 0)) });
  });
  api.get('/students/duplicate-check', (req, res) => res.json({ duplicate: findDuplicate(req.query.name, req.query.father, req.query.dob, Number(req.query.exclude) || 0) }));
}
