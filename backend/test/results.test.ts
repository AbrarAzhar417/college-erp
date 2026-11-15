import './setup.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import { db } from '../src/db.js';
import { signToken } from '../src/auth.js';
import { app } from '../src/server.js';
import { addStudent, sectionOf } from './helpers.js';

let server: http.Server, base = '';
const tok: Record<string, string> = {};
const get = async (url: string, who: string) => { const r = await fetch(base + url, { headers: { authorization: `Bearer ${tok[who]}` } }); return { status: r.status, body: await r.json() as any }; };

const mkUser = (username: string, role: any) => {
  const id = Number(db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,?)').run(username, username, bcrypt.hashSync('x', 4), role).lastInsertRowid);
  tok[username] = signToken({ id, name: username, username, role });
  return id;
};
let sid = 0, moved = 0, partial = 0;
before(async () => {
  const ctId = mkUser('classteacher', 'teacher'); mkUser('otherteacher', 'teacher'); mkUser('acct', 'accountant'); mkUser('office', 'admin');
  const t1 = Number(db.prepare('INSERT INTO teachers (name, user_id) VALUES (?,?)').run('Class Teacher', ctId).lastInsertRowid);
  const sA = sectionOf(7, 'A'), sB = sectionOf(7, 'B');
  db.prepare('UPDATE sections SET class_teacher_id = ? WHERE id = ?').run(t1, sA);
  sid = addStudent({ name: 'Ali', section: sA }); partial = addStudent({ name: 'Partial', section: sA }); moved = addStudent({ name: 'Mover', section: sA });
  const math = Number(db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES ('T-Math')").run().lastInsertRowid) || (db.prepare("SELECT id FROM subjects WHERE name='T-Math'").get() as any).id;
  const urdu = Number(db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES ('T-Urdu')").run().lastInsertRowid) || (db.prepare("SELECT id FROM subjects WHERE name='T-Urdu'").get() as any).id;
  const ex = Number(db.prepare("INSERT INTO exams (name, kind, session, status) VALUES ('Test 1','test','2026-27','open')").run().lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO exam_classes (exam_id, class_id) VALUES (?, (SELECT class_id FROM sections WHERE id = ?))').run(ex, sA);
  const paper = (sec: number, subj: number) => Number(db.prepare('INSERT INTO exam_papers (exam_id, section_id, subject_id, max_marks) VALUES (?,?,?,50)').run(ex, sec, subj).lastInsertRowid);
  const pm = paper(sA, math), pu = paper(sA, urdu);
  const mark = (p: number, s: number, m: number | null) => db.prepare('INSERT INTO exam_marks (paper_id, student_id, marks, status) VALUES (?,?,?,?)').run(p, s, m, 'P');
  mark(pm, sid, 40); mark(pu, sid, 30);
  mark(pm, partial, 25);                                  // Urdu marks not entered yet (no row)
  mark(pm, moved, 45); mark(pu, moved, 35);
  db.prepare('UPDATE students SET section_id = ? WHERE id = ?').run(sB, moved);   // moved to another section after the exam
  server = http.createServer(app); await new Promise<void>(r => server.listen(0, r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => { server?.close(); });

test('class teacher of the section and office roles can open a student\'s results', async () => {
  for (const who of ['classteacher', 'office']) { const r = await get(`/exam/students/${sid}/results`, who); assert.equal(r.status, 200, who); assert.equal(r.body.exams.length, 1); }
});
test('another teacher and the accountant cannot', async () => {
  assert.equal((await get(`/exam/students/${sid}/results`, 'otherteacher')).status, 403);
  assert.equal((await get(`/exam/students/${sid}/results`, 'acct')).status, 403);
});
test('no login gives 401 and an unknown student gives 404', async () => {
  assert.equal((await fetch(`${base}/exam/students/${sid}/results`)).status, 401);
  assert.equal((await get('/exam/students/999999/results', 'office')).status, 404);
});
test('an exam with missing marks is shown as incomplete, not as a fail or a crash', async () => {
  const r = await get(`/exam/students/${partial}/results`, 'office');
  assert.equal(r.status, 200);
  const row = r.body.exams[0].row;
  assert.equal(row.result, 'INCOMPLETE');
  assert.equal(row.missing, 1);
});
test('a student who changed section still gets the exam they sat, worked out in their old section', async () => {
  const r = await get(`/exam/students/${moved}/results`, 'office');
  assert.equal(r.status, 200); assert.equal(r.body.exams.length, 1);
  assert.equal(r.body.exams[0].section_name, 'A');
  assert.equal(r.body.student.section_name, 'B');
});
test('a student with no exams returns an empty list', async () => {
  const none = addStudent({ section: sectionOf(7, 'A') });
  const r = await get(`/exam/students/${none}/results`, 'office');
  assert.equal(r.status, 200); assert.deepEqual(r.body.exams, []);
});
test('the session filter narrows the list', async () => {
  assert.equal((await get(`/exam/students/${sid}/results?session=1999-00`, 'office')).body.exams.length, 0);
  assert.equal((await get(`/exam/students/${sid}/results?session=2026-27`, 'office')).body.exams.length, 1);
});
