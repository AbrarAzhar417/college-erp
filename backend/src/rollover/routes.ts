import { Router } from 'express';
import { requireRole } from '../auth.js';
import { makeBackup } from '../backup/service.js';
import { lastRollover, rolloverCommit, rolloverPlan } from './service.js';

export const rolloverRouter = Router();
rolloverRouter.use(requireRole('director', 'principal'));

rolloverRouter.get('/plan', (_req, res) => res.json({ ...rolloverPlan(), last: lastRollover() }));
/** Needs the word PROMOTE; a backup is taken first so the whole step can be undone with Restore. */
rolloverRouter.post('/commit', async (req, res) => {
  if (req.body?.confirm !== 'PROMOTE') return res.status(400).json({ message: 'Type PROMOTE to confirm.' });
  const hold = Array.isArray(req.body?.hold) ? req.body.hold.map(Number).filter((n: number) => n > 0) : [];
  let backup = '';
  try { backup = await makeBackup('pre-restore'); } catch (e: any) { return res.status(500).json({ message: 'Could not make the safety backup, so nothing was changed: ' + (e?.message || e) }); }
  res.json({ ...rolloverCommit({ hold, advance_session: req.body?.advance_session !== false, by: req.user }), backup });
});
