import { db } from '../db.js';
import '../exam/schema.js';

db.exec(`
-- One plan = one subject of one class for a session. All sections of the class follow it.
CREATE TABLE IF NOT EXISTS syl_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  overview TEXT,
  books TEXT,
  assessment TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
  note TEXT,
  author_id INTEGER,
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session, class_id, subject_id)
);

-- A topic planned for a week of a month (weeks: 1 = days 1-7, 2 = 8-14, 3 = 15-21, 4 = 22 to month end)
CREATE TABLE IF NOT EXISTS syl_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES syl_plans(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 4),
  sort INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'lesson',
  topic TEXT NOT NULL,
  chapter TEXT,
  outcomes TEXT,
  activities TEXT,
  resources TEXT,
  assessment TEXT,
  periods INTEGER
);
CREATE INDEX IF NOT EXISTS idx_syl_items_plan ON syl_items(plan_id, month, week, sort);

-- How far each section has got with each topic
CREATE TABLE IF NOT EXISTS syl_progress (
  item_id INTEGER NOT NULL REFERENCES syl_items(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  status TEXT NOT NULL CHECK (status IN ('pending','in_progress','done','skipped')),
  done_date TEXT,
  note TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, section_id)
);

CREATE TABLE IF NOT EXISTS syl_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES syl_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS syl_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES syl_plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS syl_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'event'
);
`);
