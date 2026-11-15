import { db } from '../db.js';
import { isDate, todayISO } from '../attendance/service.js';
import type { AuthUser } from '../auth.js';

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  assigned_to INTEGER NOT NULL REFERENCES users(id), assigned_by INTEGER NOT NULL REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  due_date TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to, status);
CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('comment','status','created','reassigned')), text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
export const STATUS = ['open', 'in_progress', 'done', 'cancelled'];
export const isManager = (u: AuthUser) => ['director', 'principal', 'admin'].includes(u.role);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const activeUser = (id: number) => db.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').get(id) as { id: number; name: string } | undefined;

export function checkNew(b: any, u: AuthUser) {
  const title = str(b.title, 150); if (!title) return 'Write what has to be done.';
  const to = b.assigned_to ? Number(b.assigned_to) : u.id;
  if (to !== u.id && !isManager(u)) return 'You can create tasks only for yourself.';
  if (!activeUser(to)) return 'Choose a staff member.';
  if (b.due_date && !isDate(b.due_date)) return 'Due date is not valid.';
  if (b.due_date && b.due_date < todayISO()) return 'Due date is in the past.';
  const priority = ['low', 'normal', 'high'].includes(b.priority) ? b.priority : 'normal';
  return { title, description: str(b.description, 2000), assigned_to: to, priority, due_date: b.due_date || null };
}
export function createTask(b: any, u: AuthUser): { id: number } | string {
  const v = checkNew(b, u); if (typeof v === 'string') return v;
  const id = Number(db.prepare('INSERT INTO tasks (title,description,assigned_to,assigned_by,priority,due_date) VALUES (?,?,?,?,?,?)').run(v.title, v.description, v.assigned_to, u.id, v.priority, v.due_date).lastInsertRowid);
  db.prepare("INSERT INTO task_events (task_id,user_id,kind,text) VALUES (?,?,'created',?)").run(id, u.id, v.assigned_to === u.id ? 'Created for self' : `Assigned to ${activeUser(v.assigned_to)!.name}`);
  return { id };
}
const row = (id: number) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
export const canSee = (u: AuthUser, t: any) => isManager(u) || t.assigned_to === u.id || t.assigned_by === u.id;
const canOwn = (u: AuthUser, t: any) => isManager(u) || t.assigned_by === u.id;   // change, reassign, reopen

export function setStatus(id: number, status: string, u: AuthUser, note = ''): { status: string } | string {
  const t = row(id); if (!t || !canSee(u, t)) return 'Task not found.';
  if (!STATUS.includes(status)) return 'Unknown status.';
  if (status === t.status) return 'The task already has that status.';
  const reopening = (t.status === 'done' || t.status === 'cancelled') && status !== t.status;
  if (reopening && !canOwn(u, t)) return 'Only the person who assigned the task can reopen it.';
  if (status === 'cancelled' && !canOwn(u, t)) return 'Only the person who assigned the task can cancel it.';
  db.prepare("UPDATE tasks SET status = ?, completed_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE NULL END, updated_at = datetime('now') WHERE id = ?").run(status, status, id);
  db.prepare("INSERT INTO task_events (task_id,user_id,kind,text) VALUES (?,?,'status',?)").run(id, u.id, `${t.status} → ${status}${note ? `: ${str(note, 500)}` : ''}`);
  return { status };
}
export function editTask(id: number, b: any, u: AuthUser): { ok: true } | string {
  const t = row(id); if (!t || !canSee(u, t)) return 'Task not found.'; if (!canOwn(u, t)) return 'Only the person who assigned the task can change it.';
  const title = str(b.title ?? t.title, 150); if (!title) return 'Write what has to be done.';
  const to = b.assigned_to ? Number(b.assigned_to) : t.assigned_to;
  if (to !== t.assigned_to) { if (!isManager(u) && to !== u.id) return 'You can give a task only to yourself.'; if (!activeUser(to)) return 'Choose a staff member.'; }
  if (b.due_date && !isDate(b.due_date)) return 'Due date is not valid.';
  db.prepare("UPDATE tasks SET title=?, description=?, assigned_to=?, priority=?, due_date=?, updated_at=datetime('now') WHERE id=?").run(title, b.description !== undefined ? str(b.description, 2000) : t.description, to, ['low', 'normal', 'high'].includes(b.priority) ? b.priority : t.priority, b.due_date === undefined ? t.due_date : b.due_date || null, id);
  if (to !== t.assigned_to) db.prepare("INSERT INTO task_events (task_id,user_id,kind,text) VALUES (?,?,'reassigned',?)").run(id, u.id, `Reassigned to ${activeUser(to)!.name}`);
  return { ok: true };
}
export function addComment(id: number, text: unknown, u: AuthUser): { ok: true } | string {
  const t = row(id); if (!t || !canSee(u, t)) return 'Task not found.';
  const s = str(text, 1000); if (!s) return 'Write a comment.';
  db.prepare("INSERT INTO task_events (task_id,user_id,kind,text) VALUES (?,?,'comment',?)").run(id, u.id, s); return { ok: true };
}
export function listTasks(u: AuthUser, scope: string, status?: string) {
  const today = todayISO(), where: string[] = [], args: any[] = [];
  if (scope === 'assigned') { where.push('t.assigned_by = ? AND t.assigned_to <> ?'); args.push(u.id, u.id); }
  else if (scope === 'all' && isManager(u)) { /* everything */ }
  else { where.push('t.assigned_to = ?'); args.push(u.id); }
  if (status === 'active') where.push("t.status IN ('open','in_progress')"); else if (status && STATUS.includes(status)) { where.push('t.status = ?'); args.push(status); }
  const rows = db.prepare(`SELECT t.*, a.name assignee, b.name assigner FROM tasks t JOIN users a ON a.id = t.assigned_to JOIN users b ON b.id = t.assigned_by ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.id DESC LIMIT 500`).all(...args) as any[];
  return rows.map(t => ({ ...t, overdue: !!t.due_date && t.due_date < today && (t.status === 'open' || t.status === 'in_progress'), can_edit: canOwn(u, t), mine: t.assigned_to === u.id }));
}
export function taskDetail(id: number, u: AuthUser) {
  const t = row(id); if (!t || !canSee(u, t)) return null;
  const rows = listTasks(u, 'all', undefined);   // reuse the shaping, then pick
  const base = rows.find(r => r.id === id) ?? { ...db.prepare('SELECT t.*, a.name assignee, b.name assigner FROM tasks t JOIN users a ON a.id = t.assigned_to JOIN users b ON b.id = t.assigned_by WHERE t.id = ?').get(id) as any, overdue: false, can_edit: canOwn(u, t), mine: t.assigned_to === u.id };
  return { ...base, can_edit: canOwn(u, t), events: db.prepare('SELECT e.*, us.name user_name FROM task_events e JOIN users us ON us.id = e.user_id WHERE e.task_id = ? ORDER BY e.id').all(id) };
}
export function summary(u: AuthUser) {
  const today = todayISO(), s = (extra: string) => (db.prepare(`SELECT COUNT(*) n FROM tasks WHERE assigned_to = ? ${extra}`).get(u.id) as any).n as number;
  return { open: s("AND status IN ('open','in_progress')"), overdue: s(`AND status IN ('open','in_progress') AND due_date < '${today}'`), dueToday: s(`AND status IN ('open','in_progress') AND due_date = '${today}'`), done: s("AND status = 'done'") };
}
/** Who is carrying how much; for the principal to balance the work. */
export const workload = () => db.prepare(`SELECT u.id, u.name, u.role, SUM(t.status IN ('open','in_progress')) open, SUM(t.status IN ('open','in_progress') AND t.due_date < ?) overdue, SUM(t.status = 'done') done
  FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id WHERE u.active = 1 GROUP BY u.id ORDER BY overdue DESC, open DESC, u.name`).all(todayISO()).map((r: any) => ({ ...r, open: r.open ?? 0, overdue: r.overdue ?? 0, done: r.done ?? 0 }));
export const people = (u: AuthUser) => (isManager(u) ? db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all() : [{ id: u.id, name: u.name, role: u.role }]);

/** For system reminders (paper setting, marks collection): the sender is a duty holder, not necessarily the office. */
export function remindTask(title: string, description: string, to: number, by: number, due: string | null): number {
  const id = Number(db.prepare("INSERT INTO tasks (title,description,assigned_to,assigned_by,priority,due_date) VALUES (?,?,?,?,'high',?)").run(title.slice(0, 150), description.slice(0, 2000), to, by, due && due >= todayISO() ? due : null).lastInsertRowid);
  db.prepare("INSERT INTO task_events (task_id,user_id,kind,text) VALUES (?,?,'created','Reminder')").run(id, by);
  return id;
}
