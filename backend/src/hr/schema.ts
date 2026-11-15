import { db, addColumn } from '../db.js';
import '../timetable/schema.js';
import '../attendance/schema.js';
import '../transport/schema.js';

db.exec(`
CREATE TABLE IF NOT EXISTS hr_departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS hr_designations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);

-- One record per employee. Teachers (Timetable) and drivers/conductors (Transport) are linked to it.
CREATE TABLE IF NOT EXISTS hr_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  father_name TEXT, gender TEXT, cnic TEXT, dob TEXT, phone TEXT, email TEXT, address TEXT,
  emergency_name TEXT, emergency_phone TEXT, qualification TEXT,
  staff_type TEXT NOT NULL DEFAULT 'office' CHECK (staff_type IN ('teacher','office','accounts','driver','conductor','support','lab_attendant')),
  kind TEXT NOT NULL DEFAULT 'non_teaching' CHECK (kind IN ('teaching','non_teaching','transport')),
  photo TEXT,
  department TEXT, designation TEXT,
  employment TEXT NOT NULL DEFAULT 'permanent' CHECK (employment IN ('permanent','contract','part_time','probation')),
  joining_date TEXT, contract_end TEXT,
  basic_salary INTEGER NOT NULL DEFAULT 0,
  house_allow INTEGER NOT NULL DEFAULT 0, medical_allow INTEGER NOT NULL DEFAULT 0,
  conveyance_allow INTEGER NOT NULL DEFAULT 0, other_allow INTEGER NOT NULL DEFAULT 0,
  fixed_deduction INTEGER NOT NULL DEFAULT 0,
  license_no TEXT, license_expiry TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','resigned')),
  left_date TEXT, left_reason TEXT,
  user_id INTEGER, teacher_id INTEGER, tr_staff_id INTEGER, candidate_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_staff_status ON hr_staff(status);

-- P present, A absent, L leave, LT late (counts as present), HD half day
CREATE TABLE IF NOT EXISTS hr_att (
  staff_id INTEGER NOT NULL REFERENCES hr_staff(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('P','A','L','LT','HD')),
  note TEXT,
  time_in TEXT, time_out TEXT,
  leave_id INTEGER,
  marked_by INTEGER,
  marked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (staff_id, date)
);
CREATE INDEX IF NOT EXISTS idx_hr_att_date ON hr_att(date);

CREATE TABLE IF NOT EXISTS hr_leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  yearly_quota INTEGER NOT NULL DEFAULT 0,   -- 0 = no limit
  paid INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS hr_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES hr_staff(id),
  type_id INTEGER NOT NULL REFERENCES hr_leave_types(id),
  from_date TEXT NOT NULL, to_date TEXT NOT NULL,
  days INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  applied_by INTEGER, decided_by INTEGER, decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_leaves_staff ON hr_leaves(staff_id);

-- bonus, overtime and arrears add to the month's salary; advance and deduction are taken off it
CREATE TABLE IF NOT EXISTS hr_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES hr_staff(id),
  month TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bonus','overtime','arrears','advance','deduction')),
  amount INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_adj ON hr_adjustments(month, staff_id);

-- Advance or loan paid back in monthly instalments, taken from the salary automatically
CREATE TABLE IF NOT EXISTS hr_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES hr_staff(id),
  kind TEXT NOT NULL DEFAULT 'advance' CHECK (kind IN ('advance','loan')),
  total INTEGER NOT NULL, installment INTEGER NOT NULL,
  start_month TEXT NOT NULL, note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hr_loan_deductions (
  loan_id INTEGER NOT NULL REFERENCES hr_loans(id) ON DELETE CASCADE,
  month TEXT NOT NULL, amount INTEGER NOT NULL,
  PRIMARY KEY (loan_id, month)
);

CREATE TABLE IF NOT EXISTS hr_payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  staff_id INTEGER NOT NULL REFERENCES hr_staff(id),
  basic INTEGER NOT NULL, allowances INTEGER NOT NULL, gross INTEGER NOT NULL,
  working_days INTEGER NOT NULL,
  absent_days REAL NOT NULL DEFAULT 0, unpaid_days REAL NOT NULL DEFAULT 0, notjoined_days REAL NOT NULL DEFAULT 0,
  per_day INTEGER NOT NULL DEFAULT 0, cut_amount INTEGER NOT NULL DEFAULT 0,
  late_count INTEGER NOT NULL DEFAULT 0, late_cut_days REAL NOT NULL DEFAULT 0,
  fixed_deduction INTEGER NOT NULL DEFAULT 0, advance INTEGER NOT NULL DEFAULT 0, loan INTEGER NOT NULL DEFAULT 0, other_deduction INTEGER NOT NULL DEFAULT 0,
  bonus INTEGER NOT NULL DEFAULT 0, overtime INTEGER NOT NULL DEFAULT 0, arrears INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL,
  unmarked INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  approved_by INTEGER, paid_date TEXT, paid_by INTEGER,
  UNIQUE (month, staff_id)
);

-- CVs, degrees, CNIC copies: stored on disk in data/hr_files
CREATE TABLE IF NOT EXISTS hr_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('staff','candidate')),
  owner_id INTEGER NOT NULL,
  label TEXT, name TEXT NOT NULL, stored TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  expires TEXT,                       -- optional expiry (contract, licence...) shown in alerts
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_files ON hr_files(owner_type, owner_id);

-- Recruitment
CREATE TABLE IF NOT EXISTS hr_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, department TEXT, kind TEXT NOT NULL DEFAULT 'teaching',
  positions INTEGER NOT NULL DEFAULT 1,
  qualification TEXT, experience TEXT, salary_range TEXT, description TEXT,
  posted_date TEXT, last_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES hr_jobs(id),
  name TEXT NOT NULL, phone TEXT, email TEXT, cnic TEXT, gender TEXT, city TEXT,
  qualification TEXT, experience_years REAL, current_employer TEXT, current_salary INTEGER, expected_salary INTEGER,
  source TEXT,
  stage TEXT NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied','shortlisted','interview','offered','hired','rejected')),
  rating INTEGER, notes TEXT, reject_reason TEXT,
  offer_designation TEXT, offer_salary INTEGER, offer_date TEXT, joining_date TEXT, offer_employment TEXT,
  staff_id INTEGER,
  applied_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_cand_job ON hr_candidates(job_id, stage);

CREATE TABLE IF NOT EXISTS hr_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES hr_candidates(id),
  round TEXT NOT NULL DEFAULT 'Interview',
  date TEXT NOT NULL, time TEXT, venue TEXT, panel TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','no_show','cancelled')),
  score INTEGER, feedback TEXT,
  result TEXT CHECK (result IN ('pass','fail','hold') OR result IS NULL),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_int ON hr_interviews(candidate_id, date);

-- Every message that was opened for a candidate (WhatsApp, SMS or email)
CREATE TABLE IF NOT EXISTS hr_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES hr_candidates(id),
  channel TEXT NOT NULL, kind TEXT NOT NULL, text TEXT,
  sent_by INTEGER,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_msg ON hr_messages(candidate_id);

CREATE TABLE IF NOT EXISTS hr_cv_text (candidate_id INTEGER PRIMARY KEY, text TEXT NOT NULL);
-- one sheet per panel member: scores is JSON {criterion: marks}
CREATE TABLE IF NOT EXISTS hr_interview_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id INTEGER NOT NULL REFERENCES hr_interviews(id) ON DELETE CASCADE,
  member TEXT NOT NULL, scores TEXT NOT NULL, total INTEGER NOT NULL, max INTEGER NOT NULL, remark TEXT
);
CREATE INDEX IF NOT EXISTS idx_hr_im ON hr_interview_marks(interview_id);
`);
addColumn('hr_jobs', 'keywords', 'TEXT');
addColumn('hr_staff', 'bank_name', 'TEXT');
addColumn('hr_staff', 'account_no', 'TEXT');
addColumn('hr_candidates', 'score', 'INTEGER');
addColumn('hr_candidates', 'score_note', 'TEXT');
addColumn('hr_candidates', 'checklist', 'TEXT');
addColumn('hr_candidates', 'cv_status', 'TEXT');
addColumn('hr_messages', 'status', "TEXT NOT NULL DEFAULT 'opened'");

// Defaults (only when empty)
const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
if (!count('hr_departments')) for (const n of ['Teaching', 'Administration', 'Accounts', 'Transport', 'Support']) db.prepare('INSERT INTO hr_departments (name) VALUES (?)').run(n);
if (!count('hr_designations')) for (const n of ['Principal', 'Senior Teacher', 'Teacher', 'Clerk', 'Accountant', 'Driver', 'Conductor', 'Naib Qasid', 'Security Guard', 'Lab Attendant', 'Sweeper']) db.prepare('INSERT INTO hr_designations (name) VALUES (?)').run(n);
if (!count('hr_leave_types')) {
  const ins = db.prepare('INSERT INTO hr_leave_types (name, yearly_quota, paid) VALUES (?,?,?)');
  ins.run('Casual Leave', 10, 1); ins.run('Sick Leave', 8, 1); ins.run('Annual Leave', 14, 1); ins.run('Maternity Leave', 90, 1); ins.run('Unpaid Leave', 0, 0);
}
