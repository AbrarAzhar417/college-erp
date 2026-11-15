import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { db } from '../src/db.js';
import { facultyRouter, RANKS } from '../src/faculty/routes.js';
import { sectionOf } from './helpers.js';

const call = (method: string, path: string, opts: { body?: any; params?: any; user?: any; query?: any } = {}) => new Promise<{ status: number; body: any }>(resolve => {
  const r = (facultyRouter as any).routes.find((x: any) => x.method === method && x.path === path);
  assert.ok(r, `${method} ${path}`);
  const req: any = { user: opts.user ?? { id: 1, name: 'P', role: 'principal' }, ip: '1.1.1.1', query: opts.query ?? {}, params: opts.params ?? {}, body: opts.body ?? {} };
  let status = 200;
  const res: any = { status(c: number) { status = c; return res; }, json(b: any) { resolve({ status, body: b }); return res; }, set() { return res; } };
  let i = 0;
  const next = () => { const h = r.h[i++]; if (h) h(req, res, next); };
  next();
});
const admin = { id: 2, name: 'A', role: 'admin' }, teacher = { id: 9, name: 'T', role: 'teacher', duties: [] };

test('ranks run from Educator to Professor', () => {
  assert.equal(RANKS[0].label, 'Educator');
  assert.equal(RANKS[RANKS.length - 1].label, 'Professor');
  assert.ok(RANKS.some(r => r.label === 'Subject Specialist'));
});

test('add a teacher with rank, subjects and a login; teachers cannot use this page', async () => {
  db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES ('Physics')").run();
  const phy = (db.prepare("SELECT id FROM subjects WHERE name = 'Physics'").get() as any).id;
  assert.equal((await call('GET', '/', { user: teacher })).status, 403);
  assert.equal((await call('POST', '/', { body: { name: 'X' } , user: teacher })).status, 403);
  assert.equal((await call('POST', '/', { body: { name: '' } })).status, 400);
  assert.equal((await call('POST', '/', { body: { name: 'Mr Ali', rank: 'king' } })).status, 400);
  assert.equal((await call('POST', '/', { body: { name: 'Mr Ali', email: 'nope' } })).status, 400);
  assert.equal((await call('POST', '/', { body: { name: 'Mr Ali', login: { username: 'a b', password: 'password1' } } })).status, 400);
  assert.equal((await call('POST', '/', { body: { name: 'Mr Ali', login: { username: 'ali.k', password: 'short' } } })).status, 400);
  const r = await call('POST', '/', { user: admin, body: { name: 'Mr Ali', rank: 'subject_specialist', phone: '0300-1112223', qualification: 'M.Sc Physics', subjects: [phy], login: { username: 'Ali.K', password: 'password1' } } });
  assert.equal(r.status, 201);
  const list = (await call('GET', '/')).body;
  const t = list.items.find((x: any) => x.id === r.body.id);
  assert.equal(t.rank_label, 'Subject Specialist'); assert.equal(t.username, 'ali.k'); assert.deepEqual(t.subjects.map((s: any) => s.name), ['Physics']); assert.equal(t.login_active, true);
  const u = db.prepare('SELECT password_hash, role FROM users WHERE id = ?').get(t.user_id) as any;
  assert.equal(u.role, 'teacher'); assert.ok(bcrypt.compareSync('password1', u.password_hash));
  assert.equal((await call('POST', '/', { body: { name: 'Other', login: { username: 'ali.k', password: 'password1' } } })).status, 409, 'username taken');
});

test('edit every detail; the login name and the HR record follow', async () => {
  const id = (db.prepare("SELECT id FROM teachers WHERE name = 'Mr Ali'").get() as any).id;
  db.prepare("INSERT INTO hr_staff (emp_no, name, staff_type, kind, teacher_id) VALUES ('E-T1', 'Mr Ali', 'teacher', 'teaching', ?)").run(id);
  const r = await call('PUT', '/:id', { params: { id }, body: { name: 'Prof. Ali Khan', rank: 'professor', phone: '0311-0000000', cnic: '35202-1234567-1', qualification: 'PhD', joining_date: '2020-08-01', gender: 'male', subjects: [] } });
  assert.equal(r.status, 200);
  const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id) as any;
  assert.equal(t.rank, 'professor'); assert.equal(t.cnic, '35202-1234567-1');
  assert.equal((db.prepare('SELECT name FROM users WHERE id = ?').get(t.user_id) as any).name, 'Prof. Ali Khan');
  const h = db.prepare('SELECT name, designation, phone, cnic FROM hr_staff WHERE teacher_id = ?').get(id) as any;
  assert.deepEqual({ ...h }, { name: 'Prof. Ali Khan', designation: 'Professor', phone: '0311-0000000', cnic: '35202-1234567-1' });
  assert.equal((await call('PUT', '/:id', { params: { id }, body: { name: 'Prof. Ali Khan', cnic: '123' } })).status, 400);
  assert.equal((await call('PUT', '/:id', { params: { id: 99999 }, body: { name: 'Nobody' } })).status, 404);
  assert.equal((await call('GET', '/summary')).body.byRank.find((x: any) => x.key === 'professor').count, 1);
});

test('login: reset password, rename, switch off and on; create for a teacher without one', async () => {
  const id = (db.prepare("SELECT id FROM teachers WHERE name = 'Prof. Ali Khan'").get() as any).id;
  assert.equal((await call('POST', '/:id/login', { params: { id }, body: { password: 'tiny' } })).status, 400);
  assert.equal((await call('POST', '/:id/login', { params: { id }, body: { password: 'brandnew99' } })).status, 200);
  const uid = (db.prepare('SELECT user_id FROM teachers WHERE id = ?').get(id) as any).user_id;
  assert.ok(bcrypt.compareSync('brandnew99', (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid) as any).password_hash));
  assert.equal((await call('POST', '/:id/login', { params: { id }, body: { username: 'prof.ali' } })).body.username, 'prof.ali');
  await call('POST', '/:id/login', { params: { id }, body: { active: false } });
  assert.equal((db.prepare('SELECT active FROM users WHERE id = ?').get(uid) as any).active, 0);
  await call('POST', '/:id/login', { params: { id }, body: { active: true } });
  assert.equal((db.prepare('SELECT active FROM users WHERE id = ?').get(uid) as any).active, 1);
  const n = await call('POST', '/', { body: { name: 'Ms Sara', rank: 'educator' } });
  assert.equal((await call('POST', '/:id/login', { params: { id: n.body.id }, body: { username: 'sara' } })).status, 400, 'a new login needs a password');
  assert.equal((await call('POST', '/:id/login', { params: { id: n.body.id }, body: { username: 'sara', password: 'sarapass1' } })).status, 201);
  assert.equal((await call('POST', '/:id/login', { params: { id: n.body.id }, body: { username: 'prof.ali', password: 'sarapass1' } })).status, 409, 'cannot take a name that is already used');
});

test('remove a teacher: warns about lessons, force frees them and closes the login', async () => {
  const id = (db.prepare("SELECT id FROM teachers WHERE name = 'Prof. Ali Khan'").get() as any).id;
  const sec = sectionOf(6, 'A');
  db.prepare('UPDATE sections SET class_teacher_id = ? WHERE id = ?').run(id, sec);
  const r = await call('DELETE', '/:id', { params: { id } });
  assert.equal(r.status, 409); assert.equal(r.body.needsForce, true); assert.equal(r.body.classes, 1);
  assert.equal((await call('DELETE', '/:id', { params: { id }, query: { force: '1' } })).status, 200);
  assert.equal((db.prepare('SELECT class_teacher_id FROM sections WHERE id = ?').get(sec) as any).class_teacher_id, null);
  const t = db.prepare('SELECT active, user_id FROM teachers WHERE id = ?').get(id) as any;
  assert.equal(t.active, 0); assert.equal((db.prepare('SELECT active FROM users WHERE id = ?').get(t.user_id) as any).active, 0);
  assert.ok(!(await call('GET', '/')).body.items.some((x: any) => x.id === id));
});
