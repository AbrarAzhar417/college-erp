import { Router } from 'express';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { cardData } from './service.js';

export const cardsRouter = Router();
cardsRouter.get('/', requireRole('director', 'principal', 'admin'), (req, res) => {
  const kind = req.query.kind === 'transport' ? 'transport' : 'id';
  const r = cardData(kind, {
    classId: Number(req.query.classId) || undefined, sectionId: Number(req.query.sectionId) || undefined,
    studentIds: String(req.query.studentIds ?? '').split(',').map(Number).filter(n => n > 0)
  });
  if ('error' in r) return res.status(400).json({ message: r.error });
  audit(req.user, `cards.${kind}`, 'cards', null, `${r.cards.length} cards`);
  res.json(r);
});
