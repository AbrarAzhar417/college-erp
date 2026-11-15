import { Router } from 'express';
import express from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { applyCategoryRules } from '../fee/service.js';
import { linkedSiblings } from '../family.js';
import { toCsv } from '../import/csv.js';
import { logCategoryChange } from './audit.js';

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const reportRole = requireRole('director', 'principal', 'admin', 'accountant');

/** Sets one category for a whole class or section. With only_unset the students who already have a category are left alone. */
export function bulkCategory(o: { classId?: number; sectionId?: number; category: string | null; onlyUnset: boolean; by: number | null; reason: string }) {
  const where = ["st.status = 'active'"], args: any[] = [];
  if (o.sectionId) { where.push('s.id = ?'); args.push(o.sectionId); } else if (o.classId) { where.push('s.class_id = ?'); args.push(o.classId); }
  if (o.onlyUnset) where.push("(st.category IS NULL OR st.category = '')");
  const rows = db.prepare(`SELECT st.id, st.category FROM students st JOIN sections s ON s.id = st.section_id WHERE ${where.join(' AND ')}`).all(...args) as { id: number; category: string | null }[];
  let changed = 0;
  db.transaction(() => {
    for (const r of rows) {
      if ((r.category || null) === o.category) continue;
      db.prepare('UPDATE students SET category = ? WHERE id = ?').run(o.category, r.id);
      logCategoryChange(r.id, r.category, o.category, o.by, o.reason || 'Bulk change'); changed++;
    }
  })();
  const touched = new Set<number>();
  for (const r of rows) { touched.add(r.id); for (const x of linkedSiblings(r.id)) touched.add(x.id); }
  for (const id of touched) applyCategoryRules(id);
  return { matched: rows.length, changed };
}

export function categoryReport(from: string | null, to: string | null) {
  const counts = db.prepare(`SELECT COALESCE(NULLIF(st.category,''), '-') AS category, COUNT(*) AS students FROM students st WHERE st.status = 'active' GROUP BY 1 ORDER BY 1`).all();
  const byClass = db.prepare(`SELECT c.grade, c.name AS class_name, COALESCE(NULLIF(st.category,''), '-') AS category, COUNT(*) AS students
    FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE st.status = 'active' GROUP BY c.id, 3 ORDER BY c.grade, 3`).all();
  const vArgs: any[] = [], vWhere = ["v.status = 'open'"]; if (from) { vWhere.push('v.issue_date >= ?'); vArgs.push(from); } if (to) { vWhere.push('v.issue_date <= ?'); vArgs.push(to); }
  const discount = db.prepare(`SELECT COALESCE(NULLIF(st.category,''), '-') AS category, COUNT(v.id) AS vouchers, COALESCE(SUM(v.gross),0) AS gross, COALESCE(SUM(v.discount),0) AS discount, COALESCE(SUM(v.net),0) AS net
    FROM vouchers v JOIN students st ON st.id = v.student_id WHERE ${vWhere.join(' AND ')} GROUP BY 1 ORDER BY 1`).all(...vArgs);
  const pArgs: any[] = [], pWhere = ['p.cancelled = 0']; if (from) { pWhere.push('p.paid_on >= ?'); pArgs.push(from); } if (to) { pWhere.push('p.paid_on <= ?'); pArgs.push(to); }
  const income = db.prepare(`SELECT COALESCE(NULLIF(st.category,''), '-') AS category, COUNT(p.id) AS receipts, COALESCE(SUM(p.amount),0) AS received
    FROM payments p JOIN students st ON st.id = p.student_id WHERE ${pWhere.join(' AND ')} GROUP BY 1 ORDER BY 1`).all(...pArgs);
  return { from, to, counts, by_class: byClass, discount, income };
}

export function categoryReportCsv(r: ReturnType<typeof categoryReport>) {
  const m = new Map<string, any>();
  for (const x of r.counts as any[]) m.set(x.category, { category: x.category, students: x.students, vouchers: 0, gross: 0, discount: 0, net: 0, receipts: 0, received: 0 });
  for (const x of r.discount as any[]) Object.assign(m.get(x.category) ?? m.set(x.category, { category: x.category, students: 0, receipts: 0, received: 0 }).get(x.category), { vouchers: x.vouchers, gross: x.gross, discount: x.discount, net: x.net });
  for (const x of r.income as any[]) Object.assign(m.get(x.category) ?? m.set(x.category, { category: x.category, students: 0, vouchers: 0, gross: 0, discount: 0, net: 0 }).get(x.category), { receipts: x.receipts, received: x.received });
  return toCsv([['Category', 'Students', 'Vouchers', 'Gross', 'Discount given', 'Net billed', 'Receipts', 'Fee received'], ...[...m.values()].sort((a, b) => a.category.localeCompare(b.category)).map(x => [x.category, x.students, x.vouchers, x.gross, x.discount, x.net, x.receipts, x.received])]);
}

export function studentsCsv(category?: string) {
  const where = ["st.status = 'active'"], args: any[] = [];
  if (category === '-') where.push("(st.category IS NULL OR st.category = '')"); else if (category) { where.push('st.category = ?'); args.push(category); }
  const rows = db.prepare(`SELECT st.reg_no, st.name, st.father_name, c.name AS class_name, s.name AS section, st.roll_no, st.gender, st.dob, st.father_cnic, st.phone, st.father_phone, st.mother_phone, st.address, st.category, st.admission_date
    FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE ${where.join(' AND ')} ORDER BY c.grade, s.name, st.roll_no, st.name`).all(...args) as any[];
  return toCsv([['Admission No', 'Name', 'Father Name', 'Class', 'Section', 'Roll No', 'Gender', 'Date of Birth', 'Father CNIC', 'Phone', 'Father Phone', 'Mother Phone', 'Address', 'Category', 'Admission Date'],
    ...rows.map(r => [r.reg_no, r.name, r.father_name, r.class_name, r.section, r.roll_no, r.gender, r.dob, r.father_cnic, r.phone, r.father_phone, r.mother_phone, r.address, r.category, r.admission_date])]);
}

export function registerStudentReports(api: Router, canWrite: express.RequestHandler) {
  api.post('/students/bulk-category', canWrite, (req, res) => {
    const b = req.body ?? {}, cat = b.category === '' || b.category === null ? null : String(b.category);
    if (cat !== null && !['A', 'B', 'C'].includes(cat)) return res.status(400).json({ message: 'Category must be A, B, C or empty.' });
    const classId = Number(b.class_id) || undefined, sectionId = Number(b.section_id) || undefined;
    if (!classId && !sectionId) return res.status(400).json({ message: 'Choose a class or a section.' });
    res.json(bulkCategory({ classId, sectionId, category: cat, onlyUnset: !!b.only_unset, by: req.user!.id, reason: String(b.reason ?? '').trim().slice(0, 200) }));
  });
  api.get('/students/reports/category', reportRole, (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : null, to = isDate(req.query.to) ? req.query.to : null;
    const r = categoryReport(from, to);
    res.json(req.query.csv === '1' ? { csv: categoryReportCsv(r) } : r);
  });
  api.get('/students/export', reportRole, (req, res) => res.json({ csv: studentsCsv(req.query.category ? String(req.query.category) : undefined) }));
}
