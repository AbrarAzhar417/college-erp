import express, { Router } from 'express';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { admissionPrompt, allowScan, apiKey, readImage, saveApiKey, sniffImage, visionReady, VisionError } from './vision.js';

export const ocrRouter = Router();

ocrRouter.get('/status', requireRole('director', 'principal', 'admin', 'teacher'), (_req, res) => res.json({ ready: visionReady(), fromEnv: !!process.env.ANTHROPIC_API_KEY }));
/** The key is only ever written here, never sent back. */
ocrRouter.put('/key', requireRole('director', 'principal'), (req, res) => {
  const k = String(req.body?.key ?? '').trim();
  if (k && !/^sk-[\w-]{20,}$/.test(k)) return res.status(400).json({ message: 'That does not look like an API key (it starts with sk-).' });
  saveApiKey(k); audit(req.user, 'ocr.key', 'settings', null, k ? 'set' : 'removed');
  res.json({ ready: visionReady() });
});

const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
/** A photo of a filled admission form fills the admission screen; nothing is saved until the person presses Save there. */
ocrRouter.post('/admission', requireRole('director', 'principal', 'admin'), express.raw({ type: () => true, limit: '8mb' }), async (req, res) => {
  const buf = req.body as Buffer; const mime = Buffer.isBuffer(buf) ? sniffImage(buf) : null;
  if (!mime) return res.status(400).json({ message: 'Send a photo (JPG or PNG) of the form.' });
  if (!visionReady()) return res.status(503).json({ message: 'Photo reading is not set up. The Director can add the key in System & Safety → Photo reading.' });
  if (!allowScan(req.user!.id)) return res.status(429).json({ message: 'Too many photos this hour. Try again later.' });
  try {
    const r = await readImage(buf, mime, admissionPrompt);
    const g = String(r.gender ?? '').toLowerCase();
    audit(req.user, 'admission.scan', 'student', null, '');
    res.json({
      name: clean(r.name, 80), father_name: clean(r.father_name, 80), father_cnic: clean(r.father_cnic, 20), dob: /^\d{4}-\d{2}-\d{2}$/.test(String(r.dob)) ? String(r.dob) : '',
      gender: g.startsWith('f') ? 'Female' : g.startsWith('m') ? 'Male' : '', phone: clean(r.phone, 20), father_phone: clean(r.father_phone, 20), mother_phone: clean(r.mother_phone, 20),
      address: clean(r.address, 200), class: clean(r.class, 20), p_number: clean(r.p_number, 30), previous_school: clean(r.previous_school, 80)
    });
  } catch (e: any) { res.status(e instanceof VisionError ? 502 : 500).json({ message: e instanceof VisionError ? e.message : 'The photo could not be read.' }); }
});
