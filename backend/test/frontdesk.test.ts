import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { addDays, todayISO } from '../src/attendance/service.js';
import { checkEnquiry, checkPass, checkVisitor, decidePass, enquirySummary, followUpsDue, markLeft, passesOn, signOut } from '../src/frontdesk/service.js';
import { addStudent } from './helpers.js';

const uid = Number(db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES ('fd','fd','x','principal')").run().lastInsertRowid);
const ins = (v: any) => Number(db.prepare('INSERT INTO fd_visitors (date,name,purpose,time_in) VALUES (?,?,?,?)').run(v.date, v.name, v.purpose, v.time_in).lastInsertRowid);

test('visitor: required fields, phone check, sign out once and not before time in', () => {
  assert.match(checkVisitor({ purpose: 'x' }) as string, /name/);
  assert.match(checkVisitor({ name: 'A' }) as string, /Purpose/);
  assert.match(checkVisitor({ name: 'A', purpose: 'x', phone: '123' }) as string, /Phone/);
  const v = checkVisitor({ name: ' Ali ', purpose: 'Fee', time_in: '09:30' }) as any; assert.equal(v.name, 'Ali'); assert.equal(v.time_in, '09:30');
  const id = ins(v);
  assert.match(signOut(id, '09:00') as string, /before/);
  assert.deepEqual(signOut(id, '10:15'), { time_out: '10:15' });
  assert.match(signOut(id, '11:00') as string, /already/);
  assert.match(signOut(99999) as string, /not found/);
});
test('enquiry: phone required, class and category validated, follow-ups only for open ones', () => {
  assert.match(checkEnquiry({ child_name: 'C', parent_name: 'P', phone: '12' }) as string, /phone/);
  assert.match(checkEnquiry({ child_name: 'C', parent_name: 'P', phone: '03001234567', grade: 99 }) as string, /class/);
  assert.match(checkEnquiry({ child_name: 'C', parent_name: 'P', phone: '03001234567', category: 'Z' }) as string, /Category/);
  assert.match(checkEnquiry({ child_name: 'C', parent_name: 'P', phone: '03001234567', status: 'x' }) as string, /status/);
  const add = (status: string, follow: string | null) => db.prepare('INSERT INTO fd_enquiries (date,child_name,parent_name,phone,status,follow_up) VALUES (?,?,?,?,?,?)').run(todayISO(), 'k', 'p', '03001234567', status, follow);
  db.prepare('DELETE FROM fd_enquiries').run();
  add('new', addDays(todayISO(), -2)); add('contacted', todayISO()); add('new', addDays(todayISO(), 3)); add('admitted', addDays(todayISO(), -5)); add('lost', null);
  assert.equal(followUpsDue().length, 2);
  assert.deepEqual(enquirySummary(), { new: 2, contacted: 1, visited: 0, admitted: 1, lost: 1 });
});
test('gate pass: approval first, decide once, leaves once, left students refused', () => {
  const sid = addStudent({ name: 'Gate Kid' }), gone = addStudent({ name: 'Gone', status: 'left' });
  assert.match(checkPass({ student_id: gone, taken_by: 'Dad', reason: 'x' }) as string, /left/);
  assert.match(checkPass({ student_id: sid, reason: 'x' }) as string, /who/);
  assert.match(checkPass({ student_id: sid, taken_by: 'Dad' }) as string, /reason/);
  const v = checkPass({ student_id: sid, taken_by: 'Dad', relation: 'Father', reason: 'Doctor' }) as any;
  const id = Number(db.prepare('INSERT INTO fd_gate_passes (student_id,date,reason,taken_by,relation) VALUES (?,?,?,?,?)').run(v.student_id, v.date, v.reason, v.taken_by, v.relation).lastInsertRowid);
  assert.match(markLeft(id) as string, /approved/);
  assert.deepEqual(decidePass(id, true, uid), { status: 'approved' });
  assert.match(decidePass(id, false, uid) as string, /already/);
  assert.ok(typeof (markLeft(id) as any).left_at === 'string');
  assert.match(markLeft(id) as string, /already/);
  const rejected = Number(db.prepare('INSERT INTO fd_gate_passes (student_id,date,reason,taken_by) VALUES (?,?,?,?)').run(sid, todayISO(), 'r', 't').lastInsertRowid);
  decidePass(rejected, false, uid); assert.match(markLeft(rejected) as string, /approved/);
  assert.ok(passesOn(todayISO(), todayISO()).some((p: any) => p.student === 'Gate Kid'));
});
