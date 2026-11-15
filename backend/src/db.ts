import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.resolve(here, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'college.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('director','principal','admin','teacher','accountant')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  stage TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL,
  UNIQUE (class_id, name)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_no TEXT NOT NULL UNIQUE,
  roll_no INTEGER,
  father_cnic TEXT,
  name TEXT NOT NULL,
  father_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male','female')),
  dob TEXT,
  phone TEXT,
  address TEXT,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  admission_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_section ON students(section_id);
`);

// Older databases: add the columns that newer versions need
export function addColumn(table: string, col: string, def: string) {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('students', 'roll_no', 'INTEGER');
addColumn('students', 'father_cnic', 'TEXT');
addColumn('students', 'photo', 'TEXT');
addColumn('users', 'pw_changed', 'INTEGER');
/** Marks a password change; sessions issued before it stop working (a small allowance keeps the person who changed it logged in only if a new token is issued). */
export function passwordChanged(userId: number) { db.prepare('UPDATE users SET pw_changed = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) + 1, userId); }

/** Gives roll numbers to active students that have none (alphabetical within each section). */
export function backfillRollNumbers() {
  const secs = db.prepare("SELECT DISTINCT section_id FROM students WHERE roll_no IS NULL AND status = 'active'").all() as { section_id: number }[];
  const upd = db.prepare('UPDATE students SET roll_no = ? WHERE id = ?');
  db.transaction(() => {
    for (const { section_id } of secs) {
      let n = (db.prepare("SELECT COALESCE(MAX(roll_no), 0) AS n FROM students WHERE section_id = ? AND status = 'active'").get(section_id) as { n: number }).n;
      for (const r of db.prepare("SELECT id FROM students WHERE section_id = ? AND roll_no IS NULL AND status = 'active' ORDER BY name, id").all(section_id) as { id: number }[]) upd.run(++n, r.id);
    }
  })();
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

const setting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');

/** Runs on every start; only fills in what is missing. */
export function ensureBaseData() {
  setting.run('institute_name', 'KRL Model College for Boys');
  setting.run('short_name', 'KMCB');
  // Older databases still carry the placeholder name or the old spelling of the category labels.
  db.prepare("UPDATE settings SET value = 'KRL Model College for Boys' WHERE key = 'institute_name' AND value IN ('Your College Name', '')").run();
  db.prepare("UPDATE settings SET value = 'KMCB' WHERE key = 'short_name' AND value = ''").run();
  db.prepare("UPDATE settings SET value = REPLACE(value, 'GRL', 'KRL') WHERE key LIKE 'cat_%' AND value LIKE '%GRL%'").run();
  setting.run('demo_mode', '0');

  // Classes 6-12 (6-10 SSC, 11-12 HSSC), 5 sections (A-E) each
  const insClass = db.prepare('INSERT OR IGNORE INTO classes (grade, name, stage) VALUES (?, ?, ?)');
  const insSec = db.prepare('INSERT OR IGNORE INTO sections (class_id, name) VALUES (?, ?)');
  for (let grade = 6; grade <= 12; grade++) {
    insClass.run(grade, `Class ${grade}`, grade <= 10 ? 'SSC' : 'HSSC');
    const { id } = db.prepare('SELECT id FROM classes WHERE grade = ?').get(grade) as { id: number };
    for (const s of ['A', 'B', 'C', 'D', 'E']) insSec.run(id, s);
  }

  // Default users (first run only). CHANGE THESE PASSWORDS after first login.
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n === 0) {
    const hash = bcrypt.hashSync('ChangeMe@123', 10);
    const ins = db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)');
    ins.run('Director', 'director', hash, 'director');
    ins.run('Principal', 'principal', hash, 'principal');
    ins.run('Front Desk Admin', 'admin', hash, 'admin');
    ins.run('Demo Teacher', 'teacher', hash, 'teacher');
    ins.run('Accountant', 'accountant', hash, 'accountant');
  }
  backfillRollNumbers();
}

export function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? '';
}
