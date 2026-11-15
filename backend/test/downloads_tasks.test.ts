import './setup.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { addDays, todayISO } from '../src/attendance/service.js';
import { canChange, checkUpload, listFiles, MAX_FILE } from '../src/downloads/service.js';
import { addComment, createTask, editTask, listTasks, setStatus, summary, taskDetail, workload } from '../src/tasks/service.js';
import { classOf } from './helpers.js';

const U = (id: number, role: any) => ({ id, name: `u${id}`, username: `u${id}`, role });
let boss = 0, t1 = 0, t2 = 0, gone = 0;
before(() => {
  const mk = (n: string, role: string, active = 1) => Number(db.prepare('INSERT INTO users (name, username, password_hash, role, active) VALUES (?,?,?,?,?)').run(n, n, 'x', role, active).lastInsertRowid);
  boss = mk('tb', 'principal'); t1 = mk('tt1', 'teacher'); t2 = mk('tt2', 'teacher'); gone = mk('tgone', 'teacher', 0);
});
const pdf = Buffer.from('%PDF-1.4 hello'), png = Buffer.concat([Buffer.from('\x89PNG', 'latin1'), Buffer.alloc(8)]), zip = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(8)]);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

test('upload: who may upload what, and the file must really be what it says', () => {
  assert.match(checkUpload(pdf, 'application/pdf', { title: 'x' }, U(boss, 'principal')) as string, /category/);
  assert.match(checkUpload(pdf, 'application/pdf', { category: 'forms', title: 'x' }, U(t1, 'teacher')) as string, /notes only/);
  assert.match(checkUpload(pdf, 'application/pdf', { category: 'notes', title: 'x' }, U(99, 'accountant')) as string, /cannot upload/);
  assert.match(checkUpload(pdf, 'application/pdf', { category: 'notes', title: ' ' }, U(t1, 'teacher')) as string, /title/);
  assert.equal(typeof checkUpload(pdf, 'application/pdf', { category: 'notes', title: 'Ch 1 notes', class_id: classOf(7) }, U(t1, 'teacher')), 'object');
  assert.match(checkUpload(png, 'application/pdf', { category: 'forms', title: 'x' }, U(boss, 'principal')) as string, /does not match/);
  assert.match(checkUpload(Buffer.from('MZ evil'), 'application/octet-stream', { category: 'forms', title: 'x', name: 'virus.exe' }, U(boss, 'principal')) as string, /Upload a PDF/);
  assert.match(checkUpload(Buffer.alloc(0), 'application/pdf', { category: 'forms', title: 'x' }, U(boss, 'principal')) as string, /empty/);
  assert.match(checkUpload(Buffer.concat([pdf, Buffer.alloc(MAX_FILE)]), 'application/pdf', { category: 'forms', title: 'x' }, U(boss, 'principal')) as string, /6 MB/);
  assert.match(checkUpload(pdf, 'application/pdf', { category: 'forms', title: 'x', class_id: 99999 }, U(boss, 'principal')) as string, /class does not exist/);
  const w = checkUpload(zip, 'application/octet-stream', { category: 'forms', title: 'Form', name: 'my form.docx' }, U(boss, 'principal')) as any; assert.equal(w.mime, DOCX); assert.equal(w.name, 'my form.docx');
  assert.equal(checkUpload(pdf, 'application/pdf', { category: 'forms', title: 'x', name: '../../etc/passwd' }, U(boss, 'principal') as any) && (checkUpload(pdf, 'application/pdf', { category: 'forms', title: 'x', name: '../../etc/passwd' }, U(boss, 'principal')) as any).name.includes('/'), false);
});
test('list filters by category, class (plus files for every class) and text; only owner or office may change', () => {
  const ins = (title: string, cat: string, cls: number | null, by: number) => db.prepare('INSERT INTO dl_files (title,category,class_id,filename,mime,size,data,uploaded_by) VALUES (?,?,?,?,?,?,?,?)').run(title, cat, cls, 'f.pdf', 'application/pdf', 3, pdf, by);
  ins('Admission form', 'forms', null, boss); ins('Class 7 notes', 'notes', classOf(7), t1); ins('Class 8 notes', 'notes', classOf(8), t1);
  assert.equal(listFiles({ category: 'notes', class_id: classOf(7) }).length, 1);
  assert.equal(listFiles({ class_id: classOf(7) }).length, 2);   // class 7 notes + the form for everyone
  assert.equal((listFiles({ text: 'admission' }) as any[])[0].title, 'Admission form');
  assert.equal(canChange(U(t1, 'teacher'), { uploaded_by: t1 }), true); assert.equal(canChange(U(t2, 'teacher'), { uploaded_by: t1 }), false); assert.equal(canChange(U(boss, 'principal'), { uploaded_by: t1 }), true);
});

test('tasks: teachers create for themselves only, manager for anyone active, no past due dates', () => {
  assert.match(createTask({ title: '', assigned_to: t1 }, U(boss, 'principal')) as string, /what has to be done/);
  assert.match(createTask({ title: 'x', assigned_to: t2 }, U(t1, 'teacher')) as string, /only for yourself/);
  assert.match(createTask({ title: 'x', assigned_to: gone }, U(boss, 'principal')) as string, /staff member/);
  assert.match(createTask({ title: 'x', assigned_to: t1, due_date: addDays(todayISO(), -1) }, U(boss, 'principal')) as string, /past/);
  assert.match(createTask({ title: 'x', assigned_to: t1, due_date: 'zz' }, U(boss, 'principal')) as string, /not valid/);
  assert.equal(typeof createTask({ title: 'Own todo' }, U(t1, 'teacher')), 'object');
});
test('tasks: status flow, reopen and cancel only by the one who assigned, comments, visibility', () => {
  db.prepare('DELETE FROM tasks').run();
  const a = (createTask({ title: 'Submit lesson plans', assigned_to: t1, due_date: addDays(todayISO(), 2), priority: 'high' }, U(boss, 'principal')) as any).id;
  assert.deepEqual(setStatus(a, 'in_progress', U(t1, 'teacher')), { status: 'in_progress' });
  assert.match(setStatus(a, 'in_progress', U(t1, 'teacher')) as string, /already/); assert.match(setStatus(a, 'weird', U(t1, 'teacher')) as string, /Unknown/);
  assert.match(setStatus(a, 'cancelled', U(t1, 'teacher')) as string, /Only the person who assigned/);
  assert.deepEqual(setStatus(a, 'done', U(t1, 'teacher'), 'sent by email'), { status: 'done' });
  assert.ok((db.prepare('SELECT completed_at c FROM tasks WHERE id = ?').get(a) as any).c);
  assert.match(setStatus(a, 'open', U(t1, 'teacher')) as string, /Only the person who assigned/);
  assert.deepEqual(setStatus(a, 'open', U(boss, 'principal')), { status: 'open' }); assert.equal((db.prepare('SELECT completed_at c FROM tasks WHERE id = ?').get(a) as any).c, null);
  assert.match(addComment(a, ' ', U(t1, 'teacher')) as string, /comment/); assert.deepEqual(addComment(a, 'Need one more day', U(t1, 'teacher')), { ok: true });
  assert.match(addComment(a, 'peek', U(t2, 'teacher')) as string, /not found/); assert.equal(taskDetail(a, U(t2, 'teacher')), null);
  const d = taskDetail(a, U(t1, 'teacher'))!; assert.equal(d.events.length, 5); assert.equal(d.can_edit, false); assert.equal(taskDetail(a, U(boss, 'principal'))!.can_edit, true);
  assert.match(editTask(a, { title: 'x' }, U(t1, 'teacher')) as string, /Only the person who assigned/);
  assert.deepEqual(editTask(a, { assigned_to: t2 }, U(boss, 'principal')), { ok: true }); assert.equal(listTasks(U(t2, 'teacher'), 'mine').length, 1); assert.equal(listTasks(U(t1, 'teacher'), 'mine').length, 0);
});
test('tasks: lists, overdue, summary and workload', () => {
  db.prepare('DELETE FROM tasks').run();
  const mk = (t: string, to: number, due: string | null) => (createTask({ title: t, assigned_to: to, due_date: due }, U(boss, 'principal')) as any).id as number;
  const late = mk('Late one', t1, todayISO()); mk('Later', t1, addDays(todayISO(), 5)); mk('No date', t1, null);
  db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(addDays(todayISO(), -3), late);
  const mine = listTasks(U(t1, 'teacher'), 'mine', 'active'); assert.equal(mine[0].title, 'Late one'); assert.equal(mine[0].overdue, true); assert.equal(mine[mine.length - 1].title, 'No date');
  assert.deepEqual(summary(U(t1, 'teacher')), { open: 3, overdue: 1, dueToday: 0, done: 0 });
  assert.equal(listTasks(U(boss, 'principal'), 'assigned').length, 3); assert.equal(listTasks(U(t1, 'teacher'), 'all').length, 3);   // a teacher asking for "all" only gets their own
  assert.equal(listTasks(U(t2, 'teacher'), 'all').length, 0); assert.equal(listTasks(U(boss, 'principal'), 'all').length, 3);
  const w = workload().find((x: any) => x.id === t1)!; assert.equal(w.open, 3); assert.equal(w.overdue, 1);
});
