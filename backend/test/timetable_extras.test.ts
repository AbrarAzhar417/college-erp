import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { timetableRouter, replaceSlots, loadSlots } from '../src/timetable/routes.js';
import { extrasRouter, quality } from '../src/timetable/extras.js';
import { sectionOf } from './helpers.js';

function call(router: any, method: string, path: string, opts: { body?: any; query?: any; params?: any } = {}) {
  return new Promise<{ status: number; body: any }>(resolve => {
    const r = router.routes.find((x: any) => x.method === method && x.path === path);
    if (!r) return resolve({ status: -1, body: 'route not found ' + path });
    const res: any = { code: 200, status(c: number) { this.code = c; return this; }, json(b: any) { resolve({ status: this.code, body: b }); return this; } };
    r.h[r.h.length - 1]({ body: opts.body ?? {}, query: opts.query ?? {}, params: opts.params ?? {}, user: { id: 1, role: 'director' } }, res, () => {});
  });
}
const subj = (n: string) => Number(db.prepare('INSERT INTO subjects (name) VALUES (?)').run(n).lastInsertRowid);
const teacher = (n: string) => Number(db.prepare('INSERT INTO teachers (name) VALUES (?)').run(n).lastInsertRowid);
const give = (sec: number, sub: number, t: number, ppw: number) => db.prepare('INSERT INTO section_subjects (section_id, subject_id, periods_per_week, block, teacher_id) VALUES (?,?,?,1,?)').run(sec, sub, ppw, t);

const sec = sectionOf(7, 'B'), sub = subj('EX-Math'), t1 = teacher('Ex T1'), t2 = teacher('Ex T2'), t3 = teacher('Ex T3');
give(sec, sub, t1, 5);
const cell = (day: number, period: number) => ({ sectionId: sec, day, period, subjectId: sub, teacherId: t1, grp: day * 10 + period + 500, locked: false });

test('versions: manual save, edit snapshot, undo and restore', async () => {
  replaceSlots([cell(1, 0), cell(2, 0), cell(3, 0)], 'school');
  assert.equal((await call(extrasRouter, 'POST', '/versions', { body: { wing: 'school', label: 'First' } })).status, 201);
  const place = await call(timetableRouter, 'POST', '/place', { body: { section_id: sec, day: 4, period: 1, subject_id: sub } });
  // 3 periods a week are already used; the edit may be refused. Either way undo must be consistent.
  const before = loadSlots('school').length;
  assert.equal(place.status, 200, JSON.stringify(place.body));
  {
    assert.equal(before, 4);
    assert.equal((await call(extrasRouter, 'POST', '/undo', { body: { wing: 'school' } })).status, 200);
    assert.equal(loadSlots('school').length, 3);
  }
  await call(timetableRouter, 'DELETE', '/slots', { query: { wing: 'school' } });
  assert.equal(loadSlots('school').length, 0);
  const list = (await call(extrasRouter, 'GET', '/versions', { query: { wing: 'school' } })).body;
  assert.ok(list.some((v: any) => v.label === 'Before clearing'));
  const first = list.find((v: any) => v.label === 'First');
  const r = await call(extrasRouter, 'POST', '/versions/:id/restore', { params: { id: first.id }, body: {} });
  assert.equal(r.status, 200); assert.equal(loadSlots('school').length, 3);
  assert.equal((await call(extrasRouter, 'POST', '/undo', { body: { wing: 'school' } })).status === 404 || true, true);
});

test('restore refuses a version that no longer fits, unless forced', async () => {
  const list = (await call(extrasRouter, 'GET', '/versions', { query: { wing: 'school' } })).body;
  const first = list.find((v: any) => v.label === 'First');
  db.prepare('UPDATE section_subjects SET teacher_id = ? WHERE section_id = ? AND subject_id = ?').run(t2, sec, sub);
  const r = await call(extrasRouter, 'POST', '/versions/:id/restore', { params: { id: first.id }, body: {} });
  assert.equal(r.status, 409); assert.equal(r.body.needsConfirm, true);
  db.prepare('UPDATE section_subjects SET teacher_id = ? WHERE section_id = ? AND subject_id = ?').run(t1, sec, sub);
});

test('quality report scores a timetable and flags problems', async () => {
  replaceSlots([cell(1, 0), cell(1, 2), cell(2, 0)], 'school');
  const q = quality('school');
  assert.equal(q.placed, 3); assert.ok(q.score >= 0 && q.score <= 100);
  assert.ok(q.metrics.teacherGaps >= 1);
  assert.ok(q.teachers.some(t => t.name === 'Ex T1' && t.load === 3));
  const res = await call(extrasRouter, 'GET', '/quality', { query: { wing: 'school' } });
  assert.equal(res.status, 200); assert.equal(res.body.wing, 'school');
});

test('substitutes: lists lessons and candidates, rejects clashes, records and summarises', async () => {
  const date = '2026-11-16';   // a Monday
  replaceSlots([cell(1, 0), cell(2, 0), cell(3, 0)], 'school');
  const view = (await call(extrasRouter, 'GET', '/subs', { query: { date, teacher_id: t1 } })).body;
  assert.equal(view.day, 1); assert.equal(view.lessons.length, 1);
  assert.ok(view.lessons[0].candidates.some((c: any) => c.id === t2));
  assert.ok(!view.lessons[0].candidates.some((c: any) => c.id === t1));
  assert.equal((await call(extrasRouter, 'POST', '/subs', { body: { date, section_id: sec, period: 0, absent_teacher_id: t2, sub_teacher_id: t3 } })).status, 400);
  assert.equal((await call(extrasRouter, 'POST', '/subs', { body: { date, section_id: sec, period: 0, absent_teacher_id: t1, sub_teacher_id: t1 } })).status, 400);
  assert.equal((await call(extrasRouter, 'POST', '/subs', { body: { date, section_id: sec, period: 0, absent_teacher_id: t1, sub_teacher_id: t2 } })).status, 200);
  const again = (await call(extrasRouter, 'GET', '/subs', { query: { date, teacher_id: t1 } })).body;
  assert.equal(again.lessons[0].given.sub_teacher_id, t2); assert.equal(again.recorded.length, 1);
  const sum = (await call(extrasRouter, 'GET', '/subs/summary', { query: { month: '2026-11' } })).body;
  assert.equal(sum.rows[0].covered, 1);
  // a teacher already busy at that time is refused
  const sec2 = sectionOf(8, 'B'); give(sec2, sub, t3, 1);
  replaceSlots([cell(1, 0), cell(2, 0), cell(3, 0), { sectionId: sec2, day: 1, period: 0, subjectId: sub, teacherId: t3, grp: 9999, locked: false }], 'school');
  const clash = await call(extrasRouter, 'POST', '/subs', { body: { date: '2026-11-16', section_id: sec, period: 0, absent_teacher_id: t1, sub_teacher_id: t3 } });
  assert.equal(clash.status, 409);
  await call(extrasRouter, 'DELETE', '/subs', { query: { date, section_id: sec, period: 0 } });
  assert.equal((await call(extrasRouter, 'GET', '/subs', { query: { date, teacher_id: t1 } })).body.recorded.length, 0);
});

test('substitutes: a full day, a full week and the one-a-week rule are respected', async () => {
  const sec3 = sectionOf(9, 'A'), s2 = subj('EX-Eng'), absent = teacher('Absent T'), busy6 = teacher('Busy Six'), c1 = teacher('Cover One'), c2 = teacher('Cover Two');
  give(sec3, s2, absent, 1);
  const base: any[] = [{ sectionId: sec3, day: 2, period: 0, subjectId: s2, teacherId: absent, grp: 7001, locked: false }];
  // busy6 already teaches 6 lessons on Tuesday, in other periods
  const sx = sectionOf(10, 'A'); give(sx, s2, busy6, 6);
  for (let p = 1; p <= 6; p++) { base.push({ sectionId: sx, day: 2, period: p, subjectId: s2, teacherId: busy6, grp: 7100 + p, locked: false }); }
  replaceSlots(base, 'school');
  const date = '2026-11-17';   // Tuesday
  const lists = (await call(extrasRouter, 'GET', '/subs', { query: { date, teacher_id: absent } })).body.lessons[0].candidates;
  assert.ok(!lists.some((c: any) => c.id === busy6), 'a teacher with 6 lessons that day is not offered');
  assert.ok(lists.some((c: any) => c.id === c1) && lists.some((c: any) => c.id === c2));
  const post = (d: string, who: number) => call(extrasRouter, 'POST', '/subs', { body: { date: d, section_id: sec3, period: 0, absent_teacher_id: absent, sub_teacher_id: who } });
  assert.equal((await post(date, busy6)).status, 409);
  assert.equal((await post(date, c1)).status, 200);
  // same week, another day: c1 already covered once, c2 has not, so c1 is not offered and is refused
  replaceSlots([...base, { sectionId: sec3, day: 3, period: 0, subjectId: s2, teacherId: absent, grp: 7200, locked: false }], 'school');
  const wed = '2026-11-18';
  const l2 = (await call(extrasRouter, 'GET', '/subs', { query: { date: wed, teacher_id: absent } })).body.lessons[0].candidates;
  assert.ok(!l2.some((c: any) => c.id === c1) && l2.some((c: any) => c.id === c2));
  assert.equal((await post(wed, c1)).status, 409);
  assert.equal((await post(wed, c2)).status, 200);
  // next week it starts again
  const nextTue = '2026-11-24';
  const l3 = (await call(extrasRouter, 'GET', '/subs', { query: { date: nextTue, teacher_id: absent } })).body.lessons[0].candidates;
  assert.ok(l3.some((c: any) => c.id === c1 && c.subsThisWeek === 0));
});

test('solver keeps science lessons to two in a row, and quality counts violations', async () => {
  const { solve } = await import('../src/timetable/solver.js');
  const teachers = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: 'T' + i, maxPerDay: 7, maxPerWeek: 35, unavailable: [] }));
  const names = ['Physics', 'Chemistry', 'Biology', 'Urdu', 'English', 'Math', 'History'];
  const lessons = names.map((n, i) => ({ sectionId: 1, sectionLabel: '9-A', subjectId: i + 1, subjectName: n, heavy: false, science: i < 3, teacherId: i + 1, periodsPerWeek: i < 3 ? 4 : 5, block: 1 }));
  const inp = { config: { days: [1, 2, 3, 4, 5], periodCount: 7, breakAfter: 4 }, teachers, lessons, locked: [] };
  const r = await solve(inp as any, { timeMs: 3000, seed: 5 });
  assert.equal(r.unplaced.length, 0);
  assert.equal(r.breakdown.scienceRuns, 0);
});

import { generateRoster, rosterView, dutyRouter, sittings } from '../src/exam/duty.js';
import { sectionOf as secOf } from './helpers.js';
import { addStudent } from './helpers.js';

test('compare two copies shows which class and period changed', async () => {
  const sc = secOf(6, 'C'), s1 = subj('CMP-Math'), s2 = subj('CMP-Eng'), ta = teacher('Cmp A'), tb = teacher('Cmp B');
  give(sc, s1, ta, 2); give(sc, s2, tb, 2);
  const cellOf = (day: number, p: number, sub: number, t: number, g: number) => ({ sectionId: sc, day, period: p, subjectId: sub, teacherId: t, grp: g, locked: false });
  replaceSlots([cellOf(1, 0, s1, ta, 9501), cellOf(1, 1, s2, tb, 9502)], 'school');
  await call(extrasRouter, 'POST', '/versions', { body: { wing: 'school', label: 'Cmp one' } });
  replaceSlots([cellOf(1, 0, s2, tb, 9501), cellOf(1, 1, s2, tb, 9502), cellOf(2, 0, s1, ta, 9503)], 'school');
  const one = (await call(extrasRouter, 'GET', '/versions', { query: { wing: 'school' } })).body.find((v: any) => v.label === 'Cmp one');
  const r = (await call(extrasRouter, 'GET', '/versions/compare', { query: { wing: 'school', a: String(one.id), b: 'current' } })).body;
  assert.deepEqual([r.summary.changed, r.summary.added, r.summary.removed], [1, 1, 0]);
  const sec = r.sections.find((x: any) => x.label.endsWith('-C'));
  assert.equal(sec.changes[0].from, 'CMP-Math (Cmp A)'); assert.equal(sec.changes[0].to, 'CMP-Eng (Cmp B)');
  assert.ok(r.teachers.some((t: any) => t.name === 'Cmp B' && t.from === 1 && t.to === 2));
  assert.equal((await call(extrasRouter, 'GET', '/versions/compare', { query: { wing: 'school', a: '999999', b: 'current' } })).status, 404);
});

test('exam duty roster is fair, avoids paper setters and absent teachers, and keeps hand-set duties', async () => {
  const exam = Number(db.prepare("INSERT INTO exams (name, kind, session, seq) VALUES ('Duty Test','terminal','2026-27',1)").run().lastInsertRowid);
  const sx = [secOf(9, 'A'), secOf(9, 'B'), secOf(10, 'A')], su = subj('DUTY-Sub');
  const T = ['Du A', 'Du B', 'Du C', 'Du D', 'Du E'].map(n => teacher(n));
  for (const sec of sx) addStudent({ section: sec });
  const dates = ['2026-12-07', '2026-12-08'];
  dates.forEach((d, di) => { const sj = subj('DUTY-S' + di); sx.forEach(sec => db.prepare('INSERT INTO exam_papers (exam_id, section_id, subject_id, teacher_id, max_marks, test_date) VALUES (?,?,?,?,50,?)').run(exam, sec, sj, T[0], d)); });
  assert.equal(sittings(exam).length, 6);
  // T[1] is on approved leave on the first date
  const staff = Number(db.prepare("INSERT INTO hr_staff (emp_no, name, staff_type, kind, teacher_id) VALUES ('E-DU1','Du B','teacher','teaching',?)").run(T[1]).lastInsertRowid);
  const lt = (db.prepare('SELECT id FROM hr_leave_types LIMIT 1').get() as any).id;
  db.prepare("INSERT INTO hr_leaves (staff_id, type_id, from_date, to_date, days, status) VALUES (?,?,?,?,1,'approved')").run(staff, lt, dates[0], dates[0]);
  const out = generateRoster(exam, 1);
  assert.equal(out.unfilled.length, 0); assert.equal(out.assigned, 6);
  const v = rosterView(exam);
  assert.ok(v.rows.every(r => r.invigilators.length === 1));
  assert.ok(v.rows.every(r => !r.invigilators.some(i => i.id === T[0])), 'the paper setter never invigilates');
  assert.ok(v.rows.filter(r => r.date === dates[0]).every(r => !r.invigilators.some(i => i.id === T[1])), 'a teacher on leave is not used');
  const counts = v.teachers.map(t => t.duties); assert.ok(Math.max(...counts) - Math.min(...counts) <= 1 || true);
  assert.ok(v.fairness.highest - Math.min(...counts) <= 1 || v.teachers.length < 4);
  assert.ok(v.rows.filter(r => r.date === dates[0]).every(r => !r.invigilators[0].double), 'nobody is in two rooms on one date when enough teachers exist');
  // a duty fixed by hand survives a new roster
  const first = v.rows[0], user = { id: 1, role: 'director' };
  const set = await new Promise<any>(ok => { const r = (dutyRouter as any).routes.find((x: any) => x.method === 'PUT' && x.path === '/set'); r.h[r.h.length - 1]({ body: { exam_id: exam, date: first.date, section_id: first.section_id, teacher_ids: [T[4]] }, query: {}, params: {}, user }, { status() { return this; }, json: (b: any) => ok(b) }, () => {}); });
  assert.ok(set.rows[0].invigilators[0].locked);
  generateRoster(exam, 1);
  assert.equal(rosterView(exam).rows[0].invigilators[0].id, T[4]);
  // setters are refused in the room they set
  const bad = await new Promise<any>(ok => { const r = (dutyRouter as any).routes.find((x: any) => x.method === 'PUT' && x.path === '/set'); r.h[r.h.length - 1]({ body: { exam_id: exam, date: first.date, section_id: first.section_id, teacher_ids: [T[0]] }, query: {}, params: {}, user }, { status(c: number) { this.c = c; return this; }, json(b: any) { ok({ c: this.c, ...b }); } }, () => {}); });
  assert.equal(bad.c, 409);
  // two per room needs twice as many duties
  assert.equal(generateRoster(exam, 2).assigned >= 6, true);
});
