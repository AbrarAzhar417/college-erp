import { db, ensureBaseData } from '../src/db.js';
import '../src/timetable/schema.js';
import '../src/attendance/schema.js';
import '../src/fee/schema.js';
import '../src/exam/schema.js';
import '../src/family.js';

ensureBaseData();
let seq = 0;
export const sectionOf = (grade: number, name = 'A') =>
  (db.prepare('SELECT s.id FROM sections s JOIN classes c ON c.id = s.class_id WHERE c.grade = ? AND s.name = ?').get(grade, name) as { id: number }).id;
export const classOf = (grade: number) => (db.prepare('SELECT id FROM classes WHERE grade = ?').get(grade) as { id: number }).id;

export interface NewStudent { name?: string; father?: string; cnic?: string | null; phone?: string | null; fphone?: string | null; mphone?: string | null; dob?: string | null; address?: string | null; section?: number; status?: string; category?: string | null }
export function addStudent(o: NewStudent = {}): number {
  seq++;
  const r = db.prepare(`INSERT INTO students (reg_no, name, father_name, gender, dob, phone, father_phone, mother_phone, father_cnic, address, category, section_id, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`T-${seq}`, o.name ?? `Child ${seq}`, o.father ?? `Father ${seq}`, 'male', o.dob ?? null, o.phone ?? null, o.fphone ?? null, o.mphone ?? null,
    o.cnic ?? null, o.address ?? null, o.category ?? null, o.section ?? sectionOf(6), o.status ?? 'active');
  return Number(r.lastInsertRowid);
}
export function resetFees() {
  for (const t of ['student_concessions', 'fee_category_rules', 'sibling_discount_rules', 'fee_structure', 'student_heads']) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("DELETE FROM fee_heads WHERE name LIKE 'T-%'").run();
  db.prepare("DELETE FROM settings WHERE key = 'sibling_mode'").run();
}
export function addHead(name: string, o: { frequency?: string; concessionable?: number; optional?: number } = {}): number {
  return Number(db.prepare('INSERT INTO fee_heads (name, frequency, optional, concessionable) VALUES (?,?,?,?)').run(`T-${name}`, o.frequency ?? 'monthly', o.optional ?? 0, o.concessionable ?? 0).lastInsertRowid);
}
export const setFee = (classId: number, head: number, amount: number) => db.prepare('INSERT OR REPLACE INTO fee_structure (class_id, head_id, amount) VALUES (?,?,?)').run(classId, head, amount);
export const addRule = (category: string, head: number | null, kind: 'percent' | 'fixed', value: number, note: string | null = null) =>
  db.prepare('INSERT INTO fee_category_rules (category, head_id, kind, value, note) VALUES (?,?,?,?,?)').run(category, head, kind, value, note);
export const concessionsOf = (sid: number) => db.prepare('SELECT head_id, kind, value, reason FROM student_concessions WHERE student_id = ? ORDER BY id').all(sid) as any[];
