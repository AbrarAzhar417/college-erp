import { db, getSetting } from '../db.js';
import '../attendance/schema.js';
import '../fee/schema.js';
import { smsConfig, smsNumber, sendSms } from '../hr/notify.js';
import { todayISO } from '../attendance/service.js';
import { audit } from '../audit/service.js';

db.exec(`
CREATE TABLE IF NOT EXISTS parent_msgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  student_id INTEGER, kind TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'sms',
  phone TEXT, text TEXT NOT NULL, status TEXT NOT NULL, error TEXT, by_user INTEGER
);
CREATE INDEX IF NOT EXISTS idx_parent_msgs_student ON parent_msgs(student_id, at);
`);

export type Kind = 'absent' | 'fee' | 'custom';
export interface Item { student_id: number; name: string; class_name: string; phone: string; text: string; wa: string; note?: string }

const school = () => getSetting('short_name') || getSetting('institute_name') || 'College';
const waLink = (phone: string, text: string) => { const n = smsNumber(phone); return n ? `https://wa.me/${n.replace(/\D/g, '')}?text=${encodeURIComponent(text)}` : ''; };
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

export const DEFAULTS: Record<Kind, string> = {
  absent: 'Assalam o Alaikum. {name} ({class}) aaj {date} ko {school} mein ghair hazir hai. Meharbani karke wajah se agah karein.',
  fee: 'Assalam o Alaikum. {name} ({class}) ki fees ka Rs {amount} baqaya hai. Meharbani karke jald ada karein. {school}',
  custom: '{school}: {name} ({class}) ke baray mein ittela.'
};

interface Filter { kind: Kind; sectionId?: number; classId?: number; studentIds?: number[]; text?: string; date?: string; min?: number }

const base = `SELECT st.id AS student_id, st.name, st.phone, c.name || '-' || s.name AS class_name
  FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id`;

/** Builds the messages without sending anything, so the office can read them first. */
export function preview(f: Filter): Item[] {
  const date = f.date || todayISO();
  const w: string[] = ["st.status = 'active'"], p: any[] = [];
  if (f.sectionId) { w.push('s.id = ?'); p.push(f.sectionId); } else if (f.classId) { w.push('c.id = ?'); p.push(f.classId); }
  let rows: any[];
  if (f.kind === 'absent') {
    rows = db.prepare(`${base} JOIN att_daily a ON a.student_id = st.id AND a.date = ? WHERE a.status = 'A' AND ${w.join(' AND ')} ORDER BY c.grade, s.name, st.roll_no`).all(date, ...p);
  } else if (f.kind === 'fee') {
    p.push(Math.max(0, f.min || 0));
    rows = db.prepare(`SELECT st.id AS student_id, st.name, st.phone, c.name || '-' || s.name AS class_name, b.bal AS amount
      FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
      JOIN (SELECT student_id, SUM(amount) AS bal FROM ledger GROUP BY student_id) b ON b.student_id = st.id
      WHERE ${w.join(' AND ')} AND b.bal > ? ORDER BY b.bal DESC LIMIT 1000`).all(...p);
  } else {
    const ids = (f.studentIds ?? []).map(Number).filter(n => n > 0).slice(0, 1000);
    if (!ids.length) return [];
    rows = db.prepare(`${base} WHERE st.status = 'active' AND st.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  }
  const tpl = (f.text && f.text.trim()) || DEFAULTS[f.kind];
  return rows.map(r => {
    const text = fill(tpl, { name: r.name, class: r.class_name, date, school: school(), amount: String(Math.round(r.amount ?? 0)) });
    return { student_id: r.student_id, name: r.name, class_name: r.class_name, phone: r.phone ?? '', text, wa: waLink(r.phone ?? '', text), note: smsNumber(r.phone) ? undefined : 'No valid phone number' };
  });
}

export const smsReady = () => !!smsConfig().url;

/** Replaceable so tests never touch the network. */
let sender: (phone: string, text: string) => Promise<void> = (p, t) => sendSms(p, t);
export const setSender = (fn: typeof sender) => { sender = fn; };

export async function send(items: { student_id: number; phone: string; text: string }[], kind: Kind, by?: { id?: number; name?: string; role?: string }) {
  const ins = db.prepare('INSERT INTO parent_msgs (student_id, kind, phone, text, status, error, by_user) VALUES (?,?,?,?,?,?,?)');
  let sent = 0, failed = 0, skipped = 0;
  const errors: string[] = [];
  for (const it of items.slice(0, 500)) {
    const text = String(it.text ?? '').trim().slice(0, 600);
    if (!text || !smsNumber(it.phone)) { ins.run(it.student_id, kind, it.phone, text || '-', 'skipped', 'No valid phone number', by?.id ?? null); skipped++; continue; }
    try { await sender(it.phone, text); ins.run(it.student_id, kind, it.phone, text, 'sent', null, by?.id ?? null); sent++; }
    catch (e: any) {
      const m = String(e?.message || e); ins.run(it.student_id, kind, it.phone, text, 'failed', m, by?.id ?? null); failed++;
      if (!errors.includes(m)) errors.push(m);
      if (failed >= 3 && sent === 0) break;   // the phone is clearly unreachable: stop instead of 500 failures
    }
  }
  audit(by, 'parentmsg.send', kind, null, { sent, failed, skipped });
  return { sent, failed, skipped, errors };
}

export function msgLog(limit = 200, studentId?: number) {
  const where = studentId ? 'WHERE m.student_id = ?' : '';
  return db.prepare(`SELECT m.*, st.name AS student_name FROM parent_msgs m LEFT JOIN students st ON st.id = m.student_id ${where} ORDER BY m.id DESC LIMIT ?`).all(...(studentId ? [studentId, limit] : [limit]));
}
