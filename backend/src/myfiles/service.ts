import { db } from '../db.js';
import { isFull, type AuthUser } from '../auth.js';

db.exec(`
CREATE TABLE IF NOT EXISTS staff_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('paper','marks','notes','other')),
  filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_files_user ON staff_files(user_id);
`);
export const KIND_LABEL: Record<string, string> = { paper: 'Paper', marks: 'Marks file', notes: 'Notes', other: 'Other' };
export const MAX_STAFF_FILE = 10 * 1024 * 1024;
const M = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png'
} as Record<string, string>;
export const ALLOWED_MIME = [...new Set(Object.values(M))];
/** Decides the real type from the extension (browsers differ) and checks the bytes match it. */
export function sniff(buf: Buffer, filename: string, declared: string): { mime: string } | string {
  if (!Buffer.isBuffer(buf) || !buf.length) return 'The file is empty.';
  const ext = filename.split('.').pop()!.toLowerCase(), declaredMime = declared.split(';')[0].trim().toLowerCase();
  const mime = M[ext] ?? (ALLOWED_MIME.includes(declaredMime) ? declaredMime : '');
  if (!mime) return 'Allowed: PDF, Word, Excel, PowerPoint, CSV, text, JPG and PNG.';
  const zip = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50, ole = buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0;
  const text = () => !buf.subarray(0, 4096).includes(0);
  const ok = mime === 'application/pdf' ? buf.subarray(0, 4).toString('latin1') === '%PDF' : mime === 'image/png' ? buf.subarray(0, 4).toString('latin1').startsWith('\x89PNG') : mime === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8
    : [M.docx, M.xlsx, M.pptx].includes(mime) ? zip : [M.doc, M.xls, M.ppt].includes(mime) ? ole : text();
  return ok ? { mime } : 'The file does not match its type.';
}
export function checkStaffUpload(buf: Buffer, q: Record<string, any>, contentType: string) {
  const title = String(q.title ?? '').trim().slice(0, 120), kind = String(q.kind ?? 'other'); if (!title) return 'Give the file a title.'; if (!KIND_LABEL[kind]) return 'Choose what kind of file this is.';
  const name = String(q.name ?? 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'file';
  if (Buffer.isBuffer(buf) && buf.length > MAX_STAFF_FILE) return 'The file is larger than 10 MB.';
  const t = sniff(buf, name, contentType); if (typeof t === 'string') return t;
  return { title, kind, name, mime: t.mime };
}
export const canSeeFilesOf = (u: AuthUser, ownerId: number) => u.id === ownerId || isFull(u.role);
