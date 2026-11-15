import './setup.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { db } from '../src/db.js';
import { addDays, todayISO } from '../src/attendance/service.js';
import { DUTIES, dutiesOf, hasDuty, listStaffDuties, setDuties } from '../src/duties.js';
import { readXlsx } from '../src/import/xlsx.js';
import { checkRows, readRows, templateCsv, toFileRows } from '../src/exam/marksfile.js';
import { checkStaffUpload, sniff } from '../src/myfiles/service.js';
import { checkPaperFile, createRequests, listRequests, markPrinted, remind, review, submit, suggestFromExam, summary } from '../src/papers/service.js';
import { classList, remindTeacher, tracker } from '../src/testdept/service.js';
import { portal } from '../src/teacher/service.js';
import { addStudent, classOf, sectionOf } from './helpers.js';

const U = (id: number, role: any, duties: string[] = []) => ({ id, name: `u${id}`, username: `u${id}`, role, duties });
let boss = 0, t1 = 0, t2 = 0, acct = 0, tr1 = 0, sec = 0, cls = 0, math = 0, urdu = 0;
const pdf = Buffer.from('%PDF-1.4 x'), zip = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(8)]);

// A tiny zip writer so the xlsx test needs no fixture file.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), comp = zlib.deflateRawSync(data), nb = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, comp); central.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const xlsx = (rows: (string | number)[][], shared = true) => {
  const strings: string[] = [];
  const sheet = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => { const ref = `${String.fromCharCode(65 + j)}${i + 1}`; if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`; if (shared) { strings.push(v); return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`; } return `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`; }).join('')}</row>`).join('');
  return makeZip({ 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheet}</sheetData></worksheet>`, ...(shared ? { 'xl/sharedStrings.xml': `<sst>${strings.map(s => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>` } : {}) });
};

before(() => {
  const mk = (n: string, role: string, active = 1) => Number(db.prepare('INSERT INTO users (name, username, password_hash, role, active) VALUES (?,?,?,?,?)').run(n, n, 'x', role, active).lastInsertRowid);
  boss = mk('pb', 'principal'); t1 = mk('pt1', 'teacher'); t2 = mk('pt2', 'teacher'); acct = mk('pa', 'accountant');
  tr1 = Number(db.prepare('INSERT INTO teachers (name, user_id) VALUES (?,?)').run('Teacher One', t1).lastInsertRowid);
  cls = classOf(9); sec = sectionOf(9, 'E'); db.prepare('DELETE FROM students WHERE section_id = ?').run(sec);
  math = Number(db.prepare("INSERT INTO subjects (name) VALUES ('TP-Math')").run().lastInsertRowid); urdu = Number(db.prepare("INSERT INTO subjects (name) VALUES ('TP-Urdu')").run().lastInsertRowid);
});

test('duties: only active teachers, only known duties, fresh from the database', () => {
  assert.match(setDuties(boss, ['exam_dept'], boss) as string, /teachers only/); assert.match(setDuties(99999, [], boss) as string, /not found/);
  assert.match(setDuties(t1, ['nope'], boss) as string, /Unknown duty/);
  assert.deepEqual(setDuties(t1, ['timetable_team', 'exam_dept', 'exam_dept'], boss), ['exam_dept', 'timetable_team']);
  assert.deepEqual(dutiesOf(t1), ['exam_dept', 'timetable_team']); assert.equal(hasDuty({ duties: dutiesOf(t1) }, 'exam_dept'), true); assert.equal(hasDuty({ duties: dutiesOf(t2) }, 'exam_dept'), false);
  assert.ok(listStaffDuties().find(s => s.id === t1)!.duties.includes('timetable_team'));
  assert.deepEqual(setDuties(t1, [], boss), []); assert.ok(Object.keys(DUTIES).length === 3);
});
test('xlsx reader: shared strings, inline strings, numbers and gaps', () => {
  const rows = readXlsx(xlsx([['Reg No', 'Name', 'Marks'], ['R-1', 'Ali & Co', 45], ['R-2', 'Bina', 38.5]]));
  assert.deepEqual(rows, [['Reg No', 'Name', 'Marks'], ['R-1', 'Ali & Co', '45'], ['R-2', 'Bina', '38.5']]);
  assert.deepEqual(readXlsx(xlsx([['A', 'B'], ['x', 2]], false)), [['A', 'B'], ['x', '2']]);
  assert.throws(() => readXlsx(Buffer.from('not a zip at all, definitely not')), /not an Excel/);
});
test('marks file: template round trip, aliases, blanks, A and L, errors', () => {
  const students = [{ id: 1, reg_no: 'R-1', roll_no: 1, name: 'Ali' }, { id: 2, reg_no: 'R-2', roll_no: 2, name: 'Bina' }, { id: 3, reg_no: 'R-3', roll_no: 3, name: 'Cara' }, { id: 4, reg_no: 'R-4', roll_no: 4, name: 'Dina' }];
  const csv = templateCsv({ max_marks: 50 }, students.map(s => ({ ...s, marks: null, status: null })));
  assert.match(csv, /Marks \(max 50\)/);
  const fromTemplate = toFileRows(readRows(Buffer.from(csv.replace('R-1,1,Ali,,', 'R-1,1,Ali,45,')), 'm.csv')) as any[]; assert.equal(fromTemplate.length, 4); assert.equal(fromTemplate[0].marks, '45');
  const x = toFileRows(readRows(xlsx([['Roll Number', 'Student', 'Obtained'], [1, 'Ali', 45], [2, 'Bina', 'A'], [3, 'Cara', 51], [3, 'Cara', 20], [9, 'Ghost', 10], [4, 'Dina', '']]), 'm.xlsx')) as any[];
  const c = checkRows(x, 50, students);
  assert.deepEqual(c[0].entry, { marks: 45, status: 'P' }); assert.deepEqual(c[1].entry, { marks: null, status: 'A' }); assert.match(c[2].problem!, /outside 0 to 50/);
  assert.match(c[3].problem!, /twice/); assert.match(c[4].problem!, /not found/); assert.equal(c[5].skipped, true); assert.equal(c[5].problem, null);
  assert.match(toFileRows([['Name', 'Class'], ['x', 'y']]) as string, /column names/);
  assert.throws(() => readRows(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(20)]), 'old.xls'), /\.xls/);
  assert.equal(checkRows([{ line: 2, reg_no: 'R-1', roll_no: '', name: '', marks: 'abc', status: '' }], 50, students)[0].problem!.includes('not a number'), true);
  assert.equal(checkRows([{ line: 2, reg_no: 'R-1', roll_no: '', name: '', marks: '40', status: 'X' }], 50, students)[0].problem!.includes('not P, A or L'), true);
});
test('personal files: type is checked against the content', () => {
  assert.ok(typeof sniff(pdf, 'a.pdf', '') === 'object'); assert.ok(typeof sniff(zip, 'a.docx', '') === 'object'); assert.ok(typeof sniff(Buffer.from('a,b\n1,2'), 'm.csv', '') === 'object');
  assert.match(sniff(Buffer.from('MZ'), 'virus.exe', 'application/octet-stream') as string, /Allowed/); assert.match(sniff(zip, 'a.pdf', '') as string, /does not match/);
  assert.match(sniff(Buffer.from([1, 0, 2]), 'fake.csv', '') as string, /does not match/); assert.match(sniff(Buffer.alloc(0), 'a.pdf', '') as string, /empty/);
  assert.match(checkStaffUpload(pdf, { kind: 'paper' }, '') as string, /title/); assert.match(checkStaffUpload(pdf, { title: 'x', kind: 'zzz' }, '') as string, /kind/);
  assert.equal((checkStaffUpload(pdf, { title: ' Paper ', kind: 'paper', name: '../x.pdf' }, '') as any).name.includes('/'), false);
});
test('paper setting: request, submit, review, print, remind', () => {
  const dept = U(t2, 'teacher', ['exam_dept']), tomorrow = addDays(todayISO(), 1);
  assert.match(createRequests({ title: 'Mid', due_date: addDays(todayISO(), -1), items: [{ class_id: cls, subject_id: math, teacher_user_id: t1 }] }, dept) as string, /past/);
  assert.match(createRequests({ title: 'Mid', due_date: tomorrow, items: [{ class_id: cls, subject_id: math, teacher_user_id: acct }] }, dept) as string, /Choose a teacher/);
  assert.match(createRequests({ title: 'Mid', due_date: tomorrow, items: [] }, dept) as string, /at least one/);
  assert.match(createRequests({ title: 'Mid', due_date: tomorrow, items: [{ class_id: cls, subject_id: math, teacher_user_id: t1 }, { class_id: cls, subject_id: math, teacher_user_id: t1 }] }, dept) as string, /twice/);
  addStudent({ section: sec }); addStudent({ section: sec });
  const made = createRequests({ title: 'Mid-term papers', due_date: tomorrow, instructions: 'Use the new pattern', items: [{ class_id: cls, subject_id: math, teacher_user_id: t1 }, { class_id: cls, subject_id: urdu, teacher_user_id: t1, copies: 40 }] }, dept) as { ids: number[] };
  assert.equal(made.ids.length, 2); assert.match(createRequests({ title: 'Mid-term papers', due_date: tomorrow, items: [{ class_id: cls, subject_id: math, teacher_user_id: t2 }] }, dept) as string, /already has/);
  const [a, b] = made.ids; const copiesA = (db.prepare('SELECT copies FROM paper_requests WHERE id = ?').get(a) as any).copies; assert.ok(copiesA >= 2);
  assert.equal(listRequests(U(t1, 'teacher'), false, {}).length, 2); assert.equal(listRequests(U(t2, 'teacher'), false, {}).length, 0);
  assert.match(submit(a, U(t2, 'teacher'), pdf, 'x.pdf', '') as string, /not found/); assert.match(submit(a, U(t1, 'teacher'), Buffer.from('MZ'), 'x.exe', '') as string, /Allowed|PDF/);
  assert.match(checkPaperFile(Buffer.from('a,b'), 'x.csv', '') as string, /PDF, Word/);
  assert.deepEqual(submit(a, U(t1, 'teacher'), pdf, 'math.pdf', 'application/pdf'), { version: 1 }); assert.deepEqual(submit(a, U(t1, 'teacher'), pdf, 'math2.pdf', ''), { version: 2 });
  assert.match(review(b, 'approve', '', dept) as string, /Only a submitted/); assert.match(review(a, 'return', '', dept) as string, /what the teacher should change/);
  assert.deepEqual(review(a, 'return', 'Add marking scheme', dept), { status: 'returned' }); assert.equal(listRequests(U(t1, 'teacher'), false, {}).find(r => r.id === a)!.remark, 'Add marking scheme');
  submit(a, U(t1, 'teacher'), pdf, 'math3.pdf', ''); assert.deepEqual(review(a, 'approve', '', dept), { status: 'approved' });
  assert.match(submit(a, U(t1, 'teacher'), pdf, 'late.pdf', '') as string, /already approved/);
  assert.match(markPrinted(b, dept) as string, /approved/); assert.deepEqual(markPrinted(a, dept, 60), { print_count: 1 }); assert.deepEqual(markPrinted(a, dept), { print_count: 2 });
  const r = remind(b, dept) as { task_id: number }; assert.ok(r.task_id > 0); assert.equal((db.prepare('SELECT assigned_to FROM tasks WHERE id = ?').get(r.task_id) as any).assigned_to, t1);
  assert.match(remind(a, dept) as string, /nothing pending/);
  db.prepare('UPDATE paper_requests SET due_date = ? WHERE id = ?').run(addDays(todayISO(), -2), b);
  const all = listRequests(dept, true, {}); assert.equal(all.find(x => x.id === b)!.overdue, true); const sm = summary(all); assert.ok(sm.overdue >= 1 && sm.printed >= 1);
});
test('paper setting suggestions come from the exam module', () => {
  const ex = Number(db.prepare("INSERT INTO exams (name, kind, session, status) VALUES ('TP-Exam','test','2026-27','open')").run().lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO exam_classes (exam_id, class_id) VALUES (?,?)').run(ex, cls);
  db.prepare('INSERT INTO exam_papers (exam_id, section_id, subject_id, teacher_id, max_marks) VALUES (?,?,?,?,50)').run(ex, sec, math, tr1);
  db.prepare('INSERT INTO exam_papers (exam_id, section_id, subject_id, teacher_id, max_marks) VALUES (?,?,?,?,50)').run(ex, sectionOf(9, 'D'), math, tr1);
  const s = suggestFromExam(ex); assert.equal(s.length, 1); assert.equal(s[0].teacher_user_id, t1);
});
test('test department: tracker, class list and reminders', () => {
  const ex = (db.prepare("SELECT id FROM exams WHERE name = 'TP-Exam'").get() as any).id as number;
  const paper = (db.prepare('SELECT id FROM exam_papers WHERE exam_id = ? AND section_id = ?').get(ex, sec) as any).id as number;
  const kids = db.prepare("SELECT id FROM students WHERE section_id = ? AND status = 'active' ORDER BY id").all(sec) as any[];
  db.prepare("INSERT INTO exam_marks (paper_id, student_id, marks, status) VALUES (?,?,?,'P')").run(paper, kids[0].id, 40);
  const t = tracker(ex)!; const mine = t.papers.find(p => p.id === paper)!; assert.equal(mine.state, 'partial'); assert.equal(t.teachers[0].teacher, 'Teacher One'); assert.ok(t.teachers[0].pending >= 1); assert.equal(tracker(99999), null);
  const r = remindTeacher(ex, tr1, U(boss, 'principal')) as { task_id: number }; assert.ok(r.task_id > 0);
  assert.match(remindTeacher(ex, 99999, U(boss, 'principal')) as string, /not found/);
  db.prepare("INSERT INTO exam_marks (paper_id, student_id, marks, status) VALUES (?,?,?,'P')").run(paper, kids[1].id, 30);
  const l = classList(ex, sec)!; assert.equal(l.subjects.length, 1); assert.match(l.csv, /TP-Math \(50\)/); assert.equal(l.rows.length, kids.length); assert.equal(classList(99999, sec), null);
});
test('teacher portal: classes, today, what is waiting', () => {
  assert.equal(portal(U(t1, 'teacher')).waiting.marksToEnter, 0);   // the test above completed the marks
  db.prepare('DELETE FROM exam_marks WHERE rowid = (SELECT MAX(rowid) FROM exam_marks)').run();
  const p = portal(U(t1, 'teacher', []));
  assert.equal(p.linked, true); assert.equal(p.teacher.name, 'Teacher One'); assert.ok(p.waiting.papersToSet >= 1); assert.ok(p.waiting.marksToEnter >= 1);
  const none = portal(U(t2, 'teacher')); assert.equal(none.linked, false); assert.deepEqual(none.subjects, []);
});
