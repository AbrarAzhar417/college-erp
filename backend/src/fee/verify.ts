import { Router } from 'express';
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from '../db.js';
import './schema.js';

/**
 * Receipts carry a QR code. Scanning it opens /verify/<code> where anyone can see whether the receipt is genuine.
 * The code is the receipt number plus a signature over (receipt number, student, amount, date) made with a secret that
 * only this server holds, so a receipt cannot be invented or its amount altered. Only name, class, amount, date and
 * status are shown: no phone, CNIC or balance.
 */
const secret = () => {
  let s = getSetting('receipt_secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); setSetting('receipt_secret', s); }
  return s;
};
const sign = (p: { receipt_no: string; student_id: number; amount: number; paid_on: string }) =>
  crypto.createHmac('sha256', secret()).update(`${p.receipt_no}|${p.student_id}|${p.amount}|${p.paid_on}`).digest('hex').slice(0, 12);

export const receiptCode = (p: { receipt_no: string; student_id: number; amount: number; paid_on: string }) => `${p.receipt_no}~${sign(p)}`;

export function verifyReceipt(code: string) {
  const [no, sig] = String(code ?? '').split('~');
  if (!no || !sig || no.length > 40) return null;
  const p = db.prepare(`SELECT p.receipt_no, p.student_id, p.amount, p.paid_on, p.mode, p.cancelled, st.name, c.name AS class_name, s.name AS section_name
    FROM payments p JOIN students st ON st.id = p.student_id JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE p.receipt_no = ?`).get(no) as any;
  if (!p) return null;
  const good = Buffer.from(sign(p)), given = Buffer.from(sig);
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return null;
  return { receipt_no: p.receipt_no, paid_on: p.paid_on, amount: p.amount, mode: p.mode, name: p.name, class: `${p.class_name}-${p.section_name}`, cancelled: !!p.cancelled };
}

const tries = new Map<string, { n: number; first: number }>();
export const resetVerifyLimits = () => tries.clear();
export const receiptVerifyRouter = Router();
receiptVerifyRouter.get('/receipt/:code', (req, res) => {
  const ip = req.ip || 'x', now = Date.now();
  let a = tries.get(ip); if (!a || now - a.first > 15 * 60_000) { a = { n: 0, first: now }; tries.set(ip, a); }
  if (++a.n > 60) return res.status(429).json({ message: 'Too many tries. Please wait a few minutes.' });
  const r = verifyReceipt(String(req.params.code));
  if (!r) return res.status(404).json({ valid: false, message: 'This receipt could not be verified. It may not be genuine.' });
  res.json({ valid: true, institute: getSetting('institute_name'), ...r });
});
