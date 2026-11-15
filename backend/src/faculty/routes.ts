import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { addColumn, db, passwordChanged } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { cnicCheck } from '../students/admission.js';
import '../timetable/schema.js';
import '../hr/schema.js';

/**
 * Teachers: one page for the office to add a teacher, change every detail, give or reset the login and remove the teacher.
 * The ranks run from Educator up to Professor. The timetable keeps working from the same `teachers` table, and when a teacher is also
 * on the HR list the shared details (name, phone, CNIC, rank as designation...) are copied across so the two never disagree.
 */
addColumn('teachers', 'rank', 'TEXT');
addColumn('teachers', 'email', 'TEXT');
addColumn('teachers', 'cnic', 'TEXT');
addColumn('teachers', 'qualification', 'TEXT');
addColumn('teachers', 'address', 'TEXT');
addColumn('teachers', 'joining_date', 'TEXT');
addColumn('teachers', 'gender', 'TEXT');
addColumn('teachers', 'photo', 'TEXT');

export const RANKS = [
  { key: 'educator', label: 'Educator' }, { key: 'senior_educator', label: 'Senior Educator' },
  { key: 'subject_specialist', label: 'Subject Specialist' }, { key: 'senior_subject_specialist', label: 'Senior Subject Specialist' },
  { key: 'lecturer', label: 'Lecturer' }, { key: 'assistant_professor', label: 'Assistant Professor' },
  { key: 'associate_professor', label: 'Associate Professor' }, { key: 'professor', label: 'Professor' }
];
const RANK_LABEL = Object.fromEntries(RANKS.map(r => [r.key, r.label]));

const bad = (res: any, m: string, c = 400) => res.status(c).json({ message: m });
const boss = requireRole('director', 'principal', 'admin');
const text = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
const cleanPhoto = (v: unknown) => (typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v) && v.length <= 120000 ? v : null);

interface Clean { name: string; rank: string | null; phone: string | null; email: string | null; cnic: string | null; qualification: string | null; address: string | null; joining: string | null; gender: string | null; maxDay: number; maxWeek: number; subjects: number[] }

function clean(b: any): { error: string } | { v: Clean } {
  const name = text(b?.name, 80); if (name.length < 2) return { error: 'Enter the teacher\'s name.' };
  const rank = text(b?.rank, 40) || null; if (rank && !RANK_LABEL[rank]) return { error: 'Choose a rank from the list.' };
  const email = text(b?.email, 80) || null; if (email && !/^\S+@\S+\.\S+$/.test(email)) return { error: 'This email address does not look right.' };
  const c = cnicCheck(b?.cnic); if (c.error) return { error: c.error };
  const joining = text(b?.joining_date, 10) || null; if (joining && !isDate(joining)) return { error: 'Enter the joining date as a proper date.' };
  const gender = text(b?.gender, 10) || null; if (gender && !['male', 'female'].includes(gender)) return { error: 'Choose male or female.' };
  const maxDay = Number(b?.max_per_day ?? 6), maxWeek = Number(b?.max_per_week ?? 30);
  if (!(maxDay >= 1 && maxDay <= 12)) return { error: 'Daily limit must be between 1 and 12.' };
  if (!(maxWeek >= 1 && maxWeek <= 70)) return { error: 'Weekly limit must be between 1 and 70.' };
  const subjects = [...new Set((Array.isArray(b?.subjects) ? b.subjects : []).map(Number).filter((n: number) => Number.isInteger(n)))] as number[];
  for (const s of subjects) if (!db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(s)) return { error: 'A subject in the list does not exist.' };
  return { v: { name, rank, phone: text(b?.phone, 30) || null, email, cnic: c.value, qualification: text(b?.qualification, 120) || null, address: text(b?.address, 200) || null, joining, gender, maxDay, maxWeek, subjects } };
}

/** Copy the shared details to the HR record and the login name, so there is one truth. */
function sync(tid: number) {
  const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(tid) as any; if (!t) return;
  if (t.user_id) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(t.name, t.user_id);
  db.prepare('UPDATE hr_staff SET name=?, phone=?, email=COALESCE(?, email), cnic=COALESCE(?, cnic), address=COALESCE(?, address), qualification=COALESCE(?, qualification), gender=COALESCE(?, gender), joining_date=COALESCE(?, joining_date), designation=COALESCE(?, designation), photo=COALESCE(?, photo) WHERE teacher_id = ?')
    .run(t.name, t.phone, t.email, t.cnic, t.address, t.qualification, t.gender, t.joining_date, t.rank ? RANK_LABEL[t.rank] : null, t.photo, tid);
}

function rows(where = 't.active = 1') {
  const subs = new Map<number, { id: number; name: string }[]>(), cls = new Map<number, string[]>(), load = new Map<number, number>();
  for (const r of db.prepare('SELECT ts.teacher_id, s.id, s.name FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id ORDER BY s.name').all() as any[]) (subs.get(r.teacher_id) ?? subs.set(r.teacher_id, []).get(r.teacher_id)!).push({ id: r.id, name: r.name });
  for (const r of db.prepare("SELECT s.class_teacher_id AS tid, c.name || '-' || s.name AS label FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.class_teacher_id IS NOT NULL ORDER BY c.grade, s.name").all() as any[]) (cls.get(r.tid) ?? cls.set(r.tid, []).get(r.tid)!).push(r.label);
  for (const r of db.prepare('SELECT teacher_id, SUM(periods_per_week) AS n FROM section_subjects WHERE teacher_id IS NOT NULL GROUP BY teacher_id').all() as any[]) load.set(r.teacher_id, r.n);
  const list = db.prepare(`SELECT t.id, t.name, t.rank, t.phone, t.email, t.cnic, t.qualification, t.address, t.joining_date, t.gender, t.max_per_day, t.max_per_week, t.active, (t.photo IS NOT NULL) AS has_photo,
      t.user_id, u.username, u.active AS login_active, (SELECT id FROM hr_staff h WHERE h.teacher_id = t.id LIMIT 1) AS staff_id
    FROM teachers t LEFT JOIN users u ON u.id = t.user_id WHERE ${where} ORDER BY t.name`).all() as any[];
  return list.map(t => ({ ...t, has_photo: !!t.has_photo, rank_label: t.rank ? RANK_LABEL[t.rank] : null, login_active: t.user_id ? !!t.login_active : null, subjects: subs.get(t.id) ?? [], class_teacher_of: cls.get(t.id) ?? [], load: load.get(t.id) ?? 0 }));
}

export const facultyRouter = Router();
facultyRouter.get('/', boss, (req, res) => res.json({ ranks: RANKS, subjects: db.prepare('SELECT id, name FROM subjects ORDER BY name').all(), items: rows(req.query.all === '1' ? '1=1' : 't.active = 1') }));

/** Numbers for the dashboard card. */
facultyRouter.get('/summary', boss, (_req, res) => {
  const all = rows(), byRank = RANKS.map(r => ({ ...r, count: all.filter(t => t.rank === r.key).length }));
  res.json({ total: all.length, byRank, noRank: all.filter(t => !t.rank).length, withLogin: all.filter(t => t.user_id && t.login_active).length, noLogin: all.filter(t => !t.user_id).length, classTeachers: all.filter(t => t.class_teacher_of.length).length });
});

facultyRouter.get('/:id/photo', boss, (req, res) => {
  const r = db.prepare('SELECT photo FROM teachers WHERE id = ?').get(Number(req.params.id)) as any;
  if (!r) return bad(res, 'Teacher not found.', 404);
  res.set('Cache-Control', 'private, max-age=300').json({ photo: r.photo });
});

function usernameOk(u: string) { return /^[a-z0-9._-]{3,30}$/.test(u); }

facultyRouter.post('/', boss, (req, res) => {
  const c = clean(req.body); if ('error' in c) return bad(res, c.error);
  const v = c.v, lg = req.body?.login;
  if (lg?.username || lg?.password) {
    const un = text(lg.username, 30).toLowerCase();
    if (!usernameOk(un)) return bad(res, 'The username must be 3 to 30 letters or numbers (no spaces).');
    if (String(lg.password ?? '').length < 8) return bad(res, 'The password must be at least 8 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(un)) return bad(res, 'This username is already taken.', 409);
  }
  const photo = req.body?.photo ? cleanPhoto(req.body.photo) : null;
  const id = db.transaction(() => {
    const tid = Number(db.prepare('INSERT INTO teachers (name, phone, max_per_day, max_per_week, rank, email, cnic, qualification, address, joining_date, gender, photo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(v.name, v.phone, v.maxDay, v.maxWeek, v.rank, v.email, v.cnic, v.qualification, v.address, v.joining, v.gender, photo).lastInsertRowid);
    for (const s of v.subjects) db.prepare('INSERT OR IGNORE INTO teacher_subjects VALUES (?, ?)').run(tid, s);
    if (lg?.username || lg?.password) {
      const uid = Number(db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?, 'teacher')").run(v.name, text(lg.username, 30).toLowerCase(), bcrypt.hashSync(String(lg.password), 10)).lastInsertRowid);
      db.prepare('UPDATE teachers SET user_id = ? WHERE id = ?').run(uid, tid);
    }
    return tid;
  })();
  audit(req.user, 'faculty.add', 'teacher', id, `${v.name}${v.rank ? ` (${RANK_LABEL[v.rank]})` : ''}${lg?.username ? ', login created' : ''}`);
  res.status(201).json({ id });
});

facultyRouter.put('/:id', boss, (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(id) as any; if (!old) return bad(res, 'Teacher not found.', 404);
  const c = clean(req.body); if ('error' in c) return bad(res, c.error);
  const v = c.v;
  let photoSql = '', photoArg: any[] = [];
  if (req.body?.photo === null || req.body?.photo === '') photoSql = ', photo = NULL';
  else if (req.body?.photo !== undefined) { const p = cleanPhoto(req.body.photo); if (!p) return bad(res, 'Use a PNG, JPG or WebP photo (it is saved small, about 100 KB).'); photoSql = ', photo = ?'; photoArg = [p]; }
  db.transaction(() => {
    db.prepare(`UPDATE teachers SET name=?, phone=?, max_per_day=?, max_per_week=?, rank=?, email=?, cnic=?, qualification=?, address=?, joining_date=?, gender=?${photoSql} WHERE id=?`)
      .run(v.name, v.phone, v.maxDay, v.maxWeek, v.rank, v.email, v.cnic, v.qualification, v.address, v.joining, v.gender, ...photoArg, id);
    db.prepare('DELETE FROM teacher_subjects WHERE teacher_id = ?').run(id);
    for (const s of v.subjects) db.prepare('INSERT OR IGNORE INTO teacher_subjects VALUES (?, ?)').run(id, s);
    sync(id);
  })();
  audit(req.user, 'faculty.edit', 'teacher', id, `${old.name}${old.name !== v.name ? ` -> ${v.name}` : ''}`);
  res.json({ ok: true });
});

/** Give a login, change the username, set a new password, or switch the login on and off. The password is never written to the audit log. */
facultyRouter.post('/:id/login', boss, (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT id, name, user_id FROM teachers WHERE id = ?').get(id) as any; if (!t) return bad(res, 'Teacher not found.', 404);
  const b = req.body ?? {}, pw = b.password === undefined ? null : String(b.password);
  if (pw !== null && pw.length < 8) return bad(res, 'The password must be at least 8 characters.');
  if (!t.user_id) {
    const un = text(b.username, 30).toLowerCase();
    if (!usernameOk(un)) return bad(res, 'The username must be 3 to 30 letters or numbers (no spaces).');
    if (pw === null) return bad(res, 'Set a password for the new login.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(un)) return bad(res, 'This username is already taken.', 409);
    const uid = Number(db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?, 'teacher')").run(t.name, un, bcrypt.hashSync(pw, 10)).lastInsertRowid);
    db.prepare('UPDATE teachers SET user_id = ? WHERE id = ?').run(uid, id);
    audit(req.user, 'faculty.login.create', 'teacher', id, un);
    return res.status(201).json({ username: un, created: true });
  }
  const u = db.prepare('SELECT id, username, active FROM users WHERE id = ?').get(t.user_id) as any;
  let username = u.username;
  if (b.username !== undefined && text(b.username, 30).toLowerCase() !== u.username) {
    const un = text(b.username, 30).toLowerCase();
    if (!usernameOk(un)) return bad(res, 'The username must be 3 to 30 letters or numbers (no spaces).');
    if (db.prepare('SELECT 1 FROM users WHERE username = ? AND id <> ?').get(un, u.id)) return bad(res, 'This username is already taken.', 409);
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(un, u.id); username = un;
    audit(req.user, 'faculty.login.rename', 'teacher', id, `${u.username} -> ${un}`);
  }
  if (pw !== null) { db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pw, 10), u.id); passwordChanged(u.id); audit(req.user, 'faculty.login.password', 'teacher', id, 'password reset'); }
  if (b.active !== undefined) { db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, u.id); audit(req.user, b.active ? 'faculty.login.enable' : 'faculty.login.disable', 'teacher', id, username); }
  res.json({ username, created: false });
});

/** Remove a teacher. If lessons or a class are still theirs, say so first; with force=1 they are freed and the login is closed. */
facultyRouter.delete('/:id', boss, (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT id, name, user_id FROM teachers WHERE id = ?').get(id) as any; if (!t) return bad(res, 'Teacher not found.', 404);
  const lessons = (db.prepare('SELECT COUNT(*) AS n FROM section_subjects WHERE teacher_id = ?').get(id) as any).n;
  const classes = (db.prepare('SELECT COUNT(*) AS n FROM sections WHERE class_teacher_id = ?').get(id) as any).n;
  if ((lessons || classes) && req.query.force !== '1')
    return res.status(409).json({ message: `${t.name} still teaches ${lessons} subject(s) and is class teacher of ${classes} class(es). Remove anyway to free them.`, lessons, classes, needsForce: true });
  db.transaction(() => {
    db.prepare('UPDATE section_subjects SET teacher_id = NULL WHERE teacher_id = ?').run(id);
    db.prepare('UPDATE sections SET class_teacher_id = NULL WHERE class_teacher_id = ?').run(id);
    db.prepare('UPDATE teachers SET active = 0 WHERE id = ?').run(id);
    if (t.user_id) db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(t.user_id);
  })();
  audit(req.user, 'faculty.remove', 'teacher', id, `${t.name}${lessons || classes ? ' (lessons freed)' : ''}`);
  res.json({ ok: true });
});
export { sync as syncTeacher };
