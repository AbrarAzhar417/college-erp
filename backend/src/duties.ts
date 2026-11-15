import { db } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS staff_duties (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  duty TEXT NOT NULL,
  assigned_by INTEGER REFERENCES users(id), assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, duty)
);
`);

/** Additional charges a teacher can be given on top of teaching. The office assigns them. */
export const DUTIES: Record<string, { label: string; blurb: string }> = {
  exam_dept: { label: 'Exam Department', blurb: 'Plans exams, asks teachers to prepare papers, collects and prints them.' },
  test_dept: { label: 'Test Department', blurb: 'Collects marks and lists from teachers and prepares the test lists.' },
  timetable_team: { label: 'Timetable Team', blurb: 'Builds and changes the timetable.' }
};
export const dutiesOf = (userId: number): string[] => (db.prepare('SELECT duty FROM staff_duties WHERE user_id = ? ORDER BY duty').all(userId) as { duty: string }[]).map(r => r.duty).filter(d => d in DUTIES);
export const hasDuty = (u: { duties?: string[] } | undefined, duty: string) => !!u?.duties?.includes(duty);

export function listStaffDuties() {
  const teachers = db.prepare("SELECT id, name, username FROM users WHERE role = 'teacher' AND active = 1 ORDER BY name").all() as { id: number; name: string; username: string }[];
  return teachers.map(t => ({ ...t, duties: dutiesOf(t.id) }));
}
export function setDuties(userId: number, duties: unknown, by: number): string[] | string {
  const u = db.prepare('SELECT role, active FROM users WHERE id = ?').get(userId) as { role: string; active: number } | undefined;
  if (!u) return 'Staff member not found.';
  if (u.role !== 'teacher') return 'Additional charges are given to teachers only.';
  if (!u.active) return 'This teacher is no longer active.';
  const list = [...new Set(Array.isArray(duties) ? duties.map(String) : [])];
  for (const d of list) if (!(d in DUTIES)) return `Unknown duty: ${d}.`;
  db.transaction(() => {
    db.prepare('DELETE FROM staff_duties WHERE user_id = ?').run(userId);
    for (const d of list) db.prepare('INSERT INTO staff_duties (user_id, duty, assigned_by) VALUES (?,?,?)').run(userId, d, by);
  })();
  return dutiesOf(userId);
}
