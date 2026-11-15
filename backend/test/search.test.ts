import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import '../src/timetable/schema.js';
import '../src/fee/schema.js';
import '../src/hr/schema.js';
import '../src/communication/service.js';
import '../src/frontdesk/service.js';
import { globalSearch } from '../src/search/routes.js';
import { addStudent } from './helpers.js';

const types = (q: string, role: any) => globalSearch(q, role).groups.map(g => g.type);

test('search finds a student by name, admission number and a phone typed with dashes', () => {
  const id = addStudent({ name: 'Zaheer Unique Khan' });
  db.prepare("UPDATE students SET father_phone = '0345-7771234', father_name = 'Mushtaq Unique' WHERE id = ?").run(id);
  const reg = (db.prepare('SELECT reg_no FROM students WHERE id = ?').get(id) as any).reg_no;
  assert.equal(globalSearch('zaheer unique', 'teacher').groups[0].hits[0].link, `/students/${id}`);
  assert.equal(globalSearch(reg, 'principal').groups[0].hits[0].id, id);
  assert.equal(globalSearch('0345 777', 'principal').groups[0].hits[0].id, id, 'phone with a space');
  assert.equal(globalSearch('03457771234', 'principal').groups[0].hits[0].id, id, 'phone without dashes');
  assert.equal(globalSearch('mushtaq unique', 'principal').groups[0].hits[0].id, id, 'father name');
  assert.deepEqual(globalSearch('no-such-person-xyz', 'principal').groups, []);
});

test('search finds teachers, staff, fee papers and notices only for those who may see them', () => {
  const t = Number(db.prepare("INSERT INTO teachers (name, phone, cnic) VALUES ('Qasim Searchable', '0321-5550000', '37301-1112223-1')").run().lastInsertRowid);
  db.prepare("INSERT INTO subjects (name) VALUES ('Zoology Searchable')").run();
  const sub = (db.prepare("SELECT id FROM subjects WHERE name = 'Zoology Searchable'").get() as any).id;
  db.prepare('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)').run(t, sub);
  db.prepare("INSERT INTO comm_notices (kind, title, body, audience, priority, status, issue_date, signed_by, created_by) VALUES ('circular', 'Searchable holiday circular', 'x', 'all', 'normal', 'draft', '2026-11-15', 'P', 1)").run();
  const hit = (q: string, role: any, type: string) => globalSearch(q, role).groups.find(g => g.type === type)?.hits[0];
  assert.equal(hit('qasim searchable', 'principal', 'teacher')?.id, t);
  assert.equal(hit('zoology searchable', 'admin', 'teacher')?.id, t, 'by subject');
  assert.equal(hit('5550000', 'director', 'teacher')?.id, t, 'by phone');
  assert.equal(hit('1112223', 'principal', 'teacher')?.id, t, 'by CNIC');
  assert.equal(hit('qasim searchable', 'teacher', 'teacher'), undefined, 'a teacher does not get the staff directory');
  assert.equal(hit('qasim searchable', 'accountant', 'teacher'), undefined);
  assert.ok(hit('searchable holiday', 'principal', 'notice'), 'office sees a draft');
  assert.equal(hit('searchable holiday', 'teacher', 'notice'), undefined, 'a draft is not shown to a teacher');
  assert.ok(!types('qasim', 'teacher').includes('voucher'));
});

test('search ignores very short text and treats % and _ as plain characters', () => {
  assert.deepEqual(globalSearch('%', 'principal').groups.find(g => g.type === 'student')?.hits ?? [], []);
  assert.equal(globalSearch('_', 'principal').total, 0);
});
