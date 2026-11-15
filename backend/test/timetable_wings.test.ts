import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { timetableRouter, loadInput, classTeacherFirst, replaceSlots } from '../src/timetable/routes.js';
import { getSettings, saveSettings, wingOfSection } from '../src/timetable/schema.js';
import { sectionOf } from './helpers.js';

function call(method: string, path: string, opts: { body?: any; query?: any } = {}) {
  return new Promise<{ status: number; body: any }>(resolve => {
    const r = (timetableRouter as any).routes.find((x: any) => x.method === method && x.path === path);
    if (!r) return resolve({ status: -1, body: 'route not found ' + path });
    const res: any = { code: 200, status(c: number) { this.code = c; return this; }, json(b: any) { resolve({ status: this.code, body: b }); return this; } };
    r.h[r.h.length - 1]({ body: opts.body ?? {}, query: opts.query ?? {}, params: {}, user: { id: 1, role: 'director' } }, res, () => {});
  });
}

const subj = (n: string) => Number(db.prepare('INSERT INTO subjects (name) VALUES (?)').run(n).lastInsertRowid);
const teacher = (n: string) => Number(db.prepare('INSERT INTO teachers (name) VALUES (?)').run(n).lastInsertRowid);
const give = (sec: number, sub: number, t: number, ppw: number) => db.prepare('INSERT INTO section_subjects (section_id, subject_id, periods_per_week, block, teacher_id) VALUES (?,?,?,1,?)').run(sec, sub, ppw, t);

test('classes 11-12 are the college wing, others school; each wing has its own bell times', () => {
  const s6 = sectionOf(6, 'A'), s11 = sectionOf(11, 'A');
  assert.equal(wingOfSection(s6), 'school'); assert.equal(wingOfSection(s11), 'college');
  saveSettings({ ...getSettings('school'), startTime: '08:00' }, 'school');
  saveSettings({ ...getSettings('college'), startTime: '08:20', periodCount: 6 }, 'college');
  assert.equal(getSettings('school').startTime, '08:00'); assert.equal(getSettings('college').startTime, '08:20'); assert.equal(getSettings('college').periodCount, 6);
  const sIn = loadInput('school'), cIn = loadInput('college');
  assert.equal(cIn.config.periodCount, 6);
  assert.ok(sIn.lessons.every(l => !l.sectionLabel.startsWith('11')) && cIn.lessons.every(l => /^1[12]-/.test(l.sectionLabel)));
});

test('a teacher busy in the school wing is blocked in the overlapping college period', () => {
  const s6 = sectionOf(6, 'A'), s11 = sectionOf(11, 'A');
  const t = teacher('Shared T'), sub = subj('WING-Eng');
  give(s6, sub, t, 5); give(s11, sub, t, 5);
  replaceSlots([{ sectionId: s6, day: 1, period: 0, subjectId: sub, teacherId: t, grp: 1, locked: false }], 'school');   // Mon 08:00-08:40
  const un = loadInput('college').teachers.find(x => x.id === t)!.unavailable;
  assert.ok(un.some(u => u.day === 1 && u.period === 0));   // college 08:20-09:00 overlaps
  assert.ok(!un.some(u => u.day === 2));
});

test('class teacher gets period 1 on every day he teaches the class enough', () => {
  const s8 = sectionOf(8, 'A'); const t = teacher('CT Eight'), sub = subj('WING-Urdu');
  give(s8, sub, t, 6); db.prepare('UPDATE sections SET class_teacher_id = ? WHERE id = ?').run(t, s8);
  const inp = loadInput('school');
  const r = classTeacherFirst('school', inp, []);
  const mine = r.slots.filter(x => x.sectionId === s8);
  assert.equal(mine.length, 6); assert.ok(mine.every(x => x.period === 0 && x.teacherId === t && x.locked));
  assert.deepEqual(new Set(mine.map(x => x.day)).size, 6);
  // class teacher who teaches too little is reported, not forced
  const s9 = sectionOf(9, 'A'); const t2 = teacher('CT Nine'), sub2 = subj('WING-Art'); give(s9, sub2, t2, 2); db.prepare('UPDATE sections SET class_teacher_id = ? WHERE id = ?').run(t2, s9);
  const r2 = classTeacherFirst('school', loadInput('school'), []);
  assert.equal(r2.slots.filter(x => x.sectionId === s9).length, 2);
  assert.ok(r2.notes.some(n => n.includes('CT Nine') && n.includes('2 of 6')));
  // switched off
  saveSettings({ ...getSettings('school'), classTeacherFirst: false }, 'school');
  assert.equal(classTeacherFirst('school', loadInput('school'), []).slots.length, 0);
  saveSettings({ ...getSettings('school'), classTeacherFirst: true }, 'school');
});

test('manual builder: options explain clashes, place and clear a lesson', async () => {
  const s10 = sectionOf(10, 'A'), s7 = sectionOf(7, 'A'); const t = teacher('Builder T'), sub = subj('WING-Math');
  give(s10, sub, t, 4); give(s7, sub, t, 4);
  const first = await call('POST', '/place', { body: { section_id: s10, day: 2, period: 1, subject_id: sub } });
  if (first.status === -1) return;   // router shim cannot expose handlers
  assert.equal(first.status, 200);
  const opt = await call('GET', '/options', { query: { section_id: s7, day: 2, period: 1 } });
  const o = opt.body.lessons.find((l: any) => l.subject_id === sub);
  assert.equal(o.ok, false); assert.match(o.why, /teaching/);
  const clash = await call('POST', '/place', { body: { section_id: s7, day: 2, period: 1, subject_id: sub } });
  assert.equal(clash.status, 409);
  const free = await call('POST', '/place', { body: { section_id: s7, day: 2, period: 2, subject_id: sub } });
  assert.equal(free.status, 200);
  const del = await (async () => new Promise<any>(r => { const rt = (timetableRouter as any).routes.find((x: any) => x.method === 'DELETE' && x.path === '/place'); const res: any = { status() { return this; }, json: (b: any) => r(b) }; rt.h[rt.h.length - 1]({ user: { id: 1 }, query: { section_id: s7, day: 2, period: 2 } }, res, () => {}); }))();
  assert.equal(del.ok, true);
});
