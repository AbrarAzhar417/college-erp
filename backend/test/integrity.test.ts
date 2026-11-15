import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import '../src/timetable/schema.js';
import '../src/fee/schema.js';
import '../src/attendance/schema.js';
import '../src/transport/schema.js';
import '../src/hr/schema.js';
import '../src/exam/schema.js';
import '../src/syllabus/schema.js';
import '../src/college/routes.js';
import '../src/faculty/routes.js';
import { checkIntegrity, installGuards, repairIntegrity } from '../src/integrity.js';
import { sectionOf } from './helpers.js';

installGuards();
const student = (name: string, sec: number) => Number(db.prepare("INSERT INTO students (reg_no, name, father_name, gender, section_id) VALUES (?, ?, 'F', 'male', ?)").run('IG-' + name, name, sec).lastInsertRowid);

test('guards: a pointer to a row that does not exist is refused', () => {
  const sec = sectionOf(6, 'A');
  assert.throws(() => db.prepare('UPDATE sections SET class_teacher_id = 99999 WHERE id = ?').run(sec), /must point at an existing teachers row/);
  const st = student('a', sec);
  assert.throws(() => db.prepare('UPDATE students SET tr_route_id = 99999 WHERE id = ?').run(st), /tr_routes/);
  assert.throws(() => db.prepare("INSERT INTO parent_msgs (student_id, kind, body) VALUES (99999, 'x', 'y')").run());
});

test('guards: deleting a teacher clears the class teacher and the hr link instead of leaving a dangling pointer', () => {
  const sec = sectionOf(7, 'A');
  const t = Number(db.prepare("INSERT INTO teachers (name) VALUES ('Mr Guard')").run().lastInsertRowid);
  db.prepare('UPDATE sections SET class_teacher_id = ? WHERE id = ?').run(t, sec);
  db.prepare('DELETE FROM teachers WHERE id = ?').run(t);
  assert.equal((db.prepare('SELECT class_teacher_id AS c FROM sections WHERE id = ?').get(sec) as any).c, null);
});

test('guards: users cannot repeat a username in another letter case, and one login serves one teacher', () => {
  db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES ('X', 'case.user', 'h', 'teacher')").run();
  assert.throws(() => db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES ('Y', 'CASE.User', 'h', 'teacher')").run(), /UNIQUE/);
  const u = Number((db.prepare("SELECT id FROM users WHERE username = 'case.user'").get() as any).id);
  db.prepare('INSERT INTO teachers (name, user_id) VALUES (?, ?)').run('One', u);
  assert.throws(() => db.prepare('INSERT INTO teachers (name, user_id) VALUES (?, ?)').run('Two', u), /UNIQUE/);
});

test('checker finds a mismatch and the repair fixes it; money is only reported', () => {
  const sec = sectionOf(8, 'A');
  const t = Number(db.prepare("INSERT INTO teachers (name, phone) VALUES ('Drift T', '0300-1111111')").run().lastInsertRowid);
  const h = Number(db.prepare("INSERT INTO hr_staff (emp_no, name, phone, staff_type, kind, teacher_id) VALUES ('E-IG1', 'Old Name', '0300-2', 'teacher', 'teaching', ?)").run(t).lastInsertRowid);
  const st = student('left', sec);
  db.prepare("UPDATE students SET status = 'left' WHERE id = ?").run(st);
  const before = checkIntegrity();
  assert.ok(before.findings.some(f => f.key === 'drift:teacher-hr'));
  const r = repairIntegrity();
  assert.ok(r.fixed.some(f => f.key === 'drift:teacher-hr'));
  assert.equal((db.prepare('SELECT name FROM hr_staff WHERE id = ?').get(h) as any).name, 'Drift T');
  // a voucher whose gross disagrees with its lines is reported and left alone
  db.prepare("INSERT INTO vouchers (seq, voucher_no, student_id, period, period_label, issue_date, due_date, gross, discount, net, arrears, late_fine) VALUES (9001, '2611-09001', ?, '2026-11', 'Nov', '2026-11-01', '2026-11-10', 500, 0, 500, 0, 0)").run(st);
  const after = checkIntegrity();
  assert.ok(after.findings.some(f => f.key === 'money:voucher-items'));
  assert.equal((db.prepare("SELECT gross FROM vouchers WHERE seq = 9001").get() as any).gross, 500, 'money untouched');
  assert.equal(after.engine, 'ok');
});
