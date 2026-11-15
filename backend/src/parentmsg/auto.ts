import { db, getSetting, setSetting } from '../db.js';
import { audit } from '../audit/service.js';
import { preview, send, smsReady } from './service.js';

/**
 * Monthly fee reminders sent by the server itself. Off until the office switches it on.
 * It sends once a month, on or after the chosen day, only in daytime (10:00-18:00 server time), only when SMS is set up,
 * and never twice in the same month. Every message is in the parent message log like a hand-sent one.
 */
export interface AutoFee { enabled: boolean; day: number; min: number; last: string; report: { at: string; sent: number; failed: number; skipped: number; note?: string } | null }

export function autoFee(): AutoFee {
  let report = null; try { report = JSON.parse(getSetting('auto_fee_report') || 'null'); } catch { /* ignore */ }
  return { enabled: getSetting('auto_fee_enabled') === '1', day: Math.min(28, Math.max(1, Number(getSetting('auto_fee_day')) || 5)), min: Math.max(0, Number(getSetting('auto_fee_min')) || 0), last: getSetting('auto_fee_last') || '', report };
}
export function saveAutoFee(b: { enabled?: boolean; day?: number; min?: number }) {
  if (b.enabled !== undefined) setSetting('auto_fee_enabled', b.enabled ? '1' : '0');
  if (b.day !== undefined) { const d = Math.round(Number(b.day)); if (!(d >= 1 && d <= 28)) throw new Error('Day must be between 1 and 28.'); setSetting('auto_fee_day', String(d)); }
  if (b.min !== undefined) { const m = Math.round(Number(b.min)); if (!(m >= 0)) throw new Error('Minimum must be 0 or more.'); setSetting('auto_fee_min', String(m)); }
  return autoFee();
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Runs when due. `force` skips the day and hour checks (the "Send now" button) but still refuses to run twice in a month. */
export async function runAutoFee(now = new Date(), opts: { force?: boolean; skipSmsCheck?: boolean } = {}) {
  const c = autoFee(), month = iso(now).slice(0, 7);
  if (!opts.force && !c.enabled) return { ran: false, reason: 'off' };
  if (c.last === month) return { ran: false, reason: 'already sent this month' };
  if (!opts.force && (now.getDate() < c.day || now.getHours() < 10 || now.getHours() >= 18)) return { ran: false, reason: 'not yet' };
  if (!opts.skipSmsCheck && !smsReady()) {
    setSetting('auto_fee_report', JSON.stringify({ at: now.toISOString(), sent: 0, failed: 0, skipped: 0, note: 'SMS is not set up, nothing was sent.' }));
    return { ran: false, reason: 'sms not set up' };
  }
  const items = preview({ kind: 'fee', min: c.min, date: iso(now) });
  const r = await send(items, 'fee', { name: 'automatic' });
  // A phone that is clearly unreachable aborts early with failures: do not mark the month done, so the next check tries again.
  const done = r.sent > 0 || !items.length || r.failed === 0;
  if (done) setSetting('auto_fee_last', month);
  setSetting('auto_fee_report', JSON.stringify({ at: now.toISOString(), sent: r.sent, failed: r.failed, skipped: r.skipped, note: done ? undefined : 'Sending failed, will try again.' }));
  audit(null, 'parentmsg.auto', 'fee', null, { month, ...r });
  return { ran: true, ...r, done };
}

let timer: NodeJS.Timeout | null = null;
export function startAutoFee() {
  if (timer || process.env.NO_AUTOFEE) return;
  timer = setInterval(() => { runAutoFee().catch(e => console.error('Auto fee reminders failed:', e)); }, 3600 * 1000);
  timer.unref();
}
