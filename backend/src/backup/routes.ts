import express, { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { copyLatest, offsiteView, saveOffsite } from './offsite.js';
import { backupPath, checkBackupFile, deleteBackup, listBackups, makeBackup, restoreBackup } from './service.js';

export const backupRouter = Router();
backupRouter.use(requireRole('director', 'principal'));

backupRouter.get('/offsite', (_req, res) => res.json(offsiteView()));
backupRouter.put('/offsite', (req, res) => { try { const v = saveOffsite(req.body ?? {}); audit(req.user, 'backup.offsite_settings', 'settings'); res.json(v); } catch (e: any) { res.status(400).json({ message: e.message }); } });
backupRouter.post('/offsite/run', async (req, res) => { try { res.json({ results: await copyLatest(req.user) }); } catch (e: any) { res.status(400).json({ message: e.message }); } });
backupRouter.get('/', (_req, res) => res.json(listBackups()));
backupRouter.post('/', async (req, res) => {
  try { const name = await makeBackup('manual'); audit(req.user, 'backup.create', 'backup', name); res.status(201).json({ name }); }
  catch (e: any) { res.status(500).json({ message: 'Backup failed: ' + (e?.message || e) }); }
});
backupRouter.get('/:name/download', (req, res) => {
  const p = backupPath(req.params.name); if (!p) return res.status(404).json({ message: 'Backup not found.' });
  audit(req.user, 'backup.download', 'backup', req.params.name);
  res.download(p, req.params.name);
});
backupRouter.delete('/:name', (req, res) => {
  if (!deleteBackup(req.params.name)) return res.status(404).json({ message: 'Backup not found.' });
  audit(req.user, 'backup.delete', 'backup', req.params.name); res.json({ ok: true });
});
/** Restore from one of the saved backups. The person must type RESTORE so it cannot happen by a mis-click. */
backupRouter.post('/:name/restore', async (req, res) => {
  if (req.body?.confirm !== 'RESTORE') return res.status(400).json({ message: 'Type RESTORE to confirm.' });
  const p = backupPath(req.params.name); if (!p) return res.status(404).json({ message: 'Backup not found.' });
  try { const safety = await restoreBackup(p); audit(req.user, 'backup.restore', 'backup', req.params.name, { safety }); res.json({ ok: true, safety }); }
  catch (e: any) { res.status(400).json({ message: e?.message || 'Restore failed.' }); }
});
/** Restore from a .db file the person uploaded (for example after the computer was replaced). */
backupRouter.post('/upload-restore', express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
  if (String(req.query.confirm) !== 'RESTORE') return res.status(400).json({ message: 'Type RESTORE to confirm.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ message: 'No file received.' });
  const tmp = path.join(os.tmpdir(), `erp-restore-${Date.now()}.db`);
  fs.writeFileSync(tmp, req.body);
  try {
    const err = checkBackupFile(tmp); if (err) return res.status(400).json({ message: err });
    const safety = await restoreBackup(tmp); audit(req.user, 'backup.restore_upload', 'backup', '', { safety, bytes: req.body.length });
    res.json({ ok: true, safety });
  } catch (e: any) { res.status(400).json({ message: e?.message || 'Restore failed.' }); }
  finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
});
