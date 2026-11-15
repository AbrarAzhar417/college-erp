import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { parseCsv } from '../src/import/csv.js';
import { parseClass, parseDate, parseGender, parseMoney } from '../src/import/values.js';
import { analyze, autoMap, commit, detectKind } from '../src/import/importer.js';
import { siblingOrder } from '../src/family.js';
import './helpers.js';
import '../src/hr/schema.js';

const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n as number;

test('csv: quotes, commas inside quotes, semicolons, tabs, BOM and blank lines', () => {
  assert.deepEqual(parseCsv('﻿a,b\n"x, y","say ""hi"""\n\n').rows, [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.equal(parseCsv('a;b;c\n1;2;3').delimiter, ';');
  assert.equal(parseCsv('a\tb\n1\t2').delimiter, '\t');
  assert.deepEqual(parseCsv('a,b\r\n"line1\nline2",2').rows[1], ['line1\nline2', '2']);
});
test('values: dates, classes, gender, money', () => {
  assert.equal(parseDate('15/03/2012'), '2012-03-15'); assert.equal(parseDate('2012-3-5'), '2012-03-05'); assert.equal(parseDate('5 Jan 2010'), '2010-01-05');
  assert.equal(parseDate('31/02/2012'), null); assert.equal(parseDate('hello'), null); assert.equal(parseDate('40179'), '2010-01-01');
  assert.deepEqual(parseClass('6-A'), { grade: 6, section: 'A' }); assert.deepEqual(parseClass('Class Six B'), { grade: 6, section: 'B' });
  assert.deepEqual(parseClass('10th'), { grade: 10, section: null }); assert.deepEqual(parseClass('IX-C'), { grade: 9, section: 'C' }); assert.deepEqual(parseClass('9B'), { grade: 9, section: 'B' });
  assert.equal(parseClass('Nursery').grade, null);
  assert.equal(parseGender('Boy'), 'male'); assert.equal(parseGender('F'), 'female'); assert.equal(parseGender('?'), null);
  assert.equal(parseMoney('Rs. 45,000'), 45000); assert.equal(parseMoney('abc'), null); assert.equal(parseMoney(''), 0);
});
test('columns with different names are matched, and the file kind is detected', () => {
  const h = ["Student's Name", 'F/Name', 'Class', 'Sec', 'GR No', 'D.O.B', 'Father CNIC #', 'Mobile No.'];
  const m = autoMap('students', h);
  assert.equal(m["Student's Name"], 'name'); assert.equal(m['Sec'], 'section'); assert.equal(m['GR No'], 'reg_no'); assert.equal(m['Mobile No.'], 'phone'); assert.equal(m['Father CNIC #'], 'father_cnic');
  assert.equal(detectKind(h), 'students');
  assert.equal(detectKind(['Employee Name', 'Designation', 'Salary', 'Date of Joining', 'CNIC']), 'staff');
});

const OLD = [
  'Name of Student;Father Name;Class;Sec;Adm No;DOB;CNIC;Contact;Status',
  'Ali Raza;Muhammad Aslam;6;A;OLD-1;15/03/2012;37405-1234567-1;0300 1234567;Active',
  'Sara Raza;Muhammad Aslam;Class 8-B;;OLD-2;02-07-2010;3740512345671;+92 300 1234567;Active',
  'Old Boy;Tariq;10th;C;OLD-3;01/01/2000;;03451112223;Left',
  'No Class;Tariq;Nursery;;OLD-4;;;;',
  'Bad Date;Tariq;7;A;OLD-5;31/02/2012;;;',
  ';Tariq;7;A;OLD-6;;;;',
  'Far Away;Tariq;5;A;OLD-7;;;;'
].join('\n');

test('analyze reads a messy file, reports row problems, and writes nothing', () => {
  const before = count('students'), classes = count('classes');
  const r = analyze(OLD, {}); if ('error' in r) throw new Error(r.error);
  assert.equal(r.kind, 'students'); assert.equal(r.delimiter, ';');
  assert.equal(r.counts.total, 7); assert.equal(r.counts.new, 3); assert.equal(r.counts.error, 4);
  const msg = (n: number) => r.rows.find(x => x.line === n)!.problems.join(' ');
  assert.match(msg(5), /not understood/); assert.match(msg(6), /valid date/); assert.match(msg(7), /name is empty/); assert.match(msg(8), /does not exist/);
  assert.equal(count('students'), before); assert.equal(count('classes'), classes);
});
test('commit saves good rows, keeps left students as left, links brothers and sisters, and returns the rejected rows', () => {
  const r = commit(OLD, {}); if ('error' in r) throw new Error(r.error);
  assert.equal(r.saved, 3); assert.equal(r.errors, 4); assert.equal(r.families_linked >= 1, true);
  assert.match(r.rejected_csv, /Why it was not saved/); assert.equal(r.rejected_csv.split('\r\n').length, 5);
  const row = (reg: string) => db.prepare('SELECT * FROM students WHERE reg_no = ?').get(reg) as any;
  assert.equal(row('OLD-1').dob, '2012-03-15'); assert.equal(row('OLD-2').dob, '2010-07-02'); assert.equal(row('OLD-3').status, 'left'); assert.equal(row('OLD-3').roll_no, null);
  assert.equal(row('OLD-1').father_cnic, '37405-1234567-1');
  assert.ok(row('OLD-1').family_id && row('OLD-1').family_id === row('OLD-2').family_id);
  assert.equal(siblingOrder(row('OLD-2').id), 1);   // born 2010, older than Ali
  assert.equal(siblingOrder(row('OLD-1').id), 2);
});
test('uploading the same file again saves nothing new (safe to repeat)', () => {
  const before = count('students');
  const r = commit(OLD, {}); if ('error' in r) throw new Error(r.error);
  assert.equal(r.saved, 0); assert.equal(r.duplicates, 3); assert.equal(count('students'), before);
});
test('missing classes are created only when asked', () => {
  const f = 'Name,Class\nNew Kid,5-A';
  assert.equal((analyze(f, {}) as any).counts.error, 1);
  const a = analyze(f, { createMissing: true }) as any; assert.equal(a.counts.new, 1);
  assert.equal(db.prepare('SELECT 1 FROM classes WHERE grade = 5').get(), undefined);   // preview did not create it
  const r = commit(f, { createMissing: true }) as any; assert.equal(r.saved, 1);
  assert.ok(db.prepare('SELECT 1 FROM classes WHERE grade = 5').get());
});
test('a column can be re-mapped by hand', () => {
  const f = 'Pupil,Level,Parent\nMapped Kid,7-B,Some Father';
  const a = analyze(f, { mapping: { Pupil: 'name', Level: 'class', Parent: 'father_name' } }) as any;
  assert.equal(a.counts.new, 1);
  const c = commit(f, { mapping: { Pupil: 'name', Level: 'class', Parent: 'father_name' } }) as any; assert.equal(c.saved, 1);
  assert.equal((db.prepare("SELECT father_name FROM students WHERE name = 'Mapped Kid'").get() as any).father_name, 'Some Father');
});
test('staff file: type guessed from the post, salary read, duplicates skipped', () => {
  const f = 'Employee Name,Designation,Salary,Date of Joining,CNIC,Mobile\nSara Khan,Math Teacher,"Rs 45,000",01/08/2019,37405-7654321-2,0312-7654321\nBilal,Driver,30000,1/1/2020,,0300-0000001\nNo Salary Date,Peon,x,,,';
  const a = analyze(f, {}) as any; assert.equal(a.kind, 'staff'); assert.equal(a.counts.new, 2); assert.equal(a.counts.error, 1);
  const c = commit(f, {}) as any; assert.equal(c.saved, 2);
  const s = db.prepare("SELECT * FROM hr_staff WHERE name = 'Sara Khan'").get() as any;
  assert.equal(s.staff_type, 'teacher'); assert.equal(s.kind, 'teaching'); assert.equal(s.basic_salary, 45000); assert.match(s.emp_no, /^E-\d+$/);
  assert.equal((db.prepare("SELECT staff_type, kind FROM hr_staff WHERE name = 'Bilal'").get() as any).kind, 'transport');
  assert.equal((commit(f, {}) as any).saved, 0);
});
test('a file without a name column is rejected with a clear message', () => {
  const a = analyze('Foo,Bar\n1,2', {}) as any; assert.equal(a.counts.error, 1); assert.match(a.rows[0].problems[0], /No column is matched/);
  assert.ok('error' in (analyze('only header', {}) as any));
});
