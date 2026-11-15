import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { send } from '../parentmsg/service.js';

/**
 * The principal's notice board. A notice is for staff, for parents or for everyone, shows between a start and an end date, and
 * can be pinned. Staff see the live ones on their dashboard and the system remembers who has read them. A notice for parents can
 * also go out as an SMS, once, to each phone number only one time even if there are several children.
 */
db.exec(`CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, target TEXT NOT NULL DEFAULT 'staff' CHECK (target IN ('staff','parents','all')),
  class_id INTEGER, pinned INTEGER NOT NULL DEFAULT 0, publish_on TEXT NOT NULL, expires_on TEXT, sms_sent INTEGER NOT NULL DEFAULT 0, sms_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, created_by_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec('CREATE TABLE IF NOT EXISTS notice_reads (notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (datetime(\'now\')), PRIMARY KEY (notice_id, user_id))');

const today = () => new Date().toISOString().slice(0, 10);
const isDate = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
const bad = (res: any, m: string, c = 400) => res.status(c).json({ message: m });
const office = requireRole('director', 'principal', 'admin');

export function activeFor(userId: number, date = today()) {
  return db.prepare(`SELECT n.id, n.title, n.body, n.target, n.pinned, n.publish_on, n.expires_on, n.created_by_name,
      EXISTS (SELECT 1 FROM notice_reads r WHERE r.notice_id = n.id AND r.user_id = ?) AS read
    FROM notices n WHERE n.target IN ('staff','all') AND n.publish_on <= ? AND (n.expires_on IS NULL OR n.expires_on >= ?)
    ORDER BY n.pinned DESC, n.publish_on DESC, n.id DESC LIMIT 30`).all(userId, date, date).map((r: any) => ({ ...r, read: !!r.read }));
}

/** One SMS per phone number to the parents of the targeted students. */
export function parentRecipients(classId: number | null) {
  const rows = db.prepare(`SELECT st.id, st.name, st.father_phone, st.mother_phone, st.phone FROM students st JOIN sections s ON s.id = st.section_id
    WHERE st.status = 'active' ${classId ? 'AND s.class_id = ?' : ''} ORDER BY st.id`).all(...(classId ? [classId] : [])) as any[];
  const seen = new Set<string>(), out: { student_id: number; phone: string }[] = [];
  for (const r of rows) {
    const ph = String(r.father_phone || r.mother_phone || r.phone || '').replace(/\D/g, '');
    if (!ph || seen.has(ph)) continue; seen.add(ph); out.push({ student_id: r.id, phone: r.father_phone || r.mother_phone || r.phone });
  }
  return out;
}

export async function smsNotice(id: number, by: any, force = false) {
  const n = db.prepare('SELECT * FROM notices WHERE id = ?').get(id) as any;
  if (!n) return { error: 'Notice not found.', code: 404 };
  if (n.target === 'staff') return { error: 'This notice is for staff only.', code: 400 };
  if (n.sms_sent && !force) return { error: 'The SMS for this notice was already sent.', code: 409 };
  const school = getSetting('short_name') || getSetting('institute_name') || 'College';
  const text = `${school}: ${n.title}. ${n.body}`.replace(/\s+/g, ' ').slice(0, 300);
  const to = parentRecipients(n.class_id);
  const r = await send(to.map(t => ({ ...t, text })), 'custom', by);
  db.prepare('UPDATE notices SET sms_sent = 1, sms_count = ? WHERE id = ?').run(r.sent, id);
  audit(by, 'notice.sms', 'notice', id, r);
  return { ...r, recipients: to.length };
}

export const noticeRouter = Router();
noticeRouter.get('/active', (req, res) => res.json(activeFor(req.user!.id)));
noticeRouter.post('/:id/read', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM notices WHERE id = ?').get(id)) return bad(res, 'Notice not found.', 404);
  db.prepare('INSERT OR IGNORE INTO notice_reads (notice_id, user_id) VALUES (?,?)').run(id, req.user!.id); res.json({ ok: true });
});

noticeRouter.get('/', office, (_req, res) => {
  const staff = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role IN ('teacher','accountant','admin','principal','director')").get() as any).n;
  res.json(db.prepare(`SELECT n.*, (SELECT COUNT(*) FROM notice_reads r WHERE r.notice_id = n.id) AS reads, ? AS staff_total, c.name AS class_name
    FROM notices n LEFT JOIN classes c ON c.id = n.class_id ORDER BY n.pinned DESC, n.publish_on DESC, n.id DESC LIMIT 200`).all(staff));
});

function clean(b: any): { error?: string; v?: any } {
  const title = String(b.title ?? '').trim(), body = String(b.body ?? '').trim();
  if (!title) return { error: 'Write a title.' }; if (!body) return { error: 'Write the notice.' };
  const target = ['staff', 'parents', 'all'].includes(b.target) ? b.target : 'staff';
  const publish = isDate(b.publish_on) ? b.publish_on : today();
  if (b.expires_on && !isDate(b.expires_on)) return { error: 'The end date is not valid.' };
  if (b.expires_on && b.expires_on < publish) return { error: 'The end date is before the start date.' };
  const classId = b.class_id ? Number(b.class_id) : null;
  if (classId && !db.prepare('SELECT 1 FROM classes WHERE id = ?').get(classId)) return { error: 'Class not found.' };
  return { v: { title: title.slice(0, 150), body: body.slice(0, 2000), target, publish, expires: b.expires_on || null, classId, pinned: b.pinned ? 1 : 0 } };
}

noticeRouter.post('/', office, async (req, res) => {
  const c = clean(req.body ?? {}); if (c.error) return bad(res, c.error);
  const v = c.v, r = db.prepare('INSERT INTO notices (title, body, target, class_id, pinned, publish_on, expires_on, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(v.title, v.body, v.target, v.classId, v.pinned, v.publish, v.expires, req.user!.id, req.user!.name);
  const id = Number(r.lastInsertRowid); audit(req.user, 'notice.add', 'notice', id, { title: v.title, target: v.target });
  const sms = req.body?.send_sms && v.target !== 'staff' ? await smsNotice(id, req.user) : null;
  res.status(201).json({ id, sms });
});
noticeRouter.put('/:id', office, (req, res) => {
  const id = Number(req.params.id); if (!db.prepare('SELECT 1 FROM notices WHERE id = ?').get(id)) return bad(res, 'Notice not found.', 404);
  const c = clean(req.body ?? {}); if (c.error) return bad(res, c.error); const v = c.v;
  db.prepare('UPDATE notices SET title = ?, body = ?, target = ?, class_id = ?, pinned = ?, publish_on = ?, expires_on = ? WHERE id = ?').run(v.title, v.body, v.target, v.classId, v.pinned, v.publish, v.expires, id);
  audit(req.user, 'notice.edit', 'notice', id); res.json({ ok: true });
});
noticeRouter.post('/:id/sms', office, async (req, res) => {
  const r: any = await smsNotice(Number(req.params.id), req.user, !!req.body?.force);
  if (r.error) return bad(res, r.error, r.code); res.json(r);
});
noticeRouter.delete('/:id', office, (req, res) => {
  const id = Number(req.params.id); db.prepare('DELETE FROM notices WHERE id = ?').run(id); audit(req.user, 'notice.delete', 'notice', id); res.json({ ok: true });
});
