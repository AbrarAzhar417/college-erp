import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import '../src/timetable/schema.js';
import '../src/fee/schema.js';
import '../src/attendance/schema.js';
import '../src/transport/schema.js';
import '../src/hr/schema.js';
import '../src/exam/schema.js';
import '../src/syllabus/schema.js';
import '../src/college/routes.js';
import '../src/faculty/routes.js';
import '../src/discipline/routes.js';
import '../src/family.js';
import { linkStudents, unlinkStudent } from '../src/family.js';
import { LINKS, installGuards, checkIntegrity } from '../src/integrity.js';
import { addForeignKeys, dropRedundantIndexes, ensureIndexes, splitDefs, upgradeDatabase, withReferences } from '../src/upgrade.js';
import { addStudent, sectionOf } from './helpers.js';

const fks = (t: string) => (db.prepare(`PRAGMA foreign_key_list(${t})`).all() as any[]).map(f => f.from);

test('the CREATE TABLE editor adds a reference to the right column and keeps constraints', () => {
  const out = withReferences('CREATE TABLE IF NOT EXISTS t (\n id INTEGER PRIMARY KEY, a INTEGER NOT NULL DEFAULT 1, b TEXT CHECK (b IN (\'x,y\',\'z\')), c INTEGER,\n UNIQUE (a, c)\n)', 't__new', [{ col: 'c', parent: 'p', action: 'SET NULL' }]);
  assert.match(out, /^CREATE TABLE IF NOT EXISTS t__new/);
  assert.match(out, /c INTEGER REFERENCES p\(id\) ON DELETE SET NULL/);
  assert.match(out, /CHECK \(b IN \('x,y','z'\)\)/);
  assert.equal(splitDefs(" a INTEGER, b TEXT CHECK (b IN ('1,2')), UNIQUE (a, b)").length, 3);
});

test('upgrade: old pointers become real foreign keys, data survives, and running it again changes nothing', () => {
  const sec = sectionOf(6, 'A');
  const st = addStudent();
  const t = Number(db.prepare("INSERT INTO teachers (name) VALUES ('Upgrade T')").run().lastInsertRowid);
  db.prepare('UPDATE sections SET class_teacher_id = ? WHERE id = ?').run(t, sec);
  const studentsBefore = (db.prepare('SELECT COUNT(*) n FROM students').get() as any).n;
  const first = upgradeDatabase();
  assert.ok(first.rebuilt.includes('sections') || fks('sections').includes('class_teacher_id'));
  for (const l of LINKS) {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)").all(l.table, l.parent).length === 2;
    if (has) assert.ok(fks(l.table).includes(l.col), `${l.table}.${l.col} is a real foreign key`);
  }
  assert.equal((db.prepare('SELECT COUNT(*) n FROM students').get() as any).n, studentsBefore);
  assert.equal((db.prepare('SELECT class_teacher_id c FROM sections WHERE id = ?').get(sec) as any).c, t);
  assert.equal((db.prepare('PRAGMA foreign_key_check').all() as any[]).length, 0);
  assert.deepEqual(addForeignKeys(), { rebuilt: [], skipped: [] });
  // real enforcement
  assert.throws(() => db.prepare('UPDATE sections SET class_teacher_id = 99999 WHERE id = ?').run(sec), /FOREIGN KEY/);
  db.prepare('DELETE FROM teachers WHERE id = ?').run(t);
  assert.equal((db.prepare('SELECT class_teacher_id c FROM sections WHERE id = ?').get(sec) as any).c, null, 'ON DELETE SET NULL');
  installGuards();
  assert.equal((db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'g\\_%' ESCAPE '\\'").get() as any).n, 0, 'no stand-in triggers once the real keys exist');
  void st;
});

test('families are rows of their own: linking creates one, unlinking removes it, and a student cannot join one that does not exist', () => {
  const sec = sectionOf(7, 'A');
  const a = addStudent({ name: 'Fam A' }), b = addStudent({ name: 'Fam B' });
  db.prepare('UPDATE students SET section_id = ?, father_cnic = ? WHERE id IN (?, ?)').run(sec, '37301-9999999-9', a, b);
  const ids = linkStudents(a, b) as number[];
  assert.equal(ids.length, 2);
  const fam = (db.prepare('SELECT family_id f FROM students WHERE id = ?').get(a) as any).f;
  assert.ok(db.prepare('SELECT 1 FROM families WHERE id = ?').get(fam));
  assert.throws(() => db.prepare('UPDATE students SET family_id = 987654 WHERE id = ?').run(a), /FOREIGN KEY/);
  unlinkStudent(a);
  assert.equal(db.prepare('SELECT 1 FROM families WHERE id = ?').get(fam), undefined, 'an empty family is removed');
});

test('indexes: every foreign key column starts an index, and no index only repeats another', () => {
  ensureIndexes(); dropRedundantIndexes();
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as any[]).map(t => t.name);
  const lead = (t: string) => new Set((db.prepare(`PRAGMA index_list(${t})`).all() as any[]).map(i => (db.prepare(`PRAGMA index_info(${i.name})`).all() as any[])[0]?.name));
  const bare: string[] = [];
  for (const t of tables) { const idx = lead(t), pkCol = (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).filter(c => c.pk); for (const f of db.prepare(`PRAGMA foreign_key_list(${t})`).all() as any[]) if (!idx.has(f.from) && !(pkCol.length === 1 && pkCol[0].name === f.from)) bare.push(`${t}.${f.from}`); }
  assert.deepEqual(bare, []);
  assert.deepEqual(dropRedundantIndexes(), []);
  // enough rows for the planner to prefer an index over reading the whole table (it rightly scans a table of a few rows)
  const sec = sectionOf(9, 'A'), other = sectionOf(10, 'A');
  db.prepare(`WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 3000)
    INSERT INTO students (reg_no, name, father_name, gender, section_id, status) SELECT 'PLAN-' || n, 'Plan ' || n, 'F', 'male', CASE WHEN n % 2 = 0 THEN ? ELSE ? END, 'active' FROM c`).run(sec, other);
  db.exec('ANALYZE');
  const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as any[]).map(r => r.detail).join(' | ');
  for (const [name, sql] of [['payments by student', 'SELECT * FROM payments WHERE student_id = 1'], ['vouchers by student', 'SELECT * FROM vouchers WHERE student_id = 1 AND period = \'2026-11\''],
    ['students of a section', "SELECT * FROM students WHERE section_id = 1 AND status = 'active'"], ['marks of a student', 'SELECT * FROM exam_marks WHERE student_id = 1'], ['one student attendance', "SELECT * FROM att_daily WHERE student_id = 1 AND date >= '2026-11-01'"]])
    assert.doesNotMatch(plan(sql), /SCAN (payments|vouchers|students|exam_marks|att_daily)\b/, `${name}: ${plan(sql)}`);
  assert.equal(checkIntegrity().engine, 'ok');
});
