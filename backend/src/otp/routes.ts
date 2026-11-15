import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireRole, signTicket, signToken, verifyTicket, type AuthUser } from '../auth.js';
import { dutiesOf } from '../duties.js';
import { audit } from '../audit/service.js';
import { beginSetup, checkCode, confirmSetup, disableOtp, mustSetup, otpEnabled, recoveryLeft, requiredRoles, saveRequiredRoles, usersOtp } from './service.js';

const msg = (res: any, code: number, m: string) => res.status(code).json({ message: m });

/** Second step of login: no token yet, only the short ticket given after the password was right. */
export const otpLoginRouter = Router();
otpLoginRouter.post('/auth/otp', (req, res) => {
  const uid = verifyTicket(String(req.body?.ticket ?? ''));
  if (!uid) return msg(res, 401, 'This login has timed out. Enter your password again.');
  const row = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(uid) as any;
  if (!row) return msg(res, 401, 'This login has timed out. Enter your password again.');
  let ok = false;
  try { ok = checkCode(uid, String(req.body?.code ?? ''), { allowRecovery: true }); } catch (e: any) { return msg(res, 429, e.message); }
  if (!ok) { audit(null, 'login.otp_failed', 'user', uid, `username ${row.username}`, req.ip || ''); return msg(res, 401, 'That code is not right.'); }
  const user: AuthUser = { id: row.id, name: row.name, username: row.username, role: row.role, duties: row.role === 'teacher' ? dutiesOf(row.id) : [] };
  audit(user, 'login', 'user', user.id, 'two-step', req.ip || '');
  res.json({ token: signToken(user), user });
});

/** Everything here needs a logged-in user. */
export const otpRouter = Router();
const boss = requireRole('director', 'principal');
otpRouter.get('/status', (req, res) => res.json({ enabled: otpEnabled(req.user!.id), recoveryLeft: recoveryLeft(req.user!.id), required: mustSetup(req.user!) || requiredRoles().includes(req.user!.role) }));
otpRouter.post('/setup', (req, res) => { try { res.json(beginSetup(req.user!.id, req.user!.username)); } catch (e: any) { msg(res, 400, e.message); } });
otpRouter.post('/enable', (req, res) => {
  try { const codes = confirmSetup(req.user!.id, String(req.body?.code ?? '')); audit(req.user, 'otp.enable', 'user', req.user!.id); res.json({ recovery: codes }); }
  catch (e: any) { msg(res, 400, e.message); }
});
otpRouter.post('/disable', (req, res) => {
  if (requiredRoles().includes(req.user!.role)) return msg(res, 400, 'Your role must use two-step login, so it cannot be turned off.');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!row || !bcrypt.compareSync(String(req.body?.password ?? ''), row.password_hash)) return msg(res, 400, 'Password is wrong.');
  try { if (!checkCode(req.user!.id, String(req.body?.code ?? ''), { allowRecovery: true })) return msg(res, 400, 'That code is not right.'); } catch (e: any) { return msg(res, 429, e.message); }
  disableOtp(req.user!.id); audit(req.user, 'otp.disable', 'user', req.user!.id); res.json({ ok: true });
});
otpRouter.get('/policy', boss, (_req, res) => res.json({ roles: requiredRoles(), users: usersOtp() }));
otpRouter.put('/policy', boss, (req, res) => { const roles = saveRequiredRoles(req.body?.roles); audit(req.user, 'otp.policy', 'settings', '', { roles }); res.json({ roles, users: usersOtp() }); });
/** A lost phone: the office switches it off for that person, who then sets it up again. */
otpRouter.delete('/users/:id', boss, (req, res) => { disableOtp(Number(req.params.id)); audit(req.user, 'otp.reset', 'user', req.params.id); res.json({ users: usersOtp() }); });

export const ticket = signTicket;
