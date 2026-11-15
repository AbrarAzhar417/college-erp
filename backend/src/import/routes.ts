import express, { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { analyze, commit, TEMPLATES, type Kind } from './importer.js';
import { importRealStudents, realStudentsCsv } from '../realStudents.js';

export const importRouter = Router();
// A CSV of ten years can be large: this router has its own, bigger body limit and is mounted before the general 2 MB parser.
importRouter.use(requireAuth, requireRole('director', 'principal', 'admin'), express.json({ limit: '30mb' }));

const opts = (b: any) => ({ kind: b?.kind === 'staff' || b?.kind === 'students' ? b.kind as Kind : undefined, mapping: b?.mapping && typeof b.mapping === 'object' ? b.mapping as Record<string, string> : undefined, createMissing: !!b?.createMissing });
importRouter.get('/template/:kind', (req, res) => {
  const k = req.params.kind as Kind; if (!TEMPLATES[k]) return res.status(404).json({ message: 'Unknown kind.' });
  res.json({ csv: TEMPLATES[k] });
});
importRouter.post('/analyze', (req, res) => {
  if (typeof req.body?.text !== 'string') return res.status(400).json({ message: 'Send the CSV text.' });
  const r = analyze(req.body.text, opts(req.body));
  if ('error' in r) return res.status(400).json({ message: r.error });
  res.json(r);
});
importRouter.post('/commit', (req, res) => {
  if (typeof req.body?.text !== 'string') return res.status(400).json({ message: 'Send the CSV text.' });
  const r = commit(req.body.text, opts(req.body));
  if ('error' in r) return res.status(400).json({ message: r.error });
  res.json(r);
});

// The real KMCB students (classes XI and XII, 2026-27): preview, then add. Existing admission numbers are skipped, so running it again is harmless.
importRouter.get('/real-students', (_req, res) => {
  const r = importRealStudents(true) as any;
  if (r.error) return res.status(400).json({ message: r.error });
  res.json({ ...r, csv: realStudentsCsv() });
});
importRouter.post('/real-students', (_req, res) => {
  const r = importRealStudents(false) as any;
  if (r.error) return res.status(400).json({ message: r.error });
  res.json(r);
});
