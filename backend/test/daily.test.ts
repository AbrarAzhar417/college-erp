import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db, getSetting } from '../src/db.js';
import { addStudent, sectionOf } from './helpers.js';
import { recordPayment } from '../src/fee/service.js';
import { receiptCode, verifyReceipt, receiptVerifyRouter, resetVerifyLimits } from '../src/fee/verify.js';
import { autoFee, saveAutoFee, runAutoFee } from '../src/parentmsg/auto.js';
import { setSender } from '../src/parentmsg/service.js';
import { extrasRouter, absentTeachers } from '../src/timetable/extras.js';
import { replaceSlots } from '../src/timetable/routes.js';
import { todaySummary } from '../src/today/routes.js';

const call = (router: any, method: string, path: string, opts: { body?: any; query?: any; params?: any } = {}) => new Promise<{ status: number; body: any }>(resolve => {
  const r = router.routes.find((x: any) => x.method === method && x.path === path);
  if (!r) return resolve({ status: -1, body: 'route not found ' + path });
  const res: any = { code: 200, status(c: number) { this.code = c; return this; }, json(b: any) { resolve({ status: this.code, body: b }); return this; } };
  r.h[r.h.length - 1]({ body: opts.body ?? {}, query: opts.query ?? {}, params: opts.params ?? {}, ip: '1.1.1.1', user: { id: 1, role: 'director' } }, res, () => {});
});

test('receipt QR code: genuine receipts verify, forged or altered ones do not', async () => {
  resetVerifyLimits();
  const sid = addStudent({ name: 'Verify Kid', section: sectionOf(6, 'A') });
  const r = recordPayment({ studentId: sid, amount: 1500, paidOn: '2026-11-10', mode: 'cash', receivedBy: null });
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(r.id) as any;
  const code = receiptCode(p);
  const ok = verifyReceipt(code)!;
  assert.equal(ok.amount, 1500); assert.equal(ok.name, 'Verify Kid'); assert.equal(ok.cancelled, false);
  assert.ok(!('phone' in ok) && !('balance' in ok));
  assert.equal(verifyReceipt(p.receipt_no + '~000000000000'), null);          // wrong signature
  assert.equal(verifyReceipt('NOPE~' + code.split('~')[1]), null);            // unknown receipt
  db.prepare('UPDATE payments SET amount = 9999 WHERE id = ?').run(r.id);     // altered amount breaks the signature
  assert.equal(verifyReceipt(code), null);
  db.prepare('UPDATE payments SET amount = 1500, cancelled = 1 WHERE id = ?').run(r.id);
  assert.equal(verifyReceipt(code)!.cancelled, true);
  assert.equal((await call(receiptVerifyRouter, 'GET', '/receipt/:code', { params: { code } })).status, 200);
  assert.equal((await call(receiptVerifyRouter, 'GET', '/receipt/:code', { params: { code: 'x~y' } })).status, 404);
  assert.ok(getSetting('receipt_secret').length >= 32);
});

test('auto fee reminders: off by default, once a month, daytime only, needs SMS', async () => {
  const sid = addStudent({ name: 'Owes Money', section: sectionOf(6, 'B'), phone: '03001234567' });
  db.prepare("INSERT INTO ledger (student_id, amount, kind, note, date) VALUES (?,?,?,?,?)").run(sid, 3000, 'charge', 't', '2026-11-01');
  const sent: string[] = []; setSender(async (_p, t) => { sent.push(t); });
  assert.equal(autoFee().enabled, false);
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0);
  assert.equal((await runAutoFee(at(10, 11), { skipSmsCheck: true })).ran, false);            // off
  saveAutoFee({ enabled: true, day: 5, min: 0 });
  assert.equal((await runAutoFee(at(3, 11), { skipSmsCheck: true })).ran, false);             // before the day
  assert.equal((await runAutoFee(at(10, 22), { skipSmsCheck: true })).ran, false);            // night
  assert.equal((await runAutoFee(at(10, 11))).reason, 'sms not set up');                      // no SMS configured
  const r: any = await runAutoFee(at(10, 11), { skipSmsCheck: true });
  assert.equal(r.ran, true); assert.ok(r.sent >= 1); assert.ok(sent.some(t => t.includes('3000')));
  assert.equal(autoFee().last, '2026-11');
  const n = sent.length;
  assert.equal((await runAutoFee(at(12, 11), { skipSmsCheck: true })).ran, false);            // not twice in a month
  assert.equal(sent.length, n);
  assert.throws(() => saveAutoFee({ day: 40 }));
});

test('absent teachers come from approved leave, and auto-assign covers their lessons fairly', async () => {
  const sec = sectionOf(8, 'C');
  const sub = Number(db.prepare("INSERT INTO subjects (name) VALUES ('DL-Eng')").run().lastInsertRowid);
  const mk = (n: string) => Number(db.prepare('INSERT INTO teachers (name) VALUES (?)').run(n).lastInsertRowid);
  const away = mk('Away T'), a = mk('Cover A'), b = mk('Cover B');
  db.prepare('INSERT INTO section_subjects (section_id, subject_id, periods_per_week, block, teacher_id) VALUES (?,?,?,1,?)').run(sec, sub, 3, away);
  replaceSlots([0, 1, 2].map(p => ({ sectionId: sec, day: 3, period: p, subjectId: sub, teacherId: away, grp: 8800 + p, locked: false })), 'school');
  const staff = Number(db.prepare("INSERT INTO hr_staff (emp_no, name, staff_type, kind, teacher_id) VALUES ('E-DL1','Away T','teacher','teaching',?)").run(away).lastInsertRowid);
  const lt = (db.prepare('SELECT id FROM hr_leave_types LIMIT 1').get() as any).id;
  const date = '2026-12-02';   // Wednesday
  assert.equal(absentTeachers(date).length, 0);
  db.prepare("INSERT INTO hr_leaves (staff_id, type_id, from_date, to_date, days, status) VALUES (?,?,?,?,1,'approved')").run(staff, lt, date, date);
  const list = absentTeachers(date);
  assert.equal(list.length, 1); assert.equal(list[0].uncovered, 3); assert.equal(list[0].why, 'Leave');
  const res = await call(extrasRouter, 'POST', '/subs/auto', { body: { date, teacher_id: away } });
  assert.equal(res.status, 200); assert.equal(res.body.assigned.length + res.body.left.length, 3);
  assert.ok(res.body.assigned.length >= 2);
  // nobody is given more than the weekly maximum of 2, and covers are spread between teachers
  const per = new Map<string, number>(); for (const x of res.body.assigned) per.set(x.teacher, (per.get(x.teacher) ?? 0) + 1);
  assert.ok([...per.values()].every(n => n <= 2));
  assert.equal(absentTeachers(date)[0].uncovered, res.body.left.length);
  void a; void b;
});

test("today's summary has the fee line for the accountant and the full picture for the office", () => {
  const acc = todaySummary('accountant', '2026-11-12');
  assert.ok(acc.fee && !acc.teachers);
  const off = todaySummary('principal', '2026-11-12');
  assert.ok(Array.isArray(off.teachers.absent) && Array.isArray(off.attendanceMissing) && off.leaves);
  assert.equal(todaySummary('principal', '2026-11-15').holiday, 'Sunday');
});

import { leaveCover } from '../src/timetable/extras.js';
test('approving a leave reports the lessons that still need a replacement', () => {
  const sec = sectionOf(8, 'D');
  const sub = Number(db.prepare("INSERT INTO subjects (name) VALUES ('LC-Sub')").run().lastInsertRowid);
  const t = Number(db.prepare("INSERT INTO teachers (name) VALUES ('Leave Cover T')").run().lastInsertRowid);
  db.prepare('INSERT INTO section_subjects (section_id, subject_id, periods_per_week, block, teacher_id) VALUES (?,?,?,1,?)').run(sec, sub, 4, t);
  replaceSlots([0, 1].map(p => ({ sectionId: sec, day: 2, period: p, subjectId: sub, teacherId: t, grp: 9900 + p, locked: false })), 'school');
  const staff = Number(db.prepare("INSERT INTO hr_staff (emp_no, name, staff_type, kind, teacher_id) VALUES ('E-LC1','Leave Cover T','teacher','teaching',?)").run(t).lastInsertRowid);
  const r = leaveCover(staff, '2026-12-08', '2026-12-09', '2026-12-01');   // Tuesday and Wednesday: lessons only on Tuesday (day 2)
  assert.equal(r.teacher, 'Leave Cover T'); assert.equal(r.lessons, 2); assert.equal(r.uncovered, 2); assert.equal(r.dates.length, 1);
  db.prepare('INSERT INTO tt_substitutions (date, section_id, period, subject_id, absent_teacher_id, sub_teacher_id) VALUES (?,?,?,?,?,?)').run('2026-12-08', sec, 0, sub, t, t + 1);
  assert.equal(leaveCover(staff, '2026-12-08', '2026-12-09', '2026-12-01').uncovered, 1);
  assert.equal(leaveCover(999999, '2026-12-08', '2026-12-09').teacher, null);
});
