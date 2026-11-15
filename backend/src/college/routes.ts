import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit/service.js';
import { setTeacherOpen, teacherOpen } from '../policy.js';

/**
 * The College Profile. The name, address, contacts and logo live in the settings (see PUT /settings); this adds the campus picture and the
 * office-bearers: who is the director, principal, vice principal, headmaster, accounts, HR and admin officer. Their names appear under the
 * signature lines of the printed sheets and on the ID cards, so a change here shows up everywhere. Everyone logged in can read it; the
 * principal, the admin and the director change it.
 */
db.exec(`CREATE TABLE IF NOT EXISTS office_bearers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, post TEXT NOT NULL, title TEXT, name TEXT NOT NULL, phone TEXT, email TEXT, qualification TEXT,
  photo TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

export const POSTS: Record<string, string> = {
  director: 'Director', principal: 'Principal', vice_principal: 'Vice Principal', headmaster: 'Headmaster',
  accounts_officer: 'Accounts Officer', hr_officer: 'HR Officer', admin_officer: 'Admin Officer', other: 'Other'
};
const ORDER = Object.keys(POSTS);

const bad = (res: any, m: string, c = 400) => res.status(c).json({ message: m });
const boss = requireRole('director', 'principal', 'admin');
const text = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
const cleanPhoto = (v: unknown) => (typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v) && v.length <= 160000 ? v : null);

/** The name of whoever holds a post (the first one listed), or '' when nobody is set. */
/** The login of a post-holder shows the name in the College Profile (login page, headers, HR file): one name, one place. */
const ROLE_OF_POST: Record<string, string> = { director: 'director', principal: 'principal', admin_officer: 'admin', accounts_officer: 'accountant' };
export function syncBearerLogins() {
  let changed = 0;
  for (const [post, role] of Object.entries(ROLE_OF_POST)) {
    const name = bearerName(post); if (!name) continue;
    const u = db.prepare('SELECT id, name FROM users WHERE role = ? ORDER BY id LIMIT 1').get(role) as { id: number; name: string } | undefined;
    if (!u || u.name === name) continue;
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
    try { db.prepare('UPDATE hr_staff SET name = ? WHERE user_id = ? AND teacher_id IS NULL').run(name, u.id); } catch { /* HR module not loaded */ }
    changed++;
  }
  return changed;
}
export function bearerName(post: string): string {
  return ((db.prepare('SELECT name FROM office_bearers WHERE post = ? ORDER BY sort_order, id LIMIT 1').get(post) as any)?.name) ?? '';
}
/** Names for the printed sheets and the login page: no phone numbers. */
export function publicBearers() {
  return (db.prepare('SELECT id, post, title, name FROM office_bearers ORDER BY sort_order, id').all() as any[])
    .map(b => ({ id: b.id, post: b.post, title: b.title || POSTS[b.post] || b.post, name: b.name }));
}

function clean(b: any): { error: string } | { v: { post: string; title: string | null; name: string; phone: string | null; email: string | null; qualification: string | null; sort: number } } {
  const post = text(b?.post, 30); if (!POSTS[post]) return { error: 'Choose a post.' };
  const name = text(b?.name, 80); if (name.length < 2) return { error: 'Enter the name.' };
  const title = text(b?.title, 40) || null;
  if (post === 'other' && !title) return { error: 'Type the title of this post.' };
  const email = text(b?.email, 80); if (email && !/^\S+@\S+\.\S+$/.test(email)) return { error: 'This email address does not look right.' };
  return { v: { post, title: post === 'other' ? title : title, name, phone: text(b?.phone, 30) || null, email: email || null, qualification: text(b?.qualification, 120) || null, sort: ORDER.indexOf(post) } };
}

export const collegeRouter = Router();

collegeRouter.get('/bearers', (_req, res) => {
  const rows = db.prepare('SELECT id, post, title, name, phone, email, qualification, (photo IS NOT NULL) AS has_photo FROM office_bearers ORDER BY sort_order, id').all() as any[];
  res.json({ posts: POSTS, items: rows.map(r => ({ ...r, has_photo: !!r.has_photo, label: r.title || POSTS[r.post] })) });
});
collegeRouter.get('/bearers/:id/photo', (req, res) => {
  const r = db.prepare('SELECT photo FROM office_bearers WHERE id = ?').get(Number(req.params.id)) as any;
  if (!r) return bad(res, 'Not found.', 404);
  res.set('Cache-Control', 'private, max-age=300').json({ photo: r.photo });
});
collegeRouter.post('/bearers', boss, (req, res) => {
  const c = clean(req.body); if ('error' in c) return bad(res, c.error);
  const v = c.v, photo = cleanPhoto(req.body?.photo);
  const id = Number(db.prepare('INSERT INTO office_bearers (post, title, name, phone, email, qualification, photo, sort_order) VALUES (?,?,?,?,?,?,?,?)').run(v.post, v.title, v.name, v.phone, v.email, v.qualification, photo, v.sort).lastInsertRowid);
  syncBearerLogins();
  audit(req.user, 'college.bearer.add', 'office_bearer', id, `${POSTS[v.post]}: ${v.name}`);
  res.status(201).json({ id });
});
collegeRouter.put('/bearers/:id', boss, (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT id, name FROM office_bearers WHERE id = ?').get(id) as any; if (!old) return bad(res, 'Not found.', 404);
  const c = clean(req.body); if ('error' in c) return bad(res, c.error);
  const v = c.v;
  db.prepare('UPDATE office_bearers SET post=?, title=?, name=?, phone=?, email=?, qualification=?, sort_order=? WHERE id=?').run(v.post, v.title, v.name, v.phone, v.email, v.qualification, v.sort, id);
  if (req.body?.photo === null || req.body?.photo === '') db.prepare('UPDATE office_bearers SET photo = NULL WHERE id = ?').run(id);
  else if (req.body?.photo !== undefined) { const p = cleanPhoto(req.body.photo); if (!p) return bad(res, 'Use a PNG, JPG or WebP photo under about 100 KB.'); db.prepare('UPDATE office_bearers SET photo = ? WHERE id = ?').run(p, id); }
  syncBearerLogins();
  audit(req.user, 'college.bearer.edit', 'office_bearer', id, `${POSTS[v.post]}: ${old.name} -> ${v.name}`);
  res.json({ ok: true });
});
collegeRouter.delete('/bearers/:id', boss, (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT post, name FROM office_bearers WHERE id = ?').get(id) as any; if (!old) return bad(res, 'Not found.', 404);
  db.prepare('DELETE FROM office_bearers WHERE id = ?').run(id);
  audit(req.user, 'college.bearer.delete', 'office_bearer', id, `${POSTS[old.post]}: ${old.name}`);
  res.json({ ok: true });
});

// campus picture
collegeRouter.get('/campus-photo', (_req, res) => res.json({ photo: getSetting('campus_photo') || null }));
collegeRouter.put('/campus-photo', boss, (req, res) => {
  const d = String(req.body?.dataUrl ?? '');
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(d)) return bad(res, 'Please choose a PNG, JPG or WebP picture.');
  if (d.length * 0.75 > 900_000) return bad(res, 'The picture is too big. Use one under 900 KB.');
  setSetting('campus_photo', d); audit(req.user, 'college.campus.set', 'settings', 'campus_photo', '');
  res.json({ ok: true });
});
collegeRouter.delete('/campus-photo', boss, (req, res) => { setSetting('campus_photo', ''); audit(req.user, 'college.campus.delete', 'settings', 'campus_photo', ''); res.json({ ok: true }); });

// open teaching switch
collegeRouter.get('/policy', (_req, res) => res.json({ teacherOpen: teacherOpen() }));
collegeRouter.put('/policy', boss, (req, res) => {
  setTeacherOpen(!!req.body?.teacherOpen);
  audit(req.user, 'college.policy', 'settings', 'teacher_open', teacherOpen() ? 'on' : 'off');
  res.json({ teacherOpen: teacherOpen() });
});
