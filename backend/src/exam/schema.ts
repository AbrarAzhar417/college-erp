import { addColumn, db } from '../db.js';
import '../attendance/schema.js';

// Category of the student's family and extra contact numbers
addColumn('students', 'category', 'TEXT');          // A, B or C
addColumn('students', 'p_number', 'TEXT');          // special parents' code (categories A and B)
addColumn('students', 'father_phone', 'TEXT');
addColumn('students', 'mother_phone', 'TEXT');

db.exec(`
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('test','terminal','sendup','preboard','annual','board')),
  session TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1,
  pass_percent INTEGER NOT NULL DEFAULT 33,
  pass_rule TEXT NOT NULL DEFAULT 'subjects' CHECK (pass_rule IN ('subjects','total')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked','published')),
  start_date TEXT,
  end_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exam_classes (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  PRIMARY KEY (exam_id, class_id)
);

-- One paper = one subject of one section in one exam. Its teacher sets the date and enters the marks.
CREATE TABLE IF NOT EXISTS exam_papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  teacher_id INTEGER REFERENCES teachers(id),
  max_marks INTEGER NOT NULL,
  test_date TEXT,
  UNIQUE (exam_id, section_id, subject_id)
);

CREATE TABLE IF NOT EXISTS exam_marks (
  paper_id INTEGER NOT NULL REFERENCES exam_papers(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  marks REAL,
  status TEXT NOT NULL DEFAULT 'P' CHECK (status IN ('P','A','L')),   -- present, absent (counts 0), leave (left out of the total)
  entered_by INTEGER,
  entered_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (paper_id, student_id)
);

-- Guardian (GR) calls and parent meetings for failing or declining students
CREATE TABLE IF NOT EXISTS exam_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  reason TEXT NOT NULL,
  pct REAL,
  prev_pct REAL,
  failed TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','called','meeting_set','attended','no_show','closed')),
  call_date TEXT,
  ptm_date TEXT,
  notes TEXT,
  called_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS board_admissions (
  student_id INTEGER NOT NULL REFERENCES students(id),
  session TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','form_ready','submitted','roll_issued','withheld')),
  board_reg_no TEXT,
  board_roll_no TEXT,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, session)
);
`);
