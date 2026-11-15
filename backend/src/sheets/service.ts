import { teacherOpen } from '../policy.js';
import { db, getSetting } from '../db.js';
import { examConfig } from '../exam/service.js';
import { settingsForSection } from '../timetable/schema.js';
import { isManager, myTeacherId } from '../attendance/service.js';
import type { AuthUser } from '../auth.js';

/** Office and the class teacher see the whole section; a subject teacher sees the sections where they teach. */
export function canSheet(u: AuthUser, sectionId: number): boolean {
  if (isManager(u)) return true;
  if (u.role !== 'teacher') return false;
  if (teacherOpen()) return true;
  const t = myTeacherId(u.id); if (!t) return false;
  return !!db.prepare('SELECT 1 FROM sections WHERE id = ? AND class_teacher_id = ?').get(sectionId, t)
    || !!db.prepare('SELECT 1 FROM section_subjects WHERE section_id = ? AND teacher_id = ?').get(sectionId, t);
}

export interface SectionSheet {
  institute: string; short: string; section_id: number; label: string; class_name: string; section_name: string; class_teacher: string | null;
  periods: number; students: { id: number; roll_no: number | null; name: string; father_name: string; reg_no: string }[];
  subjects: { id: number; name: string; teacher: string | null }[];
}

/** Names and subjects of one section: the starting point of every blank sheet (attendance, award list). */
export function sectionSheet(sectionId: number): SectionSheet | null {
  const s = db.prepare(`SELECT s.id, s.name AS section_name, c.name AS class_name, t.name AS class_teacher FROM sections s JOIN classes c ON c.id = s.class_id LEFT JOIN teachers t ON t.id = s.class_teacher_id WHERE s.id = ?`).get(sectionId) as any;
  if (!s) return null;
  const students = db.prepare("SELECT id, roll_no, name, father_name, reg_no FROM students WHERE section_id = ? AND status = 'active' ORDER BY COALESCE(roll_no, 99999), name").all(sectionId) as SectionSheet['students'];
  const subjects = db.prepare(`SELECT sub.id, sub.name, t.name AS teacher FROM section_subjects ss JOIN subjects sub ON sub.id = ss.subject_id LEFT JOIN teachers t ON t.id = ss.teacher_id WHERE ss.section_id = ? ORDER BY sub.name`).all(sectionId) as SectionSheet['subjects'];
  return { institute: getSetting('institute_name'), short: getSetting('short_name'), section_id: s.id, label: `${s.class_name}-${s.section_name}`, class_name: s.class_name, section_name: s.section_name, class_teacher: s.class_teacher, periods: settingsForSection(sectionId).periodCount, students, subjects };
}

export const EXPORT_COLUMNS = ['Admission no', 'Roll no', 'Name', 'Father name', 'Class', 'Section', 'Gender', 'Date of birth', 'Category', 'Category meaning', 'P number', 'Father CNIC', 'Father phone', 'Mother phone', 'Student phone', 'Address', 'Admission date'];

/** One row per student with the parents' category and phone numbers (for the office; contains private data). */
export function classExport(f: { classId?: number; sectionId?: number }) {
  const cfg = examConfig();
  const w: string[] = ["st.status = 'active'"], p: any[] = [];
  if (f.sectionId) { w.push('s.id = ?'); p.push(f.sectionId); } else if (f.classId) { w.push('c.id = ?'); p.push(f.classId); }
  const rows = db.prepare(`SELECT st.reg_no, st.roll_no, st.name, st.father_name, c.name AS class_name, s.name AS section_name, st.gender, st.dob, st.category, st.p_number,
      st.father_cnic, st.father_phone, st.mother_phone, st.phone, st.address, st.admission_date
    FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE ${w.join(' AND ')} ORDER BY c.grade, s.name, COALESCE(st.roll_no, 99999), st.name`).all(...p) as any[];
  return rows.map(r => [r.reg_no, r.roll_no, r.name, r.father_name, r.class_name, r.section_name, r.gender, r.dob, r.category ?? '', r.category ? (cfg.categories as any)[r.category]?.label ?? '' : '', r.p_number, r.father_cnic, r.father_phone, r.mother_phone, r.phone, r.address, r.admission_date]);
}
