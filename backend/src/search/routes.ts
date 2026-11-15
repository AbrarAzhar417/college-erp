import { Router } from 'express';
import { db } from '../db.js';
import { isFull } from '../auth.js';
import type { Role } from '../auth.js';
import '../faculty/routes.js'; // adds the teacher columns that the search reads

/**
 * One search box for the whole college. It looks in students, teachers, staff, fee papers, notices and the front desk,
 * and returns for each hit the page to open. What a person finds follows what they may see: a teacher finds students
 * and notices, the accountant also finds fee papers, the office finds everything. Phone numbers and CNICs are matched
 * with or without dashes and spaces.
 */
export const searchRouter = Router();

interface Hit { type: string; title: string; sub: string; link: string; query?: Record<string, string>; id: number }
const PER_GROUP = 6;
const esc = (s: string) => s.replace(/[\\%_]/g, c => '\\' + c);
const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const strip = (col: string) => `REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), '-', ''), ' ', ''), '+', '')`;

export function globalSearch(q: string, role: Role): { groups: { type: string; label: string; hits: Hit[] }[]; total: number } {
  const text = `%${esc(q.toLowerCase())}%`, starts = `${esc(q.toLowerCase())}%`;
  const digits = q.replace(/\D/g, ''), num = digits.length >= 3 ? `%${digits}%` : null;
  const full = isFull(role), fee = full || role === 'accountant', hr = full;
  const groups: { type: string; label: string; hits: Hit[] }[] = [];
  const add = (type: string, label: string, hits: Hit[]) => { if (hits.length) groups.push({ type, label, hits }); };

  // students: everybody
  try {
    const stuCols = ['lower(st.name)', 'lower(st.father_name)', 'lower(st.reg_no)'], stuWhere = stuCols.map(c => `${c} LIKE ? ESCAPE '\\'`);
    const stuArgs: unknown[] = stuCols.map(() => text);
    if (num) { for (const c of ['st.phone', 'st.father_phone', 'st.mother_phone']) { stuWhere.push(`${strip(c)} LIKE ?`); stuArgs.push(num); } if (role !== 'teacher') { stuWhere.push(`${strip('st.father_cnic')} LIKE ?`); stuArgs.push(num); } }
    stuWhere.push("CAST(st.roll_no AS TEXT) = ?"); stuArgs.push(q.trim());
    add('student', 'Students', (db.prepare(`SELECT st.id, st.name, st.father_name, st.reg_no, st.status, c.name || '-' || s.name AS cls FROM students st LEFT JOIN sections s ON s.id = st.section_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE ${stuWhere.join(' OR ')} ORDER BY (st.status = 'active') DESC, (lower(st.name) LIKE ? ESCAPE '\\') DESC, (lower(st.reg_no) = ?) DESC, st.name LIMIT ${PER_GROUP}`).all(...stuArgs, starts, q.toLowerCase()) as any[])
      .map(r => ({ type: 'student', id: r.id, title: r.name, sub: `${r.cls ?? ''} · S/O ${r.father_name} · ${r.reg_no}${r.status !== 'active' ? ' · ' + r.status : ''}`, link: `/students/${r.id}` })));
  } catch (e) { console.error('Search: this part failed, the rest still works:', (e as Error).message); }

  // teachers: the office opens them in the Teachers page
  try {
    if (full && has('teachers')) {
      const where = ["lower(t.name) LIKE ? ESCAPE '\\'", "lower(COALESCE(u.username, '')) LIKE ? ESCAPE '\\'", "lower(COALESCE(t.email, '')) LIKE ? ESCAPE '\\'",
        "EXISTS (SELECT 1 FROM teacher_subjects ts JOIN subjects sb ON sb.id = ts.subject_id WHERE ts.teacher_id = t.id AND lower(sb.name) LIKE ? ESCAPE '\\')"], args: unknown[] = [text, text, text, text];
      if (num) { where.push(`${strip('t.phone')} LIKE ?`, `${strip('t.cnic')} LIKE ?`); args.push(num, num); }
      add('teacher', 'Teachers', (db.prepare(`SELECT t.id, t.name, t.rank, t.phone, t.active FROM teachers t LEFT JOIN users u ON u.id = t.user_id WHERE ${where.join(' OR ')} ORDER BY t.active DESC, (lower(t.name) LIKE ? ESCAPE '\\') DESC, t.name LIMIT ${PER_GROUP}`).all(...args, starts) as any[])
        .map(r => ({ type: 'teacher', id: r.id, title: r.name, sub: `${(r.rank ?? '').replace(/_/g, ' ') || 'Teacher'}${r.phone ? ' · ' + r.phone : ''}${r.active ? '' : ' · left'}`, link: '/teachers', query: { q: r.name } })));
    }
  } catch (e) { console.error('Search: this part failed, the rest still works:', (e as Error).message); }

  // other staff (drivers, clerks, ...): HR file
  try {
    if (hr && has('hr_staff')) {
      const where = ["lower(h.name) LIKE ? ESCAPE '\\'", "lower(COALESCE(h.emp_no, '')) LIKE ? ESCAPE '\\'"], args: unknown[] = [text, text];
      if (num) { where.push(`${strip('h.phone')} LIKE ?`, `${strip('h.cnic')} LIKE ?`); args.push(num, num); }
      add('staff', 'Staff (HR file)', (db.prepare(`SELECT h.id, h.name, h.emp_no, h.staff_type, h.status FROM hr_staff h WHERE h.teacher_id IS NULL AND (${where.join(' OR ')}) ORDER BY (h.status = 'active') DESC, h.name LIMIT ${PER_GROUP}`).all(...args) as any[])
        .map(r => ({ type: 'staff', id: r.id, title: r.name, sub: `${r.staff_type ?? 'Staff'} · ${r.emp_no ?? ''}${r.status !== 'active' ? ' · ' + r.status : ''}`, link: `/hr/staff/${r.id}` })));
    }
  } catch (e) { console.error('Search: this part failed, the rest still works:', (e as Error).message); }

  // fee papers
  try {
    if (fee && has('vouchers')) {
      add('voucher', 'Fee vouchers', (db.prepare(`SELECT v.id, v.voucher_no, v.period_label, v.net, v.status, v.student_id, st.name FROM vouchers v JOIN students st ON st.id = v.student_id WHERE lower(v.voucher_no) LIKE ? ESCAPE '\\' ORDER BY v.id DESC LIMIT ${PER_GROUP}`).all(text) as any[])
        .map(r => ({ type: 'voucher', id: r.id, title: `Voucher ${r.voucher_no}`, sub: `${r.name} · ${r.period_label} · Rs ${r.net} · ${r.status}`, link: `/fee/student/${r.student_id}` })));
      add('receipt', 'Fee receipts', (db.prepare(`SELECT p.id, p.receipt_no, p.amount, p.paid_on, st.name FROM payments p JOIN students st ON st.id = p.student_id WHERE lower(p.receipt_no) LIKE ? ESCAPE '\\' ORDER BY p.id DESC LIMIT ${PER_GROUP}`).all(text) as any[])
        .map(r => ({ type: 'receipt', id: r.id, title: `Receipt ${r.receipt_no}`, sub: `${r.name} · Rs ${r.amount} · ${r.paid_on}`, link: `/fee/receipt/${r.id}` })));
    }
  } catch (e) { console.error('Search: this part failed, the rest still works:', (e as Error).message); }

  // circulars and notices
  try {
    if (has('comm_notices')) {
      add('notice', 'Notices and circulars', (db.prepare(`SELECT id, title, kind, ref_no, status FROM comm_notices WHERE (lower(title) LIKE ? ESCAPE '\\' OR lower(COALESCE(ref_no, '')) LIKE ? ESCAPE '\\')${full ? '' : " AND status = 'published'"} ORDER BY id DESC LIMIT ${PER_GROUP}`).all(text, text) as any[])
        .map(r => ({ type: 'notice', id: r.id, title: r.title, sub: `${r.kind}${r.ref_no ? ' · ' + r.ref_no : ''} · ${r.status}`, link: '/communication' })));
    }
  } catch (e) { console.error('Search: this part failed, the rest still works:', (e as Error).message); }

  // front desk enquiries and visitors
  try {
    if (full && has('fd_enquiries')) {
      const where = ["lower(child_name) LIKE ? ESCAPE '\\'", "lower(parent_name) LIKE ? ESCAPE '\\'"], args: unknown[] = [text, text];
      if (num) { where.push(`${strip('phone')} LIKE ?`); args.push(num); }
      add('enquiry', 'Admission enquiries', (db.prepare(`SELECT id, child_name, parent_name, grade, status, date FROM fd_enquiries WHERE ${where.join(' OR ')} ORDER BY id DESC LIMIT ${PER_GROUP}`).all(...args) as any[])
        .map(r => ({ type: 'enquiry', id: r.id, title: r.child_name, sub: `Class ${r.grade ?? '-'} · ${r.parent_name} · ${r.status} · ${r.date}`, link: '/frontdesk' })));
    }
  } catch (e) { console.error('Search: this part failed, the rest still works:', (e as Error).message); }

  return { groups, total: groups.reduce((n, g) => n + g.hits.length, 0) };
}

searchRouter.get('/', (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  if (q.length < 2) return res.json({ groups: [], total: 0 });
  res.json(globalSearch(q, req.user!.role));
});
