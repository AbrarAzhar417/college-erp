import { Router } from 'express';
import { db } from '../db.js';
import { requireAccess } from '../auth.js';
import { audit } from '../audit/service.js';
import './schema.js';
import '../hr/schema.js';

/**
 * Invigilation roster. A "sitting" is one section writing on one date. Each sitting gets the chosen number of invigilators,
 * given out so every teacher ends up with about the same number of duties. A teacher is never put in the room of a paper
 * they set themselves, never on a date they are on approved leave or marked absent, and not in two rooms on one date unless
 * there is nobody else. Duties fixed by hand stay fixed when the roster is made again.
 */
db.exec(`CREATE TABLE IF NOT EXISTS exam_duty (
  id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE, date TEXT NOT NULL,
  section_id INTEGER NOT NULL REFERENCES sections(id), teacher_id INTEGER NOT NULL REFERENCES teachers(id), locked INTEGER NOT NULL DEFAULT 0,
  UNIQUE (exam_id, date, section_id, teacher_id)
)`);

export interface Sitting { date: string; section_id: number; label: string; grade: number; setters: number[]; subjects: string }

export function sittings(examId: number): Sitting[] {
  const rows = db.prepare(`SELECT p.test_date AS date, p.section_id, c.name || '-' || s.name AS label, c.grade, GROUP_CONCAT(DISTINCT p.teacher_id) AS setters, GROUP_CONCAT(sub.name, ', ') AS subjects
    FROM exam_papers p JOIN sections s ON s.id = p.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = p.subject_id
    WHERE p.exam_id = ? AND p.test_date IS NOT NULL AND EXISTS (SELECT 1 FROM students st WHERE st.section_id = s.id AND st.status = 'active')
    GROUP BY p.test_date, p.section_id ORDER BY p.test_date, c.grade, s.name`).all(examId) as any[];
  return rows.map(r => ({ date: r.date, section_id: r.section_id, label: r.label, grade: r.grade, setters: (r.setters ?? '').split(',').filter(Boolean).map(Number), subjects: r.subjects }));
}

const away = (date: string): Set<number> => new Set((db.prepare(`
  SELECT s.teacher_id AS id FROM hr_leaves l JOIN hr_staff s ON s.id = l.staff_id WHERE l.status = 'approved' AND l.from_date <= ? AND l.to_date >= ? AND s.teacher_id IS NOT NULL
  UNION SELECT s.teacher_id FROM hr_att a JOIN hr_staff s ON s.id = a.staff_id WHERE a.date = ? AND a.status IN ('A','L') AND s.teacher_id IS NOT NULL`).all(date, date, date) as any[]).map(r => r.id));

export function generateRoster(examId: number, perRoom: number) {
  const list = sittings(examId);
  const teachers = db.prepare('SELECT id, name FROM teachers WHERE active = 1 ORDER BY name').all() as { id: number; name: string }[];
  db.prepare('DELETE FROM exam_duty WHERE exam_id = ? AND locked = 0').run(examId);
  const kept = db.prepare('SELECT date, section_id, teacher_id FROM exam_duty WHERE exam_id = ?').all(examId) as any[];
  const total = new Map<number, number>(), byDay = new Map<string, Set<number>>(), inRoom = new Map<string, Set<number>>();
  const bump = (d: string, sec: number, t: number) => { total.set(t, (total.get(t) ?? 0) + 1); (byDay.get(d) ?? byDay.set(d, new Set()).get(d)!).add(t); (inRoom.get(`${d}|${sec}`) ?? inRoom.set(`${d}|${sec}`, new Set()).get(`${d}|${sec}`)!).add(t); };
  for (const k of kept) bump(k.date, k.section_id, k.teacher_id);
  const ins = db.prepare('INSERT INTO exam_duty (exam_id, date, section_id, teacher_id) VALUES (?,?,?,?)');
  const unfilled: { date: string; label: string; missing: number }[] = []; let assigned = 0, doubled = 0;
  for (const s of list) {
    const need = perRoom - (inRoom.get(`${s.date}|${s.section_id}`)?.size ?? 0);
    const gone = away(s.date);
    for (let i = 0; i < need; i++) {
      const ok = teachers.filter(t => !s.setters.includes(t.id) && !gone.has(t.id) && !inRoom.get(`${s.date}|${s.section_id}`)?.has(t.id));
      const pick = (pool: typeof ok) => pool.sort((a, b) => (total.get(a.id) ?? 0) - (total.get(b.id) ?? 0) || a.name.localeCompare(b.name))[0];
      let t = pick(ok.filter(x => !byDay.get(s.date)?.has(x.id)));
      if (!t) { t = pick(ok); if (t) doubled++; }
      if (!t) { unfilled.push({ date: s.date, label: s.label, missing: need - i }); break; }
      ins.run(examId, s.date, s.section_id, t.id); bump(s.date, s.section_id, t.id); assigned++;
    }
  }
  return { assigned, doubled, unfilled };
}

export function rosterView(examId: number) {
  const list = sittings(examId);
  const duty = db.prepare(`SELECT d.id, d.date, d.section_id, d.teacher_id, d.locked, t.name FROM exam_duty d JOIN teachers t ON t.id = d.teacher_id WHERE d.exam_id = ? ORDER BY t.name`).all(examId) as any[];
  const days = new Map<string, Map<number, number>>();
  for (const d of duty) { const m = days.get(d.date) ?? days.set(d.date, new Map()).get(d.date)!; m.set(d.teacher_id, (m.get(d.teacher_id) ?? 0) + 1); }
  const rows = list.map(s => ({ ...s, invigilators: duty.filter(d => d.date === s.date && d.section_id === s.section_id).map(d => ({ id: d.teacher_id, name: d.name, locked: !!d.locked, double: (days.get(d.date)?.get(d.teacher_id) ?? 0) > 1 })) }));
  const per = new Map<number, { id: number; name: string; duties: number; dates: Set<string> }>();
  for (const d of duty) { const e = per.get(d.teacher_id) ?? { id: d.teacher_id, name: d.name, duties: 0, dates: new Set() }; e.duties++; e.dates.add(d.date); per.set(d.teacher_id, e); }
  const teachers = [...per.values()].map(e => ({ id: e.id, name: e.name, duties: e.duties, days: e.dates.size, dates: [...e.dates].sort() })).sort((a, b) => b.duties - a.duties || a.name.localeCompare(b.name));
  const n = teachers.map(t => t.duties), mean = n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0;
  return { rows, teachers, fairness: { teachers: n.length, lowest: n.length ? Math.min(...n) : 0, highest: n.length ? Math.max(...n) : 0, average: Math.round(mean * 10) / 10 } };
}

export const dutyRouter = Router();
const manage = requireAccess(['director', 'principal', 'admin'], 'exam_dept');
const bad = (res: any, m: string, c = 400) => res.status(c).json({ message: m });
dutyRouter.get('/mine', (req, res) => {
  const t = db.prepare('SELECT teacher_id FROM hr_staff WHERE user_id = ? AND teacher_id IS NOT NULL').get(req.user!.id) as any;
  if (!t) return res.json([]);
  res.json(db.prepare(`SELECT e.name AS exam, d.date, c.name || '-' || s.name AS room FROM exam_duty d JOIN exams e ON e.id = d.exam_id JOIN sections s ON s.id = d.section_id JOIN classes c ON c.id = s.class_id
    WHERE d.teacher_id = ? AND d.date >= date('now') ORDER BY d.date`).all(t.teacher_id));
});
dutyRouter.get('/', manage, (req, res) => {
  const examId = Number(req.query.exam_id);
  if (!db.prepare('SELECT 1 FROM exams WHERE id = ?').get(examId)) return bad(res, 'Exam not found.', 404);
  res.json(rosterView(examId));
});
dutyRouter.post('/generate', manage, (req, res) => {
  const examId = Number(req.body?.exam_id), per = Math.round(Number(req.body?.per_room ?? 1));
  if (!db.prepare('SELECT 1 FROM exams WHERE id = ?').get(examId)) return bad(res, 'Exam not found.', 404);
  if (!(per >= 1 && per <= 4)) return bad(res, 'Invigilators per room must be 1 to 4.');
  if (!sittings(examId).length) return bad(res, 'This exam has no papers with a date yet. Give each paper a date first.');
  const r = generateRoster(examId, per); audit(req.user, 'exam.duty_roster', 'exam', examId, r); res.json({ ...r, ...rosterView(examId) });
});
/** Sets the invigilators of one room by hand. They stay fixed when the roster is made again. */
dutyRouter.put('/set', manage, (req, res) => {
  const { exam_id, date, section_id } = req.body ?? {}, ids: number[] = [...new Set<number>((Array.isArray(req.body?.teacher_ids) ? req.body.teacher_ids : []).map(Number))];
  const sit = sittings(Number(exam_id)).find(s => s.date === date && s.section_id === Number(section_id));
  if (!sit) return bad(res, 'That room has no paper on that date.', 404);
  const gone = away(date);
  for (const id of ids) {
    const t = db.prepare('SELECT name FROM teachers WHERE id = ? AND active = 1').get(id) as any;
    if (!t) return bad(res, 'Teacher not found.', 404);
    if (sit.setters.includes(id)) return bad(res, `${t.name} set a paper for this room and cannot invigilate it.`, 409);
    if (gone.has(id)) return bad(res, `${t.name} is on leave or absent that day.`, 409);
    const other = db.prepare('SELECT 1 FROM exam_duty WHERE exam_id = ? AND date = ? AND teacher_id = ? AND section_id <> ?').get(Number(exam_id), date, id, Number(section_id));
    if (other && !req.body?.force) return bad(res, `${t.name} is already in another room that day.`, 409);
  }
  db.transaction(() => {
    db.prepare('DELETE FROM exam_duty WHERE exam_id = ? AND date = ? AND section_id = ?').run(Number(exam_id), date, Number(section_id));
    for (const id of ids) db.prepare('INSERT INTO exam_duty (exam_id, date, section_id, teacher_id, locked) VALUES (?,?,?,?,1)').run(Number(exam_id), date, Number(section_id), id);
  })();
  res.json(rosterView(Number(exam_id)));
});
dutyRouter.delete('/', manage, (req, res) => { db.prepare('DELETE FROM exam_duty WHERE exam_id = ?').run(Number(req.query.exam_id)); audit(req.user, 'exam.duty_clear', 'exam', String(req.query.exam_id)); res.json({ ok: true }); });
