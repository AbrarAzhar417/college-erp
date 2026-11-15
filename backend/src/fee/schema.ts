import { db } from '../db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS fee_heads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','annual','one_time')),
  optional INTEGER NOT NULL DEFAULT 0,        -- 1 = only students who are assigned it (transport, hostel)
  concessionable INTEGER NOT NULL DEFAULT 0,  -- 1 = discounts that are not tied to one head apply here
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fee_structure (
  class_id INTEGER NOT NULL REFERENCES classes(id),
  head_id INTEGER NOT NULL REFERENCES fee_heads(id),
  amount INTEGER NOT NULL,
  PRIMARY KEY (class_id, head_id)
);

CREATE TABLE IF NOT EXISTS student_heads (
  student_id INTEGER NOT NULL REFERENCES students(id),
  head_id INTEGER NOT NULL REFERENCES fee_heads(id),
  amount INTEGER,                              -- NULL = use the class amount
  PRIMARY KEY (student_id, head_id)
);

CREATE TABLE IF NOT EXISTS student_concessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  head_id INTEGER REFERENCES fee_heads(id),    -- NULL = all concessionable heads
  kind TEXT NOT NULL CHECK (kind IN ('fixed','percent')),
  value REAL NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL,
  voucher_no TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  period TEXT NOT NULL,                        -- e.g. 2026-10 (one open voucher per student per period)
  period_label TEXT NOT NULL,                  -- e.g. October 2026
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  gross INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  net INTEGER NOT NULL,                        -- this voucher's own charges
  arrears INTEGER NOT NULL,                    -- balance carried in from before (negative = advance)
  late_fine INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cancelled')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_period ON vouchers(student_id, period) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_voucher_student ON vouchers(student_id);

CREATE TABLE IF NOT EXISTS voucher_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  head_id INTEGER,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL                      -- negative for concessions
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL,
  receipt_no TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  voucher_id INTEGER,
  amount INTEGER NOT NULL,
  paid_on TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  note TEXT,
  received_by INTEGER,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_student ON payments(student_id);

-- The student account: positive = owed to the college, negative = paid / credit
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening','charge','payment','fine','waiver','adjustment')),
  amount INTEGER NOT NULL,
  voucher_id INTEGER,
  payment_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_student ON ledger(student_id, date, id);

-- Category A / B / C fee rules: applied to a student automatically (as concessions tagged CAT:<letter>)
CREATE TABLE IF NOT EXISTS fee_category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('A','B','C')),
  head_id INTEGER REFERENCES fee_heads(id),    -- NULL = all concessionable heads
  kind TEXT NOT NULL CHECK (kind IN ('fixed','percent')),
  value REAL NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS sibling_discount_rules (
  child_order INTEGER PRIMARY KEY CHECK (child_order >= 2),   -- 2 = second child; also covers later children until a higher order is set
  kind TEXT NOT NULL CHECK (kind IN ('fixed','percent')),
  value REAL NOT NULL
);

-- Fixed fee of a category for one head of one class. Where it exists it replaces the class amount (and the category discount is not applied to that head).
CREATE TABLE IF NOT EXISTS fee_category_fees (
  class_id INTEGER NOT NULL REFERENCES classes(id),
  category TEXT NOT NULL CHECK (category IN ('A','B','C')),
  head_id INTEGER NOT NULL REFERENCES fee_heads(id),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (class_id, category, head_id)
);
`);

// Starter fee heads (no amounts) so a new college only has to type the amounts
if ((db.prepare('SELECT COUNT(*) AS n FROM fee_heads').get() as { n: number }).n === 0) {
  const ins = db.prepare('INSERT INTO fee_heads (name, frequency, optional, concessionable, sort) VALUES (?,?,?,?,?)');
  [['Tuition Fee', 'monthly', 0, 1], ['Computer Lab Fee', 'monthly', 0, 0], ['Transport Fee', 'monthly', 1, 0],
   ['Admission Fee', 'one_time', 0, 0], ['Annual Charges', 'annual', 0, 0], ['Examination Fee', 'annual', 0, 0], ['Library Fee', 'annual', 0, 0]]
    .forEach((h, i) => ins.run(h[0], h[1], h[2], h[3], i));
}
