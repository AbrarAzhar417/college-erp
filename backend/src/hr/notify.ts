import net from 'node:net';
import tls from 'node:tls';
import { getSetting, setSetting } from '../db.js';

/**
 * Sends real e-mails (SMTP, e.g. Gmail with an App password) and real SMS (through an Android phone running a free
 * "SMS Gateway" app on the same WiFi). No extra package is used. WhatsApp cannot be sent without a business account,
 * so it stays a one-click chat that the person presses Send in.
 */
export interface SmtpConfig { host: string; port: number; secure: 'ssl' | 'starttls' | 'none'; user: string; pass: string; from_name: string; from_email: string }
export interface SmsConfig { url: string; user: string; pass: string; path: string }

const SMTP_KEY = 'hr_smtp', SMS_KEY = 'hr_sms';
const read = <T>(key: string, empty: T): T => { try { return { ...empty, ...JSON.parse(getSetting(key) || '{}') }; } catch { return empty; } };
export const smtpConfig = () => read<SmtpConfig>(SMTP_KEY, { host: '', port: 465, secure: 'ssl', user: '', pass: '', from_name: '', from_email: '' });
export const smsConfig = () => read<SmsConfig>(SMS_KEY, { url: '', user: '', pass: '', path: '/message' });
export const notifyView = () => {
  const m = smtpConfig(), s = smsConfig();
  return { smtp: { ...m, pass: '', pass_set: !!m.pass, ready: !!(m.host && (m.from_email || m.user)) }, sms: { ...s, pass: '', pass_set: !!s.pass, ready: !!s.url } };
};
/** A blank password in the form means "keep the one already saved". */
export function saveNotify(b: any) {
  const m = smtpConfig(), s = smsConfig(), str = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
  if (b?.smtp) {
    const x = b.smtp, port = Math.round(Number(x.port));
    setSetting(SMTP_KEY, JSON.stringify({
      host: str(x.host, 120), port: port > 0 && port < 65536 ? port : 465, secure: ['ssl', 'starttls', 'none'].includes(x.secure) ? x.secure : 'ssl',
      user: str(x.user, 120), pass: x.pass ? str(x.pass, 200) : m.pass, from_name: str(x.from_name, 80), from_email: str(x.from_email, 120)
    }));
  }
  if (b?.sms) {
    const x = b.sms;
    setSetting(SMS_KEY, JSON.stringify({ url: str(x.url, 200).replace(/\/+$/, ''), user: str(x.user, 80), pass: x.pass ? str(x.pass, 120) : s.pass, path: '/' + str(x.path || '/message', 60).replace(/^\/+/, '') }));
  }
}

// ---------------------------------------------------------------- SMTP
const TIMEOUT = 15000;
class Conn {
  private buf = ''; private waiters: (() => void)[] = []; private err: Error | null = null;
  constructor(public sock: net.Socket) { this.attach(sock); }
  private attach(s: net.Socket) {
    s.setEncoding('utf8'); s.setTimeout(TIMEOUT);
    s.on('data', d => { this.buf += d; this.wake(); });
    s.on('error', e => { this.err = e; this.wake(); }); s.on('timeout', () => { this.err = new Error('The mail server did not answer in time.'); this.wake(); s.destroy(); });
    s.on('close', () => { this.err ??= new Error('The mail server closed the connection.'); this.wake(); });
  }
  private wake() { const w = this.waiters; this.waiters = []; w.forEach(f => f()); }
  upgrade(host: string): Promise<void> {
    return new Promise((ok, fail) => {
      this.sock.removeAllListeners(); const t = tls.connect({ socket: this.sock, servername: host }, () => ok());
      this.err = null; this.buf = ''; this.sock = t; this.attach(t); t.once('error', fail);
    });
  }
  /** One complete reply (a reply may have several lines; the last one has a space after the code). */
  async reply(): Promise<{ code: number; text: string }> {
    for (;;) {
      const lines = this.buf.split('\r\n');
      const done = lines.findIndex(l => /^\d{3} /.test(l));
      if (done >= 0) { const text = lines.slice(0, done + 1).join('\n'); this.buf = lines.slice(done + 1).join('\r\n'); return { code: Number(text.slice(0, 3)), text }; }
      if (this.err) throw this.err;
      await new Promise<void>(r => this.waiters.push(r));
    }
  }
  write(s: string) { this.sock.write(s + '\r\n'); }
  async cmd(s: string, ok: number[]) {
    this.write(s); const r = await this.reply();
    if (!ok.includes(r.code)) throw new Error(`Mail server said: ${r.text.replace(/\n/g, ' ').slice(0, 200)}`);
    return r;
  }
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const mime = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

export async function sendEmail(to: string, subject: string, text: string, cfg: SmtpConfig = smtpConfig(), attach?: { name: string; data: Buffer }): Promise<void> {
  if (!cfg.host) throw new Error('Email is not set up yet (Settings, Email and SMS).');
  const from = cfg.from_email || cfg.user;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('This email address looks wrong.');
  const sock = await new Promise<net.Socket>((ok, fail) => {
    const s = cfg.secure === 'ssl' ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => ok(s)) : net.connect({ host: cfg.host, port: cfg.port }, () => ok(s));
    s.once('error', fail); s.setTimeout(TIMEOUT, () => { s.destroy(); fail(new Error('Could not reach the mail server.')); });
  });
  const c = new Conn(sock);
  try {
    let r = await c.reply(); if (r.code !== 220) throw new Error(`Mail server said: ${r.text.slice(0, 200)}`);
    await c.cmd('EHLO erp.local', [250]);
    if (cfg.secure === 'starttls') { await c.cmd('STARTTLS', [220]); await c.upgrade(cfg.host); await c.cmd('EHLO erp.local', [250]); }
    if (cfg.user) { await c.cmd('AUTH LOGIN', [334]); await c.cmd(b64(cfg.user), [334]); await c.cmd(b64(cfg.pass), [235]); }
    await c.cmd(`MAIL FROM:<${from}>`, [250]); await c.cmd(`RCPT TO:<${to}>`, [250, 251]); await c.cmd('DATA', [354]);
    const body = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    const boundary = '=_erp_' + Date.now().toString(36);
    const head = [`From: ${cfg.from_name ? mime(cfg.from_name) + ' ' : ''}<${from}>`, `To: <${to}>`, `Subject: ${mime(subject)}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0',
      ...(attach ? [`Content-Type: multipart/mixed; boundary="${boundary}"`] : ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'])];
    const file = attach ? attach.data.toString('base64').replace(/(.{76})/g, '$1\r\n') : '';
    const payload = attach
      ? `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}\r\n--${boundary}\r\nContent-Type: application/octet-stream; name="${attach.name}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${attach.name}"\r\n\r\n${file}\r\n--${boundary}--`
      : body;
    c.write(head.join('\r\n') + '\r\n\r\n' + payload + '\r\n.');
    r = await c.reply(); if (r.code !== 250) throw new Error(`Mail server said: ${r.text.replace(/\n/g, ' ').slice(0, 200)}`);
    try { c.write('QUIT'); } catch { /* done */ }
  } finally { c.sock.destroy(); }
}

// ---------------------------------------------------------------- SMS through the Android phone
export const smsNumber = (p: string | null | undefined) => { let d = (p ?? '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '92' + d.slice(1); else if (d.length === 10 && d.startsWith('3')) d = '92' + d; return d.length >= 11 ? '+' + d : ''; };

export async function sendSms(phone: string, text: string, cfg: SmsConfig = smsConfig()): Promise<void> {
  if (!cfg.url) throw new Error('SMS is not set up yet (Settings, Email and SMS).');
  const to = smsNumber(phone); if (!to) throw new Error('This phone number looks wrong.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.user) headers['Authorization'] = 'Basic ' + b64(`${cfg.user}:${cfg.pass}`);
  let r: Response;
  try { r = await fetch(cfg.url + cfg.path, { method: 'POST', headers, body: JSON.stringify({ message: text, phoneNumbers: [to] }), signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error('The SMS phone could not be reached. Is it on the same WiFi with the gateway app running?'); }
  if (!r.ok) throw new Error(r.status === 401 ? 'The SMS phone refused the user name or password.' : `The SMS phone answered ${r.status}.`);
}
