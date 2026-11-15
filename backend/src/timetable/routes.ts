import { Router } from 'express';
import { db, passwordChanged } from '../db.js';
import bcrypt from 'bcryptjs';
import { requireAccess, requireRole } from '../auth.js';
import { linkOverview, linkTeacher, unlinkTeacher } from '../teacher/link.js';
import { DEFAULT_SETTINGS, WING_SQL, WINGS, asWing, getSettings, periodTimes, saveSettings, wingOfSection, type TTSettings, type Wing } from './schema.js';
import { precheck, solve, validateSlots, type LessonIn, type SlotOut, type SolveResult, type SolverInput, type TeacherIn } from './solver.js';
import { autoAssign } from './assign.js';

export const timetableRouter = Router();
const manage = requireAccess(['director', 'principal', 'admin'], 'timetable_team');
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------- helpers ----------
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/**
 * A teacher who teaches in both wings cannot be in two places at once, but the wings have their own bell times.
 * So the published lessons of the OTHER wing are turned into "not available" periods of this wing by clock overlap.
 */
function otherWingBusy(wing: Wing): { teacher_id: number; day: number; period: number }[] {
  const other: Wing = wing === 'school' ? 'college' : 'school';
  const mine = periodTimes(getSettings(wing)).map(t => ({ a: toMin(t.start), b: toMin(t.end) }));
  const theirs = periodTimes(getSettings(other)).map(t => ({ a: toMin(t.start), b: toMin(t.end) }));
  const rows = db.prepare(`SELECT DISTINCT ts.teacher_id, ts.day, ts.period FROM tt_slots ts JOIN sections s ON s.id = ts.section_id JOIN classes c ON c.id = s.class_id WHERE ${WING_SQL} = ?`).all(other) as any[];
  const out: { teacher_id: number; day: number; period: number }[] = [];
  for (const r of rows) {
    const t = theirs[r.period]; if (!t) continue;
    mine.forEach((m, q) => { if (m.a < t.b && t.a < m.b) out.push({ teacher_id: r.teacher_id, day: r.day, period: q }); });
  }
  return out;
}

export function loadInput(wing: Wing = 'school'): Omit<SolverInput, 'locked'> {
  const s = getSettings(wing);
  const unav = new Map<number, { day: number; period: number }[]>();
  for (const r of [...db.prepare('SELECT teacher_id, day, period FROM teacher_unavailable').all() as any[], ...otherWingBusy(wing)])
    (unav.get(r.teacher_id) ?? unav.set(r.teacher_id, []).get(r.teacher_id)!).push({ day: r.day, period: r.period });
  const teachers: TeacherIn[] = (db.prepare('SELECT id, name, max_per_day, max_per_week FROM teachers WHERE active = 1').all() as any[])
    .map(t => ({ id: t.id, name: t.name, maxPerDay: t.max_per_day, maxPerWeek: t.max_per_week, unavailable: unav.get(t.id) ?? [] }));
  const lessons: LessonIn[] = (db.prepare(`
    SELECT ss.section_id, ss.subject_id, ss.periods_per_week, ss.block, ss.teacher_id,
           sub.name AS subject_name, sub.heavy, sub.science, sec.name AS sec_name, c.grade
    FROM section_subjects ss JOIN subjects sub ON sub.id = ss.subject_id
    JOIN sections sec ON sec.id = ss.section_id JOIN classes c ON c.id = sec.class_id
    WHERE ${WING_SQL} = ?
    ORDER BY c.grade, sec.name, sub.name`).all(wing) as any[])
    .map(r => ({ sectionId: r.section_id, sectionLabel: `${r.grade}-${r.sec_name}`, subjectId: r.subject_id, subjectName: r.subject_name,
      heavy: !!r.heavy, science: !!r.science, teacherId: r.teacher_id, periodsPerWeek: r.periods_per_week, block: r.block }));
  return { config: { days: s.days, periodCount: s.periodCount, breakAfter: s.breakAfter }, teachers, lessons };
}
export const hooks = { before: (_w: Wing, _k: 'auto' | 'edit', _label: string, _by?: number) => {} };
export const WING_SECTIONS = `SELECT s.id FROM sections s JOIN classes c ON c.id = s.class_id WHERE ${WING_SQL} = ?`;
export const loadSlots = (wing: Wing = 'school'): SlotOut[] =>
  (db.prepare(`SELECT section_id, day, period, subject_id, teacher_id, grp, locked FROM tt_slots WHERE section_id IN (${WING_SECTIONS})`).all(wing) as any[])
    .map(r => ({ sectionId: r.section_id, day: r.day, period: r.period, subjectId: r.subject_id, teacherId: r.teacher_id, grp: r.grp, locked: !!r.locked }));

/** Replaces the published lessons of one wing only; the other wing's timetable is not touched. Without a wing: everything (demo data). */
export function replaceSlots(slots: SlotOut[], wing?: Wing) {
  const ins = db.prepare('INSERT INTO tt_slots (section_id, day, period, subject_id, teacher_id, grp, locked) VALUES (?,?,?,?,?,?,?)');
  db.transaction(() => {
    if (wing) db.prepare(`DELETE FROM tt_slots WHERE section_id IN (${WING_SECTIONS})`).run(wing); else db.prepare('DELETE FROM tt_slots').run();
    for (const s of slots) ins.run(s.sectionId, s.day, s.period, s.subjectId, s.teacherId, s.grp, s.locked ? 1 : 0);
  })();
}
export const slotCount = (wing?: Wing) => wing
  ? (db.prepare(`SELECT COUNT(*) AS n FROM tt_slots WHERE section_id IN (${WING_SECTIONS})`).get(wing) as any).n as number
  : (db.prepare('SELECT COUNT(*) AS n FROM tt_slots').get() as any).n as number;
/** Clash check of the published timetable of both wings. */
export const validateAll = (limit: number) => WINGS.flatMap(w => validateSlots(loadInput(w), loadSlots(w), limit)).slice(0, limit);
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });

// ---------- settings ----------
timetableRouter.get('/config', (req, res) => {
  const wing = asWing(req.query.wing), settings = getSettings(wing);
  res.json({ wing, settings, periods: periodTimes(settings), published: slotCount(wing) });
});

/** Which wing each class belongs to (School or College). */
timetableRouter.get('/wings', (_req, res) => res.json({
  classes: db.prepare(`SELECT c.id, c.grade, c.name, ${WING_SQL} AS wing FROM classes c ORDER BY c.grade`).all(),
  published: Object.fromEntries(WINGS.map(w => [w, slotCount(w)]))
}));
timetableRouter.put('/wings', manage, (req, res) => {
  const map = req.body?.classes as Record<string, string> | undefined;
  if (!map || typeof map !== 'object') return bad(res, 'Nothing to save.');
  const changes = Object.entries(map).map(([id, w]) => ({ id: Number(id), wing: asWing(w) }))
    .filter(c => (db.prepare(`SELECT ${WING_SQL} AS w FROM classes c WHERE c.id = ?`).get(c.id) as any)?.w !== c.wing);
  const withSlots = changes.filter(c => (db.prepare('SELECT COUNT(*) AS n FROM tt_slots WHERE section_id IN (SELECT id FROM sections WHERE class_id = ?)').get(c.id) as any).n > 0);
  if (withSlots.length && !req.body?.force)
    return res.status(409).json({ message: 'These classes already have a published timetable. Moving them to the other wing deletes it. Confirm to continue.', needsConfirm: true });
  db.transaction(() => {
    for (const c of changes) {
      db.prepare('DELETE FROM tt_slots WHERE section_id IN (SELECT id FROM sections WHERE class_id = ?)').run(c.id);
      db.prepare('UPDATE classes SET wing = ? WHERE id = ?').run(c.wing, c.id);
    }
  })();
  res.json({ ok: true, changed: changes.length });
});

timetableRouter.put('/config', manage, (req, res) => {
  const b = req.body ?? {};
  const wing = asWing(b.wing ?? req.query.wing);
  const cur = getSettings(wing);
  const next: TTSettings = {
    days: Array.isArray(b.days) ? [...new Set<number>(b.days.map(Number))].filter(d => d >= 1 && d <= 7).sort() : cur.days,
    periodCount: Number(b.periodCount ?? cur.periodCount),
    startTime: String(b.startTime ?? cur.startTime),
    periodMinutes: Number(b.periodMinutes ?? cur.periodMinutes),
    breakAfter: Number(b.breakAfter ?? cur.breakAfter),
    breakMinutes: Number(b.breakMinutes ?? cur.breakMinutes),
    classTeacherFirst: b.classTeacherFirst === undefined ? cur.classTeacherFirst !== false : !!b.classTeacherFirst,
    targetLoad: Number(b.targetLoad ?? cur.targetLoad ?? 24)
  };
  if (!next.days.length) return bad(res, 'Choose at least one school day.');
  if (!Number.isInteger(next.periodCount) || next.periodCount < 1 || next.periodCount > 12) return bad(res, 'Periods per day must be between 1 and 12.');
  if (!/^\d{2}:\d{2}$/.test(next.startTime)) return bad(res, 'Start time must look like 08:00.');
  if (!(next.periodMinutes >= 15 && next.periodMinutes <= 120)) return bad(res, 'Period length must be 15 to 120 minutes.');
  if (!Number.isInteger(next.breakAfter) || next.breakAfter < 0 || next.breakAfter >= next.periodCount) return bad(res, 'Break must come after a period that exists (0 for no break).');
  if (!Number.isInteger(next.targetLoad) || next.targetLoad! < 1 || next.targetLoad! > 60) return bad(res, 'Weekly load target must be between 1 and 60 periods.');
  if (!(next.breakMinutes >= 0 && next.breakMinutes <= 90)) return bad(res, 'Break length must be 0 to 90 minutes.');

  const structural = JSON.stringify([cur.days, cur.periodCount, cur.breakAfter]) !== JSON.stringify([next.days, next.periodCount, next.breakAfter]);
  // Bell times decide who is free when the two wings share teachers, so a time change also invalidates the other wing's "busy" picture but not its lessons.
  if (structural && slotCount(wing) > 0 && !b.force)
    return res.status(409).json({ message: `Changing days, periods or the break will delete the published ${wing} wing timetable. Confirm to continue.`, needsConfirm: true });
  db.transaction(() => {
    if (structural) {
      db.prepare(`DELETE FROM tt_slots WHERE section_id IN (${WING_SECTIONS})`).run(wing);
      const o = getSettings(wing === 'school' ? 'college' : 'school');
      const maxP = Math.max(next.periodCount, o.periodCount), days = [...new Set([...next.days, ...o.days])];
      db.prepare('DELETE FROM teacher_unavailable WHERE period >= ?').run(maxP);
      db.prepare(`DELETE FROM teacher_unavailable WHERE day NOT IN (${days.join(',')})`).run();
    }
    saveSettings(next, wing);
  })();
  res.json({ wing, settings: next, periods: periodTimes(next) });
});

// ---------- subjects ----------
timetableRouter.get('/subjects', (_req, res) => {
  res.json(db.prepare(`
    SELECT s.id, s.name, s.code, s.heavy, s.science,
      (SELECT COUNT(*) FROM section_subjects WHERE subject_id = s.id) AS sections,
      (SELECT COUNT(*) FROM teacher_subjects WHERE subject_id = s.id) AS teachers
    FROM subjects s ORDER BY s.name`).all());
});
timetableRouter.post('/subjects', manage, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return bad(res, 'Subject name is required.');
  try {
    const r = db.prepare('INSERT INTO subjects (name, code, heavy, science) VALUES (?, ?, ?, ?)').run(name, String(req.body?.code ?? '').trim() || null, req.body?.heavy ? 1 : 0, req.body?.science ? 1 : 0);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch { bad(res, 'A subject with this name already exists.', 409); }
});
timetableRouter.put('/subjects/:id', manage, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return bad(res, 'Subject name is required.');
  try {
    const r = db.prepare('UPDATE subjects SET name = ?, code = ?, heavy = ?, science = ? WHERE id = ?').run(name, String(req.body?.code ?? '').trim() || null, req.body?.heavy ? 1 : 0, req.body?.science ? 1 : 0, Number(req.params.id));
    if (!r.changes) return bad(res, 'Subject not found.', 404);
    res.json({ ok: true });
  } catch { bad(res, 'A subject with this name already exists.', 409); }
});
timetableRouter.delete('/subjects/:id', manage, (req, res) => {
  const id = Number(req.params.id);
  if ((db.prepare('SELECT COUNT(*) AS n FROM section_subjects WHERE subject_id = ?').get(id) as any).n)
    return bad(res, 'This subject is used in a curriculum. Remove it from the curriculum first.', 409);
  db.prepare('DELETE FROM subjects WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- teachers ----------
timetableRouter.get('/teachers', (_req, res) => {
  const subs = new Map<number, number[]>(), unav = new Map<number, { day: number; period: number }[]>(), load = new Map<number, number>();
  for (const r of db.prepare('SELECT teacher_id, subject_id FROM teacher_subjects').all() as any[]) (subs.get(r.teacher_id) ?? subs.set(r.teacher_id, []).get(r.teacher_id)!).push(r.subject_id);
  for (const r of db.prepare('SELECT teacher_id, day, period FROM teacher_unavailable').all() as any[]) (unav.get(r.teacher_id) ?? unav.set(r.teacher_id, []).get(r.teacher_id)!).push({ day: r.day, period: r.period });
  for (const r of db.prepare('SELECT teacher_id, SUM(periods_per_week) AS n FROM section_subjects WHERE teacher_id IS NOT NULL GROUP BY teacher_id').all() as any[]) load.set(r.teacher_id, r.n);
  const rows = db.prepare('SELECT t.id, t.name, t.phone, t.max_per_day, t.max_per_week, t.user_id, u.username FROM teachers t LEFT JOIN users u ON u.id = t.user_id WHERE t.active = 1 ORDER BY t.name').all() as any[];
  res.json(rows.map(t => ({ ...t, subjects: subs.get(t.id) ?? [], unavailable: unav.get(t.id) ?? [], load: load.get(t.id) ?? 0 })));
});

function saveTeacher(id: number | null, b: any): { error?: string; id?: number } {
  const name = String(b?.name ?? '').trim();
  if (!name) return { error: 'Teacher name is required.' };
  const maxDay = Number(b?.max_per_day ?? 6), maxWeek = Number(b?.max_per_week ?? 30);
  if (!(maxDay >= 1 && maxDay <= 12)) return { error: 'Daily limit must be between 1 and 12.' };
  if (!(maxWeek >= 1 && maxWeek <= 70)) return { error: 'Weekly limit must be between 1 and 70.' };
  const s = getSettings();
  return db.transaction(() => {
    let tid = id;
    if (tid == null) tid = Number(db.prepare('INSERT INTO teachers (name, phone, max_per_day, max_per_week) VALUES (?,?,?,?)').run(name, b.phone || null, maxDay, maxWeek).lastInsertRowid);
    else db.prepare('UPDATE teachers SET name=?, phone=?, max_per_day=?, max_per_week=? WHERE id=?').run(name, b.phone || null, maxDay, maxWeek, tid);
    db.prepare('DELETE FROM teacher_subjects WHERE teacher_id = ?').run(tid);
    for (const sid of (Array.isArray(b.subjects) ? b.subjects : [])) db.prepare('INSERT OR IGNORE INTO teacher_subjects VALUES (?, ?)').run(tid, Number(sid));
    db.prepare('DELETE FROM teacher_unavailable WHERE teacher_id = ?').run(tid);
    for (const u of (Array.isArray(b.unavailable) ? b.unavailable : []))
      if (s.days.includes(Number(u.day)) && u.period >= 0 && u.period < s.periodCount) db.prepare('INSERT OR IGNORE INTO teacher_unavailable VALUES (?, ?, ?)').run(tid, Number(u.day), Number(u.period));
    return { id: tid };
  })();
}
timetableRouter.post('/teachers', manage, (req, res) => {
  const r = saveTeacher(null, req.body); r.error ? bad(res, r.error) : res.status(201).json(r);
});
timetableRouter.put('/teachers/:id', manage, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM teachers WHERE id = ?').get(id)) return bad(res, 'Teacher not found.', 404);
  const r = saveTeacher(id, req.body);
  if (r.error) return bad(res, r.error);
  // Changed limits or unavailable periods may break the published timetable
  const errs = validateAll(3);
  res.json({ ok: true, warning: errs.length ? `The published timetable now has a clash: ${errs[0]} Generate again or fix it by hand.` : undefined });
});
/** Creates (or resets) the login of a teacher so they can mark their own attendance. */
timetableRouter.post('/teachers/:id/account', manage, (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT id, name, user_id FROM teachers WHERE id = ? AND active = 1').get(id) as any;
  if (!t) return bad(res, 'Teacher not found.', 404);
  const password = String(req.body?.password ?? '');
  if (password.length < 8) return bad(res, 'The password must be at least 8 characters.');
  const hash = bcrypt.hashSync(password, 10);
  if (t.user_id) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, t.user_id); passwordChanged(t.user_id);
    return res.json({ username: (db.prepare('SELECT username FROM users WHERE id = ?').get(t.user_id) as any).username, reset: true });
  }
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return bad(res, 'The username must be 3 to 30 letters or numbers (no spaces).');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return bad(res, 'This username is already taken.', 409);
  const uid = Number(db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?, 'teacher')").run(t.name, username, hash).lastInsertRowid);
  db.prepare('UPDATE teachers SET user_id = ? WHERE id = ?').run(uid, id);
  res.status(201).json({ username, reset: false });
});

timetableRouter.get('/teacher-links', requireRole('director', 'principal', 'admin'), (_req, res) => res.json(linkOverview()));
timetableRouter.post('/teachers/:id/link', requireRole('director', 'principal', 'admin'), (req, res) => {
  const e = linkTeacher(Number(req.params.id), Number(req.body?.user_id));
  e ? bad(res, e, e.includes('not found') ? 404 : 409) : res.json({ ok: true });
});
timetableRouter.post('/teachers/:id/unlink', requireRole('director', 'principal', 'admin'), (req, res) => {
  const e = unlinkTeacher(Number(req.params.id)); e ? bad(res, e, 404) : res.json({ ok: true });
});

timetableRouter.delete('/teachers/:id', manage, (req, res) => {
  const id = Number(req.params.id);
  if ((db.prepare('SELECT COUNT(*) AS n FROM section_subjects WHERE teacher_id = ?').get(id) as any).n)
    return bad(res, 'This teacher still has subjects assigned. Reassign them first.', 409);
  db.prepare('UPDATE teachers SET active = 0 WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- curriculum + teacher assignment ----------
timetableRouter.get('/curriculum', (req, res) => {
  const classId = Number(req.query.classId);
  const sections = db.prepare('SELECT id, name FROM sections WHERE class_id = ? ORDER BY name').all(classId);
  const rows = db.prepare(`
    SELECT ss.id, ss.section_id, ss.subject_id, sub.name AS subject_name, ss.periods_per_week, ss.block, ss.teacher_id, t.name AS teacher_name
    FROM section_subjects ss JOIN sections sec ON sec.id = ss.section_id
    JOIN subjects sub ON sub.id = ss.subject_id LEFT JOIN teachers t ON t.id = ss.teacher_id
    WHERE sec.class_id = ? ORDER BY sub.name`).all(classId);
  res.json({ sections, rows });
});

timetableRouter.put('/curriculum/class/:classId', manage, (req, res) => {
  const classId = Number(req.params.classId);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const cw = asWing((db.prepare(`SELECT ${WING_SQL} AS w FROM classes c WHERE c.id = ?`).get(classId) as any)?.w);
  const s = getSettings(cw); const T = s.days.length * s.periodCount;
  const seen = new Set<number>(); let sum = 0;
  for (const it of items) {
    const p = Number(it.periods_per_week), blk = Number(it.block ?? 1);
    if (!db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(Number(it.subject_id))) return bad(res, 'One of the subjects does not exist.');
    if (seen.has(Number(it.subject_id))) return bad(res, 'A subject is listed twice.');
    seen.add(Number(it.subject_id));
    if (!Number.isInteger(p) || p < 1 || p > T) return bad(res, `Periods per week must be between 1 and ${T}.`);
    if (![1, 2, 3].includes(blk) || p % blk !== 0) return bad(res, `${p} periods cannot be split into lessons of ${blk} periods.`);
    sum += p;
  }
  if (sum > T) return bad(res, `These add up to ${sum} periods per week, but a section only has ${T} slots.`);

  const secs = db.prepare('SELECT id FROM sections WHERE class_id = ?').all(classId) as { id: number }[];
  let cleared = 0;
  db.transaction(() => {
    for (const sec of secs) {
      const existing = db.prepare('SELECT id, subject_id, periods_per_week, block FROM section_subjects WHERE section_id = ?').all(sec.id) as any[];
      for (const ex of existing) {
        const keep = items.find((i: any) => Number(i.subject_id) === ex.subject_id);
        if (!keep) {
          cleared += db.prepare('DELETE FROM tt_slots WHERE section_id = ? AND subject_id = ?').run(sec.id, ex.subject_id).changes;
          db.prepare('DELETE FROM section_subjects WHERE id = ?').run(ex.id);
        } else if (keep.periods_per_week !== ex.periods_per_week || (keep.block ?? 1) !== ex.block) {
          cleared += db.prepare('DELETE FROM tt_slots WHERE section_id = ? AND subject_id = ?').run(sec.id, ex.subject_id).changes;
          db.prepare('UPDATE section_subjects SET periods_per_week = ?, block = ? WHERE id = ?').run(keep.periods_per_week, keep.block ?? 1, ex.id);
        }
      }
      for (const it of items)
        if (!existing.some(e => e.subject_id === Number(it.subject_id)))
          db.prepare('INSERT INTO section_subjects (section_id, subject_id, periods_per_week, block) VALUES (?,?,?,?)').run(sec.id, it.subject_id, it.periods_per_week, it.block ?? 1);
    }
  })();
  res.json({ ok: true, clearedSlots: cleared });
});

timetableRouter.put('/section-subjects/:id', manage, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM section_subjects WHERE id = ?').get(id) as any;
  if (!row) return bad(res, 'Not found.', 404);
  const teacherId = req.body?.teacher_id === null ? null : Number(req.body?.teacher_id ?? row.teacher_id);
  if (teacherId != null && !db.prepare('SELECT 1 FROM teachers WHERE id = ? AND active = 1').get(teacherId)) return bad(res, 'Teacher not found.');
  try {
    db.transaction(() => {
      db.prepare('UPDATE section_subjects SET teacher_id = ? WHERE id = ?').run(teacherId, id);
      if (teacherId == null) db.prepare('DELETE FROM tt_slots WHERE section_id = ? AND subject_id = ?').run(row.section_id, row.subject_id);
      else db.prepare('UPDATE tt_slots SET teacher_id = ? WHERE section_id = ? AND subject_id = ?').run(teacherId, row.section_id, row.subject_id);
      const errs = validateAll(3);
      if (errs.length) throw new Error(errs[0]);
    })();
  } catch (e: any) {
    return bad(res, `This teacher cannot take it: ${e.message}`, 409);
  }
  res.json({ ok: true });
});

timetableRouter.post('/assign/auto', manage, (req, res) => {
  res.json(autoAssign({ classId: req.body?.classId ? Number(req.body.classId) : undefined, reassign: !!req.body?.reassign }));
});

// ---------- class teacher's first period ----------
/**
 * The class teacher takes period 1 of every day in his or her own class. For each section of the wing we put the class teacher's own
 * lessons (single periods) into period 1 of as many days as the curriculum allows. These are placed as fixed lessons for the solver.
 * If the class teacher teaches the class fewer times than there are days, the other days are reported, not forced.
 */
export function classTeacherFirst(wing: Wing, inp: Omit<SolverInput, 'locked'>, already: SlotOut[]): { slots: SlotOut[]; notes: string[] } {
  const slots: SlotOut[] = [], notes: string[] = [];
  const cfg = getSettings(wing);
  if (cfg.classTeacherFirst === false) return { slots, notes };
  const days = inp.config.days;
  const cts = db.prepare(`SELECT s.id, s.class_teacher_id AS tid, c.name AS cname, s.name AS sname FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.class_teacher_id IS NOT NULL AND ${WING_SQL} = ?`).all(wing) as any[];
  const teacherDay = new Map<string, number>(), busy = new Set<string>();
  for (const s of already) { busy.add(`${s.teacherId}-${s.day}-${s.period}`); teacherDay.set(`${s.teacherId}-${s.day}`, (teacherDay.get(`${s.teacherId}-${s.day}`) ?? 0) + 1); }
  let grp = 1_000_000;
  for (const sec of cts) {
    const label = `${sec.cname}-${sec.sname}`;
    const t = inp.teachers.find(x => x.id === sec.tid);
    if (!t) { notes.push(`${label}: the class teacher is not an active teacher.`); continue; }
    const mine = inp.lessons.filter(l => l.sectionId === sec.id && l.teacherId === sec.tid && l.block === 1);
    if (!mine.length) { notes.push(`${label}: class teacher ${t.name} does not teach this class, so period 1 cannot be theirs. Give ${t.name} a subject in ${label} (Curriculum).`); continue; }
    const left = new Map(mine.map(l => [l.subjectId, l.periodsPerWeek - already.filter(a => a.sectionId === sec.id && a.subjectId === l.subjectId).length]));
    const perDay = new Map<string, number>();
    let placed = 0;
    for (const d of days) {
      if (already.some(a => a.sectionId === sec.id && a.day === d && a.period === 0)) { placed++; continue; }      // a locked lesson is already there
      if (t.unavailable.some(u => u.day === d && u.period === 0) || busy.has(`${t.id}-${d}-0`)) continue;
      if ((teacherDay.get(`${t.id}-${d}`) ?? 0) >= t.maxPerDay) continue;
      const pick = mine.filter(l => (left.get(l.subjectId) ?? 0) > 0 && (perDay.get(`${l.subjectId}`) ?? 0) < Math.max(1, Math.ceil(l.periodsPerWeek / days.length)) + 0)
        .sort((a, b) => (left.get(b.subjectId) ?? 0) - (left.get(a.subjectId) ?? 0))[0]
        ?? mine.filter(l => (left.get(l.subjectId) ?? 0) > 0).sort((a, b) => (left.get(b.subjectId) ?? 0) - (left.get(a.subjectId) ?? 0))[0];
      if (!pick) continue;
      // a subject may appear only ceil(periods / days) times per day: one first-period lesson per day is always within that
      left.set(pick.subjectId, (left.get(pick.subjectId) ?? 0) - 1);
      slots.push({ sectionId: sec.id, day: d, period: 0, subjectId: pick.subjectId, teacherId: t.id, grp: grp++, locked: true });
      busy.add(`${t.id}-${d}-0`); teacherDay.set(`${t.id}-${d}`, (teacherDay.get(`${t.id}-${d}`) ?? 0) + 1); placed++;
    }
    if (placed < days.length) notes.push(`${label}: class teacher ${t.name} gets period 1 on ${placed} of ${days.length} days (the curriculum gives ${t.name} only ${mine.reduce((n, l) => n + l.periodsPerWeek, 0)} periods a week in this class). Add periods for ${t.name}'s subject to cover every day.`);
  }
  return { slots, notes };
}

// ---------- readiness ----------
timetableRouter.get('/check', (req, res) => {
  const wing = asWing(req.query.wing);
  const inp = loadInput(wing);
  const issues = precheck(inp);
  for (const n of classTeacherFirst(wing, inp, loadSlots(wing).filter(x => x.locked)).notes) issues.push({ level: 'warning', message: n });
  res.json({
    wing, issues, sections: new Set(inp.lessons.map(l => l.sectionId)).size, lessons: inp.lessons.length,
    periods: inp.lessons.reduce((a, l) => a + l.periodsPerWeek, 0), teachers: inp.teachers.length, published: slotCount(wing),
    locked: loadSlots(wing).filter(x => x.locked).length
  });
});

// ---------- generation (runs in the background, UI polls for progress) ----------
interface Job { wing: Wing; id: string; status: 'running' | 'done' | 'cancelled' | 'failed'; phase: string; pct: number; placed: number; total: number; result?: SolveResult; error?: string; startedAt: number; cancel: boolean }
const jobs = new Map<string, Job>();
const EFFORT: Record<string, number> = { quick: 4000, balanced: 10000, deep: 25000 };

timetableRouter.post('/generate', manage, (req, res) => {
  if ([...jobs.values()].some(j => j.status === 'running')) return bad(res, 'A timetable is already being generated. Wait for it to finish.', 409);
  const wing = asWing(req.body?.wing);
  const base = loadInput(wing);
  const issues = precheck(base).filter(i => i.level === 'error');
  if (issues.length) return res.status(400).json({ message: 'Fix these problems before generating.', issues });

  const keepLocked = req.body?.keepLocked !== false;
  const kept = keepLocked ? loadSlots(wing).filter(s => s.locked) : [];
  const first = classTeacherFirst(wing, base, kept);
  const locked = [...kept, ...first.slots];
  const id = Math.random().toString(36).slice(2, 10);
  const job: Job = { wing, id, status: 'running', phase: 'Preparing', pct: 0, placed: 0, total: 0, startedAt: Date.now(), cancel: false };
  jobs.set(id, job);
  for (const [k, j] of jobs) if (Date.now() - j.startedAt > 30 * 60_000) jobs.delete(k);

  solve({ ...base, locked }, {
    timeMs: EFFORT[String(req.body?.effort)] ?? EFFORT.balanced,
    isCancelled: () => job.cancel,
    onProgress: p => { job.phase = p.phase; job.pct = p.pct; job.placed = p.placed; job.total = p.total; }
  }).then(r => { job.result = r; job.status = job.cancel ? 'cancelled' : 'done'; job.pct = 100; job.phase = 'Done'; })
    .catch(e => { console.error(e); job.status = 'failed'; job.error = 'The generator hit an unexpected problem.'; });

  res.status(202).json({ jobId: id, notes: first.notes });
});

timetableRouter.get('/generate/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return bad(res, 'Job not found. It may have expired.', 404);
  const { result, ...rest } = j;
  res.json({ ...rest, result: result ? { ...result, slots: undefined } : undefined });
});

/** Preview rows for a finished job (so the UI can draw the grid before publishing). */
timetableRouter.get('/generate/:id/slots', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j?.result) return bad(res, 'Result not ready.', 404);
  res.json(j.result.slots);
});

timetableRouter.post('/generate/:id/cancel', manage, (req, res) => {
  const j = jobs.get(req.params.id); if (j) j.cancel = true;
  res.json({ ok: true });
});

timetableRouter.post('/publish', manage, (req, res) => {
  const j = jobs.get(String(req.body?.jobId));
  if (!j?.result) return bad(res, 'Nothing to publish. Generate a timetable first.', 404);
  if (j.result.unplaced.length && !req.body?.allowPartial)
    return bad(res, `${j.result.unplaced.length} lesson(s) could not be placed. Fix the problem or publish a partial timetable on purpose.`, 409);
  const errs = validateSlots(loadInput(j.wing), j.result.slots);
  if (errs.length) return res.status(409).json({ message: 'The data changed after this timetable was made. Generate again.', errors: errs });
  hooks.before(j.wing, 'auto', 'Before publishing', req.user!.id);
  replaceSlots(j.result.slots, j.wing);
  jobs.delete(j.id);
  res.json({ ok: true, slots: j.result.slots.length });
});

// ---------- viewing ----------
const slotSelect = `
  SELECT ts.section_id, ts.day, ts.period, ts.subject_id, sub.name AS subject_name, ts.teacher_id, t.name AS teacher_name,
         ts.grp, ts.locked, c.grade, sec.name AS section_name, c.id AS class_id
  FROM tt_slots ts JOIN subjects sub ON sub.id = ts.subject_id JOIN teachers t ON t.id = ts.teacher_id
  JOIN sections sec ON sec.id = ts.section_id JOIN classes c ON c.id = sec.class_id`;

timetableRouter.get('/slots', (req, res) => {
  const where: string[] = [], params: any[] = [];
  if (req.query.sectionId) { where.push('ts.section_id = ?'); params.push(Number(req.query.sectionId)); }
  if (req.query.teacherId) { where.push('ts.teacher_id = ?'); params.push(Number(req.query.teacherId)); }
  if (req.query.classId) { where.push('c.id = ?'); params.push(Number(req.query.classId)); }
  res.json(db.prepare(`${slotSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts.day, ts.period`).all(...params));
});

timetableRouter.get('/mine', (req, res) => {
  const t = db.prepare('SELECT id, name FROM teachers WHERE user_id = ? AND active = 1').get(req.user!.id) as any;
  res.json({ teacher: t ?? null });
});

timetableRouter.delete('/slots', manage, (req, res) => {
  const sectionId = Number(req.query.sectionId);
  if (sectionId) hooks.before(wingOfSection(sectionId), 'auto', 'Before clearing', req.user!.id);
  else if (req.query.wing) hooks.before(asWing(req.query.wing), 'auto', 'Before clearing', req.user!.id);
  else for (const w of WINGS) hooks.before(w, 'auto', 'Before clearing', req.user!.id);
  if (sectionId) db.prepare('DELETE FROM tt_slots WHERE section_id = ?').run(sectionId);
  else if (req.query.wing) db.prepare(`DELETE FROM tt_slots WHERE section_id IN (${WING_SECTIONS})`).run(asWing(req.query.wing));
  else db.prepare('DELETE FROM tt_slots').run();
  res.json({ ok: true });
});

// ---------- manual edits (always re-validated) ----------
timetableRouter.post('/move', manage, (req, res) => {
  const { section_id, from, to } = req.body ?? {};
  const wing = wingOfSection(Number(section_id));
  const all = loadSlots(wing);
  const mine = all.filter(s => s.sectionId === section_id);
  const eventAt = (day: number, period: number) => {
    const s = mine.find(x => x.day === day && x.period === period);
    return s ? mine.filter(x => x.grp === s.grp) : null;
  };
  const A = eventAt(from?.day, from?.period);
  if (!A) return bad(res, 'Pick a lesson to move.');
  const B = eventAt(to?.day, to?.period);
  if (A.some(s => s.locked) || B?.some(s => s.locked)) return bad(res, 'That lesson is locked. Unlock it first.', 409);
  const start = (ev: SlotOut[]) => ev.reduce((m, s) => (s.period < m.period ? s : m));
  const lenA = A.length;
  const keep = all.filter(s => !(s.sectionId === section_id && (A.some(a => a.grp === s.grp) || (B && B.some(b => b.grp === s.grp)))));
  const placeAt = (ev: SlotOut[], day: number, period: number) => ev.map((s, i) => ({ ...s, day, period: period + i }));
  let moved: SlotOut[];
  if (B) {
    if (B.length !== lenA) return bad(res, 'A double period can only swap with another double period.', 409);
    if (A[0].grp === B[0].grp) return bad(res, 'Pick a different place.');
    const sa = start(A), sb = start(B);
    moved = [...placeAt([...A].sort((a, b) => a.period - b.period), sb.day, sb.period), ...placeAt([...B].sort((a, b) => a.period - b.period), sa.day, sa.period)];
  } else {
    moved = placeAt([...A].sort((a, b) => a.period - b.period), to.day, to.period);
    if (keep.some(s => s.sectionId === section_id && moved.some(m => m.day === s.day && m.period === s.period))) return bad(res, 'That place is not free.', 409);
  }
  const next = [...keep, ...moved];
  const errs = validateSlots(loadInput(wing), next, 5);
  if (errs.length) return res.status(409).json({ message: errs[0], errors: errs });
  hooks.before(wing, 'edit', 'Hand edit', req.user!.id);
  replaceSlots(next, wing);
  res.json({ ok: true });
});

// ---------- manual builder: fill one cell by hand ----------
/** What can go into this cell of this section, and why a choice is not possible. */
timetableRouter.get('/options', (req, res) => {
  const sectionId = Number(req.query.section_id), day = Number(req.query.day), period = Number(req.query.period);
  const wing = wingOfSection(sectionId), inp = loadInput(wing), slots = loadSlots(wing);
  if (!inp.config.days.includes(day) || !(period >= 0 && period < inp.config.periodCount)) return bad(res, 'That cell is outside the school week.');
  const tById = new Map(inp.teachers.map(t => [t.id, t]));
  const placed = (sid: number) => slots.filter(x => x.sectionId === sectionId && x.subjectId === sid).length;
  const used = db.prepare('SELECT subject_id FROM section_subjects WHERE section_id = ?').all(sectionId).length;
  const lessons = inp.lessons.filter(l => l.sectionId === sectionId).map(l => {
    const t = l.teacherId ? tById.get(l.teacherId) : null;
    let why = '';
    if (!t) why = 'No teacher is assigned to this subject (Curriculum).';
    else if (l.block !== 1) why = `This subject comes in double periods; place it by generating, or set it to single periods.`;
    else if (t.unavailable.some(u => u.day === day && u.period === period)) why = `${t.name} is not available at this time.`;
    else {
      const o = slots.find(x => x.teacherId === t.id && x.day === day && x.period === period && x.sectionId !== sectionId);
      if (o) why = `${t.name} is teaching ${inp.lessons.find(z => z.sectionId === o.sectionId)?.sectionLabel ?? 'another class'} then.`;
      else if (slots.filter(x => x.teacherId === t.id && x.day === day).length >= t.maxPerDay) why = `${t.name} already has ${t.maxPerDay} periods that day.`;
    }
    return { subject_id: l.subjectId, subject: l.subjectName, teacher_id: l.teacherId, teacher: t?.name ?? null, planned: l.periodsPerWeek, placed: placed(l.subjectId), ok: !why, why };
  });
  const cur = slots.find(x => x.sectionId === sectionId && x.day === day && x.period === period) ?? null;
  res.json({ wing, lessons, current: cur, sections_subjects: used });
});

/** Puts one single-period lesson into a free cell (or replaces the lesson there). Always re-checked against every rule. */
timetableRouter.post('/place', manage, (req, res) => {
  const { section_id, day, period, subject_id, lock } = req.body ?? {};
  const sectionId = Number(section_id), wing = wingOfSection(sectionId);
  const inp = loadInput(wing), all = loadSlots(wing);
  const l = inp.lessons.find(x => x.sectionId === sectionId && x.subjectId === Number(subject_id));
  if (!l) return bad(res, 'This subject is not part of the section.');
  if (!l.teacherId) return bad(res, 'No teacher is assigned to this subject yet.');
  if (l.block !== 1) return bad(res, 'Double-period lessons are placed by the generator.');
  const there = all.find(x => x.sectionId === sectionId && x.day === Number(day) && x.period === Number(period));
  if (there?.locked) return bad(res, 'That lesson is locked. Unlock it first.', 409);
  if (there && all.filter(x => x.sectionId === sectionId && x.grp === there.grp).length > 1) return bad(res, 'That cell is part of a double period; clear it first.', 409);
  const grp = Math.max(0, ...all.map(x => x.grp)) + 1;
  const next = [...all.filter(x => x !== there), { sectionId, day: Number(day), period: Number(period), subjectId: l.subjectId, teacherId: l.teacherId, grp, locked: !!lock }];
  const errs = validateSlots(inp, next, 5);
  if (errs.length) return res.status(409).json({ message: errs[0], errors: errs });
  hooks.before(wing, 'edit', 'Hand edit', req.user!.id);
  replaceSlots(next, wing);
  res.json({ ok: true });
});

timetableRouter.delete('/place', manage, (req, res) => {
  const sectionId = Number(req.query.section_id), day = Number(req.query.day), period = Number(req.query.period);
  const row = db.prepare('SELECT grp, locked FROM tt_slots WHERE section_id = ? AND day = ? AND period = ?').get(sectionId, day, period) as any;
  if (!row) return bad(res, 'Nothing there.', 404);
  if (row.locked) return bad(res, 'That lesson is locked. Unlock it first.', 409);
  hooks.before(wingOfSection(sectionId), 'edit', 'Hand edit', req.user!.id);
  db.prepare('DELETE FROM tt_slots WHERE section_id = ? AND grp = ?').run(sectionId, row.grp);
  res.json({ ok: true });
});

timetableRouter.post('/lock', manage, (req, res) => {
  const { section_id, day, period, locked } = req.body ?? {};
  const s = db.prepare('SELECT grp FROM tt_slots WHERE section_id = ? AND day = ? AND period = ?').get(section_id, day, period) as any;
  if (!s) return bad(res, 'No lesson there.', 404);
  db.prepare('UPDATE tt_slots SET locked = ? WHERE section_id = ? AND grp = ?').run(locked ? 1 : 0, section_id, s.grp);
  res.json({ ok: true });
});

// ---------- substitutes for an absent teacher ----------
timetableRouter.get('/substitutes', (req, res) => {
  const teacherId = Number(req.query.teacher_id), day = Number(req.query.day);
  const mine = db.prepare(`${slotSelect} WHERE ts.teacher_id = ? AND ts.day = ? ORDER BY ts.period`).all(teacherId, day) as any[];
  const teachers = db.prepare('SELECT id, name, max_per_day, max_per_week FROM teachers WHERE active = 1 AND id <> ?').all(teacherId) as any[];
  // "busy" is judged by clock time, because the school and college wings have their own bell times
  const wt = { school: periodTimes(getSettings('school')), college: periodTimes(getSettings('college')) };
  const span = (sectionId: number, period: number) => { const t = wt[wingOfSection(sectionId)][period]; return t ? { a: toMin(t.start), b: toMin(t.end) } : null; };
  const dayLessons = (db.prepare('SELECT teacher_id, section_id, period FROM tt_slots WHERE day = ?').all(day) as any[]).map(r => ({ t: r.teacher_id, sp: span(r.section_id, r.period) }));
  const unav = new Set((db.prepare('SELECT teacher_id, period FROM teacher_unavailable WHERE day = ?').all(day) as any[]).map(r => `${r.teacher_id}-${r.period}`));
  const today = new Map<number, number>();
  for (const r of db.prepare('SELECT teacher_id, COUNT(*) AS n FROM tt_slots WHERE day = ? GROUP BY teacher_id').all(day) as any[]) today.set(r.teacher_id, r.n);
  const qual = new Set((db.prepare('SELECT teacher_id, subject_id FROM teacher_subjects').all() as any[]).map(r => `${r.teacher_id}-${r.subject_id}`));
  res.json(mine.map(m => { const me = span(m.section_id, m.period); return ({
    period: m.period, time: wt[wingOfSection(m.section_id)][m.period]?.start, section: `${m.grade}-${m.section_name}`, subject: m.subject_name,
    candidates: teachers
      .filter(t => !dayLessons.some(d => d.t === t.id && d.sp && me && d.sp.a < me.b && me.a < d.sp.b) && !unav.has(`${t.id}-${m.period}`) && (today.get(t.id) ?? 0) < t.max_per_day)
      .map(t => ({ id: t.id, name: t.name, qualified: qual.has(`${t.id}-${m.subject_id}`), lessonsToday: today.get(t.id) ?? 0 }))
      .sort((a, b) => Number(b.qualified) - Number(a.qualified) || a.lessonsToday - b.lessonsToday).slice(0, 4)
  }); }));
});

export { DEFAULT_SETTINGS, DAY };
