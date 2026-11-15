import './setup.js';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, setSetting } from '../src/db.js';
import { applyCategoryRules, categoryPreview, previewVouchers } from '../src/fee/service.js';
import { documentChecklist, logCategoryChange } from '../src/students/audit.js';
import { bulkCategory, categoryReport, categoryReportCsv, studentsCsv } from '../src/students/reports.js';
import { cnicCheck, findDuplicate, firstVoucher, formatError, makeRegNo } from '../src/students/admission.js';
import { addHead, addRule, addStudent, classOf, concessionsOf, resetFees, sectionOf, setFee } from './helpers.js';

const cls = classOf(8);
let tuition = 0, lab = 0;
beforeEach(() => {
  db.prepare('DELETE FROM fee_category_fees').run(); resetFees();
  tuition = addHead('Tuition', { concessionable: 1 }); lab = addHead('Lab', { concessionable: 1 });
  setFee(cls, tuition, 10000); setFee(cls, lab, 2000);
});
const fixedFee = (cat: string, head: number, amount: number) => db.prepare('INSERT INTO fee_category_fees (class_id, category, head_id, amount) VALUES (?,?,?,?)').run(cls, cat, head, amount);
const rowOf = (p: ReturnType<typeof categoryPreview>, head: number) => p.rows.find(r => r.head_id === head)!;

// ---------- B5 ----------
test('B5: a fixed fee replaces the class amount; that head gets no category discount, other heads still do', () => {
  fixedFee('A', tuition, 6000); addRule('A', null, 'percent', 50);
  const p = categoryPreview(cls, 'A');
  assert.equal(rowOf(p, tuition).amount, 6000); assert.equal(rowOf(p, tuition).discount, 0); assert.equal(rowOf(p, tuition).fixed, true);
  assert.equal(rowOf(p, lab).amount, 2000); assert.equal(rowOf(p, lab).discount, 1000);
  assert.equal(categoryPreview(cls, 'B').rows.find(r => r.head_id === tuition)!.amount, 10000);   // other categories keep the class fee
  assert.equal(categoryPreview(cls, null).rows.find(r => r.head_id === tuition)!.amount, 10000);
});
test('B5: without a fixed fee the discount rules apply as before', () => {
  addRule('A', null, 'percent', 50);
  assert.equal(categoryPreview(cls, 'A').rows.reduce((a, r) => a + r.discount, 0), 6000);   // 50% of tuition + lab (worked out on the pooled amount)
});
test('B5: a fixed fee of 0 makes the head free', () => {
  fixedFee('C', lab, 0);
  assert.equal(categoryPreview(cls, 'C').rows.some(r => r.head_id === lab), false);
});
test('B5: the voucher charges what the preview shows for a fixed-fee category', () => {
  fixedFee('A', tuition, 6000); addRule('A', null, 'percent', 50);
  const s = addStudent({ category: 'A', section: sectionOf(8) }); applyCategoryRules(s);
  const v = previewVouchers({ period: '2098-01', label: 'x', issueDate: '2098-01-01', dueDate: '2098-01-10', scope: { studentId: s }, includeMonthly: true, includeHeadIds: [], lateFine: 0, createdBy: null });
  assert.equal(v.total, categoryPreview(cls, 'A').monthly);   // 6000 + (2000 - 50%)
  assert.equal(v.total, 7000);
});

// ---------- B6 ----------
test('B6: the category history records real changes only', () => {
  const s = addStudent({});
  assert.equal(logCategoryChange(s, null, 'A', null, 'Admission'), true);
  assert.equal(logCategoryChange(s, 'A', 'A', null), false);
  assert.equal(logCategoryChange(s, 'A', '' as any, null), true);
  assert.equal(logCategoryChange(s, null, null, null), false);
  assert.deepEqual((db.prepare('SELECT old_category o, new_category n FROM category_change_log WHERE student_id = ? ORDER BY id').all(s) as any[]).map(r => `${r.o}>${r.n}`), ['null>A', 'A>null']);
});
test('B6: the document checklist depends on the category', () => {
  const a = addStudent({ category: 'A' }), b = addStudent({ category: 'B' }), c = addStudent({ category: 'C' });
  assert.deepEqual(documentChecklist(a)!.missing, ['B-form', 'Birth certificate', 'Father CNIC copy', 'Last result card', 'KRL service card']);
  assert.ok(documentChecklist(b)!.missing.includes('KRL pension proof') && !documentChecklist(b)!.missing.includes('KRL service card'));
  assert.equal(documentChecklist(c)!.missing.length, 4);
  assert.equal(documentChecklist(999999), null);
  db.prepare("INSERT INTO student_documents (student_id, doc_type, filename, mime, size, data) VALUES (?, 'bform', 'f.pdf', 'application/pdf', 4, x'25504446')").run(c);
  let d = documentChecklist(c)!; assert.equal(d.missing.length, 3); assert.deepEqual(d.unverified, ['B-form']);
  db.prepare('UPDATE student_documents SET verified = 1 WHERE student_id = ?').run(c);
  d = documentChecklist(c)!; assert.deepEqual(d.unverified, []);
});

// ---------- B7 ----------
test('B7: bulk category change for a class keeps a history, applies fees and can skip students who already have one', () => {
  addRule('A', null, 'percent', 50);
  const sec = sectionOf(9, 'A'), x = addStudent({ section: sec }), y = addStudent({ section: sec, category: 'B' }), left = addStudent({ section: sec, status: 'left' });
  const r1 = bulkCategory({ sectionId: sec, category: 'A', onlyUnset: true, by: null, reason: 'Term start' });
  assert.equal(r1.changed >= 1, true);
  const cat = (id: number) => (db.prepare('SELECT category FROM students WHERE id = ?').get(id) as any).category;
  assert.equal(cat(x), 'A'); assert.equal(cat(y), 'B'); assert.equal(cat(left), null);
  assert.ok(concessionsOf(x).some(c => c.reason?.startsWith('CAT:A')));
  assert.equal((db.prepare("SELECT reason FROM category_change_log WHERE student_id = ?").get(x) as any).reason, 'Term start');
  bulkCategory({ sectionId: sec, category: 'C', onlyUnset: false, by: null, reason: '' });
  assert.equal(cat(y), 'C'); assert.equal(cat(left), null);
  assert.equal(bulkCategory({ sectionId: sec, category: 'C', onlyUnset: false, by: null, reason: '' }).changed, 0);   // nothing to change the second time
});
test('B7: category report and CSV', () => {
  const s = addStudent({ category: 'A', section: sectionOf(10, 'A') });
  const r = categoryReport(null, null);
  assert.ok((r.counts as any[]).find(x => x.category === 'A').students >= 1);
  const csv = categoryReportCsv(r); assert.match(csv.split('\r\n')[0], /^Category,Students,Vouchers,Gross,Discount given/);
  assert.match(studentsCsv('A'), /Admission No,Name/); assert.ok(studentsCsv('A').includes(`T-`));
  assert.ok(s > 0);
});

// ---------- B8 ----------
test('B8: CNIC must be 13 digits and is saved with dashes', () => {
  assert.deepEqual(cnicCheck('3740512345671'), { value: '37405-1234567-1', error: null });
  assert.equal(cnicCheck('37405-1234567-1').value, '37405-1234567-1');
  assert.equal(cnicCheck('').error, null); assert.equal(cnicCheck(null).value, null);
  assert.match(cnicCheck('12345')!.error!, /13 digits/);
});
test('B8: duplicate admission needs same name, father name and date of birth', () => {
  const a = addStudent({ name: 'Zain Ali', father: 'Ali Khan', dob: '2012-02-02' });
  assert.equal(findDuplicate('zain  ali', 'ALI KHAN', '2012-02-02')?.id, a);
  assert.equal(findDuplicate('Zain Ali', 'Ali Khan', '2012-02-03'), null);
  assert.equal(findDuplicate('Zain Ali', 'Ali Khan', ''), null);
  assert.equal(findDuplicate('Zain Ali', 'Ali Khan', '2012-02-02', a), null);   // editing the same student is fine
});
test('B8: admission number formats', () => {
  const sec = sectionOf(7, 'A'), yy = String(new Date().getFullYear()).slice(2);
  setSetting('reg_format', '{YYYY}-{SEQ4}'); assert.match(makeRegNo(sec), /^\d{4}-\d{4}$/);
  setSetting('reg_format', '{CAMPUS}/{YY}/{CLASS}/{SEQ3}'); setSetting('campus_code', 'MAIN');
  const r = makeRegNo(sec); assert.match(r, new RegExp(`^MAIN/${yy}/07/\\d{3}$`));
  addStudent({}); db.prepare('UPDATE students SET reg_no = ? WHERE id = (SELECT MAX(id) FROM students)').run(r);
  assert.notEqual(makeRegNo(sec), r);   // a used number is never given twice
  setSetting('reg_format', '{YYYY}-{SEQ4}');
});
test('B8: the format is validated', () => {
  assert.equal(formatError('{YYYY}-{SEQ4}'), null); assert.equal(formatError('A-{SEQ}'), null);
  assert.match(formatError('{YYYY}')!, /running number/); assert.match(formatError('{FOO}-{SEQ}')!, /Unknown token/); assert.ok(formatError('<b>{SEQ}'));
});
test('B8: the first voucher is made only when switched on, and holds admission fee + first month', () => {
  const adm = addHead('Admission', { frequency: 'one_time' }); setFee(cls, adm, 3000);
  const s = addStudent({ section: sectionOf(8, 'A') });
  setSetting('first_voucher', '0'); assert.equal(firstVoucher(s, null).voucherId, null);
  setSetting('first_voucher', '1');
  const r = firstVoucher(s, null); assert.ok(r.voucherId, r.note ?? '');
  const v = db.prepare('SELECT net FROM vouchers WHERE id = ?').get(r.voucherId) as any; assert.equal(v.net, 3000 + 10000 + 2000);
  assert.equal(firstVoucher(s, null).voucherId, null);   // not twice in the same month
  setSetting('first_voucher', '0');
});
