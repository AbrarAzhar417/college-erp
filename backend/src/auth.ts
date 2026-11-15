import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { DATA_DIR, db } from './db.js';
import { dutiesOf } from './duties.js';

export type Role = 'director' | 'principal' | 'admin' | 'teacher' | 'accountant';
export interface AuthUser { id: number; name: string; username: string; role: Role; /** Additional charges, read fresh from the database on every request. */ duties?: string[] }

// No .env needed: a random secret is created once and kept in the data folder.
function loadSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, '.jwt_secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const SECRET = loadSecret();

export const signToken = (u: AuthUser) => jwt.sign({ id: u.id, name: u.name, username: u.username, role: u.role }, SECRET, { expiresIn: '12h' });

/** Short-lived proof that the password was right, valid only for the second login step. */
export const signTicket = (userId: number) => jwt.sign({ otp: userId }, SECRET, { expiresIn: '5m' });
export function verifyTicket(t: string): number | null { try { const d = jwt.verify(t, SECRET) as { otp?: number }; return d.otp ? Number(d.otp) : null; } catch { return null; } }

declare module 'express-serve-static-core' {
  interface Request { user?: AuthUser }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ message: 'Please log in.' });
  try {
    const u = jwt.verify(h.slice(7), SECRET) as AuthUser & { iat?: number };
    // The account is checked on every request: a login that was closed stops working at once, and a changed role applies at once.
    const row = db.prepare('SELECT role, active, pw_changed FROM users WHERE id = ?').get(u.id) as { role: Role; active: number; pw_changed: number | null } | undefined;
    if (!row || !row.active) return res.status(401).json({ message: 'This login has been closed. Please contact the office.' });
    // A password that was changed or reset ends every session that was opened before it.
    if (row.pw_changed && (u.iat ?? 0) < row.pw_changed) return res.status(401).json({ message: 'Your password was changed. Please log in again.' });
    req.user = { id: u.id, name: u.name, username: u.username, role: row.role, duties: row.role === 'teacher' ? dutiesOf(u.id) : [] };
    next();
  } catch {
    res.status(401).json({ message: 'Session expired. Please log in again.' });
  }
}

/** Full access: the principal and the admin (and the director above them) see and do everything. Every other role gets only what its routes list. */
export const FULL: Role[] = ['director', 'principal', 'admin'];
export const isFull = (role?: string) => FULL.includes(role as Role);
/** A route that names any full-access role is open to all of them, so the admin can never be left out of a page the principal has. */
const expand = (roles: Role[]): Role[] => (roles.some(r => FULL.includes(r)) ? [...new Set<Role>([...roles, ...FULL])] : roles);

export const requireRole = (...list: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  const roles = expand(list);
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: 'You do not have permission for this.' });
  next();
};

/** Allowed for these roles, or for a teacher who holds the given additional charge. */
export const requireAccess = (list: Role[], duty: string | string[]) => (req: Request, res: Response, next: NextFunction) => {
  const roles = expand(list);
  const hasDuty = Array.isArray(duty) ? duty.some(d => req.user?.duties?.includes(d)) : req.user?.duties?.includes(duty);
  if (!req.user || !(roles.includes(req.user.role) || hasDuty)) return res.status(403).json({ message: 'You do not have permission for this.' });
  next();
};
