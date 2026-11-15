import { addColumn, db } from '../db.js';
import '../timetable/schema.js';

db.exec(`
-- The official register: one status per student per school day
CREATE TABLE IF NOT EXISTS att_daily (
  student_id INTEGER NOT NULL REFERENCES students(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('P','A','L','LT')),   -- present, absent, leave, late (late counts as present)
  note TEXT,
  leave_id INTEGER,                                            -- set when the row came from an approved leave
  marked_by INTEGER,
  marked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, date)
);
CREATE INDEX IF NOT EXISTS idx_att_daily_date ON att_daily(date);

-- Period by period attendance taken by the subject teacher
CREATE TABLE IF NOT EXISTS att_period (
  student_id INTEGER NOT NULL REFERENCES students(id),
  date TEXT NOT NULL,
  period INTEGER NOT NULL,
  subject_id INTEGER,
  teacher_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('P','A','L','LT')),
  marked_by INTEGER,
  marked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, date, period)
);
CREATE INDEX IF NOT EXISTS idx_att_period_date ON att_period(date, period);

-- Shortcut: only the month's totals were available (no day by day record)
CREATE TABLE IF NOT EXISTS att_month_totals (
  student_id INTEGER NOT NULL REFERENCES students(id),
  month TEXT NOT NULL,
  working_days INTEGER NOT NULL,
  present INTEGER NOT NULL,
  absent INTEGER NOT NULL,
  leave INTEGER NOT NULL,
  late INTEGER NOT NULL DEFAULT 0,
  entered_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, month)
);

CREATE TABLE IF NOT EXISTS att_holidays (date TEXT PRIMARY KEY, name TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS att_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'casual',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  applied_by INTEGER,
  decided_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_att_leaves_student ON att_leaves(student_id);
`);
addColumn('sections', 'class_teacher_id', 'INTEGER');
