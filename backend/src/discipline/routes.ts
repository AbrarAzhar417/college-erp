import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { send } from '../parentmsg/service.js';
import '../attendance/schema.js';
import { bearerName } from '../college/routes.js';

/**
 * Behaviour record of a student. Teachers may add a note or a praise and see only what they wrote themselves; the office
 * (director, principal, admin) adds warnings, summons and suspensions and sees everything. A summon can send an SMS to the
 * parent and has a printable letter. Three warnings within a year suggest calling the parents.
 */
db.exec(`CREATE TABLE IF NOT EXISTS disc_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('note','praise','warning','summon','suspension')),
  category TEXT, text TEXT NOT NULL, action TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  meet_date TEXT, outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','attended','not_attended','rescheduled')),
  outcome_note TEXT, by_user INTEGER, by_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_disc_student ON disc_records(student_id, date)');

db.exec(`CREATE TABLE IF NOT EXISTS disc_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  record_id INTEGER REFERENCES disc_records(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('warning','summon','suspension','appreciation','general')),
  ref_no TEXT NOT NULL UNIQUE, subject TEXT NOT NULL, body TEXT NOT NULL, issued_on TEXT NOT NULL, signed_by TEXT NOT NULL,
  issued_by INTEGER REFERENCES users(id), issued_by_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_disc_letters_student ON disc_letters(student_id, issued_on)');

export const KINDS = ['note', 'praise', 'warning', 'summon', 'suspension'] as const;
export const CATEGORIES = ['Late / bunking', 'Uniform', 'Fighting', 'Disrespect', 'Cheating', 'Damage to property', 'Mobile phone', 'Homework', 'Other'];
const today = () => new Date().toISOString().slice(0, 10);
const bad = (res: any, m: string, c = 400) => res.status(c).json({ message: m });
const isOffice = (u: any) => ['director', 'principal', 'admin'].includes(u?.role);

export function summary(studentId: number) {
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const c = (k: string) => (db.prepare('SELECT COUNT(*) AS n FROM disc_records WHERE student_id = ? AND kind = ? AND date >= ?').get(studentId, k, since) as any).n as number;
  const warnings = c('warning');
  const lastWarn = db.prepare("SELECT date FROM disc_records WHERE student_id = ? AND kind = 'warning' AND date >= ? ORDER BY date DESC, id DESC LIMIT 1").get(studentId, since) as any;
  const summonAfter = lastWarn && db.prepare("SELECT 1 FROM disc_records WHERE student_id = ? AND kind = 'summon' AND date >= ?").get(studentId, lastWarn.date);
  const letters = db.prepare('SELECT type, COUNT(*) AS n FROM disc_letters WHERE student_id = ? GROUP BY type').all(studentId) as { type: string; n: number }[];
  return {
    letters: letters.reduce((a, l) => a + l.n, 0), lettersByType: Object.fromEntries(letters.map(l => [l.type, l.n])),
    warnings, notes: c('note'), praise: c('praise'), summons: c('summon'), suspensions: c('suspension'),
    suggestSummon: warnings >= 3 && !summonAfter,
    hint: warnings >= 3 && !summonAfter ? `${warnings} warnings in the last year and no meeting with the parents since — consider calling them.` : null
  };
}

const phoneOf = (s: any) => s.father_phone || s.mother_phone || s.phone || '';
export function summonText(s: any, meetDate: string, reason: string) {
  const school = getSetting('short_name') || getSetting('institute_name') || 'College';
  return `Assalam o Alaikum. ${school}: ${s.name} (${s.class_name}) ke baray mein aap ko ${meetDate} ko school bulaya gaya hai. Wajah: ${reason}. Meharbani karke tashreef layein.`;
}

export const disciplineRouter = Router();

disciplineRouter.get('/categories', (_req, res) => res.json(CATEGORIES));

disciplineRouter.get('/student/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) return bad(res, 'Student not found.', 404);
  const own = !isOffice(req.user);
  const rows = db.prepare(`SELECT * FROM disc_records WHERE student_id = ? ${own ? 'AND by_user = ?' : ''} ORDER BY date DESC, id DESC`).all(...(own ? [id, req.user!.id] : [id]));
  res.json({ records: rows, summary: isOffice(req.user) ? summary(id) : null });
});

disciplineRouter.get('/', requireRole('director', 'principal', 'admin'), (req, res) => {
  const w: string[] = [], p: any[] = [], q = req.query as any;
  if (q.kind) { w.push('d.kind = ?'); p.push(String(q.kind)); }
  if (q.status) { w.push('d.status = ?'); p.push(String(q.status)); }
  if (q.class_id) { w.push('c.id = ?'); p.push(Number(q.class_id)); }
  if (q.from) { w.push('d.date >= ?'); p.push(String(q.from)); }
  if (q.to) { w.push('d.date <= ?'); p.push(String(q.to)); }
  if (q.q) { w.push('(st.name LIKE ? OR st.reg_no LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`); }
  res.json(db.prepare(`SELECT d.*, st.name AS student_name, st.reg_no, c.name || '-' || s.name AS class_name FROM disc_records d JOIN students st ON st.id = d.student_id
    LEFT JOIN sections s ON s.id = st.section_id LEFT JOIN classes c ON c.id = s.class_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY d.date DESC, d.id DESC LIMIT 500`).all(...p));
});

/** Students with three or more warnings in the last year and no meeting since. */
disciplineRouter.get('/watch', requireRole('director', 'principal', 'admin'), (_req, res) => {
  const ids = db.prepare("SELECT DISTINCT student_id AS id FROM disc_records WHERE kind = 'warning' AND date >= date('now','-365 day')").all() as { id: number }[];
  const out = ids.map(r => ({ id: r.id, ...summary(r.id) })).filter(s => s.suggestSummon).map(s => {
    const st = db.prepare("SELECT st.name, st.reg_no, c.name || '-' || s.name AS class_name FROM students st LEFT JOIN sections s ON s.id = st.section_id LEFT JOIN classes c ON c.id = s.class_id WHERE st.id = ? AND st.status = 'active'").get(s.id) as any;
    return st ? { student_id: s.id, ...st, warnings: s.warnings } : null;
  }).filter(Boolean);
  res.json(out);
});

export const pendingSummons = () => (db.prepare("SELECT COUNT(*) AS n FROM disc_records WHERE kind = 'summon' AND status = 'open'").get() as any).n as number;

disciplineRouter.post('/', async (req, res) => {
  const b = req.body ?? {}, kind = String(b.kind);
  if (!(KINDS as readonly string[]).includes(kind)) return bad(res, 'Choose what kind of record this is.');
  if (!isOffice(req.user) && !['note', 'praise'].includes(kind)) return bad(res, 'Teachers can add a note or a praise. A warning or a summon is for the office.', 403);
  const st = db.prepare(`SELECT st.id, st.name, st.father_phone, st.mother_phone, st.phone, c.name || '-' || s.name AS class_name FROM students st LEFT JOIN sections s ON s.id = st.section_id
    LEFT JOIN classes c ON c.id = s.class_id WHERE st.id = ?`).get(Number(b.student_id)) as any;
  if (!st) return bad(res, 'Student not found.', 404);
  const text = String(b.text ?? '').trim();
  if (!text) return bad(res, 'Write what happened.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date ?? '')) ? String(b.date) : today();
  const meet = kind === 'summon' ? String(b.meet_date ?? '') : null;
  if (kind === 'summon' && !/^\d{4}-\d{2}-\d{2}$/.test(meet!)) return bad(res, 'Give the date the parents should come.');
  const r = db.prepare('INSERT INTO disc_records (student_id, date, kind, category, text, action, status, meet_date, by_user, by_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(st.id, date, kind, b.category ? String(b.category).slice(0, 60) : null, text.slice(0, 1000), b.action ? String(b.action).slice(0, 300) : null,
      ['note', 'praise', 'warning'].includes(kind) ? 'closed' : 'open', meet, req.user!.id, req.user!.name);
  const id = Number(r.lastInsertRowid);
  audit(req.user, 'discipline.add', 'student', st.id, { id, kind });
  let sms: any = null;
  if (kind === 'summon' && b.send_sms) sms = await send([{ student_id: st.id, phone: phoneOf(st), text: summonText(st, meet!, b.category || text.slice(0, 80)) }], 'custom', req.user);
  res.status(201).json({ id, sms });
});

disciplineRouter.put('/:id/outcome', requireRole('director', 'principal', 'admin'), (req, res) => {
  const id = Number(req.params.id), o = String(req.body?.outcome);
  const rec = db.prepare('SELECT * FROM disc_records WHERE id = ?').get(id) as any;
  if (!rec) return bad(res, 'Record not found.', 404);
  if (rec.kind !== 'summon' && rec.kind !== 'suspension') return bad(res, 'Only a summon or a suspension has an outcome.');
  if (!['pending', 'attended', 'not_attended', 'rescheduled'].includes(o)) return bad(res, 'Choose an outcome.');
  let meet = rec.meet_date;
  if (o === 'rescheduled') { meet = String(req.body?.meet_date ?? ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(meet)) return bad(res, 'Give the new date.'); }
  db.prepare('UPDATE disc_records SET outcome = ?, outcome_note = ?, meet_date = ?, status = ? WHERE id = ?')
    .run(o, req.body?.note ? String(req.body.note).slice(0, 500) : null, meet, o === 'attended' || o === 'not_attended' ? 'closed' : 'open', id);
  audit(req.user, 'discipline.outcome', 'student', rec.student_id, { id, outcome: o });
  res.json({ ok: true });
});

disciplineRouter.delete('/:id', requireRole('director', 'principal'), (req, res) => {
  const id = Number(req.params.id), rec = db.prepare('SELECT * FROM disc_records WHERE id = ?').get(id) as any;
  if (!rec) return bad(res, 'Record not found.', 404);
  db.prepare('DELETE FROM disc_records WHERE id = ?').run(id);
  audit(req.user, 'discipline.delete', 'student', rec.student_id, rec);
  res.json({ ok: true });
});

/** Everything the printed summon letter needs. */
disciplineRouter.get('/:id/letter', requireRole('director', 'principal', 'admin'), (req, res) => {
  const rec = db.prepare("SELECT * FROM disc_records WHERE id = ? AND kind = 'summon'").get(Number(req.params.id)) as any;
  if (!rec) return bad(res, 'Summon not found.', 404);
  const st = db.prepare(`SELECT st.name, st.reg_no, st.father_name, c.name || '-' || s.name AS class_name FROM students st LEFT JOIN sections s ON s.id = st.section_id LEFT JOIN classes c ON c.id = s.class_id WHERE st.id = ?`).get(rec.student_id) as any;
  res.json({ school: getSetting('institute_name') || getSetting('short_name') || 'College', student: st, date: rec.date, meet_date: rec.meet_date, reason: rec.category || '', text: rec.text, by: rec.by_name });
});

// ---------- tracked letters: every letter that is issued is numbered, kept, and counted on the student's record ----------
export const LETTER_TYPES = ['warning', 'summon', 'suspension', 'appreciation', 'general'] as const;
const TYPE_OF_KIND: Record<string, string> = { warning: 'warning', summon: 'summon', suspension: 'suspension', praise: 'appreciation', note: 'general' };
const dateOk = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
const principalName = () => bearerName('principal') || getSetting('principal_name') || 'Principal';

export function letterDraft(rec: any, st: any, type: string) {
  const who = `${st.name} (Reg. ${st.reg_no}, Class ${st.class_name})`, what = `${rec.category ? rec.category + ': ' : ''}${rec.text}`;
  switch (type) {
    case 'summon': return { subject: 'Request to meet the Principal', body: `You are requested to come to the college office on ${rec.meet_date || '____________'} to meet the Principal about your son ${who}.\n\nReason: ${what}\n\nYour presence is necessary. Please bring this letter with you.` };
    case 'suspension': return { subject: 'Suspension of student', body: `This is to inform you that your son ${who} has been suspended from the college.\n\nReason: ${what}${rec.action ? '\n\nAction taken: ' + rec.action : ''}\n\nYou are requested to meet the Principal before the student returns to classes.` };
    case 'appreciation': return { subject: 'Letter of appreciation', body: `We are pleased to tell you that your son ${who} has done well.\n\n${what}\n\nWe thank you for your support and hope he keeps this up.` };
    case 'general': return { subject: 'Information about your son', body: `We write to inform you about your son ${who}.\n\n${what}\n\nPlease guide him at home and contact the college office if you wish to discuss this.` };
    default: return { subject: 'Warning to student and parents', body: `This is to bring to your notice that your son ${who} has been warned for the following.\n\n${what}${rec.action ? '\n\nAction taken: ' + rec.action : ''}\n\nIf this happens again, stricter action will be taken as per the college rules. Kindly guide him at home.` };
  }
}
const studentOf = (id: number) => db.prepare(`SELECT st.id, st.name, st.reg_no, st.father_name, c.name || '-' || s.name AS class_name FROM students st LEFT JOIN sections s ON s.id = st.section_id
  LEFT JOIN classes c ON c.id = s.class_id WHERE st.id = ?`).get(id) as any;
const office = requireRole('director', 'principal', 'admin');

export function nextLetterRef(issued: string) {
  const short = getSetting('short_name') || 'KMCB', prefix = `${short}/DIS/${issued.slice(0, 4)}/`;
  const last = (db.prepare('SELECT ref_no FROM disc_letters WHERE ref_no LIKE ? ORDER BY CAST(SUBSTR(ref_no, ?) AS INTEGER) DESC LIMIT 1').get(`${prefix}%`, prefix.length + 1) as any)?.ref_no as string | undefined;
  return `${prefix}${String((last ? Number(last.slice(prefix.length)) : 0) + 1).padStart(3, '0')}`;
}

disciplineRouter.get('/records/:id/draft', office, (req, res) => {
  const rec = db.prepare('SELECT * FROM disc_records WHERE id = ?').get(Number(req.params.id)) as any;
  if (!rec) return bad(res, 'Record not found.', 404);
  const type = LETTER_TYPES.includes(req.query.type as any) ? String(req.query.type) : TYPE_OF_KIND[rec.kind] ?? 'general';
  res.json({ type, types: LETTER_TYPES, ...letterDraft(rec, studentOf(rec.student_id), type) });
});

disciplineRouter.post('/records/:id/letters', office, (req, res) => {
  const rec = db.prepare('SELECT * FROM disc_records WHERE id = ?').get(Number(req.params.id)) as any;
  if (!rec) return bad(res, 'Record not found.', 404);
  const b = req.body ?? {}, type = String(b.type ?? TYPE_OF_KIND[rec.kind] ?? 'general');
  if (!(LETTER_TYPES as readonly string[]).includes(type)) return bad(res, 'Choose the kind of letter.');
  const subject = String(b.subject ?? '').trim().slice(0, 150), body = String(b.body ?? '').trim().slice(0, 3000);
  if (!subject) return bad(res, 'Write the subject of the letter.');
  if (!body) return bad(res, 'The letter has no text.');
  const issued = dateOk(b.issued_on) ? String(b.issued_on) : today();
  const id = db.transaction(() => Number(db.prepare('INSERT INTO disc_letters (student_id, record_id, type, ref_no, subject, body, issued_on, signed_by, issued_by, issued_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(rec.student_id, rec.id, type, nextLetterRef(issued), subject, body, issued, principalName(), req.user!.id, req.user!.name).lastInsertRowid))();
  audit(req.user, 'discipline.letter', 'student', rec.student_id, { id, type });
  res.status(201).json({ id });
});

disciplineRouter.get('/letters/student/:sid', office, (req, res) => {
  const sid = Number(req.params.sid);
  const rows = db.prepare('SELECT id, record_id, type, ref_no, subject, issued_on, issued_by_name FROM disc_letters WHERE student_id = ? ORDER BY issued_on DESC, id DESC').all(sid) as any[];
  const byType: Record<string, number> = {}; for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
  res.json({ total: rows.length, byType, letters: rows });
});

disciplineRouter.get('/letters/:id', office, (req, res) => {
  const l = db.prepare('SELECT * FROM disc_letters WHERE id = ?').get(Number(req.params.id)) as any;
  if (!l) return bad(res, 'Letter not found.', 404);
  res.json({ school: getSetting('institute_name') || getSetting('short_name') || 'College', address: getSetting('inst_address'), phone: getSetting('inst_phone'), student: studentOf(l.student_id), ...l });
});

disciplineRouter.delete('/letters/:id', requireRole('director', 'principal'), (req, res) => {
  const id = Number(req.params.id), l = db.prepare('SELECT * FROM disc_letters WHERE id = ?').get(id) as any;
  if (!l) return bad(res, 'Letter not found.', 404);
  db.prepare('DELETE FROM disc_letters WHERE id = ?').run(id);
  audit(req.user, 'discipline.letter.delete', 'student', l.student_id, { ref_no: l.ref_no, type: l.type });
  res.json({ ok: true });
});
