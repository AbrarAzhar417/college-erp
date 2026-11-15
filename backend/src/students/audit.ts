import { Router } from 'express';
import express from 'express';
import { db } from '../db.js';
import type { AuthUser } from '../auth.js';

db.exec(`
CREATE TABLE IF NOT EXISTS category_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  old_category TEXT, new_category TEXT,
  changed_by INTEGER, changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_catlog_student ON category_change_log(student_id);
CREATE TABLE IF NOT EXISTS student_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  doc_type TEXT NOT NULL,
  filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0, verified_by INTEGER, verified_at TEXT,
  uploaded_by INTEGER, uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_studoc_student ON student_documents(student_id);
`);

/** Writes a line to the category history when the category really changed. */
export function logCategoryChange(studentId: number, oldCat: string | null, newCat: string | null, by: number | null, reason: string | null = null) {
  if ((oldCat || null) === (newCat || null)) return false;
  db.prepare('INSERT INTO category_change_log (student_id, old_category, new_category, changed_by, reason) VALUES (?,?,?,?,?)').run(studentId, oldCat || null, newCat || null, by, reason);
  return true;
}

export const DOC_TYPES: { key: string; label: string; categories?: string[] }[] = [
  { key: 'bform', label: 'B-form' }, { key: 'birth_cert', label: 'Birth certificate' }, { key: 'cnic_copy', label: 'Father CNIC copy' }, { key: 'last_result', label: 'Last result card' },
  { key: 'service_card', label: 'KRL service card', categories: ['A'] }, { key: 'pension_proof', label: 'KRL pension proof', categories: ['B'] }
];
const MIME = ['image/jpeg', 'image/png', 'application/pdf'];
export const MAX_DOC = 4 * 1024 * 1024;

export function documentChecklist(studentId: number) {
  const st = db.prepare('SELECT category FROM students WHERE id = ?').get(studentId) as { category: string | null } | undefined;
  if (!st) return null;
  const docs = db.prepare('SELECT id, doc_type, filename, mime, size, verified, verified_at, uploaded_at FROM student_documents WHERE student_id = ? ORDER BY id').all(studentId) as any[];
  const needed = DOC_TYPES.filter(t => !t.categories || (st.category && t.categories.includes(st.category)));
  const list = needed.map(t => { const mine = docs.filter(d => d.doc_type === t.key); return { key: t.key, label: t.label, files: mine, uploaded: mine.length > 0, verified: mine.some(d => d.verified) }; });
  return { category: st.category, list, missing: list.filter(x => !x.uploaded).map(x => x.label), unverified: list.filter(x => x.uploaded && !x.verified).map(x => x.label) };
}

export function registerStudentAudit(api: Router, canWrite: express.RequestHandler) {
  api.get('/students/:id/category-log', (req, res) => {
    res.json(db.prepare(`SELECT l.id, l.old_category, l.new_category, l.changed_at, l.reason, u.name AS changed_by FROM category_change_log l LEFT JOIN users u ON u.id = l.changed_by WHERE l.student_id = ? ORDER BY l.id DESC`).all(Number(req.params.id)));
  });
  api.get('/students/:id/documents', (req, res) => {
    const c = documentChecklist(Number(req.params.id));
    if (!c) return res.status(404).json({ message: 'Student not found.' });
    res.json(c);
  });
  api.post('/students/:id/documents', canWrite, express.raw({ type: () => true, limit: '5mb' }), (req, res) => {
    const id = Number(req.params.id), type = String(req.query.type ?? '');
    if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) return res.status(404).json({ message: 'Student not found.' });
    if (!DOC_TYPES.some(t => t.key === type)) return res.status(400).json({ message: 'Unknown document type.' });
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!MIME.includes(mime)) return res.status(400).json({ message: 'Upload a JPG, PNG or PDF file.' });
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ message: 'The file is empty.' });
    if (buf.length > MAX_DOC) return res.status(400).json({ message: 'The file is larger than 4 MB. Scan at a lower quality.' });
    const sig = buf.subarray(0, 4).toString('latin1');   // the file must really be what it says
    if (!((mime === 'application/pdf' && sig === '%PDF') || (mime === 'image/png' && sig.startsWith('\x89PNG')) || (mime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8)))
      return res.status(400).json({ message: 'The file does not match its type.' });
    const name = String(req.query.name ?? 'document').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'document';
    const r = db.prepare('INSERT INTO student_documents (student_id, doc_type, filename, mime, size, data, uploaded_by) VALUES (?,?,?,?,?,?,?)').run(id, type, name, mime, buf.length, buf, (req.user as AuthUser).id);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  api.get('/students/:id/documents/:docId/file', (req, res) => {
    const d = db.prepare('SELECT filename, mime, data FROM student_documents WHERE id = ? AND student_id = ?').get(Number(req.params.docId), Number(req.params.id)) as any;
    if (!d) return res.status(404).json({ message: 'Document not found.' });
    res.json({ filename: d.filename, mime: d.mime, base64: Buffer.from(d.data).toString('base64') });
  });
  api.put('/students/:id/documents/:docId/verify', canWrite, (req, res) => {
    const v = req.body?.verified ? 1 : 0;
    const r = db.prepare("UPDATE student_documents SET verified = ?, verified_by = ?, verified_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ? AND student_id = ?").run(v, (req.user as AuthUser).id, v, Number(req.params.docId), Number(req.params.id));
    if (!r.changes) return res.status(404).json({ message: 'Document not found.' });
    res.json({ ok: true });
  });
  api.delete('/students/:id/documents/:docId', canWrite, (req, res) => {
    const r = db.prepare('DELETE FROM student_documents WHERE id = ? AND student_id = ?').run(Number(req.params.docId), Number(req.params.id));
    if (!r.changes) return res.status(404).json({ message: 'Document not found.' });
    res.json({ ok: true });
  });
}
