import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { acceptStrong, familyView, findSiblings, linkStudents, siblingOrder, unlinkStudent } from '../src/family.js';
import { addStudent, sectionOf } from './helpers.js';

const ids = (r: { id: number }[]) => r.map(x => x.id).sort((a, b) => a - b);

test('phone matches in any common format', () => {
  const a = addStudent({ fphone: '03001234567' });
  for (const p of ['0300 1234567', '+92 300 1234567', '0300-1234567', '92-300-1234567', '(0300) 123 4567'])
    assert.deepEqual(ids(findSiblings(null, [p])), [a], p);
});
test('a phone on the mother or home number also matches', () => {
  const m = addStudent({ mphone: '0312-7654321' }), h = addStudent({ phone: '0333 1112223' });
  assert.ok(ids(findSiblings('', ['03127654321'])).includes(m));
  assert.ok(ids(findSiblings('', ['+923331112223'])).includes(h));
});
test('CNIC matches with and without dashes; a short CNIC does not', () => {
  const a = addStudent({ cnic: '37405-1234567-1' });
  assert.deepEqual(ids(findSiblings('3740512345671', [])), [a]);
  assert.deepEqual(ids(findSiblings('37405-1234567-1', [])), [a]);
  assert.deepEqual(findSiblings('37405-12345', []), []);
});
test('left students and the student themself are excluded', () => {
  const x = addStudent({ cnic: '11111-1111111-1' }), gone = addStudent({ cnic: '11111-1111111-1', status: 'left' });
  assert.deepEqual(ids(findSiblings('1111111111111', [], x)), []);
  const y = addStudent({ cnic: '11111-1111111-1' });
  assert.deepEqual(ids(findSiblings('1111111111111', [], x)), [y]);
  assert.ok(!ids(findSiblings('1111111111111', [])).includes(gone));
});
test('empty CNIC and phone give an empty result, and empty stored values never match each other', () => {
  addStudent({}); addStudent({ phone: '' });
  assert.deepEqual(findSiblings('', []), []);
  assert.deepEqual(findSiblings(null, [null, undefined, '', '12345']), []);
});
test('a phone shorter than 10 digits is ignored', () => {
  addStudent({ fphone: '0300123' });
  assert.deepEqual(findSiblings('', ['0300123']), []);
});

test('link, order by date of birth, merge and unlink', () => {
  const young = addStudent({ dob: '2015-01-01' }), old = addStudent({ dob: '2010-05-05' }), mid = addStudent({ dob: '2012-03-03' });
  assert.equal(siblingOrder(young), 1);
  assert.equal(typeof linkStudents(young, old), 'object');
  assert.equal(siblingOrder(old), 1); assert.equal(siblingOrder(young), 2);
  linkStudents(mid, young);
  assert.equal(siblingOrder(old), 1); assert.equal(siblingOrder(mid), 2); assert.equal(siblingOrder(young), 3);
  assert.equal(linkStudents(mid, mid), 'A student cannot be linked to themselves.');
  assert.equal(linkStudents(mid, 999999), 'Student not found.');
  unlinkStudent(young);
  assert.equal(siblingOrder(young), 1); assert.equal(siblingOrder(mid), 2);
  unlinkStudent(mid);                       // only "old" would be left, so the family is dissolved
  assert.equal((db.prepare('SELECT family_id FROM students WHERE id = ?').get(old) as any).family_id, null);
});
test('two families merge when a student from each is linked', () => {
  const a = addStudent(), b = addStudent(), c = addStudent(), d = addStudent();
  linkStudents(a, b); linkStudents(c, d); linkStudents(b, c);
  assert.equal(new Set([a, b, c, d].map(i => (db.prepare('SELECT family_id FROM students WHERE id = ?').get(i) as any).family_id)).size, 1);
});
test('a student who left no longer counts in the order', () => {
  const a = addStudent({ dob: '2008-01-01' }), b = addStudent({ dob: '2010-01-01' }), c = addStudent({ dob: '2012-01-01' });
  linkStudents(a, b); linkStudents(b, c);
  assert.equal(siblingOrder(c), 3);
  db.prepare("UPDATE students SET status = 'left' WHERE id = ?").run(a);
  assert.equal(siblingOrder(c), 2);
});

test('suggestions: strong matches are not linked until accepted; linked ones leave the list', () => {
  const a = addStudent({ cnic: '22222-2222222-2' }), b = addStudent({ cnic: '2222222222222' });
  let v = familyView(a)!;
  assert.deepEqual(ids(v.strong), [b]); assert.equal(v.linked.length, 0);
  assert.equal(siblingOrder(b), 1);
  acceptStrong(a);
  v = familyView(a)!;
  assert.equal(v.strong.length, 0); assert.deepEqual(ids(v.linked), [b]);
});
test('possible siblings: same father name and similar address only, never linked automatically', () => {
  const a = addStudent({ father: 'Muhammad Aslam', address: 'House 12 Street 4 Satellite Town Rawalpindi' });
  const same = addStudent({ father: 'muhammad  aslam', address: 'House 12, Street 4, Satellite Town, Rawalpindi' });
  const otherAddr = addStudent({ father: 'Muhammad Aslam', address: 'Village Chakri Attock' });
  const otherFather = addStudent({ father: 'Abdul Rehman', address: 'House 12 Street 4 Satellite Town Rawalpindi' });
  const v = familyView(a)!;
  assert.deepEqual(ids(v.possible), [same]);
  assert.ok(!ids(v.possible).includes(otherAddr) && !ids(v.possible).includes(otherFather));
  assert.equal(v.linked.length, 0);
  assert.equal(siblingOrder(same), 1);
  assert.deepEqual(familyView(addStudent({ father: 'No Address' }))!.possible, []);
});
test('a student found by CNIC is not also shown as "possible"', () => {
  const a = addStudent({ father: 'Tariq Mehmood', cnic: '33333-3333333-3', address: 'Street 9 Chaklala Scheme Three' });
  const b = addStudent({ father: 'Tariq Mehmood', cnic: '33333-3333333-3', address: 'Street 9 Chaklala Scheme Three' });
  const v = familyView(a)!;
  assert.deepEqual(ids(v.strong), [b]); assert.deepEqual(v.possible, []);
});
test('section helper sanity', () => assert.ok(sectionOf(6) > 0));
