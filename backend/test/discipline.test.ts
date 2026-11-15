import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { addStudent, sectionOf } from './helpers.js';
import { disciplineRouter } from '../src/discipline/routes.js';
import { setSender } from '../src/parentmsg/service.js';
import { todaySummary } from '../src/today/routes.js';

const call = (method: string, path: string, opts: { body?: any; query?: any; params?: any; user?: any } = {}) => new Promise<{ status: number; body: any }>(resolve => {
  const r = (disciplineRouter as any).routes.find((x: any) => x.method === method && x.path === path);
  if (!r) return resolve({ status: -1, body: 'route not found ' + path });
  const res: any = { code: 200, status(c: number) { this.code = c; return this; }, json(b: any) { resolve({ status: this.code, body: b }); return this; } };
  const req = { body: opts.body ?? {}, query: opts.query ?? {}, params: opts.params ?? {}, ip: '1.1.1.1', user: opts.user ?? { id: 1, name: 'Principal', role: 'principal' } };
  // run every handler in order so role guards apply
  const run = (i: number) => r.h[i](req, res, () => run(i + 1));
  run(0);
});
const teacher = { id: 77, name: 'Sir Ali', role: 'teacher', duties: [] };

test('teacher can only add notes and praise, and sees only his own', async () => {
  const sid = addStudent({ name: 'Naughty', section: sectionOf(6, 'A') });
  assert.equal((await call('POST', '/', { user: teacher, body: { student_id: sid, kind: 'warning', text: 'x' } })).status, 403);
  assert.equal((await call('POST', '/', { user: teacher, body: { student_id: sid, kind: 'note', text: 'Talks in class' } })).status, 201);
  await call('POST', '/', { body: { student_id: sid, kind: 'warning', text: 'Fight', category: 'Fighting' } });
  const t = await call('GET', '/student/:id', { user: teacher, params: { id: sid } });
  assert.equal(t.body.records.length, 1); assert.equal(t.body.summary, null);
  const o = await call('GET', '/student/:id', { params: { id: sid } });
  assert.equal(o.body.records.length, 2); assert.equal(o.body.summary.warnings, 1);
  assert.equal((await call('GET', '/', { user: teacher })).status, 403);
});

test('three warnings suggest a summon; the summon sends an SMS and clears the hint', async () => {
  const sid = addStudent({ name: 'Three', section: sectionOf(6, 'B'), fphone: '03001234567' });
  for (let i = 0; i < 3; i++) await call('POST', '/', { body: { student_id: sid, kind: 'warning', text: 'late ' + i } });
  assert.equal((await call('GET', '/student/:id', { params: { id: sid } })).body.summary.suggestSummon, true);
  assert.ok((await call('GET', '/watch')).body.some((x: any) => x.student_id === sid));
  const sent: string[] = []; setSender(async (_p: string, t: string) => { sent.push(t); });
  assert.equal((await call('POST', '/', { body: { student_id: sid, kind: 'summon', text: 'Repeated late', meet_date: '2026-11-20', send_sms: true } })).status, 201);
  assert.equal(sent.length, 1); assert.match(sent[0], /2026-11-20/);
  assert.equal((await call('GET', '/student/:id', { params: { id: sid } })).body.summary.suggestSummon, false);
  assert.equal((await call('POST', '/', { body: { student_id: sid, kind: 'summon', text: 'no date' } })).status, 400);
});

test('summon outcome closes it; pending count shows on the today summary; letter works', async () => {
  const sid = addStudent({ name: 'Summoned', section: sectionOf(6, 'C') });
  const id = (await call('POST', '/', { body: { student_id: sid, kind: 'summon', text: 'Fight', meet_date: '2026-11-25' } })).body.id;
  assert.ok(todaySummary('principal').summonsPending >= 1);
  assert.equal((await call('PUT', '/:id/outcome', { params: { id }, body: { outcome: 'rescheduled' } })).status, 400);
  assert.equal((await call('PUT', '/:id/outcome', { params: { id }, body: { outcome: 'rescheduled', meet_date: '2026-11-27' } })).status, 200);
  assert.equal((db.prepare('SELECT status FROM disc_records WHERE id = ?').get(id) as any).status, 'open');
  await call('PUT', '/:id/outcome', { params: { id }, body: { outcome: 'attended', note: 'Father came' } });
  assert.equal((db.prepare('SELECT status FROM disc_records WHERE id = ?').get(id) as any).status, 'closed');
  assert.equal((await call('GET', '/:id/letter', { params: { id } })).body.student.name, 'Summoned');
  assert.equal((await call('DELETE', '/:id', { params: { id }, user: { id: 2, name: 'A', role: 'teacher' } })).status, 403);
  assert.equal((await call('DELETE', '/:id', { params: { id } })).status, 200);
});
