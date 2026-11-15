import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { disciplineRouter, summary } from '../src/discipline/routes.js';
import { addStudent } from './helpers.js';

const call = (method: string, path: string, opts: { body?: any; params?: any; user?: any; query?: any } = {}) => new Promise<{ status: number; body: any }>(resolve => {
  const r = (disciplineRouter as any).routes.find((x: any) => x.method === method && x.path === path);
  assert.ok(r, `${method} ${path}`);
  const req: any = { user: opts.user ?? { id: 1, name: 'Principal', role: 'principal' }, ip: '1.1.1.1', query: opts.query ?? {}, params: opts.params ?? {}, body: opts.body ?? {} };
  let status = 200;
  const res: any = { status(c: number) { status = c; return res; }, json(b: any) { resolve({ status, body: b }); return res; }, set() { return res; } };
  let i = 0; const next = () => { const h = r.h[i++]; if (h) h(req, res, next); }; next();
});
const teacher = { id: 9, name: 'T', role: 'teacher' }, admin = { id: 2, name: 'A', role: 'admin' };

test('a letter can be issued for any record, is numbered, kept, and counted on the student', async () => {
  const st = addStudent({ name: 'Letter Boy' });
  const rec = Number(db.prepare("INSERT INTO disc_records (student_id, date, kind, category, text, status, by_user, by_name) VALUES (?, '2026-11-10', 'warning', 'Uniform', 'No tie for three days', 'closed', 1, 'P')").run(st).lastInsertRowid);
  const d = (await call('GET', '/records/:id/draft', { params: { id: String(rec) } })).body;
  assert.equal(d.type, 'warning'); assert.match(d.body, /Letter Boy/); assert.match(d.body, /No tie/);
  const a = await call('POST', '/records/:id/letters', { params: { id: String(rec) }, user: admin, body: { type: d.type, subject: d.subject, body: d.body, issued_on: '2026-11-11' } });
  assert.equal(a.status, 201);
  const b = await call('POST', '/records/:id/letters', { params: { id: String(rec) }, body: { type: 'general', subject: 'Second', body: 'Please note.', issued_on: '2026-11-12' } });
  const list = (await call('GET', '/letters/student/:sid', { params: { sid: String(st) } })).body;
  assert.equal(list.total, 2); assert.deepEqual({ ...list.byType }, { warning: 1, general: 1 });
  const one = (await call('GET', '/letters/:id', { params: { id: String(a.body.id) } })).body;
  assert.match(one.ref_no, /\/DIS\/2026\/\d{3}$/); assert.equal(one.student.name, 'Letter Boy'); assert.notEqual(one.ref_no, (await call('GET', '/letters/:id', { params: { id: String(b.body.id) } })).body.ref_no);
  assert.equal(summary(st).letters, 2);
});

test('letter rules: office only, subject and text required, teachers cannot delete, kept if the record goes', async () => {
  const st = addStudent();
  const rec = Number(db.prepare("INSERT INTO disc_records (student_id, date, kind, text, status, by_user, by_name) VALUES (?, '2026-11-10', 'praise', 'Top of class', 'closed', 1, 'P')").run(st).lastInsertRowid);
  assert.equal((await call('POST', '/records/:id/letters', { params: { id: String(rec) }, user: teacher, body: { subject: 's', body: 'b' } })).status, 403);
  assert.equal((await call('POST', '/records/:id/letters', { params: { id: String(rec) }, body: { subject: '', body: 'b' } })).status, 400);
  assert.equal((await call('POST', '/records/:id/letters', { params: { id: String(rec) }, body: { subject: 's', body: '' } })).status, 400);
  const id = (await call('POST', '/records/:id/letters', { params: { id: String(rec) }, body: { subject: 'Well done', body: 'Good.' } })).body.id;
  assert.equal((await call('GET', '/records/:id/draft', { params: { id: String(rec) } })).body.type, 'appreciation');
  db.prepare('DELETE FROM disc_records WHERE id = ?').run(rec);
  assert.equal((await call('GET', '/letters/student/:sid', { params: { sid: String(st) } })).body.total, 1, 'the letter outlives the record');
  assert.equal((await call('DELETE', '/letters/:id', { params: { id: String(id) }, user: teacher })).status, 403);
  assert.equal((await call('DELETE', '/letters/:id', { params: { id: String(id) } })).status, 200);
});
