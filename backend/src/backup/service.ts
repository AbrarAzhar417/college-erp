import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from '../db.js';

export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const KEEP_DAILY = Math.max(3, Number(process.env.BACKUP_KEEP) || 14);
const NAME_RE = /^college-(auto|manual|pre-restore)-\d{8}-\d{6}\.db$/;

const stamp = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

export function listBackups() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return fs.readdirSync(BACKUP_DIR).filter(f => NAME_RE.test(f)).map(f => {
    const s = fs.statSync(path.join(BACKUP_DIR, f));
    return { name: f, kind: /^college-(auto|manual|pre-restore)-/.exec(f)![1], size: s.size, created: s.mtime.toISOString() };
  }).sort((a, b) => b.created.localeCompare(a.created));
}

/** Consistent copy of the live database (safe while the app is in use). */
export async function makeBackup(kind: 'auto' | 'manual' | 'pre-restore' = 'manual') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `college-${kind}-${stamp()}.db`;
  await db.backup(path.join(BACKUP_DIR, name));
  if (kind === 'auto') prune();
  return name;
}

/** Keeps only the newest KEEP_DAILY automatic backups; manual and pre-restore copies are never deleted by the program. */
function prune() {
  const autos = listBackups().filter(b => b.kind === 'auto');
  for (const b of autos.slice(KEEP_DAILY)) { try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); } catch { /* ignore */ } }
}

export function backupPath(name: string) {
  if (!NAME_RE.test(name)) return null;
  const p = path.join(BACKUP_DIR, name);
  return fs.existsSync(p) ? p : null;
}

export function deleteBackup(name: string) {
  const p = backupPath(name); if (!p) return false;
  fs.unlinkSync(p); return true;
}

/** A real SQLite file that contains the tables this program needs. */
export function checkBackupFile(file: string): string | null {
  try {
    const head = Buffer.alloc(16); const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
    if (head.toString('latin1') !== 'SQLite format 3\0') return 'This is not a database backup file.';
    const Database = (db.constructor as any);
    const t = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const names = new Set((t.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name));
      for (const need of ['users', 'students', 'settings']) if (!names.has(need)) return `This backup does not look like a College ERP database (no "${need}" table).`;
      const ok = (t.pragma('integrity_check', { simple: true }) as string);
      if (ok !== 'ok') return 'The backup file is damaged.';
    } finally { t.close(); }
    return null;
  } catch { return 'The file could not be opened as a database.'; }
}

/**
 * Replaces the live data with a backup. A safety copy of the current data is made first.
 * Uses SQLite's backup API in reverse, so the running server keeps working with the restored data (no restart needed).
 */
export async function restoreBackup(file: string) {
  const err = checkBackupFile(file); if (err) throw new Error(err);
  const safety = await makeBackup('pre-restore');
  const Database = (db.constructor as any);
  const src = new Database(file, { readonly: true });
  try {
    const tables = (src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(r => r.name);
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        const mine = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(r => r.name);
        for (const t of mine) db.exec(`DELETE FROM "${t}"`);
        for (const t of tables) {
          if (!mine.includes(t)) continue;
          const mycols = new Set((db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map(c => c.name));
          const cols = (src.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map(c => c.name).filter(c => mycols.has(c));
          if (!cols.length) continue;
          const list = cols.map(c => `"${c}"`).join(',');
          const ins = db.prepare(`INSERT INTO "${t}" (${list}) VALUES (${cols.map(() => '?').join(',')})`);
          for (const row of src.prepare(`SELECT ${list} FROM "${t}"`).iterate() as Iterable<Record<string, unknown>>) ins.run(...cols.map(c => row[c]));
        }
        try { db.exec("DELETE FROM sqlite_sequence"); const seq = src.prepare('SELECT name, seq FROM sqlite_sequence').all() as { name: string; seq: number }[]; for (const s of seq) db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?,?)').run(s.name, s.seq); } catch { /* no autoincrement tables */ }
      })();
    } finally { db.pragma('foreign_keys = ON'); }
  } finally { src.close(); }
  return safety;
}

let timer: NodeJS.Timeout | null = null;
/** One automatic backup per day, shortly after start-up and then every 6 hours it checks whether today's exists. */
export function startAutoBackup() {
  if (timer || process.env.NO_AUTOBACKUP) return;
  const tick = async () => {
    try {
      const today = stamp().slice(0, 8);
      if (!listBackups().some(b => b.kind === 'auto' && b.name.includes('-' + today + '-'))) { const n = await makeBackup('auto'); (await import('./offsite.js')).offsiteAfterAuto(n); }
    } catch (e) { console.error('Auto backup failed:', e); }
  };
  setTimeout(tick, 15000).unref();
  timer = setInterval(tick, 6 * 3600 * 1000); timer.unref();
}
