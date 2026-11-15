import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, setSetting } from '../src/db.js';
import { audit, listAudit } from '../src/audit/service.js';
import { checkBackupFile, deleteBackup, listBackups, makeBackup, restoreBackup, backupPath } from '../src/backup/service.js';
import { rolloverCommit, rolloverPlan } from '../src/rollover/service.js';
import { preview, send, setSender, msgLog } from '../src/parentmsg/service.js';
import { publicResultRouter, resetPublicLimits } from '../src/publicresult/routes.js';
import { saveExamConfig } from '../src/exam/service.js';
import { todayISO } from '../src/attendance/service.js';
import { addStudent, sectionOf } from './helpers.js';

const count = () => (db.prepare('SELECT COUNT(*) AS n FROM students').get() as { n: number }).n;

test('audit log writes and filters', () => {
  audit({ id: 1, name: 'Boss', role: 'director' }, 'fee.payment', 'payment', 9, 'Rs 500');
  audit({ id: 2, name: 'Clerk', role: 'admin' }, 'student.left', 'student', 3, '');
  const all = listAudit({});
  assert.ok(all.total >= 2);
  assert.equal(listAudit({ action: 'fee.' }).rows.length, 1);
  assert.equal(listAudit({ user: 'Clerk' }).rows.length, 1);
  assert.equal(listAudit({ q: 'Rs 500' }).rows.length, 1);
});

test('backup, damaged file refused, restore returns the old data and keeps a safety copy', async () => {
  addStudent({ name: 'Before Backup' });
  const n = count();
  const name = await makeBackup('manual');
  assert.ok(listBackups().some(b => b.name === name));
  assert.equal(checkBackupFile(backupPath(name)!), null);
  addStudent({ name: 'After Backup' });
  assert.equal(count(), n + 1);
  const safety = await restoreBackup(backupPath(name)!);
  assert.equal(count(), n);
  assert.ok(listBackups().some(b => b.name === safety && b.kind === 'pre-restore'));
  // the app still works after a restore
  addStudent({ name: 'Works Again' });
  assert.equal(count(), n + 1);
  const junk = path.join(os.tmpdir(), 'junk-' + Date.now() + '.db'); fs.writeFileSync(junk, 'this is not a database');
  assert.match(checkBackupFile(junk)!, /not a database/);
  assert.equal(backupPath('../../etc/passwd'), null);
  assert.equal(deleteBackup(name), true);
});

test('rollover promotes, passes out the top class, holds back chosen students, advances the session', () => {
  saveExamConfig({ session: '2026-27', session_start: '2026-04-01' });
  const s6 = addStudent({ name: 'Six A', section: sectionOf(6, 'A') });
  const held = addStudent({ name: 'Six Held', section: sectionOf(6, 'A') });
  const s12 = addStudent({ name: 'Twelve', section: sectionOf(12, 'A') });
  const plan = rolloverPlan();
  assert.equal(plan.next_session, '2027-28');
  assert.ok(plan.rows.find(r => r.grade === 12)!.graduating);
  const r = rolloverCommit({ hold: [held] });
  assert.ok(r.promoted >= 1 && r.passed_out >= 1 && r.held >= 1);
  const g = (id: number) => db.prepare('SELECT s.section_id, s.status, s.left_reason, c.grade FROM students s JOIN sections x ON x.id = s.section_id JOIN classes c ON c.id = x.class_id WHERE s.id = ?').get(id) as any;
  assert.equal(g(s6).grade, 7); assert.equal(g(held).grade, 6);
  assert.equal(g(s12).status, 'left'); assert.equal(g(s12).left_reason, 'passed_out');
  assert.equal(r.session, '2027-28');
});

test('parent messages: preview, send, skip bad numbers, log', async () => {
  const sec = sectionOf(8, 'A');
  const a = addStudent({ name: 'Absent One', section: sec, phone: '0300-1234567' });
  const b = addStudent({ name: 'Absent Two', section: sec, phone: '' });
  const d = todayISO();
  for (const s of [a, b]) db.prepare("INSERT OR REPLACE INTO att_daily (student_id, date, status) VALUES (?,?,'A')").run(s, d);
  const items = preview({ kind: 'absent', sectionId: sec });
  assert.equal(items.length, 2);
  assert.match(items.find(i => i.student_id === a)!.text, /Absent One/);
  assert.ok(items.find(i => i.student_id === a)!.wa.startsWith('https://wa.me/923001234567'));
  assert.ok(items.find(i => i.student_id === b)!.note);
  const sent: string[] = [];
  setSender(async (p, t) => { sent.push(p); });
  const r = await send(items, 'absent', { id: 1 });
  assert.deepEqual([r.sent, r.skipped, r.failed], [1, 1, 0]);
  setSender(async () => { throw new Error('phone off'); });
  const r2 = await send([{ student_id: a, phone: '03001234567', text: 'x' }], 'custom');
  assert.equal(r2.failed, 1);
  assert.ok((msgLog(50) as any[]).some(m => m.status === 'failed' && m.error === 'phone off'));
  // fee reminders use the ledger
  db.prepare("INSERT INTO ledger (student_id, amount, kind, note, date) VALUES (?,?,?,?,?)").run(a, 4500, 'charge', 't', d);
  const fee = preview({ kind: 'fee', sectionId: sec });
  assert.equal(fee.length, 1); assert.match(fee[0].text, /4500/);
});

function call(body: any, ip = '1.1.1.1') {
  return new Promise<{ status: number; body: any }>(resolve => {
    const layer = (publicResultRouter as any).routes?.find((l: any) => l.path === '/result' && l.method === 'POST');
    const res: any = { code: 200, status(c: number) { this.code = c; return this; }, json(b: any) { resolve({ status: this.code, body: b }); return this; } };
    if (!layer) return resolve({ status: -1, body: 'router shim has no stack' });
    layer.h[layer.h.length - 1]({ body, ip }, res, () => {});
  });
}

test('public result lookup needs the switch, reg no + CNIC, published exam only, and is rate limited', async (t) => {
  const probe = await call({ reg_no: 'x', cnic: '1' });
  if (probe.status === -1) return t.skip('router shim cannot be called directly');
  resetPublicLimits(); setSetting('public_results', '0');
  assert.equal((await call({ reg_no: 'x', cnic: '1' })).status, 404);
  setSetting('public_results', '1');
  const sec = sectionOf(9, 'A');
  const sid = addStudent({ name: 'Result Kid', section: sec, cnic: '35202-1234567-1' });
  const sub = Number(db.prepare("INSERT INTO subjects (name) VALUES ('PUB-Math')").run().lastInsertRowid);
  const ex = Number(db.prepare("INSERT INTO exams (name, kind, session, status) VALUES ('Terminal PUB','terminal','2027-28','open')").run().lastInsertRowid);
  const p = Number(db.prepare('INSERT INTO exam_papers (exam_id, section_id, subject_id, max_marks) VALUES (?,?,?,100)').run(ex, sec, sub).lastInsertRowid);
  db.prepare("INSERT INTO exam_marks (paper_id, student_id, marks, status) VALUES (?,?,?,'P')").run(p, sid, 80);
  const reg = (db.prepare('SELECT reg_no FROM students WHERE id = ?').get(sid) as any).reg_no;
  const ok = { reg_no: reg, cnic: '3520212345671' };
  assert.equal((await call(ok)).body.results.length, 0);           // not published yet: nothing shown
  db.prepare("UPDATE exams SET status = 'published' WHERE id = ?").run(ex);
  const r = await call(ok);
  assert.equal(r.status, 200); assert.equal(r.body.results[0].pct, 80);
  assert.equal(r.body.student.cnic, undefined); assert.equal(r.body.student.phone, undefined);
  const wrong = await call({ reg_no: reg, cnic: '3520299999999' });
  const none = await call({ reg_no: 'NOPE-1', cnic: '3520212345671' });
  assert.equal(wrong.status, 404); assert.deepEqual(wrong.body, none.body);   // same answer: nothing leaks
  resetPublicLimits();
  for (let i = 0; i < 5; i++) await call({ reg_no: reg, cnic: '3520299999999' }, '9.9.9.9');
  assert.equal((await call(ok, '9.9.9.9')).status, 429);                         // locked after repeated wrong CNIC
});

import { linkOverview, linkTeacher, unlinkTeacher } from '../src/teacher/link.js';
test('teacher login can be linked to a teacher record, once', () => {
  const t1 = Number(db.prepare("INSERT INTO teachers (name) VALUES ('Link T1')").run().lastInsertRowid);
  const t2 = Number(db.prepare("INSERT INTO teachers (name) VALUES ('Link T2')").run().lastInsertRowid);
  const u = Number(db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES ('Link U','linku','x','teacher')").run().lastInsertRowid);
  const adm = Number(db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES ('Adm','linkadm','x','admin')").run().lastInsertRowid);
  assert.ok(linkOverview().freeLogins.some((x: any) => x.id === u));
  assert.equal(linkTeacher(t1, u), null);
  assert.ok(!linkOverview().freeLogins.some((x: any) => x.id === u));
  assert.match(linkTeacher(t2, u)!, /another teacher/);
  assert.match(linkTeacher(t2, adm)!, /Teacher role/);
  assert.equal(unlinkTeacher(t1), null);
  assert.equal(linkTeacher(t2, u), null);
});

import { classExport, sectionSheet, canSheet, EXPORT_COLUMNS } from '../src/sheets/service.js';
import { setTeacherOpen } from '../src/policy.js';
test('sheets: section names/subjects and class data export with parents category and phones', () => {
  const sec = sectionOf(10, 'B');
  const a = addStudent({ name: 'Zed Sheet', section: sec, category: 'A', fphone: '0301-1111111', mphone: '0302-2222222', cnic: '35202-1111111-1' });
  const sub = Number(db.prepare("INSERT INTO subjects (name) VALUES ('SHEET-Physics')").run().lastInsertRowid);
  const tid = Number(db.prepare("INSERT INTO teachers (name) VALUES ('Sheet Teacher')").run().lastInsertRowid);
  db.prepare('INSERT INTO section_subjects (section_id, subject_id, teacher_id, periods_per_week) VALUES (?,?,?,5)').run(sec, sub, tid);
  const s = sectionSheet(sec)!;
  assert.ok(s.students.some(x => x.id === a)); assert.equal(s.subjects[0].name, 'SHEET-Physics'); assert.ok(s.periods >= 1);
  const rows = classExport({ sectionId: sec });
  const row = rows.find(r => r[2] === 'Zed Sheet')!;
  assert.equal(row[EXPORT_COLUMNS.indexOf('Category')], 'A'); assert.equal(row[EXPORT_COLUMNS.indexOf('Father phone')], '0301-1111111');
  assert.equal(row.length, EXPORT_COLUMNS.length);
  const u = Number(db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES ('ST','sheetteach','x','teacher')").run().lastInsertRowid);
  db.prepare('UPDATE teachers SET user_id = ? WHERE id = ?').run(u, tid);
  assert.equal(canSheet({ id: u, name: 'ST', username: 'x', role: 'teacher' } as any, sec), true);
  assert.equal(canSheet({ id: u, name: 'ST', username: 'x', role: 'teacher' } as any, sectionOf(10, 'C')), true, 'open teaching: any teacher');
  setTeacherOpen(false);
  assert.equal(canSheet({ id: u, name: 'ST', username: 'x', role: 'teacher' } as any, sectionOf(10, 'C')), false, 'own classes only when switched off');
  setTeacherOpen(true);
  assert.equal(canSheet({ id: 1, name: 'A', username: 'x', role: 'accountant' } as any, sec), false);
});

import { cardData } from '../src/cards/service.js';
test('cards: ID card for anyone, transport (TPT) card only for bus students, with photo', () => {
  const sec = sectionOf(7, 'D');
  const a = addStudent({ name: 'Card Bus', section: sec }), b = addStudent({ name: 'Card Walk', section: sec });
  db.prepare("UPDATE students SET photo = 'data:image/png;base64,AAAA' WHERE id = ?").run(a);
  const veh = Number(db.prepare("INSERT INTO tr_vehicles (number, capacity) VALUES ('CARD-Bus 1', 40)").run().lastInsertRowid);
  const rt = Number(db.prepare("INSERT INTO tr_routes (name, vehicle_id, morning_time) VALUES ('CARD-Route', ?, '07:10')").run(veh).lastInsertRowid);
  const stop = Number(db.prepare("INSERT INTO tr_stops (route_id, name, pickup_time) VALUES (?, 'Chowk', '07:20')").run(rt).lastInsertRowid);
  db.prepare("UPDATE students SET tr_route_id = ?, tr_stop_id = ?, tr_mode = 'both' WHERE id = ?").run(rt, stop, a);
  const id = cardData('id', { sectionId: sec }) as any;
  assert.equal(id.cards.length, 2); assert.equal(id.cards.find((c: any) => c.id === a).photo, 'data:image/png;base64,AAAA');
  const tp = cardData('transport', { sectionId: sec }) as any;
  assert.deepEqual(tp.cards.map((c: any) => c.name), ['Card Bus']);
  assert.equal(tp.cards[0].route, 'CARD-Route'); assert.equal(tp.cards[0].stop, 'Chowk'); assert.equal(tp.cards[0].bus, 'CARD-Bus 1');
  assert.ok(tp.principal && tp.session);
  assert.ok('error' in cardData('id', {}));
});

import { readImage, setVisionFetch, sniffImage, saveApiKey, visionReady, allowScan } from '../src/ocr/vision.js';
import { scanPreview, nameLooksRight } from '../src/ocr/service.js';
test('photo reading: image sniffing, key handling, mocked AI answer becomes checked rows with warnings', async () => {
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('not an image at all')), null);
  await assert.rejects(readImage(Buffer.from('x'), 'image/jpeg', 'p'), /not set up/);
  saveApiKey('sk-test-12345678901234567890'); assert.ok(visionReady());
  let sent: any = null;
  setVisionFetch((async (_u: any, init: any) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Here you go:\n{"rows":[{"roll_no":"1","name":"Ali Khan","marks":"17.5"},{"roll_no":"2","name":"Totally Different","marks":"9"},{"roll_no":"3","name":"Cc","marks":"55"},{"roll_no":"4","name":"Dd","status":"A"}]}' }] }) }; }) as any);
  const read = await readImage(Buffer.from('xxxx'), 'image/png', 'prompt');
  assert.equal(sent.messages[0].content[0].source.media_type, 'image/png'); assert.equal(read.rows.length, 4);
  const students = [{ id: 1, reg_no: 'R1', roll_no: 1, name: 'Ali Khan' }, { id: 2, reg_no: 'R2', roll_no: 2, name: 'Bilal Ahmed' }, { id: 3, reg_no: 'R3', roll_no: 3, name: 'Cc Cc' }, { id: 4, reg_no: 'R4', roll_no: 4, name: 'Dd Dd' }];
  const rows = scanPreview(read, 50, students);
  assert.equal(rows[0].entry?.marks, 17.5); assert.equal(rows[0].warning, null);
  assert.match(rows[1].warning!, /Bilal Ahmed/);           // roll 2 is somebody else's name
  assert.match(rows[2].problem!, /outside 0 to 50/);        // 55 of 50
  assert.equal(rows[3].entry?.status, 'A');
  assert.ok(nameLooksRight('Muhammad Ali', 'Ali Khan'));
  assert.equal(allowScan(999, 2), true); assert.equal(allowScan(999, 2), true); assert.equal(allowScan(999, 2), false);
  saveApiKey('');
});
