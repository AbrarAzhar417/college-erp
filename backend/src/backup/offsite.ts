import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getSetting, setSetting } from '../db.js';
import { sendEmail } from '../hr/notify.js';
import { audit } from '../audit/service.js';
import { BACKUP_DIR, listBackups } from './service.js';

/**
 * A copy of every automatic backup sent somewhere other than this computer: a folder (USB drive, a synced Dropbox/OneDrive/Google
 * Drive folder), a WebDAV address (Nextcloud, many NAS boxes and cloud drives) and/or an e-mail address.
 * The copy is compressed and encrypted with a passphrase the director chooses, so a stolen mailbox or drive reveals nothing.
 * Without a passphrase only the local-folder copy is allowed (plain). The passphrase is NOT recoverable: keep it safe.
 * File format: "KMCBENC1" + salt(16) + iv(12) + tag(16) + AES-256-GCM(gzip(database)).
 * Decrypt with `node scripts/decrypt-backup.mjs <file.enc> <out.db>` and the passphrase.
 */
const MAGIC = Buffer.from('KMCBENC1');
export const encrypt = (data: Buffer, pass: string) => {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.scryptSync(pass, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv), body = Buffer.concat([c.update(zlib.gzipSync(data)), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
};
export const decrypt = (buf: Buffer, pass: string) => {
  if (!buf.subarray(0, 8).equals(MAGIC)) throw new Error('Not an encrypted backup from this program.');
  const salt = buf.subarray(8, 24), iv = buf.subarray(24, 36), tag = buf.subarray(36, 52), key = crypto.scryptSync(pass, salt, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  try { return zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(52)), d.final()])); } catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
};

export interface Offsite { pass: string; folder: string; webdav: { url: string; user: string; pass: string }; email: string }
const empty = (): Offsite => ({ pass: '', folder: '', webdav: { url: '', user: '', pass: '' }, email: '' });
export const offsiteConfig = (): Offsite => { try { const v = JSON.parse(getSetting('offsite') || '{}'); return { ...empty(), ...v, webdav: { ...empty().webdav, ...(v.webdav ?? {}) } }; } catch { return empty(); } };
export function offsiteView() {
  const c = offsiteConfig(); let report = null; try { report = JSON.parse(getSetting('offsite_report') || 'null'); } catch { /* ignore */ }
  return { folder: c.folder, email: c.email, webdav: { url: c.webdav.url, user: c.webdav.user, pass_set: !!c.webdav.pass }, pass_set: !!c.pass, report };
}
/** A blank secret in the form means "keep the one already saved". */
export function saveOffsite(b: any) {
  const c = offsiteConfig(), str = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
  const next: Offsite = {
    pass: b?.pass ? str(b.pass, 200) : c.pass, folder: str(b?.folder ?? c.folder, 300), email: str(b?.email ?? c.email, 120),
    webdav: { url: str(b?.webdav?.url ?? c.webdav.url, 300).replace(/\/+$/, ''), user: str(b?.webdav?.user ?? c.webdav.user, 100), pass: b?.webdav?.pass ? str(b.webdav.pass, 200) : c.webdav.pass }
  };
  if (b?.pass && next.pass.length < 8) throw new Error('The passphrase must be at least 8 characters.');
  if (next.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.email)) throw new Error('This email address looks wrong.');
  if (next.webdav.url && !/^https?:\/\//i.test(next.webdav.url)) throw new Error('The WebDAV address must start with https://');
  if ((next.email || next.webdav.url) && !next.pass) throw new Error('Choose a passphrase first: copies sent by e-mail or to the internet are always encrypted.');
  setSetting('offsite', JSON.stringify(next));
  return offsiteView();
}

type Put = (url: string, body: Buffer, auth: string) => Promise<void>;
let put: Put = async (url, body, auth) => {
  const r = await fetch(url, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(body), signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`The server answered ${r.status}.`);
};
export const setPut = (f: Put) => { put = f; };
type Mail = typeof sendEmail;
let mail: Mail = sendEmail;
export const setMail = (f: Mail) => { mail = f; };

const MAX_MAIL = 20 * 1024 * 1024;
export interface Result { where: string; ok: boolean; note: string }

/** Copies one local backup file to every place that is set up. One failing place never stops the others. */
export async function copyOffsite(file: string, who?: { id?: number; name?: string; role?: string }): Promise<Result[]> {
  const c = offsiteConfig(), base = path.basename(file), out: Result[] = [];
  const raw = fs.readFileSync(file);
  const enc = c.pass ? encrypt(raw, c.pass) : null, name = base.replace(/\.db$/, enc ? '.db.enc' : '.db');
  if (c.folder) {
    try {
      fs.mkdirSync(c.folder, { recursive: true }); fs.writeFileSync(path.join(c.folder, name), enc ?? raw);
      const old = fs.readdirSync(c.folder).filter(f => /^college-auto-.*\.db(\.enc)?$/.test(f)).sort().reverse().slice(14);
      for (const f of old) { try { fs.unlinkSync(path.join(c.folder, f)); } catch { /* ignore */ } }
      out.push({ where: 'Folder', ok: true, note: path.join(c.folder, name) });
    } catch (e: any) { out.push({ where: 'Folder', ok: false, note: e?.message || 'Could not write to the folder.' }); }
  }
  if (c.webdav.url && enc) {
    try { await put(`${c.webdav.url}/${encodeURIComponent(name)}`, enc, 'Basic ' + Buffer.from(`${c.webdav.user}:${c.webdav.pass}`).toString('base64')); out.push({ where: 'WebDAV', ok: true, note: name }); }
    catch (e: any) { out.push({ where: 'WebDAV', ok: false, note: e?.message || 'Upload failed.' }); }
  }
  if (c.email && enc) {
    if (enc.length > MAX_MAIL) out.push({ where: 'Email', ok: false, note: `The copy is ${(enc.length / 1048576).toFixed(1)} MB, too big for e-mail (limit 20 MB). Use a folder or WebDAV.` });
    else try { await mail(c.email, `College backup ${base}`, 'Encrypted backup of the College ERP database. Keep this email. You need the passphrase to open it.', undefined, { name, data: enc }); out.push({ where: 'Email', ok: true, note: c.email }); }
    catch (e: any) { out.push({ where: 'Email', ok: false, note: e?.message || 'Could not send.' }); }
  }
  setSetting('offsite_report', JSON.stringify({ at: new Date().toISOString(), file: base, results: out }));
  audit(who ?? null, 'backup.offsite', 'backup', base, out.map(r => `${r.where}:${r.ok ? 'ok' : 'failed'}`).join(', '));
  return out;
}
/** Used after each automatic backup. */
export function offsiteAfterAuto(name: string) {
  const c = offsiteConfig(); if (!c.folder && !c.webdav.url && !c.email) return;
  copyOffsite(path.join(BACKUP_DIR, name)).catch(e => console.error('Off-site copy failed:', e));
}
export async function copyLatest(who?: any) {
  const last = listBackups()[0]; if (!last) throw new Error('There is no backup yet. Make one first.');
  return copyOffsite(path.join(BACKUP_DIR, last.name), who);
}
