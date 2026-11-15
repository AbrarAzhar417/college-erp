import { Router } from 'express';
import { requireRole } from '../auth.js';
import { listAudit } from './service.js';
import { downloadsReport } from './downloads.js';

export const auditRouter = Router();
auditRouter.use(requireRole('director', 'principal'));
auditRouter.get('/', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(listAudit({ action: q.action, user: q.user, from: q.from, to: q.to, q: q.q, limit: Number(q.limit) || 100, offset: Number(q.offset) || 0 }));
});

auditRouter.get('/downloads', (req, res) => res.json(downloadsReport(req.query.from as string | undefined, req.query.to as string | undefined)));
