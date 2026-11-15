import './setup.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { addMonths, todayISO } from '../src/attendance/service.js';
import { addLateStudents, attendanceFor, checkSlotUpdate, classReport, createMeeting, invitations, phoneIntl, studentReport, syncFollowup, talkingPoints } from '../src/ptm/service.js';
import { addStudent, sectionOf } from './helpers.js';

let sec = 0, ex1 = 0, ex2 = 0, good = 0, weak = 0, mid = 0, uid = 0, meeting = 0;
const month = addMonths(todayISO().slice(0, 7), -1);   // a finished month, so every day counts
before(() => {
  uid = Number(db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES ('pt','pt','x','principal')").run().lastInsertRowid);
  sec = sectionOf(8, 'A');
  db.prepare("DELETE FROM students WHERE section_id = ?").run(sec);
  good = addStudent({ name: 'Good', section: sec, fphone: '0300-1234567' }); weak = addStudent({ name: 'Weak', section: sec }); mid = addStudent({ name: 'Mid', section: sec });
  db.prepare('UPDATE students SET roll_no = ? WHERE id = ?').run(1, good); db.prepare('UPDATE students SET roll_no = ? WHERE id = ?').run(2, weak); db.prepare('UPDATE students SET roll_no = ? WHERE id = ?').run(3, mid);
  const subj = Number(db.prepare("INSERT INTO subjects (name) VALUES ('P-Math')").run().lastInsertRowid);
  const mkExam = (name: string, start: string, marks: number[]) => {
    const e = Number(db.prepare("INSERT INTO exams (name, kind, session, status, start_date) VALUES (?, 'test', '2026-27', 'published', ?)").run(name, start).lastInsertRowid);
    db.prepare('INSERT OR IGNORE INTO exam_classes (exam_id, class_id) VALUES (?, (SELECT class_id FROM sections WHERE id = ?))').run(e, sec);
    const p = Number(db.prepare('INSERT INTO exam_papers (exam_id, section_id, subject_id, max_marks) VALUES (?,?,?,100)').run(e, sec, subj).lastInsertRowid);
    [good, weak, mid].forEach((s, i) => db.prepare("INSERT INTO exam_marks (paper_id, student_id, marks, status) VALUES (?,?,?,'P')").run(p, s, marks[i]));
    return e;
  };
  ex1 = mkExam('P-Test 1', '2026-04-10', [80, 50, 60]); ex2 = mkExam('P-Test 2', '2026-06-10', [90, 20, 60]);
  const att = (s: number, status: string, day: number) => db.prepare('INSERT OR REPLACE INTO att_daily (student_id, date, status) VALUES (?,?,?)').run(s, `${month}-${String(day).padStart(2, '0')}`, status);
  for (let d = 1; d <= 10; d++) { att(good, 'P', d); att(weak, d <= 5 ? 'A' : 'P', d); att(mid, 'P', d); }
});

test('meeting: validation and slot generation in roll order', () => {
  assert.match(createMeeting({ date: '2026-12-01', start_time: '09:00', section_ids: [sec] }, uid) as string, /title/);
  assert.match(createMeeting({ title: 'T', date: 'x', start_time: '09:00', section_ids: [sec] }, uid) as string, /date/);
  assert.match(createMeeting({ title: 'T', date: '2026-12-01', start_time: '9am', section_ids: [sec] }, uid) as string, /Start time/);
  assert.match(createMeeting({ title: 'T', date: '2026-12-01', start_time: '09:00', slot_minutes: 2, section_ids: [sec] }, uid) as string, /between 5 and 60/);
  assert.match(createMeeting({ title: 'T', date: '2026-12-01', start_time: '09:00', section_ids: [] }, uid) as string, /at least one/);
  assert.match(createMeeting({ title: 'T', date: '2026-12-01', start_time: '09:00', end_time: '09:20', slot_minutes: 10, section_ids: [sec] }, uid) as string, /needs 30 minutes/);
  assert.match(createMeeting({ title: 'T', date: '2026-12-01', start_time: '09:00', exam_id: 99999, section_ids: [sec] }, uid) as string, /exam/);
  const r = createMeeting({ title: 'Term 2', date: '2026-12-01', start_time: '09:00', slot_minutes: 10, exam_id: ex2, att_from: month, att_to: month, venue: 'Hall', section_ids: [sec] }, uid) as { id: number };
  meeting = r.id;
  const slots = db.prepare('SELECT student_id, slot_time FROM ptm_slots WHERE meeting_id = ? ORDER BY slot_time').all(meeting) as any[];
  assert.deepEqual(slots.map(s => s.slot_time), ['09:00', '09:10', '09:20']); assert.deepEqual(slots.map(s => s.student_id), [good, weak, mid]);
});
test('priority order puts students who need a call first', () => {
  const r = createMeeting({ title: 'P', date: '2026-12-02', start_time: '10:00', exam_id: ex2, order: 'priority', section_ids: [sec] }, uid) as { id: number };
  const first = db.prepare('SELECT student_id FROM ptm_slots WHERE meeting_id = ? ORDER BY slot_time LIMIT 1').get(r.id) as any;
  assert.equal(first.student_id, weak);   // 20% fails and fell by 30%
});
test('student report: marks, class average, rank, change, history, attendance, talking points', () => {
  const r = studentReport(meeting, weak)!;
  assert.equal(r.result.pct, 20); assert.equal(r.result.result, 'FAIL'); assert.equal(r.result.rank, 3);
  assert.equal(r.result.delta, -30); assert.equal(r.result.prev.name, 'P-Test 1'); assert.equal(r.result.subjects[0].classAvg, 56.7);
  assert.deepEqual(r.history.map((h: any) => h.pct), [50, 20]);
  assert.equal(r.attendance.absent, 5); assert.equal(r.attendance.pct, 50); assert.equal(r.attendance.low, true); assert.equal(r.attendance.absentDates.length, 5);
  const texts = r.points.map((p: any) => p.text).join(' | ');
  assert.match(texts, /Did not pass: P-Math/); assert.match(texts, /fell by 30%/); assert.match(texts, /below the class average/); assert.match(texts, /Attendance is 50%/);
  const g = studentReport(meeting, good)!;
  assert.equal(g.result.rank, 1); assert.ok(g.points.some((p: any) => p.kind === 'good' && /Position 1/.test(p.text))); assert.ok(g.points.some((p: any) => /Excellent attendance/.test(p.text)));
  assert.equal(studentReport(meeting, 999999), null);
});
test('class report: pass rate, averages, attendance summary, meeting counts', () => {
  const c = classReport(meeting, sec)!;
  assert.equal(c.result!.students, 3); assert.equal(c.result!.pass, 2); assert.equal(c.result!.fail, 1); assert.equal(c.result!.avg, 56.7);
  assert.equal(c.attendance.lowCount, 1); assert.equal(c.attendance.perfect, 2); assert.equal(c.attendance.avgPct, 83.3);
  assert.deepEqual(c.result!.top.map(t => t.name), ['Good', 'Mid', 'Weak']);
  assert.equal(c.meetingStats.pending, 3); assert.equal(c.students[1].needsCall, true);
  assert.equal(classReport(meeting, sectionOf(9, 'A')), null);
});
test('meeting without an exam still gives attendance', () => {
  const r = createMeeting({ title: 'No exam', date: '2026-12-03', start_time: '09:00', att_from: month, att_to: month, section_ids: [sec] }, uid) as { id: number };
  const s = studentReport(r.id, good)!; assert.equal(s.result, null); assert.equal(s.attendance.pct, 100);
  assert.equal(classReport(r.id, sec)!.result, null);
});
test('slot update: statuses, clash, follow-up sync with the exam module', () => {
  const slot = db.prepare('SELECT * FROM ptm_slots WHERE meeting_id = ? AND student_id = ?').get(meeting, weak) as any;
  assert.match(checkSlotUpdate({ status: 'x' }, slot) as string, /status/);
  assert.match(checkSlotUpdate({ slot_time: '09:00' }, slot) as string, /already/);
  assert.match(checkSlotUpdate({ slot_time: '25:00' }, slot) as string, /Time/);
  assert.match(checkSlotUpdate({ follow_up: 'zzz' }, slot) as string, /Follow-up/);
  assert.match(checkSlotUpdate({}, slot) as string, /Nothing/);
  db.prepare("INSERT INTO exam_followups (exam_id, student_id, reason, status) VALUES (?,?,'fail','meeting_set')").run(ex2, weak);
  const v = checkSlotUpdate({ status: 'attended', attended_by: 'Father', discussed: 'Maths help' }, slot) as any;
  assert.equal(v.sets.attended_by, 'Father');
  syncFollowup(slot, 'attended', '2026-12-01');
  const f = db.prepare('SELECT status, ptm_date FROM exam_followups WHERE exam_id = ? AND student_id = ?').get(ex2, weak) as any;
  assert.equal(f.status, 'attended'); assert.equal(f.ptm_date, '2026-12-01');
  assert.equal((checkSlotUpdate({ status: 'no_show', attended_by: 'x' }, slot) as any).sets.attended_by, '');
});
test('late joiner gets the next free slot; invitations use a valid international number', () => {
  const late = addStudent({ name: 'Late', section: sec }); db.prepare('UPDATE students SET roll_no = 4 WHERE id = ?').run(late);
  assert.equal(addLateStudents(meeting), 1); assert.equal(addLateStudents(meeting), 0);
  assert.equal((db.prepare('SELECT slot_time t FROM ptm_slots WHERE meeting_id = ? AND student_id = ?').get(meeting, late) as any).t, '09:30');
  assert.equal(phoneIntl('0300-1234567'), '923001234567'); assert.equal(phoneIntl('+92 300 1234567'), '923001234567'); assert.equal(phoneIntl('123'), null);
  const inv = invitations(meeting, sec, 'KRL College'); const g = inv.find(i => i.student === 'Good')!;
  assert.equal(g.phone, '923001234567'); assert.match(g.message, /09:00/); assert.match(g.message, /Hall/); assert.equal(inv.find(i => i.student === 'Weak')!.phone, null);
});
test('talking points stay quiet when there is nothing to say', () => {
  assert.deepEqual(talkingPoints({ result: 'PASS', failed: [], delta: 1, prevName: 'x', dropPct: 5, rank: 10, students: 30, subjects: [], att: { pct: 85, absent: 3, late: 1, recorded: 20 }, lowAtt: 75, concerns: 0 }), []);
  assert.equal(attendanceFor([good], month, month).get(good)!.recorded, 10);
});
