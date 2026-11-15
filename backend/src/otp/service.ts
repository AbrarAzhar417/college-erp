import crypto from 'node:crypto';
import { db, getSetting, setSetting } from '../db.js';
import { audit } from '../audit/service.js';

/**
 * Two-step login with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, ...): a 6-digit code that
 * changes every 30 seconds (RFC 6238). Works without internet on the phone. Eight one-time recovery codes are shown once.
 * Nothing is sent by e-mail or SMS, so it keeps working when those are not set up.
 */
db.exec(`CREATE TABLE IF NOT EXISTS user_otp (
  user_id INTEGER PRIMARY KEY, secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
  recovery TEXT NOT NULL DEFAULT '[]', last_step INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32encode(buf: Buffer) {
  let bits = 0, v = 0, out = '';
  for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(v << (5 - bits)) & 31];
  return out;
}
export function b32decode(s: string) {
  let bits = 0, v = 0; const out: number[] = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totp(secret: string, step: number) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
const stepNow = (t = Date.now()) => Math.floor(t / 30000);

const row = (id: number) => db.prepare('SELECT * FROM user_otp WHERE user_id = ?').get(id) as { secret: string; enabled: number; recovery: string; last_step: number } | undefined;
export const otpEnabled = (id: number) => !!row(id)?.enabled;
const hash = (s: string) => crypto.createHash('sha256').update(s.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

export function beginSetup(userId: number, username: string) {
  if (otpEnabled(userId)) throw new Error('Two-step login is already on.');
  const secret = b32encode(crypto.randomBytes(20));
  db.prepare('INSERT INTO user_otp (user_id, secret, enabled) VALUES (?,?,0) ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0, last_step = 0').run(userId, secret);
  const issuer = (getSetting('short_name') || getSetting('institute_name') || 'College ERP').replace(/[:?&#%]/g, ' ').trim();
  return { secret, uri: `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30` };
}

// A wrong code is allowed 5 times per user, then that user waits 15 minutes.
const fails = new Map<number, { n: number; until: number }>();
export const resetOtpLimits = () => fails.clear();
const locked = (id: number) => { const f = fails.get(id); return !!f && f.n >= 5 && Date.now() < f.until; };
const miss = (id: number) => { const f = fails.get(id) ?? { n: 0, until: 0 }; f.n = f.until && Date.now() > f.until ? 1 : f.n + 1; f.until = Date.now() + 15 * 60_000; fails.set(id, f); };

/** Checks a 6-digit code (or a recovery code when allowed). A code can be used once: replay of the same step is refused. */
export function checkCode(userId: number, code: string, opts: { allowRecovery?: boolean; now?: number } = {}): boolean {
  const r = row(userId); if (!r) return false;
  if (locked(userId)) throw new Error('Too many wrong codes. Wait 15 minutes and try again.');
  const c = String(code ?? '').replace(/\s/g, '');
  if (/^\d{6}$/.test(c)) {
    const now = stepNow(opts.now);
    for (const s of [now, now - 1, now + 1]) {
      if (s > r.last_step && totp(r.secret, s) === c) { db.prepare('UPDATE user_otp SET last_step = ? WHERE user_id = ?').run(s, userId); fails.delete(userId); return true; }
    }
  } else if (opts.allowRecovery && c.length >= 8) {
    const list = JSON.parse(r.recovery) as string[], h = hash(c), i = list.indexOf(h);
    if (i >= 0) { list.splice(i, 1); db.prepare('UPDATE user_otp SET recovery = ? WHERE user_id = ?').run(JSON.stringify(list), userId); fails.delete(userId); return true; }
  }
  miss(userId); return false;
}

export function confirmSetup(userId: number, code: string, now?: number) {
  const r = row(userId); if (!r || r.enabled) throw new Error('Start the set-up first.');
  if (!checkCode(userId, code, { now })) throw new Error('That code is not right. Check the time on your phone and try again.');
  const codes = Array.from({ length: 8 }, () => { const h = crypto.randomBytes(5).toString('hex'); return `${h.slice(0, 5)}-${h.slice(5)}`; });
  db.prepare('UPDATE user_otp SET enabled = 1, recovery = ? WHERE user_id = ?').run(JSON.stringify(codes.map(hash)), userId);
  return codes;
}
export const disableOtp = (userId: number) => { db.prepare('DELETE FROM user_otp WHERE user_id = ?').run(userId); fails.delete(userId); };
export const recoveryLeft = (userId: number) => { const r = row(userId); return r ? (JSON.parse(r.recovery) as string[]).length : 0; };

// ---- policy: roles that must use two-step login
export const requiredRoles = (): string[] => { try { const v = JSON.parse(getSetting('otp_required_roles') || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
export function saveRequiredRoles(roles: unknown) {
  const ok = ['director', 'principal', 'admin', 'accountant', 'teacher'];
  const list = Array.isArray(roles) ? [...new Set(roles.map(String).filter(r => ok.includes(r)))] : [];
  setSetting('otp_required_roles', JSON.stringify(list)); return list;
}
/** True when this person's role requires two-step login and they have not set it up yet. */
export const mustSetup = (u: { id: number; role: string }) => requiredRoles().includes(u.role) && !otpEnabled(u.id);

export function usersOtp() {
  return (db.prepare('SELECT id, name, username, role FROM users WHERE active = 1 ORDER BY role, name').all() as any[]).map(u => ({ ...u, otp: otpEnabled(u.id) }));
}
export const logOtp = audit;
