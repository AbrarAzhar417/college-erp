import './setup.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { addDays, todayISO } from '../src/attendance/service.js';
import { canChangeEntry, canNoteStudent, canPost, checkClassEntry, checkNote, checkTeacherEntry, classEntries, missingOn, postingScope, teacherEntries } from '../src/diary/service.js';
import { addStudent, sectionOf } from './helpers.js';
import '../src/diary/service.js';

const U = (id: number, role: any) => ({ id, name: `u${id}`, username: `u${id}`, role });
let ctUser = 0, mathUser = 0, strangerUser = 0, officeUser = 0, math = 0, urdu = 0, sec7A = 0, sec7B = 0, pupil = 0;
before(() => {
  const mk = (n: string, role: string) => Number(db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,?)').run(n, n, 'x', role).lastInsertRowid);
  ctUser = mk('ct', 'teacher'); mathUser = mk('mt', 'teacher'); strangerUser = mk('st', 'teacher'); officeUser = mk('of', 'admin');
  const tch = (n: string, uid: number) => Number(db.prepare('INSERT INTO teachers (name, user_id) VALUES (?,?)').run(n, uid).lastInsertRowid);
  const tCt = tch('Class T', ctUser), tMath = tch('Math T', mathUser); tch('Stranger', strangerUser);
  math = Number(db.prepare("INSERT INTO subjects (name) VALUES ('D-Math')").run().lastInsertRowid); urdu = Number(db.prepare("INSERT INTO subjects (name) VALUES ('D-Urdu')").run().lastInsertRowid);
  sec7A = sectionOf(7, 'A'); sec7B = sectionOf(7, 'B');
  db.prepare('UPDATE sections SET class_teacher_id = ? WHERE id = ?').run(tCt, sec7A);
  db.prepare('INSERT INTO tt_slots (section_id, day, period, subject_id, teacher_id, grp) VALUES (?,?,?,?,?,?)').run(sec7A, 1, 1, math, tMath, 1);
  pupil = addStudent({ section: sec7A });
});
const today = todayISO();
const entry = (o: any = {}) => ({ date: today, section_id: sec7A, subject_id: math, kind: 'homework', title: 'Ex 4.1', ...o });

test('posting scope: a subject teacher gets only their subject, the class teacher everything, a stranger nothing, the office all', () => {
  const m = postingScope(U(mathUser, 'teacher')); assert.deepEqual(m.map(s => s.id), [sec7A]); assert.deepEqual(m[0].subjects.map(x => x.id), [math]); assert.equal(m[0].class_teacher, false);
  const c = postingScope(U(ctUser, 'teacher')); assert.deepEqual(c.map(s => s.id), [sec7A]); assert.equal(c[0].class_teacher, true); assert.ok(c[0].subjects.length >= 2);
  assert.deepEqual(postingScope(U(strangerUser, 'teacher')), []);
  assert.ok(postingScope(U(officeUser, 'admin')).length > 2);
});
test('class entry: who may post what', () => {
  assert.equal(typeof checkClassEntry(entry(), U(mathUser, 'teacher')), 'object');
  assert.match(checkClassEntry(entry({ subject_id: urdu }), U(mathUser, 'teacher')) as string, /do not teach/);
  assert.match(checkClassEntry(entry({ section_id: sec7B }), U(mathUser, 'teacher')) as string, /do not teach/);
  assert.match(checkClassEntry(entry({ subject_id: null, kind: 'notice' }), U(mathUser, 'teacher')) as string, /Only the class teacher/);
  assert.equal(typeof checkClassEntry(entry({ subject_id: null, kind: 'notice' }), U(ctUser, 'teacher')), 'object');
  assert.equal(typeof checkClassEntry(entry({ subject_id: urdu }), U(ctUser, 'teacher')), 'object');
  assert.equal(typeof checkClassEntry(entry({ subject_id: urdu, section_id: sec7B }), U(officeUser, 'admin')), 'object');
  assert.equal(canPost(U(strangerUser, 'teacher'), sec7A, math), false);
});
test('class entry: dates, kind, title and due date are checked', () => {
  const u = U(mathUser, 'teacher');
  assert.match(checkClassEntry(entry({ date: '' }), u) as string, /date/); assert.match(checkClassEntry(entry({ date: addDays(today, 30) }), u) as string, /too far/);
  assert.match(checkClassEntry(entry({ date: addDays(today, -20) }), u) as string, /last 7 days/); assert.equal(typeof checkClassEntry(entry({ date: addDays(today, -20) }), U(officeUser, 'admin')), 'object');
  assert.equal(typeof checkClassEntry(entry({ date: addDays(today, 1) }), u), 'object');   // homework for tomorrow is fine
  assert.match(checkClassEntry(entry({ kind: 'gossip' }), u) as string, /Choose homework/); assert.match(checkClassEntry(entry({ title: '  ' }), u) as string, /title/);
  assert.match(checkClassEntry(entry({ due_date: addDays(today, -1) }), u) as string, /before/); assert.match(checkClassEntry(entry({ due_date: 'soon' }), u) as string, /not valid/);
  const ok = checkClassEntry(entry({ title: 'x'.repeat(500), body: 'y'.repeat(5000), due_date: addDays(today, 2) }), u) as any; assert.equal(ok.title.length, 120); assert.equal(ok.body.length, 2000);
  assert.match(checkClassEntry(entry({ section_id: 999999 }), U(officeUser, 'admin')) as string, /class and section/); assert.match(checkClassEntry(entry({ subject_id: 999999 }), U(officeUser, 'admin')) as string, /subject/);
});
test('editing rights: own recent entries for teachers, anything for the office', () => {
  assert.equal(canChangeEntry(U(mathUser, 'teacher'), mathUser, today), true);
  assert.equal(canChangeEntry(U(mathUser, 'teacher'), ctUser, today), false);
  assert.equal(canChangeEntry(U(mathUser, 'teacher'), mathUser, addDays(today, -10)), false);
  assert.equal(canChangeEntry(U(officeUser, 'admin'), mathUser, addDays(today, -100)), true);
});
test('listing a section shows subject, poster and edit flag', () => {
  const v = checkClassEntry(entry(), U(mathUser, 'teacher')) as any;
  db.prepare('INSERT INTO diary_entries (date, section_id, subject_id, kind, title, body, due_date, created_by) VALUES (?,?,?,?,?,?,?,?)').run(v.date, v.section_id, v.subject_id, v.kind, v.title, v.body, v.due_date, mathUser);
  const rows = classEntries(sec7A, addDays(today, -1), addDays(today, 1), U(mathUser, 'teacher'));
  assert.equal(rows.length, 1); assert.equal(rows[0].subject, 'D-Math'); assert.equal(rows[0].posted_by, 'mt'); assert.equal(rows[0].can_edit, true);
  assert.equal(classEntries(sec7A, addDays(today, -1), addDays(today, 1), U(ctUser, 'teacher'))[0].can_edit, false);
  assert.equal(classEntries(sec7B, addDays(today, -1), addDays(today, 1), U(ctUser, 'teacher')).length, 0);
});

test('teacher diary: not for the future, own lines only, reviewers see all', () => {
  assert.match(checkTeacherEntry({ date: addDays(today, 1), topic: 'x' }) as string, /future/); assert.match(checkTeacherEntry({ date: today, topic: '' }) as string, /what was taught/);
  const v = checkTeacherEntry({ date: today, section_id: sec7A, subject_id: math, topic: 'Fractions', plan_next: 'Decimals' }) as any;
  for (const uid of [mathUser, ctUser]) db.prepare('INSERT INTO teacher_diary (user_id, date, section_id, subject_id, topic, plan_next, remarks) VALUES (?,?,?,?,?,?,?)').run(uid, v.date, v.section_id, v.subject_id, v.topic, v.plan_next, v.remarks);
  assert.equal(teacherEntries(U(mathUser, 'teacher'), today, today).length, 1);
  assert.equal(teacherEntries(U(mathUser, 'teacher'), today, today, ctUser).length, 1);   // asking for somebody else's still returns only their own
  assert.equal(teacherEntries(U(mathUser, 'teacher'), today, today)[0].user_id, mathUser);
  assert.equal(teacherEntries(U(officeUser, 'principal'), today, today).length, 2);
  assert.equal(teacherEntries(U(officeUser, 'principal'), today, today, ctUser).length, 1);
});
test('student notes: kinds, dates and who may write', () => {
  assert.match(checkNote({ date: addDays(today, 1), kind: 'praise', note: 'x' }) as string, /earlier/); assert.match(checkNote({ date: today, kind: 'x', note: 'x' }) as string, /kind/); assert.match(checkNote({ date: today, kind: 'praise', note: ' ' }) as string, /Write/);
  assert.equal(typeof checkNote({ date: today, kind: 'late', note: 'Came 20 minutes late' }), 'object');
  assert.equal(canNoteStudent(U(mathUser, 'teacher'), pupil), true); assert.equal(canNoteStudent(U(ctUser, 'teacher'), pupil), true);
  assert.equal(canNoteStudent(U(strangerUser, 'teacher'), pupil), false); assert.equal(canNoteStudent(U(officeUser, 'admin'), pupil), true);
});
test('missing report: a section with lessons but no diary, a teacher with lessons but no line', () => {
  const monday = (() => { let d = addDays(today, 1); while ((new Date(`${d}T00:00:00Z`).getUTCDay() || 7) !== 1) d = addDays(d, 1); return d; })();
  const r = missingOn(monday);
  assert.ok(r.sections.some((s: any) => s.id === sec7A)); assert.ok(r.teachers.some((t: any) => t.name === 'Math T'));
  const sunday = addDays(monday, 6); const s2 = missingOn(sunday); assert.equal(s2.sections.length, 0); assert.equal(s2.teachers.length, 0);   // no lessons that day
});
