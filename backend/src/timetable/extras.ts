import { Router } from 'express';
import { db } from '../db.js';
import { requireAccess } from '../auth.js';
import { audit } from '../audit/service.js';
import { WING_SQL, WINGS, asWing, getSettings, periodTimes, wingOfSection, type Wing } from './schema.js';
import { hooks, loadInput, loadSlots, replaceSlots } from './routes.js';
import { MAX_SCIENCE_RUN, validateSlots, type SlotOut } from './solver.js';
import '../hr/schema.js';

/**
 * Extras around the timetable: saved versions with undo, a quality report, and substitute teachers.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS tt_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')), wing TEXT NOT NULL, kind TEXT NOT NULL,
  label TEXT, by_user INTEGER, slots INTEGER NOT NULL, json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tt_substitutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, section_id INTEGER NOT NULL, period INTEGER NOT NULL, subject_id INTEGER NOT NULL,
  absent_teacher_id INTEGER NOT NULL, sub_teacher_id INTEGER NOT NULL, note TEXT, by_user INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (date, section_id, period)
);
CREATE INDEX IF NOT EXISTS idx_tt_sub_date ON tt_substitutions(date);
`);

hooks.before = (wing, kind, label, by) => { if (loadSlots(wing).length) snapshot(wing, kind, label, by); };

const manage = requireAccess(['director', 'principal', 'admin'], 'timetable_team');
export const extrasRouter = Router();
const bad = (res: any, m: string, c = 400) => res.status(c).json({ message: m });
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const dowOf = (d: string) => { const n = new Date(d + 'T00:00:00Z').getUTCDay(); return n === 0 ? 7 : n; };
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// ---------------------------------------------------------------- versions & undo
const KEEP = { auto: 15, edit: 10, manual: 40 } as const;
export function snapshot(wing: Wing, kind: 'auto' | 'edit' | 'manual', label: string | null, by?: number) {
  const slots = loadSlots(wing);
  db.prepare('INSERT INTO tt_versions (wing, kind, label, by_user, slots, json) VALUES (?,?,?,?,?,?)').run(wing, kind, label, by ?? null, slots.length, JSON.stringify(slots));
  const old = db.prepare('SELECT id FROM tt_versions WHERE wing = ? AND kind = ? ORDER BY id DESC LIMIT -1 OFFSET ?').all(wing, kind, KEEP[kind]) as { id: number }[];
  for (const o of old) db.prepare('DELETE FROM tt_versions WHERE id = ?').run(o.id);
}

extrasRouter.get('/versions', (req, res) => {
  const wing = asWing(req.query.wing);
  res.json(db.prepare('SELECT v.id, v.at, v.kind, v.label, v.slots, u.name AS by FROM tt_versions v LEFT JOIN users u ON u.id = v.by_user WHERE v.wing = ? ORDER BY v.id DESC').all(wing));
});

/** What changed between two saved copies (or a copy and the timetable as it is now): per class, which period went from what to what. */
extrasRouter.get('/versions/compare', (req, res) => {
  const wing = asWing(req.query.wing);
  const load = (ref: string) => {
    if (ref === 'current') return { label: 'Timetable now', at: null as string | null, slots: loadSlots(wing) as any[] };
    const v = db.prepare('SELECT label, kind, at, json FROM tt_versions WHERE id = ? AND wing = ?').get(Number(ref), wing) as any;
    return v ? { label: v.label || (v.kind === 'auto' ? 'Automatic copy' : v.kind === 'edit' ? 'Before a hand edit' : 'Saved copy'), at: v.at as string, slots: JSON.parse(v.json) as any[] } : null;
  };
  const A = load(String(req.query.a ?? '')), B = load(String(req.query.b ?? ''));
  if (!A || !B) return bad(res, 'Choose two copies to compare.', 404);
  const subj = new Map((db.prepare('SELECT id, name FROM subjects').all() as any[]).map(r => [r.id, r.name]));
  const tch = new Map((db.prepare('SELECT id, name FROM teachers').all() as any[]).map(r => [r.id, r.name]));
  const sec = new Map((db.prepare('SELECT s.id, c.name || \'-\' || s.name AS n, c.grade FROM sections s JOIN classes c ON c.id = s.class_id').all() as any[]).map(r => [r.id, r]));
  const key = (x: any) => `${x.sectionId}|${x.day}|${x.period}`, what = (x: any) => (x ? `${subj.get(x.subjectId) ?? '?'} (${tch.get(x.teacherId) ?? '?'})` : null);
  const ma = new Map(A.slots.map(x => [key(x), x])), mb = new Map(B.slots.map(x => [key(x), x]));
  const per = new Map<number, { label: string; grade: number; changes: { day: number; period: number; from: string | null; to: string | null }[] }>();
  let changed = 0, added = 0, removed = 0;
  for (const k of new Set([...ma.keys(), ...mb.keys()])) {
    const a = ma.get(k), b = mb.get(k);
    if (a && b && a.subjectId === b.subjectId && a.teacherId === b.teacherId) continue;
    a && b ? changed++ : a ? removed++ : added++;
    const x = (a ?? b)!, info = sec.get(x.sectionId) ?? { n: '?', grade: 0 };
    const e: { label: string; grade: number; changes: { day: number; period: number; from: string | null; to: string | null }[] } =
      per.get(x.sectionId) ?? { label: info.n, grade: info.grade, changes: [] };
    e.changes.push({ day: x.day, period: x.period, from: what(a), to: what(b) }); per.set(x.sectionId, e);
  }
  const load2 = (sl: any[]) => { const m = new Map<number, number>(); for (const x of sl) m.set(x.teacherId, (m.get(x.teacherId) ?? 0) + 1); return m; };
  const la = load2(A.slots), lb = load2(B.slots), teachers: { name: string; from: number; to: number }[] = [];
  for (const id of new Set([...la.keys(), ...lb.keys()])) { const f = la.get(id) ?? 0, t = lb.get(id) ?? 0; if (f !== t) teachers.push({ name: tch.get(id) ?? '?', from: f, to: t }); }
  const sections = [...per.values()].sort((x, y) => x.grade - y.grade || x.label.localeCompare(y.label, undefined, { numeric: true }));
  for (const e of sections) e.changes.sort((x, y) => x.day - y.day || x.period - y.period);
  res.json({ a: { label: A.label, at: A.at, lessons: A.slots.length }, b: { label: B.label, at: B.at, lessons: B.slots.length }, summary: { changed, added, removed, sections: sections.length }, sections, teachers: teachers.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from)) });
});
extrasRouter.post('/versions', manage, (req, res) => {
  const wing = asWing(req.body?.wing), label = String(req.body?.label ?? '').trim().slice(0, 80) || null;
  if (!loadSlots(wing).length) return bad(res, 'There is no published timetable to save.');
  snapshot(wing, 'manual', label, req.user!.id);
  res.status(201).json({ ok: true });
});
function restore(id: number, by: number, force: boolean) {
  const v = db.prepare('SELECT * FROM tt_versions WHERE id = ?').get(id) as any;
  if (!v) return { status: 404, body: { message: 'Version not found.' } };
  const slots = JSON.parse(v.json) as SlotOut[], wing = v.wing as Wing;
  // The data may have changed since (teachers, curriculum): refuse a version that would now clash, unless the person insists.
  const errs = validateSlots(loadInput(wing), slots, 5);
  if (errs.length && !force) return { status: 409, body: { message: `This version no longer fits the current teachers and subjects: ${errs[0]}`, errors: errs, needsConfirm: true } };
  snapshot(wing, 'auto', 'Before restoring', by);
  replaceSlots(slots, wing);
  audit({ id: by }, 'timetable.restore', 'version', id, `${wing}, ${slots.length} lessons`);
  return { status: 200, body: { ok: true, slots: slots.length, warnings: errs } };
}
extrasRouter.post('/versions/:id/restore', manage, (req, res) => { const r = restore(Number(req.params.id), req.user!.id, !!req.body?.force); res.status(r.status).json(r.body); });
extrasRouter.delete('/versions/:id', manage, (req, res) => { db.prepare("DELETE FROM tt_versions WHERE id = ? AND kind = 'manual'").run(Number(req.params.id)); res.json({ ok: true }); });
/** Takes the timetable back to how it was before the last hand edit. */
extrasRouter.post('/undo', manage, (req, res) => {
  const wing = asWing(req.body?.wing);
  const v = db.prepare("SELECT id FROM tt_versions WHERE wing = ? AND kind = 'edit' ORDER BY id DESC LIMIT 1").get(wing) as { id: number } | undefined;
  if (!v) return bad(res, 'Nothing to undo.', 404);
  const r = restore(v.id, req.user!.id, true);
  if (r.status === 200) db.prepare('DELETE FROM tt_versions WHERE id = ?').run(v.id);
  res.status(r.status).json(r.body);
});

// ---------------------------------------------------------------- quality report
export function quality(wing: Wing) {
  const inp = loadInput(wing), slots = loadSlots(wing), cfg = getSettings(wing);
  const days = inp.config.days, P = inp.config.periodCount, half = Math.ceil(P / 2);
  const tName = new Map(inp.teachers.map(t => [t.id, t.name]));
  const lessonOf = new Map(inp.lessons.map(l => [`${l.sectionId}-${l.subjectId}`, l]));
  const label = new Map(inp.lessons.map(l => [l.sectionId, l.sectionLabel]));

  // teachers
  const per = new Map<number, Map<number, number[]>>();       // teacher -> day -> periods
  for (const s of slots) { const d = per.get(s.teacherId) ?? per.set(s.teacherId, new Map()).get(s.teacherId)!; (d.get(s.day) ?? d.set(s.day, []).get(s.day)!).push(s.period); }
  let tGaps = 0, longRuns = 0;
  const teachers = inp.teachers.filter(t => per.has(t.id)).map(t => {
    const d = per.get(t.id)!; let load = 0, gaps = 0, runs = 0, busiest = 0;
    for (const ps of d.values()) {
      ps.sort((a, b) => a - b); load += ps.length; busiest = Math.max(busiest, ps.length);
      gaps += ps[ps.length - 1] - ps[0] + 1 - ps.length;
      let run = 1; for (let i = 1; i < ps.length; i++) { run = ps[i] === ps[i - 1] + 1 ? run + 1 : 1; if (run === 4) runs++; }
    }
    tGaps += gaps; longRuns += runs;
    return { id: t.id, name: t.name, load, maxPerWeek: t.maxPerWeek, busiestDay: busiest, maxPerDay: t.maxPerDay, gaps, longRuns: runs, over: load > t.maxPerWeek || busiest > t.maxPerDay };
  }).sort((a, b) => b.load - a.load);

  // sections
  const secRows = new Map<number, SlotOut[]>();
  for (const s of slots) (secRows.get(s.sectionId) ?? secRows.set(s.sectionId, []).get(s.sectionId)!).push(s);
  let sGaps = 0, heavyLate = 0, b2b = 0, unplaced = 0, sciRuns = 0;
  const sections = [...new Set(inp.lessons.map(l => l.sectionId))].map(id => {
    const mine = secRows.get(id) ?? [], planned = inp.lessons.filter(l => l.sectionId === id).reduce((n, l) => n + l.periodsPerWeek, 0);
    let gaps = 0, sRuns = 0;
    for (const d of days) {
      const ps = mine.filter(s => s.day === d).map(s => s.period).sort((a, b) => a - b);
      if (ps.length) gaps += ps[ps.length - 1] - ps[0] + 1 - ps.length;
      const byP = new Map(mine.filter(s => s.day === d).map(s => [s.period, s]));
      let sci = 0;
      for (let p = 0; p < P; p++) {
        if (inp.config.breakAfter > 0 && p === inp.config.breakAfter) sci = 0;
        const x = byP.get(p);
        if (x && lessonOf.get(`${x.sectionId}-${x.subjectId}`)?.science) { sci++; if (sci > MAX_SCIENCE_RUN) sRuns++; } else sci = 0;
      }
      for (const s of mine.filter(x => x.day === d)) {
        const l = lessonOf.get(`${s.sectionId}-${s.subjectId}`); if (l?.heavy && s.period >= half) heavyLate++;
        const nx = byP.get(s.period + 1); if (nx && nx.subjectId === s.subjectId && nx.grp !== s.grp) b2b++;
      }
    }
    sGaps += gaps; sciRuns += sRuns; unplaced += Math.max(0, planned - mine.length);
    return { id, label: label.get(id) ?? String(id), planned, placed: mine.length, free: days.length * P - mine.length, gaps, scienceRuns: sRuns };
  }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  // class teacher in period 1
  const ct = db.prepare(`SELECT s.id, s.class_teacher_id AS tid FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.class_teacher_id IS NOT NULL AND ${WING_SQL} = ?`).all(wing) as { id: number; tid: number }[];
  const classTeacher = ct.map(c => ({ label: label.get(c.id) ?? String(c.id), teacher: tName.get(c.tid) ?? '?', days: (secRows.get(c.id) ?? []).filter(s => s.period === 0 && s.teacherId === c.tid).length, of: days.length }));

  // fairness: how far each teacher's weekly load is from the target
  const target = cfg.targetLoad ?? 24;
  const loads = teachers.map(t => t.load);
  const mean = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
  const stdev = loads.length ? Math.sqrt(loads.reduce((a, b) => a + (b - mean) ** 2, 0) / loads.length) : 0;
  const sumDev = loads.reduce((a, b) => a + Math.abs(b - target), 0);
  const fairness = {
    target, average: Math.round(mean * 10) / 10, lowest: loads.length ? Math.min(...loads) : 0, highest: loads.length ? Math.max(...loads) : 0,
    spread: Math.round(stdev * 10) / 10, aboveTarget: loads.filter(n => n > target).length, belowTarget: loads.filter(n => n < target).length,
    teachers: teachers.map(t => ({ id: t.id, name: t.name, load: t.load, diff: t.load - target }))
  };
  const placed = slots.length;
  const penalty = placed ? (2 * tGaps + 3 * sGaps + 3 * longRuns + 2 * b2b + 1 * heavyLate + 6 * unplaced + 5 * sciRuns + 1 * sumDev) / (placed * 0.35) : 0;
  const score = placed ? Math.max(0, Math.min(100, Math.round(100 - penalty))) : 0;
  const issues: string[] = [];
  if (sciRuns) issues.push(`${sciRuns} place(s) where more than ${MAX_SCIENCE_RUN} science lessons come in a row in a class.`);
  if (unplaced) issues.push(`${unplaced} planned period(s) are not placed yet.`);
  for (const t of teachers.filter(x => x.over)) issues.push(`${t.name} is over a limit (${t.load}/${t.maxPerWeek} a week, busiest day ${t.busiestDay}/${t.maxPerDay}).`);
  for (const c of classTeacher.filter(x => cfg.classTeacherFirst !== false && x.days < x.of)) issues.push(`${c.label}: class teacher ${c.teacher} has period 1 on ${c.days} of ${c.of} days.`);
  for (const e of validateSlots(inp, slots, 5)) issues.push(e);
  return { wing, placed, score, grade: score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 55 ? 'Fair' : 'Needs work',
    metrics: { teacherGaps: tGaps, longRuns, sectionGaps: sGaps, backToBack: b2b, heavyLate, unplaced, scienceRuns: sciRuns }, fairness, teachers, sections, classTeacher, issues };
}
extrasRouter.get('/quality', (req, res) => res.json(quality(asWing(req.query.wing))));

// ---------------------------------------------------------------- substitutes
const spanOf = (sectionId: number, period: number) => { const t = periodTimes(getSettings(wingOfSection(sectionId)))[period]; return t ? { a: toMin(t.start), b: toMin(t.end) } : null; };
const overlaps = (x: { a: number; b: number } | null, y: { a: number; b: number } | null) => !!x && !!y && x.a < y.b && y.a < x.b;

const SUB_DAY_CAP = 6;   // nobody with this many lessons already that day is asked to cover another
const SUB_WEEK_NORMAL = 1, SUB_WEEK_MAX = 2;   // one cover a week; a second only when there is no one else
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const weekOf = (d: string) => { const mon = addDays(d, -(dowOf(d) - 1)); return { from: mon, to: addDays(mon, 6) }; };

export interface Cand { id: number; name: string; qualified: boolean; lessonsToday: number; subsThisMonth: number; subsThisWeek: number; weekLoad: number; secondThisWeek: boolean }
/** Who can cover one lesson. Excludes busy teachers, teachers with a full day or week, and anyone who already covered twice this week. */
export function candidatesFor(date: string, sectionId: number, period: number, subjectId: number, absentId: number): { all: Cand[]; shown: Cand[] } {
  const day = dowOf(date), me = spanOf(sectionId, period), wk = weekOf(date);
  const teachers = db.prepare('SELECT id, name, max_per_day, max_per_week FROM teachers WHERE active = 1 AND id <> ?').all(absentId) as any[];
  const dayRows = (db.prepare('SELECT teacher_id, section_id, period FROM tt_slots WHERE day = ?').all(day) as any[]);
  const doneToday = db.prepare('SELECT sub_teacher_id AS t, section_id, period FROM tt_substitutions WHERE date = ? AND NOT (section_id = ? AND period = ?)').all(date, sectionId, period) as any[];
  const absentToday = new Set((db.prepare('SELECT DISTINCT absent_teacher_id AS id FROM tt_substitutions WHERE date = ?').all(date) as any[]).map(r => r.id));
  const unav = new Set((db.prepare('SELECT teacher_id, day, period FROM teacher_unavailable').all() as any[]).map(r => `${r.teacher_id}-${r.day}-${r.period}`));
  const qual = new Set((db.prepare('SELECT teacher_id, subject_id FROM teacher_subjects').all() as any[]).map(r => `${r.teacher_id}-${r.subject_id}`));
  const weekLessons = new Map<number, number>(); for (const r of db.prepare('SELECT teacher_id AS t, COUNT(*) AS n FROM tt_slots GROUP BY teacher_id').all() as any[]) weekLessons.set(r.t, r.n);
  const subsWeek = new Map<number, number>();
  for (const r of db.prepare('SELECT sub_teacher_id AS t, COUNT(*) AS n FROM tt_substitutions WHERE date BETWEEN ? AND ? AND NOT (date = ? AND section_id = ? AND period = ?) GROUP BY sub_teacher_id').all(wk.from, wk.to, date, sectionId, period) as any[]) subsWeek.set(r.t, r.n);
  const subsMonth = new Map<number, number>();
  for (const r of db.prepare("SELECT sub_teacher_id AS t, COUNT(*) AS n FROM tt_substitutions WHERE substr(date,1,7) = ? GROUP BY sub_teacher_id").all(date.slice(0, 7)) as any[]) subsMonth.set(r.t, r.n);
  const all: Cand[] = [];
  for (const t of teachers) {
    if (absentToday.has(t.id)) continue;
    if (dayRows.some(r => r.teacher_id === t.id && overlaps(spanOf(r.section_id, r.period), me))) continue;
    if (doneToday.some(r => r.t === t.id && overlaps(spanOf(r.section_id, r.period), me))) continue;
    if (unav.has(`${t.id}-${day}-${period}`)) continue;
    const today = dayRows.filter(r => r.teacher_id === t.id).length + doneToday.filter(r => r.t === t.id).length;
    if (today >= Math.min(SUB_DAY_CAP, t.max_per_day)) continue;
    const sw = subsWeek.get(t.id) ?? 0, wl = (weekLessons.get(t.id) ?? 0) + sw;
    if (sw >= SUB_WEEK_MAX || wl >= t.max_per_week) continue;
    all.push({ id: t.id, name: t.name, qualified: qual.has(`${t.id}-${subjectId}`), lessonsToday: today, subsThisMonth: subsMonth.get(t.id) ?? 0, subsThisWeek: sw, weekLoad: wl, secondThisWeek: sw >= SUB_WEEK_NORMAL });
  }
  all.sort((a, b) => a.subsThisWeek - b.subsThisWeek || Number(b.qualified) - Number(a.qualified) || a.lessonsToday - b.lessonsToday || a.weekLoad - b.weekLoad || a.subsThisMonth - b.subsThisMonth);
  // Teachers who already covered once this week are offered only when nobody with no cover is free.
  const fresh = all.filter(c => !c.secondThisWeek);
  return { all, shown: (fresh.length ? fresh : all).slice(0, 8) };
}

/** The lessons of an absent teacher on a date, who has been put in, and who could be. */
extrasRouter.get('/subs', (req, res) => {
  const date = String(req.query.date ?? ''), teacherId = Number(req.query.teacher_id);
  if (!isDate(date)) return bad(res, 'Choose a date.');
  const day = dowOf(date);
  const lessons = (teacherId ? db.prepare(`SELECT ts.section_id, ts.period, ts.subject_id, sub.name AS subject, c.name AS class_name, sec.name AS section_name FROM tt_slots ts
      JOIN subjects sub ON sub.id = ts.subject_id JOIN sections sec ON sec.id = ts.section_id JOIN classes c ON c.id = sec.class_id WHERE ts.teacher_id = ? AND ts.day = ? ORDER BY ts.period`).all(teacherId, day) : []) as any[];
  const done = db.prepare(`SELECT s.*, t.name AS sub_name FROM tt_substitutions s JOIN teachers t ON t.id = s.sub_teacher_id WHERE s.date = ?`).all(date) as any[];
  res.json({
    date, day, week: weekOf(date), lessons: lessons.map(l => {
      const given = done.find(d => d.section_id === l.section_id && d.period === l.period) ?? null;
      return { ...l, time: periodTimes(getSettings(wingOfSection(l.section_id)))[l.period]?.start ?? '', given, candidates: candidatesFor(date, l.section_id, l.period, l.subject_id, teacherId).shown };
    }),
    recorded: done.map(d => ({ ...d, ...(() => { const r = db.prepare(`SELECT c.name AS class_name, sec.name AS section_name, sub.name AS subject, t.name AS absent_name FROM sections sec JOIN classes c ON c.id = sec.class_id, subjects sub, teachers t WHERE sec.id = ? AND sub.id = ? AND t.id = ?`).get(d.section_id, d.subject_id, d.absent_teacher_id) as any; return r ?? {}; })(), time: periodTimes(getSettings(wingOfSection(d.section_id)))[d.period]?.start ?? '' }))
  });
});

extrasRouter.post('/subs', manage, (req, res) => {
  const { date, section_id, period, sub_teacher_id, absent_teacher_id, note } = req.body ?? {};
  if (!isDate(date)) return bad(res, 'Choose a date.');
  const day = dowOf(date);
  const slot = db.prepare('SELECT subject_id, teacher_id FROM tt_slots WHERE section_id = ? AND day = ? AND period = ?').get(Number(section_id), day, Number(period)) as any;
  if (!slot) return bad(res, 'There is no lesson there on that day.');
  if (slot.teacher_id !== Number(absent_teacher_id)) return bad(res, 'That lesson belongs to a different teacher.');
  const sub = Number(sub_teacher_id);
  if (sub === slot.teacher_id) return bad(res, 'The substitute cannot be the absent teacher.');
  if (!db.prepare('SELECT 1 FROM teachers WHERE id = ? AND active = 1').get(sub)) return bad(res, 'Teacher not found.', 404);
  const { all, shown } = candidatesFor(date, Number(section_id), Number(period), slot.subject_id, slot.teacher_id);
  const me = all.find(c => c.id === sub);
  if (!me) return bad(res, 'That teacher cannot take this lesson: busy at that time, a full day or week, or already covered twice this week.', 409);
  if (me.secondThisWeek && shown.some(c => !c.secondThisWeek)) return bad(res, `${me.name} has already covered a lesson this week and others are free. Choose someone who has not covered yet.`, 409);
  db.prepare(`INSERT INTO tt_substitutions (date, section_id, period, subject_id, absent_teacher_id, sub_teacher_id, note, by_user) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(date, section_id, period) DO UPDATE SET sub_teacher_id = excluded.sub_teacher_id, note = excluded.note, by_user = excluded.by_user, at = datetime('now')`)
    .run(date, Number(section_id), Number(period), slot.subject_id, slot.teacher_id, sub, String(note ?? '').slice(0, 120) || null, req.user!.id);
  res.json({ ok: true });
});
/** Teachers who are away on a date (approved leave, or marked absent/leave in the staff register) with how many of their lessons still have no cover. */
export function absentTeachers(date: string) {
  const day = dowOf(date);
  const rows = db.prepare(`SELECT DISTINCT t.id, t.name, 'Leave' AS why FROM hr_leaves l JOIN hr_staff s ON s.id = l.staff_id JOIN teachers t ON t.id = s.teacher_id
      WHERE l.status = 'approved' AND l.from_date <= ? AND l.to_date >= ? AND t.active = 1
    UNION SELECT DISTINCT t.id, t.name, CASE a.status WHEN 'L' THEN 'Leave' ELSE 'Absent' END FROM hr_att a JOIN hr_staff s ON s.id = a.staff_id JOIN teachers t ON t.id = s.teacher_id
      WHERE a.date = ? AND a.status IN ('A','L') AND t.active = 1`).all(date, date, date) as { id: number; name: string; why: string }[];
  const seen = new Set<number>();
  return rows.filter(r => !seen.has(r.id) && seen.add(r.id)).map(r => {
    const lessons = (db.prepare('SELECT COUNT(*) AS n FROM tt_slots WHERE teacher_id = ? AND day = ?').get(r.id, day) as any).n as number;
    const covered = (db.prepare('SELECT COUNT(*) AS n FROM tt_substitutions WHERE date = ? AND absent_teacher_id = ?').get(date, r.id) as any).n as number;
    return { id: r.id, name: r.name, why: r.why, lessons, covered, uncovered: Math.max(0, lessons - covered) };
  }).filter(r => r.lessons > 0).sort((a, b) => b.uncovered - a.uncovered || a.name.localeCompare(b.name));
}
/** After a leave is approved: for each coming day of it (today onward, at most 30 days), how many of the teacher's lessons still have no replacement. */
export function leaveCover(staffId: number, from: string, to: string, today = new Date().toISOString().slice(0, 10)) {
  const t = db.prepare('SELECT teacher_id FROM hr_staff WHERE id = ? AND teacher_id IS NOT NULL').get(staffId) as { teacher_id: number } | undefined;
  if (!t) return { teacher: null as string | null, lessons: 0, uncovered: 0, dates: [] as { date: string; lessons: number; uncovered: number }[] };
  const name = (db.prepare('SELECT name FROM teachers WHERE id = ?').get(t.teacher_id) as any)?.name ?? null;
  const dates: { date: string; lessons: number; uncovered: number }[] = [];
  for (let d = from < today ? today : from, n = 0; d <= to && n < 30; d = addDays(d, 1), n++) {
    const lessons = (db.prepare('SELECT COUNT(*) AS n FROM tt_slots WHERE teacher_id = ? AND day = ?').get(t.teacher_id, dowOf(d)) as any).n as number;
    if (!lessons) continue;
    const covered = (db.prepare('SELECT COUNT(*) AS n FROM tt_substitutions WHERE date = ? AND absent_teacher_id = ?').get(d, t.teacher_id) as any).n as number;
    dates.push({ date: d, lessons, uncovered: Math.max(0, lessons - covered) });
  }
  return { teacher: name, lessons: dates.reduce((a, x) => a + x.lessons, 0), uncovered: dates.reduce((a, x) => a + x.uncovered, 0), dates };
}
extrasRouter.get('/absent', (req, res) => {
  const date = String(req.query.date ?? '');
  if (!isDate(date)) return bad(res, 'Choose a date.');
  res.json(absentTeachers(date));
});

/** Gives every uncovered lesson of an absent teacher to the best free teacher, one at a time so the fairness rules see each choice. */
extrasRouter.post('/subs/auto', manage, (req, res) => {
  const date = String(req.body?.date ?? ''), absent = Number(req.body?.teacher_id);
  if (!isDate(date) || !absent) return bad(res, 'Choose a date and the absent teacher.');
  const lessons = db.prepare('SELECT section_id, period, subject_id FROM tt_slots WHERE teacher_id = ? AND day = ? ORDER BY period').all(absent, dowOf(date)) as any[];
  const have = new Set((db.prepare('SELECT section_id, period FROM tt_substitutions WHERE date = ? AND absent_teacher_id = ?').all(date, absent) as any[]).map(r => `${r.section_id}-${r.period}`));
  const assigned: any[] = [], left: any[] = [];
  const ins = db.prepare('INSERT INTO tt_substitutions (date, section_id, period, subject_id, absent_teacher_id, sub_teacher_id, by_user) VALUES (?,?,?,?,?,?,?)');
  const labelOf = db.prepare("SELECT c.name || '-' || sec.name AS n FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = ?");
  for (const l of lessons) {
    if (have.has(`${l.section_id}-${l.period}`)) continue;
    const best = candidatesFor(date, l.section_id, l.period, l.subject_id, absent).shown[0];
    const label = (labelOf.get(l.section_id) as any)?.n;
    if (!best) { left.push({ period: l.period + 1, class: label }); continue; }
    ins.run(date, l.section_id, l.period, l.subject_id, absent, best.id, req.user!.id);
    assigned.push({ period: l.period + 1, class: label, teacher: best.name });
  }
  res.json({ assigned, left });
});

extrasRouter.delete('/subs', manage, (req, res) => {
  db.prepare('DELETE FROM tt_substitutions WHERE date = ? AND section_id = ? AND period = ?').run(String(req.query.date), Number(req.query.section_id), Number(req.query.period));
  res.json({ ok: true });
});
/** How many extra lessons each teacher covered in a month (for the extra-duty allowance). */
extrasRouter.get('/subs/summary', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
  res.json({ month, rows: db.prepare(`SELECT t.id, t.name, COUNT(*) AS covered FROM tt_substitutions s JOIN teachers t ON t.id = s.sub_teacher_id WHERE substr(s.date,1,7) = ? GROUP BY t.id ORDER BY covered DESC, t.name`).all(month),
    absent: db.prepare(`SELECT t.id, t.name, COUNT(*) AS lessons FROM tt_substitutions s JOIN teachers t ON t.id = s.absent_teacher_id WHERE substr(s.date,1,7) = ? GROUP BY t.id ORDER BY lessons DESC, t.name`).all(month) });
});
