import { db } from '../db.js';

/** Which teachers have a login, which do not, and which teacher-logins belong to nobody yet. */
export function linkOverview() {
  const teachers = db.prepare(`SELECT t.id, t.name, t.phone, t.user_id, u.username, u.active AS login_active FROM teachers t LEFT JOIN users u ON u.id = t.user_id WHERE t.active = 1 ORDER BY t.name`).all();
  const freeLogins = db.prepare(`SELECT u.id, u.name, u.username FROM users u WHERE u.role = 'teacher' AND u.active = 1 AND u.id NOT IN (SELECT user_id FROM teachers WHERE user_id IS NOT NULL) ORDER BY u.name`).all();
  return { teachers, freeLogins, unlinked: (teachers as any[]).filter(t => !t.user_id).length };
}

/** Connects an existing teacher login to a teacher record (for logins made by hand in Users). */
export function linkTeacher(teacherId: number, userId: number): string | null {
  const t = db.prepare('SELECT id, user_id FROM teachers WHERE id = ? AND active = 1').get(teacherId) as any;
  if (!t) return 'Teacher not found.';
  const u = db.prepare('SELECT id, role FROM users WHERE id = ? AND active = 1').get(userId) as any;
  if (!u) return 'Login not found.';
  if (u.role !== 'teacher') return 'Only a login with the Teacher role can be linked.';
  if (db.prepare('SELECT 1 FROM teachers WHERE user_id = ? AND id <> ?').get(userId, teacherId)) return 'This login already belongs to another teacher.';
  db.prepare('UPDATE teachers SET user_id = ? WHERE id = ?').run(userId, teacherId);
  return null;
}

export function unlinkTeacher(teacherId: number): string | null {
  const r = db.prepare('UPDATE teachers SET user_id = NULL WHERE id = ?').run(teacherId);
  return r.changes ? null : 'Teacher not found.';
}
