import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireRole, requireAccess, isFull, type Role } from '../src/auth.js';

const roles: Role[] = ['director', 'principal', 'admin', 'teacher', 'accountant'];
const pass = (mw: any, role: Role, duties: string[] = []) => {
  let ok = false, code = 0;
  mw({ user: { id: 1, role, duties } }, { status(c: number) { code = c; return { json() {} }; }, json() {} }, () => { ok = true; });
  return ok && !code;
};

test('principal and admin are both full access, teacher and accountant are not', () => {
  assert.deepEqual(roles.filter(isFull), ['director', 'principal', 'admin']);
});

test('a route open to the principal is open to the admin too', () => {
  const leadership = requireRole('director', 'principal');
  assert.equal(pass(leadership, 'admin'), true);
  assert.equal(pass(leadership, 'principal'), true);
  assert.equal(pass(leadership, 'teacher'), false);
  assert.equal(pass(leadership, 'accountant'), false);
});

test('an accountant route stays closed to teachers', () => {
  const fee = requireRole('director', 'principal', 'accountant');
  assert.equal(pass(fee, 'accountant'), true);
  assert.equal(pass(fee, 'admin'), true);
  assert.equal(pass(fee, 'teacher'), false);
});

test('a teacher with the right additional charge gets in, others do not', () => {
  const mw = requireAccess(['director', 'principal'], 'exam_dept');
  assert.equal(pass(mw, 'admin'), true);
  assert.equal(pass(mw, 'teacher', ['exam_dept']), true);
  assert.equal(pass(mw, 'teacher'), false);
  assert.equal(pass(mw, 'accountant'), false);
});

test('a route for staff roles only does not suddenly open to everybody', () => {
  const teacherOnly = requireRole('teacher');
  assert.equal(pass(teacherOnly, 'teacher'), true);
  assert.equal(pass(teacherOnly, 'admin'), false);
});
