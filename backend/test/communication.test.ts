import './setup.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { ackReport, checkNotice, datesheetFromExam, inboxFor, nextRef, parentClasses, parentRecipients, publish, resultFromExam, unreadCount } from '../src/communication/service.js';
import { addStudent, classOf, sectionOf } from './helpers.js';

const U = (id: number, role: any) => ({ id, name: `u${id}`, username: `u${id}`, role });
let principal = 0, teacher = 0, teacher2 = 0, acct = 0, cls = 0, sec = 0, kid = 0;
before(() => {
  const mk = (n: string, role: string) => Number(db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,?)').run(n, n, 'x', role).lastInsertRowid);
  principal = mk('cp', 'principal'); teacher = mk('ct1', 'teacher'); teacher2 = mk('ct2', 'teacher'); acct = mk('ca', 'accountant');
  cls = classOf(7); sec = sectionOf(7, 'C'); db.prepare('DELETE FROM students WHERE section_id = ?').run(sec);
  kid = addStudent({ name: 'Zain', father: 'Mr Zain', section: sec, fphone: '03001112222' }); addStudent({ name: 'NoPhone', section: sec });
});
const base = (o: any = {}) => ({ kind: 'circular', title: 'Holiday', body: 'Closed on Friday.', audience: 'staff', ...o });
const make = (o: any = {}) => { const v = checkNotice(base(o)) as any; return Number(db.prepare('INSERT INTO comm_notices (kind,title,body,data,audience,class_ids,priority,issue_date,signed_by,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(v.v.kind, v.v.title, v.v.body, v.v.data, v.v.audience, v.v.class_ids, v.v.priority, v.v.issue_date, v.v.signed_by, principal).lastInsertRowid); };

test('validation per kind', () => {
  assert.match(checkNotice(base({ kind: 'x' })) as string, /kind/); assert.match(checkNotice(base({ title: ' ' })) as string, /title/);
  assert.match(checkNotice(base({ audience: 'x' })) as string, /receive/); assert.match(checkNotice(base({ audience: 'parents' })) as string, /classes/);
  assert.match(checkNotice(base({ audience: 'parents', class_ids: [99999] })) as string, /class does not exist/); assert.match(checkNotice(base({ body: '' })) as string, /text/);
  assert.match(checkNotice(base({ kind: 'meeting', data: { points: [] } })) as string, /meeting point/);
  assert.match(checkNotice(base({ kind: 'meeting', data: { points: [{ text: 'A', due: 'bad' }] } })) as string, /due date/);
  assert.match(checkNotice(base({ kind: 'datesheet', body: '', data: { rows: [] } })) as string, /at least one row/);
  assert.match(checkNotice(base({ kind: 'datesheet', body: '', data: { rows: [{ date: 'x', subject: 'Math' }] } })) as string, /Math/);
  assert.match(checkNotice(base({ kind: 'result', body: '', data: {} })) as string, /message or add/);
  assert.match(checkNotice(base({ issue_date: 'zz' })) as string, /Issue date/);
  const ok = checkNotice(base({ kind: 'meeting', body: '', data: { points: [{ text: ' Fix timetable ', assignee: 'Admin' }] }, priority: 'urgent' })) as any;
  assert.equal(JSON.parse(ok.v.data).points[0].text, 'Fix timetable'); assert.equal(ok.v.priority, 'urgent'); assert.equal(ok.v.signed_by, 'Principal');
});
test('reference numbers run per kind and year and are never reused', () => {
  const a = make({ issue_date: '2031-03-01' }), b = make({ issue_date: '2031-03-02' }), c = make({ issue_date: '2031-03-03', kind: 'order' });
  assert.deepEqual(publish(a, principal), { ref_no: 'KMCB/CIR/2031/001' }); assert.deepEqual(publish(b, principal), { ref_no: 'KMCB/CIR/2031/002' }); assert.deepEqual(publish(c, principal), { ref_no: 'KMCB/ORD/2031/001' });
  db.prepare("UPDATE comm_notices SET status = 'withdrawn' WHERE id = ?").run(b);
  assert.equal(nextRef('circular', '2031-05-01'), 'KMCB/CIR/2031/003'); assert.equal(nextRef('circular', '2032-01-01'), 'KMCB/CIR/2032/001');
  assert.match(publish(a, principal) as string, /draft/); assert.match(publish(99999, principal) as string, /not found/);
});
test('inbox: staff see published only, managers see drafts; acknowledging clears the badge', () => {
  const draft = make({ title: 'Draft one' }), live = make({ title: 'Live one' }); publish(live, principal);
  assert.ok(!inboxFor(U(teacher, 'teacher')).some(n => n.id === draft)); assert.ok(inboxFor(U(principal, 'principal')).some(n => n.id === draft));
  const before = unreadCount(U(teacher, 'teacher')); assert.ok(inboxFor(U(teacher, 'teacher')).find(n => n.id === live)!.needs_ack);
  db.prepare('INSERT INTO comm_reads (notice_id, user_id) VALUES (?,?)').run(live, teacher);
  assert.equal(unreadCount(U(teacher, 'teacher')), before - 1);
  const tOnly = make({ audience: 'teachers', title: 'Teachers only' }); publish(tOnly, principal);
  assert.ok(!inboxFor(U(acct, 'accountant')).find(n => n.id === tOnly)!.needs_ack);   // visible, but nothing to acknowledge
  const rep = ackReport(tOnly)!; assert.ok(rep.users.every((u: any) => u.role === 'teacher')); assert.ok(rep.users.some((u: any) => u.id === teacher2 && !u.read_at));
  const par = make({ audience: 'parents', class_ids: [cls] }); publish(par, principal); assert.equal(ackReport(par)!.applies, false);
});
test('parents: classes, recipients with valid phones, sent flag, class limit', () => {
  const n = make({ audience: 'parents', class_ids: [cls], title: 'Date sheet out', body: 'Exams start on Monday.' }); publish(n, principal);
  assert.ok(parentClasses(n)!.some(c => c.section_id === sec));
  const r = parentRecipients(n, sec)!, z = r.find(x => x.student_id === kid)!;
  assert.equal(z.phone, '923001112222'); assert.match(z.message, /Date sheet out/); assert.match(z.message, /KMCB\/CIR/); assert.equal(r.find(x => x.name === 'NoPhone')!.phone, null);
  assert.deepEqual(parentRecipients(n, sectionOf(9, 'A')), []);
  db.prepare('INSERT INTO comm_parent_sent (notice_id, student_id) VALUES (?,?)').run(n, kid); assert.equal(parentRecipients(n, sec)!.find(x => x.student_id === kid)!.sent, true);
});
test('generators read the exam module', () => {
  const subj = Number(db.prepare("INSERT INTO subjects (name) VALUES ('C-Math')").run().lastInsertRowid);
  const ex = Number(db.prepare("INSERT INTO exams (name, kind, session, status) VALUES ('C-Exam','test','2026-27','published')").run().lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO exam_classes (exam_id, class_id) VALUES (?,?)').run(ex, cls);
  const p = Number(db.prepare('INSERT INTO exam_papers (exam_id, section_id, subject_id, max_marks, test_date) VALUES (?,?,?,100,?)').run(ex, sec, subj, '2026-12-07').lastInsertRowid);
  db.prepare('INSERT INTO exam_papers (exam_id, section_id, subject_id, max_marks) VALUES (?,?,?,100)').run(ex, sectionOf(7, 'D'), subj);
  const ds = datesheetFromExam(ex)!; assert.equal(ds.rows.length, 1); assert.equal(ds.rows[0].day, 'Mon'); assert.equal(ds.missing, 1); assert.equal(datesheetFromExam(99999), null);
  for (const s of db.prepare("SELECT id FROM students WHERE section_id = ? AND status = 'active'").all(sec) as any[]) db.prepare("INSERT INTO exam_marks (paper_id, student_id, marks, status) VALUES (?,?,?,'P')").run(p, s.id, s.id === kid ? 90 : 20);
  const rs = resultFromExam(ex)!; const line = rs.lines.find(l => l.class_label.endsWith('-C'))!;
  assert.equal(line.pass_pct, 50); assert.match(line.top, /Zain \(90%\)/); assert.ok(rs.skipped >= 1);
});
