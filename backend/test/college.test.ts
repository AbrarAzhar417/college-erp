import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { collegeRouter, bearerName, publicBearers, syncBearerLogins } from '../src/college/routes.js';
import { papersRouter } from '../src/papers/routes.js';
import { canMark } from '../src/attendance/service.js';
import { setTeacherOpen, teacherOpen } from '../src/policy.js';
import { sectionOf, classOf } from './helpers.js';

const call = (router: any, method: string, path: string, opts: { body?: any; params?: any; user?: any; query?: any } = {}) => new Promise<{ status: number; body: any }>(resolve => {
  const r = router.routes.find((x: any) => x.method === method && x.path === path);
  assert.ok(r, `${method} ${path}`);
  const req: any = { user: opts.user ?? { id: 1, name: 'P', role: 'principal' }, ip: '1.1.1.1', query: opts.query ?? {}, params: opts.params ?? {}, body: opts.body ?? {} };
  let status = 200;
  const res: any = { status(c: number) { status = c; return res; }, json(b: any) { resolve({ status, body: b }); return res; }, set() { return res; } };
  let i = 0;
  const next = () => { const h = r.h[i++]; if (h) h(req, res, next); };
  next();
});
const admin = { id: 2, name: 'A', role: 'admin' }, teacher = { id: 9, name: 'T', role: 'teacher', duties: [] }, acct = { id: 8, name: 'Ac', role: 'accountant' };

test('office-bearers: add, edit, delete, validation and who can do it', async () => {
  assert.equal((await call(collegeRouter, 'POST', '/bearers', { body: { post: 'nonsense', name: 'X' } })).status, 400);
  assert.equal((await call(collegeRouter, 'POST', '/bearers', { body: { post: 'other', name: 'Mr X' } })).status, 400, 'other needs a title');
  assert.equal((await call(collegeRouter, 'POST', '/bearers', { body: { post: 'principal', name: 'Mr Y', email: 'bad' } })).status, 400);
  assert.equal((await call(collegeRouter, 'POST', '/bearers', { body: { post: 'principal', name: 'Col. Ahmed' }, user: teacher })).status, 403);
  assert.equal((await call(collegeRouter, 'POST', '/bearers', { body: { post: 'principal', name: 'Col. Ahmed' }, user: acct })).status, 403);
  const a = await call(collegeRouter, 'POST', '/bearers', { body: { post: 'principal', name: 'Col. Ahmed', phone: '0300-1234567' }, user: admin });
  assert.equal(a.status, 201);
  const vp = await call(collegeRouter, 'POST', '/bearers', { body: { post: 'vice_principal', name: 'Mr Vice' } });
  await call(collegeRouter, 'POST', '/bearers', { body: { post: 'accounts_officer', name: 'Mr Accounts' } });
  await call(collegeRouter, 'POST', '/bearers', { body: { post: 'other', title: 'Librarian', name: 'Ms Book' } });
  assert.equal(bearerName('principal'), 'Col. Ahmed');
  const list = await call(collegeRouter, 'GET', '/bearers', { user: teacher });
  assert.deepEqual(list.body.items.map((x: any) => x.label), ['Principal', 'Vice Principal', 'Accounts Officer', 'Librarian']);
  assert.ok(!JSON.stringify(publicBearers()).includes('0300'), 'public list has no phone numbers');
  assert.equal((await call(collegeRouter, 'PUT', '/bearers/:id', { params: { id: a.body.id }, body: { post: 'principal', name: 'Col. Bilal' } })).status, 200);
  assert.equal(bearerName('principal'), 'Col. Bilal');
  assert.equal((await call(collegeRouter, 'DELETE', '/bearers/:id', { params: { id: vp.body.id }, user: teacher })).status, 403);
  assert.equal((await call(collegeRouter, 'DELETE', '/bearers/:id', { params: { id: vp.body.id }, user: admin })).status, 200);
  assert.equal(bearerName('vice_principal'), '');
  assert.equal((await call(collegeRouter, 'DELETE', '/bearers/:id', { params: { id: 99999 } })).status, 404);
});

test('open teaching switch: on by default, office can turn it off, teachers cannot', async () => {
  assert.equal(teacherOpen(), true);
  assert.equal((await call(collegeRouter, 'PUT', '/policy', { body: { teacherOpen: false }, user: teacher })).status, 403);
  const sec = sectionOf(6, 'A');
  assert.equal(canMark(teacher as any, sec), true, 'any teacher may take attendance while open');
  assert.equal(canMark(acct as any, sec), false);
  assert.equal((await call(collegeRouter, 'PUT', '/policy', { body: { teacherOpen: false }, user: admin })).body.teacherOpen, false);
  assert.equal(canMark(teacher as any, sec), false, 'back to own classes only');
  setTeacherOpen(true);
});

test('a teacher can start a paper of their own for any class and subject', async () => {
  db.prepare("INSERT OR IGNORE INTO users (id, name, username, password_hash, role) VALUES (9, 'T', 'tt9', 'x', 'teacher')").run();
  db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES ('Physics')").run();
  const subj = (db.prepare("SELECT id FROM subjects WHERE name = 'Physics'").get() as any).id, cls = classOf(7);
  const due = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  assert.equal((await call(papersRouter, 'POST', '/mine', { user: acct, body: { class_id: cls, subject_id: subj, title: 'Mine', due_date: due } })).status, 403);
  const ok = await call(papersRouter, 'POST', '/mine', { user: teacher, body: { class_id: cls, subject_id: subj, title: 'Mine', due_date: due } });
  assert.equal(ok.status, 201);
  const mine = await call(papersRouter, 'GET', '/', { user: teacher });
  assert.ok(mine.body.items.some((x: any) => x.title === 'Mine' && x.teacher_user_id === 9));
  assert.equal((await call(papersRouter, 'POST', '/mine', { user: teacher, body: { class_id: cls, subject_id: subj, title: 'Mine', due_date: due } })).status, 400, 'same class and subject twice');
  setTeacherOpen(false);
  assert.equal((await call(papersRouter, 'POST', '/mine', { user: teacher, body: { class_id: classOf(8), subject_id: subj, title: 'x', due_date: due } })).status, 403);
  setTeacherOpen(true);
});

test('changing the principal or director in the College Profile changes the name on their login (login page, headers)', async () => {
  db.prepare("INSERT OR IGNORE INTO users (name, username, password_hash, role) VALUES ('Old Director', 'dir.sync', 'h', 'director')").run();
  db.prepare("INSERT OR IGNORE INTO users (name, username, password_hash, role) VALUES ('Old Principal', 'pri.sync', 'h', 'principal')").run();
  const boss = { id: 1, name: 'B', role: 'director' };
  const r = await call(collegeRouter, 'POST', '/bearers', { user: boss, body: { post: 'principal', name: 'Prof. New Principal' } });
  assert.equal(r.status, 201);
  const first = db.prepare("SELECT name FROM users WHERE role = 'principal' ORDER BY id LIMIT 1").get() as any;
  assert.equal(first.name, bearerName('principal'));
  const d = db.prepare("INSERT INTO office_bearers (post, title, name, sort_order) VALUES ('director', 'Director', 'Dr. New Director', 1)").run();
  assert.ok(d.changes);
  assert.ok(syncBearerLogins() >= 1);
  assert.equal((db.prepare("SELECT name FROM users WHERE role = 'director' ORDER BY id LIMIT 1").get() as any).name, 'Dr. New Director');
  assert.equal(syncBearerLogins(), 0, 'nothing left to change');
});
