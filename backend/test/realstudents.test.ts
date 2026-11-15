import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import '../src/fee/schema.js';
import '../src/exam/schema.js';
import { importRealStudents, isRealStudent } from '../src/realStudents.js';
import { REAL_STUDENTS } from '../src/data/realStudents.js';

test('the real student list is clean: unique admission numbers, valid classes, no leftover subject tags', () => {
  assert.equal(new Set(REAL_STUDENTS.map(s => s[0].toLowerCase())).size, REAL_STUDENTS.length);
  for (const [reg, name, father, grade, sec, cat] of REAL_STUDENTS) {
    assert.match(reg, /^H-\d+$/); assert.ok(name.length > 2 && !/\(.*\)\s*$/.test(name) && !/\s{2}/.test(name), name);
    assert.ok(!/^mr\.?\s/i.test(father) && !/dues/i.test(father), father);
    assert.ok([11, 12].includes(grade) && 'ABCDE'.includes(sec)); assert.ok(['', 'A', 'B', 'C'].includes(cat));
  }
});

test('importing the real students adds them once, keeps the category, and running it again changes nothing', () => {
  const dry = importRealStudents(true) as any; assert.equal(dry.counts.new, REAL_STUDENTS.length); assert.equal(dry.counts.error, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM students WHERE reg_no = 'H-4000'").get() as any).n, 0, 'a dry run writes nothing');
  const r = importRealStudents(false) as any;
  assert.equal(r.saved, REAL_STUDENTS.length); assert.equal(r.errors, 0);
  const s = db.prepare("SELECT st.name, st.father_name, st.category, st.gender, c.grade, sec.name AS sec FROM students st JOIN sections sec ON sec.id = st.section_id JOIN classes c ON c.id = sec.class_id WHERE st.reg_no = 'H-4000'").get() as any;
  assert.deepEqual({ ...s }, { name: 'Abdul Rouf Raziq', father_name: 'Raziq Hussain', category: 'A', gender: 'male', grade: 11, sec: 'A' });
  const again = importRealStudents(false) as any; assert.equal(again.saved, 0); assert.equal(again.duplicates, REAL_STUDENTS.length);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM students WHERE reg_no LIKE 'H-%'").get() as any).n, REAL_STUDENTS.length);
  assert.ok(isRealStudent('h-4000') && !isRealStudent('2026-0001'));
  assert.equal((db.prepare('SELECT COUNT(*) n FROM students WHERE category IS NULL AND reg_no LIKE ?').get('H-%') as any).n, REAL_STUDENTS.filter(s => !s[5]).length, 'a blank category stays blank');
});
