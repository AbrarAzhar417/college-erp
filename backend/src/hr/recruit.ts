import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { requireRole } from '../auth.js';
import { isDate, todayISO } from '../attendance/service.js';
import {
  DEFAULT_TEMPLATES, DEPARTMENT_OF, EMPLOYMENT, FILE_DIR, KINDS, STAFF_TYPES, STAGES, TEMPLATE_KINDS, date, deleteFileRow, int, kindOfType, nextEmpNo, syncLinked, t, templates
} from './service.js';
import { extractText, parseCv, scoreCandidate } from './cv.js';
import { notifyView, saveNotify, sendEmail, sendSms, smtpConfig, smsConfig } from './notify.js';

/** Recruitment: job posts, CVs, screening, interviews, messages to candidates and the final hire. Mounted at /api/hr/recruit (office roles only). */
export const recruitRouter = Router();
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const num = (v: unknown) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
const cand = (id: number) => db.prepare('SELECT * FROM hr_candidates WHERE id = ?').get(id) as any;

// ---------- job posts ----------
recruitRouter.get('/jobs', (_req, res) => {
  const jobs = db.prepare('SELECT * FROM hr_jobs ORDER BY (status = \'open\') DESC, id DESC').all() as any[];
  const counts = db.prepare('SELECT job_id, stage, COUNT(*) AS n FROM hr_candidates GROUP BY job_id, stage').all() as any[];
  res.json(jobs.map(j => {
    const stages: Record<string, number> = {};
    for (const c of counts) if (c.job_id === j.id) stages[c.stage] = c.n;
    return { ...j, stages, total: Object.values(stages).reduce((a, n) => a + n, 0), filled: stages['hired'] ?? 0 };
  }));
});

function jobBody(b: any) {
  const title = t(b?.title, 80); if (!title) return { error: 'Enter the post (job title).' };
  const positions = Math.round(Number(b?.positions ?? 1));
  if (!(positions >= 1 && positions <= 100)) return { error: 'Number of seats: 1 to 100.' };
  return { v: [title, t(b.department, 60), KINDS.includes(b.kind) ? b.kind : 'teaching', positions, t(b.qualification, 200), t(b.experience, 100), t(b.salary_range, 60), t(b.description, 2000), t(b.keywords, 300), date(b.posted_date) ?? todayISO(), date(b.last_date)] };
}
const JCOLS = 'title, department, kind, positions, qualification, experience, salary_range, description, keywords, posted_date, last_date';
recruitRouter.post('/jobs', (req, res) => {
  const j = jobBody(req.body); if (j.error) return bad(res, j.error);
  res.status(201).json({ id: Number(db.prepare(`INSERT INTO hr_jobs (${JCOLS}) VALUES (${j.v!.map(() => '?').join(',')})`).run(...j.v!).lastInsertRowid) });
});
recruitRouter.put('/jobs/:id', (req, res) => {
  const j = jobBody(req.body); if (j.error) return bad(res, j.error);
  db.prepare(`UPDATE hr_jobs SET ${JCOLS.split(', ').map(c => c + ' = ?').join(', ')} WHERE id = ?`).run(...j.v!, Number(req.params.id));
  res.json({ ok: true });
});
recruitRouter.put('/jobs/:id/status', (req, res) => {
  db.prepare('UPDATE hr_jobs SET status = ? WHERE id = ?').run(req.body?.status === 'closed' ? 'closed' : 'open', Number(req.params.id));
  res.json({ ok: true });
});
recruitRouter.delete('/jobs/:id', (req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT 1 FROM hr_candidates WHERE job_id = ?').get(id)) return bad(res, 'This post has candidates. Close it instead of deleting it.', 409);
  db.prepare('DELETE FROM hr_jobs WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- candidates and screening ----------
recruitRouter.get('/candidates', (req, res) => {
  const { job_id, stage, q, min_exp, min_rating, has_cv, sort, kw, min_score } = req.query as Record<string, string>;
  const where: string[] = [], args: any[] = [];
  if (job_id) { where.push('c.job_id = ?'); args.push(Number(job_id)); }
  if (STAGES.includes(stage)) { where.push('c.stage = ?'); args.push(stage); }
  if (q?.trim()) { const l = `%${q.trim()}%`; where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.qualification LIKE ? OR c.city LIKE ? OR c.notes LIKE ?)'); args.push(l, l, l, l, l, l); }
  if (num(min_exp) !== null) { where.push('COALESCE(c.experience_years, 0) >= ?'); args.push(num(min_exp)); }
  if (num(min_rating) !== null) { where.push('COALESCE(c.rating, 0) >= ?'); args.push(num(min_rating)); }
  if (has_cv === '1') where.push("EXISTS (SELECT 1 FROM hr_files f WHERE f.owner_type = 'candidate' AND f.owner_id = c.id)");
  const words = (kw ?? '').split(/[,;\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 12);
  const hit = words.map(() => "COALESCE((SELECT INSTR(LOWER(x.text), ?) > 0 FROM hr_cv_text x WHERE x.candidate_id = c.id), 0)").join(' + ') || '0';
  const hitArgs = words.slice();
  if (words.length) { where.push(`(${hit}) >= ?`); args.push(...words, req.query.match === 'all' ? words.length : 1); }
  if (num(min_score) !== null) { where.push('COALESCE(c.score, 0) >= ?'); args.push(num(min_score)); }
  const order = sort === 'score' ? 'COALESCE(c.score, -1) DESC, c.id DESC' : sort === 'experience' ? 'COALESCE(c.experience_years, 0) DESC' : sort === 'newest' ? 'c.id DESC' : 'COALESCE(c.rating, 0) DESC, c.id DESC';
  res.json(db.prepare(`SELECT c.*, j.title AS job_title, (${hit}) AS kw_hits,
      (SELECT COUNT(*) FROM hr_files f WHERE f.owner_type = 'candidate' AND f.owner_id = c.id) AS cvs,
      (SELECT date FROM hr_interviews i WHERE i.candidate_id = c.id AND i.status = 'scheduled' ORDER BY date, time LIMIT 1) AS int_date,
      (SELECT time FROM hr_interviews i WHERE i.candidate_id = c.id AND i.status = 'scheduled' ORDER BY date, time LIMIT 1) AS int_time,
      (SELECT venue FROM hr_interviews i WHERE i.candidate_id = c.id AND i.status = 'scheduled' ORDER BY date, time LIMIT 1) AS int_venue,
      (SELECT COUNT(*) FROM hr_messages m WHERE m.candidate_id = c.id) AS messages
    FROM hr_candidates c LEFT JOIN hr_jobs j ON j.id = c.job_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 1000`).all(...hitArgs, ...args));
});

function candBody(b: any) {
  const name = t(b?.name, 80); if (!name) return { error: 'Enter the candidate name.' };
  const jobId = b?.job_id ? Number(b.job_id) : null;
  if (jobId && !db.prepare('SELECT 1 FROM hr_jobs WHERE id = ?').get(jobId)) return { error: 'This post does not exist.' };
  const rating = b?.rating === null || b?.rating === '' || b?.rating === undefined ? null : Math.round(Number(b.rating));
  if (rating !== null && !(rating >= 1 && rating <= 5)) return { error: 'Rating: 1 to 5 stars.' };
  return { v: [jobId, name, t(b.phone, 20), t(b.email, 80), t(b.cnic, 20), ['male', 'female'].includes(b.gender) ? b.gender : null, t(b.city, 40), t(b.qualification, 120), num(b.experience_years), t(b.current_employer, 80),
    num(b.current_salary), num(b.expected_salary), t(b.source, 40), rating, t(b.notes, 1000), date(b.applied_date) ?? todayISO()] };
}
const CCOLS = 'job_id, name, phone, email, cnic, gender, city, qualification, experience_years, current_employer, current_salary, expected_salary, source, rating, notes, applied_date';
recruitRouter.post('/candidates', (req, res) => {
  const c = candBody(req.body); if (c.error) return bad(res, c.error);
  const dup = findDuplicate({ phone: c.v![2] as string | null, email: c.v![3] as string | null, cnic: c.v![4] as string | null });
  const id = Number(db.prepare(`INSERT INTO hr_candidates (${CCOLS}) VALUES (${c.v!.map(() => '?').join(',')})`).run(...c.v!).lastInsertRowid);
  rescore(id);
  res.status(201).json({ id, duplicate_of: dup ? { id: dup.id, name: dup.name, job_title: dup.job_title } : null });
});
recruitRouter.put('/candidates/:id', (req, res) => {
  const id = Number(req.params.id); if (!cand(id)) return bad(res, 'Candidate not found.', 404);
  const c = candBody(req.body); if (c.error) return bad(res, c.error);
  db.prepare(`UPDATE hr_candidates SET ${CCOLS.split(', ').map(x => x + ' = ?').join(', ')} WHERE id = ?`).run(...c.v!, id);
  rescore(id);
  res.json({ ok: true });
});

recruitRouter.get('/candidates/:id', (req, res) => {
  const id = Number(req.params.id), c = cand(id); if (!c) return bad(res, 'Candidate not found.', 404);
  res.json({
    candidate: c, job: c.job_id ? db.prepare('SELECT * FROM hr_jobs WHERE id = ?').get(c.job_id) : null,
    files: db.prepare("SELECT id, label, name, mime, size, created_at FROM hr_files WHERE owner_type = 'candidate' AND owner_id = ? ORDER BY id").all(id),
    interviews: db.prepare('SELECT * FROM hr_interviews WHERE candidate_id = ? ORDER BY date, time').all(id),
    score: c.score_note ? JSON.parse(c.score_note) : null, checklist: checklistOf(c), has_text: !!db.prepare('SELECT 1 FROM hr_cv_text WHERE candidate_id = ?').get(id),
    messages: db.prepare('SELECT m.*, u.name AS by_name FROM hr_messages m LEFT JOIN users u ON u.id = m.sent_by WHERE m.candidate_id = ? ORDER BY m.id DESC').all(id)
  });
});

/** Moves many candidates to a stage at once (shortlist, reject ...). "Hired" only happens through the hire step. */
recruitRouter.post('/candidates/stage', (req, res) => {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  const stage = req.body?.stage;
  if (!ids.length) return bad(res, 'Select at least one candidate.');
  if (!STAGES.includes(stage) || stage === 'hired') return bad(res, 'Choose a stage.');
  const reason = stage === 'rejected' ? t(req.body?.reason, 200) : null;
  let n = 0;
  db.transaction(() => { for (const id of ids) n += db.prepare("UPDATE hr_candidates SET stage = ?, reject_reason = ? WHERE id = ? AND stage != 'hired'").run(stage, reason, id).changes; })();
  res.json({ changed: n });
});

recruitRouter.delete('/candidates/:id', (req, res) => {
  const id = Number(req.params.id), c = cand(id); if (!c) return bad(res, 'Candidate not found.', 404);
  if (c.stage === 'hired') return bad(res, 'This person was hired. Their record stays.', 409);
  db.transaction(() => {
    for (const f of db.prepare("SELECT id FROM hr_files WHERE owner_type = 'candidate' AND owner_id = ?").all(id) as any[]) deleteFileRow(f.id);
    db.prepare('DELETE FROM hr_interview_marks WHERE interview_id IN (SELECT id FROM hr_interviews WHERE candidate_id = ?)').run(id);
    db.prepare('DELETE FROM hr_cv_text WHERE candidate_id = ?').run(id);
    db.prepare('DELETE FROM hr_interviews WHERE candidate_id = ?').run(id);
    db.prepare('DELETE FROM hr_messages WHERE candidate_id = ?').run(id);
    db.prepare('DELETE FROM hr_candidates WHERE id = ?').run(id);
  })();
  res.json({ ok: true });
});

// ---------- offer and hire ----------
recruitRouter.put('/candidates/:id/offer', (req, res) => {
  const id = Number(req.params.id), c = cand(id); if (!c) return bad(res, 'Candidate not found.', 404);
  if (c.stage === 'hired') return bad(res, 'This person is already hired.', 409);
  const b = req.body, salary = int(b?.salary);
  if (salary < 1) return bad(res, 'Enter the offered salary.');
  if (!isDate(b?.joining_date)) return bad(res, 'Choose the joining date.');
  db.prepare("UPDATE hr_candidates SET stage = 'offered', offer_designation = ?, offer_salary = ?, offer_date = ?, joining_date = ?, offer_employment = ?, reject_reason = NULL WHERE id = ?")
    .run(t(b.designation, 60), salary, date(b.offer_date) ?? todayISO(), b.joining_date, EMPLOYMENT.includes(b.employment) ? b.employment : 'permanent', id);
  res.json({ ok: true });
});

/** Final step: the candidate becomes a staff member (same CV and documents come along). */
recruitRouter.post('/candidates/:id/hire', (req, res) => {
  const id = Number(req.params.id), c = cand(id); if (!c) return bad(res, 'Candidate not found.', 404);
  if (c.stage === 'hired') return bad(res, 'This person is already hired.', 409);
  const b = req.body ?? {};
  const job = c.job_id ? db.prepare('SELECT * FROM hr_jobs WHERE id = ?').get(c.job_id) as any : null;
  const type = STAFF_TYPES.includes(b.staff_type) ? b.staff_type : job?.kind === 'teaching' ? 'teacher' : 'office';
  const joining = date(b.joining_date) ?? c.joining_date ?? todayISO();
  const basic = int(b.basic_salary, c.offer_salary ?? 0);
  const employment = EMPLOYMENT.includes(b.employment) ? b.employment : c.offer_employment ?? 'permanent';
  const staffId = db.transaction(() => {
    const sid = Number(db.prepare(`INSERT INTO hr_staff (emp_no, name, gender, cnic, phone, email, qualification, staff_type, kind, department, designation, employment, joining_date, contract_end, basic_salary, candidate_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(nextEmpNo(), c.name, c.gender, c.cnic, c.phone, c.email, c.qualification, type, kindOfType(type), t(b.department, 60) ?? job?.department ?? DEPARTMENT_OF[type],
      t(b.designation, 60) ?? c.offer_designation ?? job?.title ?? null, employment, joining, date(b.contract_end), basic, id).lastInsertRowid);
    // the CV and any papers move to the staff record (the file itself is shared, not copied)
    for (const f of db.prepare("SELECT * FROM hr_files WHERE owner_type = 'candidate' AND owner_id = ?").all(id) as any[])
      db.prepare("INSERT INTO hr_files (owner_type, owner_id, label, name, stored, mime, size, expires) VALUES ('staff', ?, ?, ?, ?, ?, ?, ?)").run(sid, f.label ?? 'CV', f.name, f.stored, f.mime, f.size, f.expires);
    db.prepare("UPDATE hr_candidates SET stage = 'hired', staff_id = ?, joining_date = ? WHERE id = ?").run(sid, joining, id);
    syncLinked(sid);
    if (job) { const filled = (db.prepare("SELECT COUNT(*) AS n FROM hr_candidates WHERE job_id = ? AND stage = 'hired'").get(job.id) as any).n; if (filled >= job.positions) db.prepare("UPDATE hr_jobs SET status = 'closed' WHERE id = ?").run(job.id); }
    return sid;
  })();
  res.status(201).json({ staff_id: staffId });
});

// ---------- interviews ----------
recruitRouter.get('/interviews', (req, res) => {
  const { date: d, status } = req.query as Record<string, string>;
  const where: string[] = [], args: any[] = [];
  if (isDate(d)) { where.push('i.date = ?'); args.push(d); }
  if (['scheduled', 'done', 'no_show', 'cancelled'].includes(status)) { where.push('i.status = ?'); args.push(status); }
  res.json(db.prepare(`SELECT i.*, c.name, c.phone, c.email, c.stage, j.title AS job_title, (SELECT COUNT(*) FROM hr_interview_marks m WHERE m.interview_id = i.id) AS sheets FROM hr_interviews i JOIN hr_candidates c ON c.id = i.candidate_id LEFT JOIN hr_jobs j ON j.id = c.job_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.date DESC, i.time, i.id LIMIT 500`).all(...args));
});

/** Schedules the same interview day for many candidates; with `slot_minutes` each one gets the next time slot. */
recruitRouter.post('/interviews', (req, res) => {
  const b = req.body ?? {};
  const ids: number[] = Array.isArray(b.candidate_ids) ? b.candidate_ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return bad(res, 'Select at least one candidate.');
  if (!isDate(b.date)) return bad(res, 'Choose the interview date.');
  const start = /^\d{2}:\d{2}$/.test(b.time ?? '') ? b.time : null;
  const slot = Math.max(0, Math.min(240, Math.round(Number(b.slot_minutes) || 0)));
  const at = (i: number) => { if (!start) return null; const m = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + i * slot; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const ins = db.prepare('INSERT INTO hr_interviews (candidate_id, round, date, time, venue, panel) VALUES (?,?,?,?,?,?)');
  const out: number[] = [];
  db.transaction(() => {
    ids.forEach((cid, i) => {
      const c = cand(cid); if (!c || c.stage === 'hired') return;
      out.push(Number(ins.run(cid, t(b.round, 40) ?? 'Interview', b.date, at(i), t(b.venue, 120), t(b.panel, 120)).lastInsertRowid));
      db.prepare("UPDATE hr_candidates SET stage = 'interview' WHERE id = ? AND stage IN ('applied','shortlisted')").run(cid);
    });
  })();
  res.status(201).json({ ids: out });
});

recruitRouter.put('/interviews/:id', (req, res) => {
  const id = Number(req.params.id), i = db.prepare('SELECT * FROM hr_interviews WHERE id = ?').get(id) as any;
  if (!i) return bad(res, 'Interview not found.', 404);
  const b = req.body ?? {};
  const score = b.score === null || b.score === '' || b.score === undefined ? null : Math.round(Number(b.score));
  if (score !== null && !(score >= 0 && score <= 100)) return bad(res, 'Score: 0 to 100.');
  db.prepare('UPDATE hr_interviews SET round = ?, date = ?, time = ?, venue = ?, panel = ?, status = ?, score = ?, feedback = ?, result = ? WHERE id = ?').run(
    t(b.round, 40) ?? i.round, date(b.date) ?? i.date, /^\d{2}:\d{2}$/.test(b.time ?? '') ? b.time : null, t(b.venue, 120), t(b.panel, 120),
    ['scheduled', 'done', 'no_show', 'cancelled'].includes(b.status) ? b.status : i.status, score, t(b.feedback, 1000), ['pass', 'fail', 'hold'].includes(b.result) ? b.result : null, id);
  res.json({ ok: true });
});
recruitRouter.delete('/interviews/:id', (req, res) => { db.prepare('DELETE FROM hr_interviews WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// ---------- messages (WhatsApp / SMS / email are opened from the browser; the log is kept here) ----------
recruitRouter.get('/templates', (_req, res) => res.json({ templates: templates(), defaults: DEFAULT_TEMPLATES }));
recruitRouter.put('/templates', (req, res) => {
  const kind = String(req.body?.kind), text = String(req.body?.text ?? '').trim();
  if (!(TEMPLATE_KINDS as readonly string[]).includes(kind)) return bad(res, 'Unknown message.');
  if (text.length < 5 || text.length > 1000) return bad(res, 'The message must be 5 to 1000 characters.');
  setSetting(`hr_tpl_${kind}`, text);
  res.json({ ok: true });
});
recruitRouter.post('/messages', (req, res) => {
  const b = req.body ?? {};
  const ids: number[] = Array.isArray(b.candidate_ids) ? b.candidate_ids.map(Number).filter(Number.isFinite) : [];
  if (!['whatsapp', 'sms', 'email'].includes(b.channel)) return bad(res, 'Unknown channel.');
  const ins = db.prepare('INSERT INTO hr_messages (candidate_id, channel, kind, text, sent_by) VALUES (?,?,?,?,?)');
  let n = 0;
  db.transaction(() => { for (const id of ids) if (cand(id)) { ins.run(id, b.channel, t(b.kind, 20) ?? 'general', t(b.text, 1000), req.user!.id); n++; } })();
  res.status(201).json({ logged: n });
});

// =====================================================================
// CV reading, duplicates and the score out of 100
// =====================================================================
const last10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
function findDuplicate(x: { phone?: string | null; email?: string | null; cnic?: string | null }, exceptId = 0): any {
  const ph = last10(x.phone), em = (x.email ?? '').trim().toLowerCase(), cn = String(x.cnic ?? '').replace(/\D/g, '');
  if (ph.length < 10 && !em && cn.length < 13) return null;
  const rows = db.prepare('SELECT c.*, j.title AS job_title FROM hr_candidates c LEFT JOIN hr_jobs j ON j.id = c.job_id WHERE c.id <> ? ORDER BY c.id').all(exceptId) as any[];
  return rows.find(r => (ph.length >= 10 && last10(r.phone) === ph) || (em && (r.email ?? '').toLowerCase() === em) || (cn.length >= 13 && String(r.cnic ?? '').replace(/\D/g, '') === cn)) ?? null;
}
recruitRouter.get('/check-duplicate', (req, res) => {
  const q = req.query as Record<string, string>, d = findDuplicate({ phone: q.phone, email: q.email, cnic: q.cnic }, Number(q.exclude) || 0);
  res.json(d ? { id: d.id, name: d.name, job_title: d.job_title, stage: d.stage } : null);
});

function rescore(id: number) {
  const c = cand(id); if (!c) return;
  const job = c.job_id ? db.prepare('SELECT * FROM hr_jobs WHERE id = ?').get(c.job_id) as any : null;
  const text = (db.prepare('SELECT text FROM hr_cv_text WHERE candidate_id = ?').get(id) as any)?.text ?? '';
  const sc = scoreCandidate(c, job, text);
  db.prepare('UPDATE hr_candidates SET score = ?, score_note = ? WHERE id = ?').run(sc.score, JSON.stringify(sc), id);
}
/** Re-marks every candidate of a post (after the keywords of the post were changed). */
recruitRouter.post('/rescore', (req, res) => {
  const jobId = Number(req.body?.job_id) || 0;
  const ids = (db.prepare(jobId ? 'SELECT id FROM hr_candidates WHERE job_id = ?' : 'SELECT id FROM hr_candidates').all(...(jobId ? [jobId] : [])) as any[]).map(r => r.id);
  db.transaction(() => ids.forEach(rescore))();
  res.json({ scored: ids.length });
});

const MIME: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
function attachFile(candidateId: number, name: string, ext: string, body: Buffer, label = 'CV'): number {
  const stored = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(FILE_DIR, stored), body);
  return Number(db.prepare("INSERT INTO hr_files (owner_type, owner_id, label, name, stored, mime, size, expires) VALUES ('candidate', ?, ?, ?, ?, ?, ?, NULL)").run(candidateId, label, name, stored, MIME[ext], body.length).lastInsertRowid);
}
/** Reads the text of a CV that was attached to a candidate, so it can be searched and scored. */
export async function indexCandidateCv(id: number, body: Buffer, ext: string) {
  const text = await extractText(body, ext);
  if (text) db.prepare('INSERT INTO hr_cv_text (candidate_id, text) VALUES (?, ?) ON CONFLICT(candidate_id) DO UPDATE SET text = text || char(10) || excluded.text').run(id, text);
  rescore(id);
  return text.length;
}

/** One CV file in, one candidate out: name, phone, email, qualification and experience are read from the file. A person who applied before is not added twice. */
recruitRouter.post('/candidates/cv-import', express.raw({ type: () => true, limit: '9mb' }), async (req, res) => {
  try {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) return bad(res, 'Choose a file first.');
    const name = (t(req.query.name, 120) ?? 'cv').replace(/[\\/:*?"<>|]/g, '_'), ext = (name.split('.').pop() ?? '').toLowerCase();
    if (!MIME[ext]) return bad(res, 'Only PDF, Word (doc, docx), JPG and PNG files are allowed.');
    const jobId = Number(req.query.job_id) || null;
    if (jobId && !db.prepare('SELECT 1 FROM hr_jobs WHERE id = ?').get(jobId)) return bad(res, 'This post does not exist.');
    const text = await extractText(body, ext), info = parseCv(text);
    const stem = name.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').replace(/\b(cv|resume|curriculum vitae)\b/gi, '').replace(/\s+/g, ' ').trim();
    const fallback = stem.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()) || 'New candidate';
    const dup = findDuplicate({ phone: info.phone, email: info.email, cnic: info.cnic });
    let id: number, status: 'created' | 'duplicate';
    db.transaction(() => {
      if (dup) {
        id = dup.id; status = 'duplicate';
        // fill only the blanks of the old record
        db.prepare('UPDATE hr_candidates SET phone = COALESCE(phone, ?), email = COALESCE(email, ?), cnic = COALESCE(cnic, ?), qualification = COALESCE(qualification, ?), experience_years = COALESCE(experience_years, ?), city = COALESCE(city, ?) WHERE id = ?')
          .run(info.phone, info.email, info.cnic, info.qualification, info.experience_years, info.city, id);
      } else {
        id = Number(db.prepare('INSERT INTO hr_candidates (job_id, name, phone, email, cnic, city, qualification, experience_years, source, cv_status, applied_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(jobId, info.name ?? fallback, info.phone, info.email, info.cnic, info.city, info.qualification, info.experience_years, 'CV upload', text ? (info.name ? 'read' : 'partly') : 'unreadable', todayISO()).lastInsertRowid);
        status = 'created';
      }
      attachFile(id, name, ext, body);
    })();
    if (text) { db.prepare('INSERT INTO hr_cv_text (candidate_id, text) VALUES (?, ?) ON CONFLICT(candidate_id) DO UPDATE SET text = excluded.text').run(id!, text); rescore(id!); }
    const c = cand(id!);
    res.status(201).json({
      status: status!, id: id!, name: c.name, phone: c.phone, email: c.email, qualification: c.qualification, experience_years: c.experience_years, score: c.score,
      text_ok: !!text, name_found: !!info.name, existing_job: dup?.job_title ?? null, existing_stage: dup?.stage ?? null
    });
  } catch (e) { console.error(e); bad(res, 'This file could not be processed.', 500); }
});

// =====================================================================
// documents checklist (what the new staff member must bring)
// =====================================================================
const CHECK_DEFAULT = ['CNIC copy', 'Degrees / certificates', 'Experience letters', 'Passport size photos', 'Police / character certificate', 'Bank account details'];
const checkItems = (): string[] => { try { const a = JSON.parse(getSetting('hr_checklist_items') || 'null'); return Array.isArray(a) && a.length ? a.map(String) : CHECK_DEFAULT; } catch { return CHECK_DEFAULT; } };
function checklistOf(c: any) { let done: Record<string, boolean> = {}; try { done = JSON.parse(c.checklist || '{}'); } catch { /* empty */ } return checkItems().map(item => ({ item, done: !!done[item] })); }
recruitRouter.get('/checklist-items', (_req, res) => res.json(checkItems()));
recruitRouter.put('/checklist-items', (req, res) => {
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).map((x: unknown) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 30);
  if (!items.length) return bad(res, 'Add at least one item.');
  setSetting('hr_checklist_items', JSON.stringify(items)); res.json({ ok: true });
});
recruitRouter.put('/candidates/:id/checklist', (req, res) => {
  const id = Number(req.params.id); if (!cand(id)) return bad(res, 'Candidate not found.', 404);
  const done: Record<string, boolean> = {};
  for (const item of checkItems()) done[item] = !!req.body?.done?.[item];
  db.prepare('UPDATE hr_candidates SET checklist = ? WHERE id = ?').run(JSON.stringify(done), id);
  res.json({ ok: true });
});

// =====================================================================
// interview marks sheets (one per panel member, averaged)
// =====================================================================
const CRIT_DEFAULT = ['Subject knowledge', 'Communication', 'Personality and confidence', 'Teaching method / experience'];
const criteria = () => { try { const a = JSON.parse(getSetting('hr_int_criteria') || 'null'); return Array.isArray(a) && a.length ? a.map(String) : CRIT_DEFAULT; } catch { return CRIT_DEFAULT; } };
const critMax = () => Math.max(1, Math.min(100, Math.round(Number(getSetting('hr_int_max'))) || 10));
recruitRouter.get('/interview-criteria', (_req, res) => res.json({ criteria: criteria(), max: critMax() }));
recruitRouter.put('/interview-criteria', (req, res) => {
  const list = (Array.isArray(req.body?.criteria) ? req.body.criteria : []).map((x: unknown) => String(x).trim().slice(0, 50)).filter(Boolean).slice(0, 10);
  const max = Math.round(Number(req.body?.max));
  if (!list.length) return bad(res, 'Add at least one point to mark.');
  if (!(max >= 1 && max <= 100)) return bad(res, 'Marks for each point: 1 to 100.');
  setSetting('hr_int_criteria', JSON.stringify(list)); setSetting('hr_int_max', String(max)); res.json({ ok: true });
});
recruitRouter.get('/interviews/:id/marks', (req, res) => {
  const id = Number(req.params.id);
  res.json({ criteria: criteria(), max: critMax(), sheets: (db.prepare('SELECT member, scores, total, max, remark FROM hr_interview_marks WHERE interview_id = ? ORDER BY id').all(id) as any[]).map(r => ({ ...r, scores: JSON.parse(r.scores) })) });
});
recruitRouter.put('/interviews/:id/marks', (req, res) => {
  const id = Number(req.params.id), i = db.prepare('SELECT * FROM hr_interviews WHERE id = ?').get(id) as any;
  if (!i) return bad(res, 'Interview not found.', 404);
  const crit = criteria(), max = critMax(), sheets: any[] = [];
  for (const sh of Array.isArray(req.body?.sheets) ? req.body.sheets : []) {
    const member = t(sh?.member, 60); if (!member) continue;
    const scores: Record<string, number> = {}; let total = 0;
    for (const k of crit) {
      const v = sh.scores?.[k] === '' || sh.scores?.[k] === null || sh.scores?.[k] === undefined ? 0 : Number(sh.scores[k]);
      if (!Number.isFinite(v) || v < 0 || v > max) return bad(res, `${member}: marks for "${k}" must be 0 to ${max}.`);
      scores[k] = v; total += v;
    }
    sheets.push({ member, scores, total, max: max * crit.length, remark: t(sh.remark, 200) });
  }
  let avg: number | null = null;
  db.transaction(() => {
    db.prepare('DELETE FROM hr_interview_marks WHERE interview_id = ?').run(id);
    for (const s of sheets) db.prepare('INSERT INTO hr_interview_marks (interview_id, member, scores, total, max, remark) VALUES (?,?,?,?,?,?)').run(id, s.member, JSON.stringify(s.scores), s.total, s.max, s.remark);
    if (sheets.length) {
      avg = Math.round(sheets.reduce((a, s) => a + (s.total / s.max) * 100, 0) / sheets.length);
      db.prepare("UPDATE hr_interviews SET score = ?, status = CASE WHEN status = 'scheduled' THEN 'done' ELSE status END, panel = COALESCE(panel, ?) WHERE id = ?").run(avg, sheets.map(s => s.member).join(', ').slice(0, 120), id);
    } else db.prepare('UPDATE hr_interviews SET score = NULL WHERE id = ?').run(id);
  })();
  res.json({ score: avg, sheets: sheets.length });
});

// =====================================================================
// real e-mail and SMS (set up once under Settings), WhatsApp stays one click
// =====================================================================
recruitRouter.get('/notify', (_req, res) => res.json(notifyView()));
recruitRouter.put('/notify', requireRole('director', 'principal'), (req, res) => { saveNotify(req.body); res.json(notifyView()); });
recruitRouter.post('/notify/test', async (req, res) => {
  const to = String(req.body?.to ?? '').trim();
  try {
    if (req.body?.channel === 'email') await sendEmail(to, 'Test message', 'This is a test message from your College ERP. Email is working.');
    else if (req.body?.channel === 'sms') await sendSms(to, 'Test SMS from your College ERP. SMS is working.');
    else return bad(res, 'Choose email or SMS.');
    res.json({ ok: true });
  } catch (e) { bad(res, (e as Error).message, 502); }
});
/** Sends the same message to many candidates now (not just opens a draft). A failure for one person does not stop the others. */
recruitRouter.post('/messages/send', async (req, res) => {
  const b = req.body ?? {};
  // items: [{ id, subject, text }] - the text is already filled in for each person; the older form (candidate_ids + one text) still works
  const items: { id: number; subject: string | null; text: string }[] = Array.isArray(b.items)
    ? b.items.map((x: any) => ({ id: Number(x?.id), subject: t(x?.subject, 150), text: String(x?.text ?? '').trim() }))
    : (Array.isArray(b.candidate_ids) ? b.candidate_ids.map((id: unknown) => ({ id: Number(id), subject: t(b.subject, 150), text: String(b.text ?? '').trim() })) : []);
  if (!['email', 'sms'].includes(b.channel)) return bad(res, 'Choose email or SMS.');
  const list = items.filter(x => Number.isFinite(x.id)).slice(0, 200);
  if (!list.length) return bad(res, 'Select at least one candidate.');
  if (b.channel === 'email' && !smtpConfig().host) return bad(res, 'Email is not set up yet (Settings, Email and SMS).', 409);
  if (b.channel === 'sms' && !smsConfig().url) return bad(res, 'SMS is not set up yet (Settings, Email and SMS).', 409);
  const sent: number[] = [], failed: { id: number; name: string; error: string }[] = [];
  const log = db.prepare("INSERT INTO hr_messages (candidate_id, channel, kind, text, sent_by, status) VALUES (?,?,?,?,?, 'sent')");
  for (const it of list) {
    const c = cand(it.id); if (!c) continue;
    const fill = (x: string) => x.replace(/\{name\}/g, c.name);
    try {
      if (it.text.length < 3) throw new Error('The message is empty.');
      if (b.channel === 'email') { if (!c.email) throw new Error('No email address.'); await sendEmail(c.email, fill(it.subject ?? 'Message from the college'), fill(it.text)); }
      else { if (!c.phone) throw new Error('No phone number.'); await sendSms(c.phone, fill(it.text)); }
      log.run(it.id, b.channel, t(b.kind, 20) ?? 'general', fill(it.text).slice(0, 1000), req.user!.id); sent.push(it.id);
    } catch (e) { failed.push({ id: it.id, name: c.name, error: (e as Error).message }); }
  }
  res.json({ sent: sent.length, sent_ids: sent, failed });
});
