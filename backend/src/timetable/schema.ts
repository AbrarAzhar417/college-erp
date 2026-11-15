import { addColumn, db } from '../db.js';

addColumn('classes', 'wing', 'TEXT');

db.exec(`
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  heavy INTEGER NOT NULL DEFAULT 0      -- 1 = demanding subject, prefer morning periods
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  max_per_day INTEGER NOT NULL DEFAULT 6,
  max_per_week INTEGER NOT NULL DEFAULT 30,
  user_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS teacher_subjects (
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id)
);

CREATE TABLE IF NOT EXISTS teacher_unavailable (
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,        -- weekday number 1=Mon .. 7=Sun
  period INTEGER NOT NULL,     -- 0-based
  PRIMARY KEY (teacher_id, day, period)
);

-- What a section studies, how often, and who teaches it
CREATE TABLE IF NOT EXISTS section_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  periods_per_week INTEGER NOT NULL,
  block INTEGER NOT NULL DEFAULT 1,     -- 2 = lessons come as double periods (labs, computer)
  teacher_id INTEGER REFERENCES teachers(id),
  UNIQUE (section_id, subject_id)
);

CREATE TABLE IF NOT EXISTS tt_slots (
  section_id INTEGER NOT NULL REFERENCES sections(id),
  day INTEGER NOT NULL,
  period INTEGER NOT NULL,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  grp INTEGER NOT NULL,                 -- slots of one lesson (double periods share a grp)
  locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (section_id, day, period)
);
CREATE INDEX IF NOT EXISTS idx_tt_teacher ON tt_slots(teacher_id, day, period);

CREATE TABLE IF NOT EXISTS tt_config (id INTEGER PRIMARY KEY, json TEXT NOT NULL);
`);

// Older databases made tt_config with CHECK (id = 1), which would refuse the college row. Rebuild it once.
{
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'tt_config'").get() as { sql: string } | undefined)?.sql ?? '';
  if (/CHECK\s*\(\s*id\s*=\s*1\s*\)/i.test(sql)) {
    db.transaction(() => {
      db.exec('ALTER TABLE tt_config RENAME TO tt_config_old');
      db.exec('CREATE TABLE tt_config (id INTEGER PRIMARY KEY, json TEXT NOT NULL)');
      db.exec('INSERT INTO tt_config (id, json) SELECT id, json FROM tt_config_old');
      db.exec('DROP TABLE tt_config_old');
    })();
  }
}

// Science subjects: no more than two of them back to back in a class. Existing subjects are marked by name once.
{
  const cols = db.prepare("PRAGMA table_info(subjects)").all() as { name: string }[];
  if (!cols.some(c => c.name === 'science')) {
    db.exec('ALTER TABLE subjects ADD COLUMN science INTEGER NOT NULL DEFAULT 0');
    db.exec("UPDATE subjects SET science = 1 WHERE lower(name) LIKE '%physics%' OR lower(name) LIKE '%chemistry%' OR lower(name) LIKE '%biology%' OR lower(name) LIKE '%science%'");
  }
}

export interface TTSettings {
  days: number[];          // weekday numbers, e.g. [1,2,3,4,5,6]
  periodCount: number;
  startTime: string;       // "08:00"
  periodMinutes: number;
  breakAfter: number;      // break comes after this many periods (0 = no break)
  breakMinutes: number;
  /** The class teacher takes the first period of every day in his or her own class (when the curriculum allows it). */
  classTeacherFirst?: boolean;
  /** Periods a teacher should have in a week (shown as the fairness target). */
  targetLoad?: number;
}

export type Wing = 'school' | 'college';
export const WINGS: Wing[] = ['school', 'college'];
export const asWing = (v: unknown): Wing => (v === 'college' ? 'college' : 'school');
/** Classes 11 and 12 are the college wing unless the office says otherwise (Timetable → Setup). */
export const WING_SQL = "COALESCE(c.wing, CASE WHEN c.grade >= 11 THEN 'college' ELSE 'school' END)";

export const DEFAULT_SETTINGS: TTSettings = {
  days: [1, 2, 3, 4, 5, 6], periodCount: 7, startTime: '08:00', periodMinutes: 40, breakAfter: 4, breakMinutes: 20
};

const wingRow = (w: Wing) => (w === 'college' ? 2 : 1);

/** Bell times, days and periods of one wing. The school wing keeps the original row, so old installations need no migration; a college wing that was never set up starts as a copy of the school wing. */
export function getSettings(wing: Wing = 'school'): TTSettings {
  const read = (id: number) => db.prepare('SELECT json FROM tt_config WHERE id = ?').get(id) as { json: string } | undefined;
  const row = read(wingRow(wing)) ?? read(1);
  return row ? { classTeacherFirst: true, targetLoad: 24, ...DEFAULT_SETTINGS, ...JSON.parse(row.json) } : { classTeacherFirst: true, targetLoad: 24, ...DEFAULT_SETTINGS };
}

export function saveSettings(s: TTSettings, wing: Wing = 'school') {
  db.prepare('INSERT INTO tt_config (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(wingRow(wing), JSON.stringify(s));
}

export const wingOfSection = (sectionId: number): Wing =>
  asWing((db.prepare(`SELECT ${WING_SQL} AS w FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`).get(sectionId) as { w: string } | undefined)?.w);
export const settingsForSection = (sectionId: number) => getSettings(wingOfSection(sectionId));

/** Clock times for each period, accounting for the break. */
export function periodTimes(s: TTSettings): { start: string; end: string }[] {
  const [h, m] = s.startTime.split(':').map(Number);
  let t = h * 60 + m;
  const fmt = (x: number) => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  const out: { start: string; end: string }[] = [];
  for (let p = 0; p < s.periodCount; p++) {
    if (s.breakAfter > 0 && p === s.breakAfter) t += s.breakMinutes;
    out.push({ start: fmt(t), end: fmt(t + s.periodMinutes) });
    t += s.periodMinutes;
  }
  return out;
}
