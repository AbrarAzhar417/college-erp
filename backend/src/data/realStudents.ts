// the table definitions the import writes into (a fresh database has none of them until they are loaded)
import './timetable/schema.js';
import './fee/schema.js';
import './attendance/schema.js';
import './exam/schema.js';
import './syllabus/schema.js';
import './transport/schema.js';
import './hr/schema.js';
import { analyze, commit } from './import/importer.js';
import { toCsv } from './import/csv.js';
import { REAL_STUDENTS } from './realStudentsList.js';

/** The real KMCB students (classes XI and XII, session 2026-27) as an import file. */
export function realStudentsCsv(): string {
  return toCsv([['Admission No', 'Name', 'Father Name', 'Class', 'Section', 'Category'],
    ...REAL_STUDENTS.map(([reg, name, father, grade, sec, cat]) => [reg, name, father, String(grade), sec, cat])]);
}
/** Admission numbers of the real students (used to keep invented demo data away from them). */
export const REAL_REGS = new Set(REAL_STUDENTS.map(s => s[0].toLowerCase()));
export const isRealStudent = (reg: string) => REAL_REGS.has(String(reg).toLowerCase());

/** Adds the real students that are not in the database yet (matched by admission number). Existing students are never changed. Safe to run again. */
export function importRealStudents(dryRun = false) {
  const csv = realStudentsCsv(), o = { kind: 'students' as const, createMissing: true };
  if (dryRun) { const a = analyze(csv, o); return 'error' in a ? { error: a.error } : { counts: a.counts, rows: a.rows.filter(r => r.status === 'error').slice(0, 50) }; }
  const r = commit(csv, o);
  return r;
}
