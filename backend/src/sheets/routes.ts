import { Router } from 'express';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { EXPORT_COLUMNS, canSheet, classExport, sectionSheet } from './service.js';

export const sheetsRouter = Router();

/** Several sections at once (to print a whole class): ?ids=1,2,3 */
sheetsRouter.get('/sections', requireRole('director', 'principal', 'admin', 'teacher'), (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').map(Number).filter(n => n > 0).slice(0, 12);
  const out = [];
  for (const id of ids) {
    if (!canSheet(req.user!, id)) return res.status(403).json({ message: 'You can print sheets only for your own classes.' });
    const s = sectionSheet(id); if (s) out.push(s);
  }
  res.json(out);
});

sheetsRouter.get('/export', requireRole('director', 'principal', 'admin'), (req, res) => {
  const classId = Number(req.query.classId) || undefined, sectionId = Number(req.query.sectionId) || undefined;
  const rows = classExport({ classId, sectionId });
  audit(req.user, 'export.students', 'class', sectionId ?? classId ?? 'all', `${rows.length} rows`);
  res.json({ columns: EXPORT_COLUMNS, rows });
});
