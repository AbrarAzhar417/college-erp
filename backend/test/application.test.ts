import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { addStudent } from './helpers.js';
import { applicationRouter } from '../src/students/application.js';

const call = (method: string, path: string, opts: { body?: any; params?: any; user?: any } = {}) => new Promise<{ status: number; body: any }>(resolve => {
  const r = (applicationRouter as any).routes.find((x: any) => x.method === method && x.path === path);
  const res: any = { code: 200, status(c: number) { this.code = c; return this; }, json(b: any) { resolve({ status: this.code, body: b }); return this; } };
  const req = { body: opts.body ?? {}, query: {}, params: opts.params ?? {}, ip: '1.1.1.1', user: opts.user ?? { id: 1, name: 'P', role: 'principal' } };
  const run = (i: number) => r.h[i](req, res, () => run(i + 1)); run(0);
});

test('application particulars: saved per student, only known fields, office only', async () => {
  const id = addStudent({ name: 'Form Kid' });
  assert.deepEqual((await call('GET', '/:id/application', { params: { id } })).body, {});
  const put = await call('PUT', '/:id/application', { params: { id }, body: { religion: 'Islam', health_issue: 'maybe', decision: 'recommended', reported_test: 'maybe', res_urdu: '45', evil: 'x', father_income: ' 90000 ', siblings: [{ name: 'Ali', class_session: '8th 2026' }, { name: '', class_session: '' }] } });
  assert.equal(put.status, 200);
  const got = (await call('GET', '/:id/application', { params: { id } })).body;
  assert.equal(got.religion, 'Islam'); assert.equal(got.father_income, '90000'); assert.equal(got.decision, 'recommended'); assert.equal(got.reported_test, undefined); assert.equal(got.res_urdu, '45');
  assert.equal(got.health_issue, undefined); assert.equal(got.evil, undefined); assert.equal(got.siblings.length, 1);
  assert.equal((await call('GET', '/:id/application', { params: { id }, user: { id: 9, name: 'T', role: 'teacher' } })).status, 403);
  assert.equal((await call('PUT', '/:id/application', { params: { id }, user: { id: 9, name: 'Acc', role: 'accountant' }, body: {} })).status, 403);
  assert.equal((await call('GET', '/:id/application', { params: { id: 999999 } })).status, 404);
});
