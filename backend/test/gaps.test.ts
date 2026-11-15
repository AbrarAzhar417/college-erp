import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db, passwordChanged } from '../src/db.js';
import { requireAuth, signToken } from '../src/auth.js';
import { frontdeskRouter } from '../src/frontdesk/routes.js';
import { ptmRouter } from '../src/ptm/routes.js';
import { addStudent } from './helpers.js';

const call = (router: any, method: string, path: string, opts: { body?: any; params?: any; user?: any } = {}) => new Promise<{ status: number; body: any }>(resolve => {
  const r = router.routes.find((x: any) => x.method === method && x.path === path);
  assert.ok(r, `${method} ${path}`);
  const req: any = { user: opts.user ?? { id: 1, name: 'P', role: 'principal' }, ip: '1.1.1.1', query: {}, params: opts.params ?? {}, body: opts.body ?? {} };
  let status = 200;
  const res: any = { status(c: number) { status = c; return res; }, json(b: any) { resolve({ status, body: b }); return res; }, set() { return res; } };
  let i = 0; const next = () => { const h = r.h[i++]; if (h) h(req, res, next); }; next();
});
const principal = { id: 1, name: 'P', role: 'principal' }, admin = { id: 2, name: 'A', role: 'admin' };

test('gate pass: a waiting pass can be changed, an approved one cannot, only principal or director deletes', async () => {
  const st = addStudent();
  const id = Number(db.prepare("INSERT INTO fd_gate_passes (student_id, date, reason, taken_by, relation) VALUES (?, '2026-11-14', 'Fever', 'Father', 'Father')").run(st).lastInsertRowid);
  assert.equal((await call(frontdeskRouter, 'PUT', '/passes/:id', { params: { id: String(id) }, user: admin, body: { date: '2026-11-14', reason: 'Dentist', taken_by: 'Uncle', relation: 'Uncle' } })).status, 200);
  assert.equal((db.prepare('SELECT reason FROM fd_gate_passes WHERE id = ?').get(id) as any).reason, 'Dentist');
  db.prepare("UPDATE fd_gate_passes SET status = 'approved' WHERE id = ?").run(id);
  assert.equal((await call(frontdeskRouter, 'PUT', '/passes/:id', { params: { id: String(id) }, user: admin, body: { date: '2026-11-14', reason: 'x', taken_by: 'y' } })).status, 400);
  assert.equal((await call(frontdeskRouter, 'DELETE', '/passes/:id', { params: { id: String(id) }, user: { id: 5, name: 'T', role: 'teacher' } })).status, 403);
  assert.equal((await call(frontdeskRouter, 'DELETE', '/passes/:id', { params: { id: String(id) }, user: principal })).status, 200);
  assert.equal(db.prepare('SELECT 1 FROM fd_gate_passes WHERE id = ?').get(id), undefined);
});

test('PTM: title, date and venue can be changed and are validated', async () => {
  const m = Number(db.prepare("INSERT INTO ptm_meetings (title, date, start_time, att_from, att_to) VALUES ('Old', '2026-11-20', '09:00', '2026-08', '2026-11')").run().lastInsertRowid);
  assert.equal((await call(ptmRouter, 'PUT', '/:id', { params: { id: String(m) }, body: { title: '', date: '2026-11-21' } })).status, 400);
  assert.equal((await call(ptmRouter, 'PUT', '/:id', { params: { id: String(m) }, body: { title: 'New', date: 'soon' } })).status, 400);
  assert.equal((await call(ptmRouter, 'PUT', '/:id', { params: { id: String(m) }, body: { title: 'New', date: '2026-11-21', venue: 'Hall' } })).status, 200);
  const r = db.prepare('SELECT title, date, venue FROM ptm_meetings WHERE id = ?').get(m) as any;
  assert.deepEqual({ ...r }, { title: 'New', date: '2026-11-21', venue: 'Hall' });
});

test('a password reset ends sessions opened before it', () => {
  const uid = Number(db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES ('S', 'sess.user', 'h', 'teacher')").run().lastInsertRowid);
  // use the app's own signer so the secret matches
  const fresh = signToken({ id: uid, name: 'S', username: 'sess.user', role: 'teacher' } as any);
  const run = (tok: string) => { let code = 0; const res: any = { status(c: number) { code = c; return res; }, json() { return res; } }; let ok = false; requireAuth({ headers: { authorization: `Bearer ${tok}` } } as any, res, () => { ok = true; }); return ok ? 200 : code; };
  assert.equal(run(fresh), 200);
  passwordChanged(uid);
  assert.equal(run(fresh), 401, 'the old token no longer works');
});
