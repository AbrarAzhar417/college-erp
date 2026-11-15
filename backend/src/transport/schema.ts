import { addColumn, db } from '../db.js';
import '../fee/schema.js';

// The transport choice made when a student is admitted
addColumn('students', 'tr_route_id', 'INTEGER');
addColumn('students', 'tr_stop_id', 'INTEGER');
addColumn('students', 'tr_mode', 'TEXT');          // both, pickup or drop

db.exec(`
CREATE TABLE IF NOT EXISTS tr_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('driver','conductor')),
  phone TEXT, cnic TEXT, license_no TEXT, license_expiry TEXT, address TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tr_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,            -- the name everybody uses: Bus 1, Coaster 2
  reg_no TEXT,
  kind TEXT NOT NULL DEFAULT 'bus',
  capacity INTEGER NOT NULL,
  make_model TEXT, year INTEGER,
  driver_id INTEGER REFERENCES tr_staff(id),
  conductor_id INTEGER REFERENCES tr_staff(id),
  fitness_expiry TEXT, permit_expiry TEXT, insurance_expiry TEXT, tax_expiry TEXT, next_service TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tr_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,              -- Model Town, Kahuta, Rawalpindi
  area TEXT,
  vehicle_id INTEGER REFERENCES tr_vehicles(id),
  morning_time TEXT, afternoon_time TEXT,
  fee_both INTEGER NOT NULL DEFAULT 0,    -- monthly fee for pick and drop
  fee_one INTEGER,                        -- monthly fee for one way (empty = same as both)
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tr_stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL REFERENCES tr_routes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  pickup_time TEXT, drop_time TEXT,
  fee_both INTEGER, fee_one INTEGER       -- only if this stop costs differently from the route
);

CREATE TABLE IF NOT EXISTS tr_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES tr_vehicles(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  odometer INTEGER
);

CREATE TABLE IF NOT EXISTS tr_boarding (
  route_id INTEGER NOT NULL REFERENCES tr_routes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  date TEXT NOT NULL,
  trip TEXT NOT NULL CHECK (trip IN ('morning','afternoon')),
  status TEXT NOT NULL CHECK (status IN ('boarded','absent')),
  marked_by INTEGER,
  PRIMARY KEY (student_id, date, trip)
);
`);
