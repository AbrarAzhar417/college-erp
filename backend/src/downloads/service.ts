import { db } from '../db.js';
import type { AuthUser } from '../auth.js';

db.exec(`
CREATE TABLE IF NOT EXISTS dl_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('forms','datesheets','notes','syllabus','circulars','other')),
  class_id INTEGER REFERENCES classes(id), subject TEXT, description TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL,
  uploaded_by INTEGER REFERENCES users(id), uploaded_at TEXT NOT NULL DEFAULT (datetime('now')), downloads INTEGER NOT NULL DEFAULT 0
);
`);
export const CATS: Record<string, string> = { forms: 'Forms', datesheets: 'Date sheets', notes: 'Notes', syllabus: 'Syllabus', circulars: 'Circulars', other: 'Other' };
export const MAX_FILE = 6 * 1024 * 1024;
const OOXML = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const BY_EXT: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', ...OOXML };
export const ALLOWED = [...new Set(Object.values(BY_EXT))];
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isManager = (u: AuthUser) => ['director', 'principal', 'admin'].includes(u.role);

export function checkUpload(buf: unknown, contentType: string, q: Record<string, any>, u: AuthUser) {
  const category = String(q.category ?? ''); if (!CATS[category]) return 'Choose a category.';
  if (!isManager(u) && !(u.role === 'teacher' && category === 'notes')) return u.role === 'teacher' ? 'Teachers can share notes only. Ask the office for other files.' : 'You cannot upload files.';
  const title = str(q.title, 120); if (!title) return 'Give the file a title.';
  const name = String(q.name ?? 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'file', ext = name.split('.').pop()!.toLowerCase();
  let mime = contentType.split(';')[0].trim().toLowerCase(); if (!ALLOWED.includes(mime)) mime = BY_EXT[ext] ?? '';
  if (!mime) return 'Upload a PDF, JPG, PNG, Word, Excel or PowerPoint file.';
  if (!Buffer.isBuffer(buf) || !buf.length) return 'The file is empty.';
  if (buf.length > MAX_FILE) return 'The file is larger than 6 MB.';
  const sig = buf.subarray(0, 4).toString('latin1');   // the file must really be what it says
  const real = (mime === 'application/pdf' && sig === '%PDF') || (mime === 'image/png' && sig.startsWith('\x89PNG')) || (mime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) || (Object.values(OOXML).includes(mime) && sig === 'PK\x03\x04');
  if (!real) return 'The file does not match its type.';
  const classId = q.class_id ? Number(q.class_id) : null;
  if (classId && !db.prepare('SELECT 1 FROM classes WHERE id = ?').get(classId)) return 'That class does not exist.';
  return { title, category, class_id: classId, subject: str(q.subject, 60) || null, description: str(q.description, 300), name, mime };
}
export const canChange = (u: AuthUser, row: { uploaded_by: number | null }) => isManager(u) || row.uploaded_by === u.id;
export function listFiles(q: { category?: string; class_id?: number; text?: string }) {
  const where: string[] = [], args: any[] = [];
  if (q.category && CATS[q.category]) { where.push('f.category = ?'); args.push(q.category); }
  if (q.class_id) { where.push('(f.class_id = ? OR f.class_id IS NULL)'); args.push(q.class_id); }
  if (q.text) { where.push('(f.title LIKE ? OR f.subject LIKE ?)'); args.push(`%${q.text}%`, `%${q.text}%`); }
  return db.prepare(`SELECT f.id, f.title, f.category, f.class_id, c.name class_name, f.subject, f.description, f.filename, f.mime, f.size, f.uploaded_at, f.downloads, f.uploaded_by, u.name uploaded_by_name
    FROM dl_files f LEFT JOIN classes c ON c.id = f.class_id LEFT JOIN users u ON u.id = f.uploaded_by ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY f.id DESC LIMIT 500`).all(...args);
}
