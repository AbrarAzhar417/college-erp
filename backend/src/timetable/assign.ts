import { db } from '../db.js';
import { getSettings } from './schema.js';

export interface AssignResult {
  assigned: number;
  unassigned: { section: string; subject: string; reason: string }[];
  teacherLoads: { name: string; load: number; max: number }[];
}

/** Gives every lesson a qualified teacher while keeping weekly loads balanced. */
export function autoAssign(opts: { classId?: number; reassign?: boolean }): AssignResult {
  const D = Math.max(...(['school', 'college'] as const).map(w => getSettings(w).days.length));
  const T = Math.max(...(['school', 'college'] as const).map(w => { const x = getSettings(w); return x.days.length * x.periodCount; }));

  const teachers = db.prepare('SELECT id, name, max_per_day, max_per_week FROM teachers WHERE active = 1').all() as any[];
  const qual = new Map<number, Set<number>>();
  for (const r of db.prepare('SELECT teacher_id, subject_id FROM teacher_subjects').all() as any[]) {
    (qual.get(r.teacher_id) ?? qual.set(r.teacher_id, new Set()).get(r.teacher_id)!).add(r.subject_id);
  }
  const unavailCount = new Map<number, number>();
  for (const r of db.prepare('SELECT teacher_id, COUNT(*) AS n FROM teacher_unavailable GROUP BY teacher_id').all() as any[]) unavailCount.set(r.teacher_id, r.n);

  const rows = db.prepare(`
    SELECT ss.id, ss.section_id, ss.subject_id, ss.periods_per_week AS periods, ss.teacher_id,
           c.id AS class_id, c.grade, sec.name AS sec_name, sub.name AS subject_name
    FROM section_subjects ss
    JOIN sections sec ON sec.id = ss.section_id JOIN classes c ON c.id = sec.class_id
    JOIN subjects sub ON sub.id = ss.subject_id`).all() as any[];

  const inScope = (r: any) => !opts.classId || r.class_id === opts.classId;
  const load = new Map<number, number>(teachers.map(t => [t.id, 0]));
  const teachesClassSubject = new Set<string>();
  const todo: any[] = [];
  for (const r of rows) {
    const reassign = opts.reassign && inScope(r);
    if (r.teacher_id && !reassign) {
      load.set(r.teacher_id, (load.get(r.teacher_id) ?? 0) + r.periods);
      teachesClassSubject.add(`${r.teacher_id}-${r.class_id}-${r.subject_id}`);
    } else if (inScope(r)) todo.push(r);
  }

  const qualifiedCount = (subjectId: number) => teachers.filter(t => qual.get(t.id)?.has(subjectId)).length;
  todo.sort((a, b) => qualifiedCount(a.subject_id) - qualifiedCount(b.subject_id) || b.periods - a.periods || a.grade - b.grade || a.sec_name.localeCompare(b.sec_name));

  // Assignments made in this run, so the balancing pass can move them
  const made = new Map<number, { row: any; teacher: any }>();
  const update = db.prepare('UPDATE section_subjects SET teacher_id = ? WHERE id = ?');
  const clear = db.prepare('DELETE FROM tt_slots WHERE section_id = ? AND subject_id = ?');
  const result: AssignResult = { assigned: 0, unassigned: [], teacherLoads: [] };

  function balance() {
    const byId = new Map(teachers.map(t => [t.id, t]));
    for (let round = 0; round < 400; round++) {
      let improved = false;
      const ranked = [...made.values()].sort((x, y) => (load.get(y.teacher.id) ?? 0) - (load.get(x.teacher.id) ?? 0));
      for (const m of ranked) {
        const from = m.teacher, p = m.row.periods, lf = load.get(from.id) ?? 0;
        let bestTo: any = null, bestMax = lf;
        for (const t of teachers) {
          if (t.id === from.id || !qual.get(t.id)?.has(m.row.subject_id)) continue;
          const lt = load.get(t.id) ?? 0;
          const after = lt + p;
          if (after > t.max_per_week || after > T - (unavailCount.get(t.id) ?? 0) || after > t.max_per_day * D) continue;
          const worst = Math.max(lf - p, after);
          if (worst < bestMax) { bestMax = worst; bestTo = t; }
        }
        if (bestTo) {
          update.run(bestTo.id, m.row.id);
          load.set(from.id, lf - p); load.set(bestTo.id, (load.get(bestTo.id) ?? 0) + p);
          m.teacher = bestTo; byId.get(bestTo.id);
          improved = true; break;
        }
      }
      if (!improved) break;
    }
  }

  db.transaction(() => {
    for (const r of todo) {
      const label = `${r.grade}-${r.sec_name}`;
      const qualified = teachers.filter(t => qual.get(t.id)?.has(r.subject_id));
      if (!qualified.length) { result.unassigned.push({ section: label, subject: r.subject_name, reason: 'No teacher is marked as able to teach this subject.' }); continue; }
      const fits = qualified.filter(t => {
        const after = (load.get(t.id) ?? 0) + r.periods;
        return after <= t.max_per_week && after <= T - (unavailCount.get(t.id) ?? 0) && after <= t.max_per_day * D;
      });
      if (!fits.length) { result.unassigned.push({ section: label, subject: r.subject_name, reason: 'All qualified teachers are already at their weekly limit. Add a teacher or raise a limit.' }); continue; }
      let best = fits[0], bestScore = Infinity;
      for (const t of fits) {
        const score = ((load.get(t.id) ?? 0) / t.max_per_week) * 10 - (teachesClassSubject.has(`${t.id}-${r.class_id}-${r.subject_id}`) ? 1.5 : 0) + Math.random() * 0.01;
        if (score < bestScore) { bestScore = score; best = t; }
      }
      if (r.teacher_id !== best.id) clear.run(r.section_id, r.subject_id);
      update.run(best.id, r.id);
      made.set(r.id, { row: r, teacher: best });
      load.set(best.id, (load.get(best.id) ?? 0) + r.periods);
      teachesClassSubject.add(`${best.id}-${r.class_id}-${r.subject_id}`);
      result.assigned++;
    }
    balance();
  })();

  result.teacherLoads = teachers.filter(t => (load.get(t.id) ?? 0) > 0).map(t => ({ name: t.name, load: load.get(t.id) ?? 0, max: t.max_per_week }));
  return result;
}
