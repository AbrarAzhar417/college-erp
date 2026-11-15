import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { db } from '../src/db.js';
import { signTicket } from '../src/auth.js';
import { b32decode, b32encode, beginSetup, checkCode, confirmSetup, disableOtp, mustSetup, otpEnabled, requiredRoles, resetOtpLimits, saveRequiredRoles, totp } from '../src/otp/service.js';
import { otpLoginRouter, otpRouter } from '../src/otp/routes.js';

const call = (router: any, method: string, path: string, opts: { body?: any; params?: any; user?: any } = {}) => new Promise<{ status: number; body: any }>(resolve => {
  const r = router.routes.find((x: any) => x.method === method && x.path === path);
  if (!r) return resolve({ status: -1, body: 'route not found ' + path });
  const res: any = { code: 200, status(c: number) { this.code = c; return this; }, json(b: any) { resolve({ status: this.code, body: b }); return this; } };
  try { r.h[r.h.length - 1]({ body: opts.body ?? {}, params: opts.params ?? {}, query: {}, ip: '1.1.1.1', user: opts.user }, res, () => {}); } catch (e: any) { console.log(e.stack); resolve({ status: 500, body: String(e) }); }
});
const mkUser = (name: string, role = 'accountant') => Number(db.prepare('INSERT INTO users (username, name, role, password_hash, active) VALUES (?,?,?,?,1)').run(name, name, role, bcrypt.hashSync('pass-12345', 4)).lastInsertRowid);

test('TOTP matches the RFC 6238 test vector and base32 round-trips', () => {
  const secret = b32encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totp(secret, 1), '287082');                      // time 59 s
  assert.equal(totp(secret, 37037036), '081804');               // time 1111111080 s
  assert.equal(b32decode(secret).toString(), '12345678901234567890');
});

test('set-up, login second step, replay, recovery codes, lock-out and reset', async () => {
  resetOtpLimits();
  const id = mkUser('otp-acc'), user = { id, username: 'otp-acc', name: 'otp-acc', role: 'accountant' };
  const s = beginSetup(id, 'otp-acc');
  assert.ok(s.uri.startsWith('otpauth://totp/') && s.uri.includes(s.secret));
  assert.equal(otpEnabled(id), false);
  const t0 = Date.now(), step = Math.floor(t0 / 30000);
  assert.throws(() => confirmSetup(id, '000000', t0), /not right/);
  const codes = confirmSetup(id, totp(s.secret, step), t0);
  assert.equal(codes.length, 8); assert.equal(otpEnabled(id), true);
  // the same code cannot be used twice; a later one can
  assert.equal(checkCode(id, totp(s.secret, step), { now: t0 }), false);
  assert.equal(checkCode(id, totp(s.secret, step + 1), { now: t0 }), true);
  // second step of login through the router
  const ticket = signTicket(id);
  assert.equal((await call(otpLoginRouter, 'POST', '/auth/otp', { body: { ticket: 'junk', code: '123456' } })).status, 401);
  assert.equal((await call(otpLoginRouter, 'POST', '/auth/otp', { body: { ticket, code: '000000' } })).status, 401);
  const ok = await call(otpLoginRouter, 'POST', '/auth/otp', { body: { ticket, code: codes[0] } });   // a recovery code works once
  assert.equal(ok.status, 200); assert.ok(ok.body.token); assert.equal(ok.body.user.username, 'otp-acc');
  assert.equal((await call(otpLoginRouter, 'POST', '/auth/otp', { body: { ticket, code: codes[0] } })).status, 401);
  // five wrong codes lock the account for a while, even a right one
  for (let i = 0; i < 4; i++) await call(otpLoginRouter, 'POST', '/auth/otp', { body: { ticket, code: '111111' } });
  assert.equal((await call(otpLoginRouter, 'POST', '/auth/otp', { body: { ticket, code: codes[1] } })).status, 429);
  resetOtpLimits();
  // switching off needs the password and a code
  assert.equal((await call(otpRouter, 'POST', '/disable', { user, body: { password: 'wrong', code: codes[1] } })).status, 400);
  assert.equal((await call(otpRouter, 'POST', '/disable', { user, body: { password: 'pass-12345', code: codes[1] } })).status, 200);
  assert.equal(otpEnabled(id), false);
  void disableOtp;
});

test('required roles: must set up first, cannot switch off, director can reset', async () => {
  const id = mkUser('otp-req', 'accountant'), dir = { id: mkUser('otp-dir', 'director'), username: 'otp-dir', name: 'd', role: 'director' };
  assert.equal(mustSetup({ id, role: 'accountant' }), false);
  assert.deepEqual(saveRequiredRoles(['accountant', 'nonsense']), ['accountant']);
  assert.equal(mustSetup({ id, role: 'accountant' }), true);
  const user = { id, username: 'otp-req', name: 'x', role: 'accountant' };
  const s = beginSetup(id, 'otp-req'); confirmSetup(id, totp(s.secret, Math.floor(Date.now() / 30000)));
  assert.equal(mustSetup({ id, role: 'accountant' }), false);
  assert.equal((await call(otpRouter, 'POST', '/disable', { user, body: { password: 'pass-12345', code: '123456' } })).status, 400);
  const r = await call(otpRouter, 'DELETE', '/users/:id', { user: dir, params: { id } });
  assert.equal(r.status, 200); assert.equal(otpEnabled(id), false);
  saveRequiredRoles([]); assert.deepEqual(requiredRoles(), []);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decrypt, encrypt, copyOffsite, saveOffsite, offsiteView, setMail, setPut } from '../src/backup/offsite.js';
import { makeBackup, BACKUP_DIR } from '../src/backup/service.js';

test('off-site backup: encrypted, restorable, folder + WebDAV + email, one failure does not stop the rest', async () => {
  const data = Buffer.from('SQLite format 3\0 pretend database ' + 'x'.repeat(5000));
  const blob = encrypt(data, 'correct horse');
  assert.ok(!blob.includes('pretend database'));
  assert.deepEqual(decrypt(blob, 'correct horse'), data);
  assert.throws(() => decrypt(blob, 'wrong pass!!'), /Wrong passphrase/);
  assert.throws(() => decrypt(Buffer.from('nope'), 'x'), /Not an encrypted/);

  assert.throws(() => saveOffsite({ email: 'a@b.co' }), /passphrase/);              // e-mail needs a passphrase
  assert.throws(() => saveOffsite({ pass: 'short' }), /8 characters/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsite-'));
  saveOffsite({ pass: 'correct horse', folder: dir, email: 'boss@example.com', webdav: { url: 'https://dav.example.com/backups', user: 'u', pass: 'p' } });
  const v = offsiteView(); assert.equal(v.pass_set, true); assert.ok(!JSON.stringify(v).includes('correct horse'));   // secrets never returned

  const name = await makeBackup('auto'), file = path.join(BACKUP_DIR, name);
  const puts: string[] = [], mails: any[] = [];
  setPut(async (url, body, auth) => { puts.push(url); assert.ok(auth.startsWith('Basic ')); assert.ok(!body.includes('SQLite format 3')); });
  setMail(async (to, _s, _t, _c, att) => { mails.push({ to, att }); throw new Error('mail server down'); });
  const r = await copyOffsite(file);
  assert.deepEqual(r.map(x => `${x.where}:${x.ok}`).sort(), ['Email:false', 'Folder:true', 'WebDAV:true']);
  assert.equal(puts.length, 1); assert.ok(puts[0].endsWith('.db.enc')); assert.equal(mails[0].att.name.endsWith('.db.enc'), true);
  const copied = path.join(dir, name + '.enc'); assert.ok(fs.existsSync(copied));
  assert.deepEqual(decrypt(fs.readFileSync(copied), 'correct horse'), fs.readFileSync(file));   // the copy restores to the same bytes
  fs.rmSync(dir, { recursive: true, force: true });
  saveOffsite({ folder: '', email: '', webdav: { url: '', user: '', pass: '' } });
});

import { bulkReadLog, downloadsReport } from '../src/audit/downloads.js';
import { audit } from '../src/audit/service.js';

test('downloads report: big reads are logged, small ones are not, and heavy users are flagged', () => {
  const run = (user: any, n: number, p = '/students') => {
    const res: any = { statusCode: 200, json(b: any) { return b; } };
    bulkReadLog({ method: 'GET', path: p, baseUrl: '/api', user, ip: '1.1.1.1' } as any, res, () => {});
    res.json(Array.from({ length: n }, (_, i) => i));
  };
  const a = { id: 9001, name: 'Teacher A', role: 'teacher' }, b = { id: 9002, name: 'Clerk B', role: 'admin' };
  run(a, 30); run(a, 120); run(b, 3000); run(b, 2500, '/fee/ledger'); run(b, 500, '/dashboard');   // /dashboard is not counted
  audit(b, 'export.students', 'class', 'all', '1800 rows');
  const r = downloadsReport();
  const ua = r.users.find(u => u.user === 'Teacher A')!, ub = r.users.find(u => u.user === 'Clerk B')!;
  assert.equal(ua.events, 1); assert.equal(ua.rows, 120); assert.equal(ua.unusual, false);
  assert.equal(ub.rows, 3000 + 2500 + 1800); assert.equal(ub.exports, 1); assert.equal(ub.unusual, true);
  assert.equal(ub.top[0].path, '/students');
  assert.ok(r.users.indexOf(ub) < r.users.indexOf(ua));
});
