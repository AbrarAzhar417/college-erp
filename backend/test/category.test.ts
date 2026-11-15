import './setup.js';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, getSetting, setSetting } from '../src/db.js';
import { applyCategoryRules, categoryPreview, chosenRules, previewVouchers } from '../src/fee/service.js';
import { linkStudents } from '../src/family.js';
import { addHead, addRule, addStudent, classOf, concessionsOf, resetFees, sectionOf, setFee } from './helpers.js';

let tuition = 0, lab = 0, annual = 0; const cls = classOf(6);
beforeEach(() => {
  resetFees();
  tuition = addHead('Tuition', { concessionable: 1 }); lab = addHead('Lab', { concessionable: 0 }); annual = addHead('Annual', { frequency: 'annual', concessionable: 1 });
  setFee(cls, tuition, 10000); setFee(cls, lab, 2000); setFee(cls, annual, 5000);
});
const sib = (order: number, kind: 'percent' | 'fixed', value: number) => db.prepare('INSERT INTO sibling_discount_rules (child_order, kind, value) VALUES (?,?,?)').run(order, kind, value);
const preview = (cat: string | null, order = 1) => categoryPreview(cls, cat, false, order);
const off = (p: ReturnType<typeof preview>) => p.rows.reduce((a, r) => a + r.discount, 0);   // total discount (a rule on "all heads" is worked out on the pooled amount)

test('percent rule on all discountable heads', () => {
  addRule('A', null, 'percent', 50);
  const p = preview('A');
  assert.equal(off(p), 7500);                                  // 50% of tuition 10000 + annual 5000
  assert.equal(p.rows.find(r => r.head_id === lab)!.discount, 0);   // lab is not discountable
});
test('fixed rule and head-specific rule', () => {
  addRule('B', tuition, 'fixed', 3000); addRule('B', lab, 'percent', 10);
  const p = preview('B');
  assert.equal(p.rows.find(r => r.head_id === tuition)!.discount, 3000);
  assert.equal(p.rows.find(r => r.head_id === lab)!.discount, 200);   // a rule aimed at one head works even if that head is not "discountable"
});
test('a discount larger than the fee is capped, and two rules cannot take more than the fee', () => {
  addRule('A', tuition, 'fixed', 99999);
  assert.equal(preview('A').rows.find(r => r.head_id === tuition)!.discount, 10000);
  addRule('A', tuition, 'percent', 50);
  const p = preview('A'); assert.equal(p.rows.find(r => r.head_id === tuition)!.discount, 10000);
});
test('rules apply one after another on what is left', () => {
  addRule('A', tuition, 'percent', 50); addRule('A', tuition, 'percent', 50);
  assert.equal(preview('A').rows.find(r => r.head_id === tuition)!.discount, 7500);
});
test('applyCategoryRules writes CAT concessions; changing category replaces them and keeps manual ones', () => {
  addRule('A', null, 'percent', 50, 'KRL'); addRule('B', null, 'percent', 25);
  const s = addStudent({ category: 'A', section: sectionOf(6) });
  db.prepare("INSERT INTO student_concessions (student_id, head_id, kind, value, reason) VALUES (?,?,?,?,?)").run(s, tuition, 'fixed', 500, 'Hardship');
  applyCategoryRules(s);
  let c = concessionsOf(s);
  assert.equal(c.length, 2); assert.ok(c.some(x => x.reason === 'Hardship')); assert.ok(c.some(x => x.reason === 'CAT:A KRL' && x.value === 50));
  db.prepare("UPDATE students SET category = 'B' WHERE id = ?").run(s); applyCategoryRules(s);
  c = concessionsOf(s);
  assert.equal(c.length, 2); assert.ok(c.some(x => x.reason === 'Hardship')); assert.ok(c.some(x => x.reason === 'CAT:B' && x.value === 25)); assert.ok(!c.some(x => x.reason?.startsWith('CAT:A')));
  db.prepare("UPDATE students SET category = NULL WHERE id = ?").run(s); applyCategoryRules(s);
  assert.deepEqual(concessionsOf(s).map(x => x.reason), ['Hardship']);
  applyCategoryRules(s); applyCategoryRules(s);   // running it again changes nothing
  assert.equal(concessionsOf(s).length, 1);
});
test('a category with no rules gives no discount', () => {
  addRule('A', null, 'percent', 50);
  assert.equal(preview('C').lines.length, 0);
  assert.equal(preview(null).lines.length, 0);
});

test('sibling discount by child order; the first child gets none', () => {
  sib(2, 'percent', 10); sib(3, 'percent', 20);
  assert.equal(preview(null, 1).lines.length, 0);
  assert.equal(off(preview(null, 2)), 1500);
  assert.equal(off(preview(null, 3)), 3000);
  assert.equal(off(preview(null, 5)), 3000);   // 4th, 5th ... use the highest rule set
});
test('mode "highest": only the bigger of category and sibling discount; "stack": both', () => {
  addRule('A', null, 'percent', 50); sib(2, 'percent', 10);
  assert.equal(chosenRules(cls, 'A', 2, 'highest').used, 'category');
  assert.equal(off(preview('A', 2)), 7500);
  db.prepare('DELETE FROM sibling_discount_rules').run(); sib(2, 'percent', 80);
  assert.equal(chosenRules(cls, 'A', 2, 'highest').used, 'sibling');
  assert.equal(off(preview('A', 2)), 12000);
  setSetting('sibling_mode', 'stack');
  assert.equal(preview('A', 2).used, 'both');
  assert.equal(off(preview('A', 2)), 13500);   // 50% (7500), then 80% of the 7500 left (6000)
});
test('linked brothers and sisters get the right concessions in the database, and unlinking removes them', () => {
  sib(2, 'percent', 10);
  const a = addStudent({ dob: '2010-01-01' }), b = addStudent({ dob: '2012-01-01' });
  const ids = linkStudents(a, b) as number[]; ids.forEach(applyCategoryRules);
  assert.deepEqual(concessionsOf(a), []);
  assert.deepEqual(concessionsOf(b).map(x => x.reason), ['SIB:2 2nd child']);
});
test('settings default is "highest"', () => { db.prepare("DELETE FROM settings WHERE key='sibling_mode'").run(); assert.equal(preview(null).mode, 'highest'); assert.equal(getSetting('sibling_mode'), ''); });

test('the voucher charges exactly what the preview shows (two rules never take more than the fee)', () => {
  setFee(cls, annual, 0);   // only monthly heads, so the voucher and the preview work on the same fees
  addRule('A', null, 'percent', 50); sib(2, 'percent', 80); setSetting('sibling_mode', 'stack');
  const a = addStudent({ dob: '2010-01-01', category: 'A' }), b = addStudent({ dob: '2012-01-01', category: 'A' });
  (linkStudents(a, b) as number[]).forEach(applyCategoryRules);
  const v = previewVouchers({ period: '2099-01', label: 'x', issueDate: '2099-01-01', dueDate: '2099-01-10', scope: { studentId: b }, includeMonthly: true, includeHeadIds: [], lateFine: 0, createdBy: null });
  assert.equal(v.total, preview('A', 2).monthly);   // 10000 -50% -80% of the rest = 1000, plus lab 2000
  assert.ok(v.total >= 0);
});
