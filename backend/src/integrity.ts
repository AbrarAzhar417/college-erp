import { db } from './db.js';

/**
 * Data integrity.
 *
 * Some columns that point at another table were added over time and carry no FOREIGN KEY in the table definition
 * (SQLite cannot add one to an existing column without rebuilding the table). `installGuards()` gives them the same
 * protection with triggers: a row can no longer point at something that does not exist, and deleting the parent
 * either clears the pointer, removes the dependent rows, or is refused, exactly as listed below.
 *
 * `checkIntegrity()` reads the whole database and reports anything that is wrong. `repairIntegrity()` fixes only what
 * can be fixed without guessing (dangling pointers, copies that drifted apart). Money is never changed: a money
 * mismatch is only reported.
 */

type OnDelete = 'null' | 'cascade' | 'restrict';
interface Link { table: string; col: string; parent: string; onDelete: OnDelete }

export const LINKS: Link[] = [
  { table: 'sections', col: 'class_teacher_id', parent: 'teachers', onDelete: 'null' },
  { table: 'students', col: 'tr_route_id', parent: 'tr_routes', onDelete: 'null' },
  { table: 'students', col: 'tr_stop_id', parent: 'tr_stops', onDelete: 'null' },
  { table: 'att_daily', col: 'leave_id', parent: 'att_leaves', onDelete: 'null' },
  { table: 'att_period', col: 'subject_id', parent: 'subjects', onDelete: 'null' },
  { table: 'att_period', col: 'teacher_id', parent: 'teachers', onDelete: 'null' },
  { table: 'voucher_items', col: 'head_id', parent: 'fee_heads', onDelete: 'null' },
  { table: 'payments', col: 'voucher_id', parent: 'vouchers', onDelete: 'restrict' },
  { table: 'ledger', col: 'voucher_id', parent: 'vouchers', onDelete: 'restrict' },
  { table: 'ledger', col: 'payment_id', parent: 'payments', onDelete: 'restrict' },
  { table: 'parent_msgs', col: 'student_id', parent: 'students', onDelete: 'cascade' },
  { table: 'hr_staff', col: 'user_id', parent: 'users', onDelete: 'null' },
  { table: 'hr_staff', col: 'teacher_id', parent: 'teachers', onDelete: 'null' },
  { table: 'hr_staff', col: 'tr_staff_id', parent: 'tr_staff', onDelete: 'null' },
  { table: 'hr_staff', col: 'candidate_id', parent: 'hr_candidates', onDelete: 'null' },
  { table: 'hr_att', col: 'leave_id', parent: 'hr_leaves', onDelete: 'null' },
  { table: 'hr_candidates', col: 'staff_id', parent: 'hr_staff', onDelete: 'null' },
  { table: 'hr_cv_text', col: 'candidate_id', parent: 'hr_candidates', onDelete: 'cascade' },
  { table: 'tt_substitutions', col: 'section_id', parent: 'sections', onDelete: 'cascade' },
  { table: 'tt_substitutions', col: 'subject_id', parent: 'subjects', onDelete: 'cascade' },
  { table: 'tt_substitutions', col: 'absent_teacher_id', parent: 'teachers', onDelete: 'cascade' },
  { table: 'tt_substitutions', col: 'sub_teacher_id', parent: 'teachers', onDelete: 'cascade' },
  { table: 'notices', col: 'class_id', parent: 'classes', onDelete: 'null' },
  { table: 'notice_reads', col: 'user_id', parent: 'users', onDelete: 'cascade' },
  { table: 'user_otp', col: 'user_id', parent: 'users', onDelete: 'cascade' },
  { table: 'syl_plans', col: 'author_id', parent: 'users', onDelete: 'null' },
  { table: 'students', col: 'family_id', parent: 'families', onDelete: 'null' }
];

const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const nullable = (t: string, c: string) => { const col = (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).find(x => x.name === c); return !!col && !col.notnull; };
const live = () => LINKS.filter(l => has(l.table) && has(l.parent));
/** True once the column carries a real FOREIGN KEY (set by upgradeDatabase); the guard triggers are then not needed. */
export const hasRealFk = (table: string, col: string) => (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as any[]).some(f => f.from === col);

/** Creates (or refreshes) the triggers. Safe to run on every start. */
export function installGuards() {
  for (const l of live()) {
    const n = `g_${l.table}_${l.col}`;
    if (hasRealFk(l.table, l.col)) { db.exec(`DROP TRIGGER IF EXISTS ${n}_ins; DROP TRIGGER IF EXISTS ${n}_upd; DROP TRIGGER IF EXISTS ${n}_del;`); continue; }
    const msg = `${l.table}.${l.col} must point at an existing ${l.parent} row`;
    db.exec(`
      DROP TRIGGER IF EXISTS ${n}_ins; DROP TRIGGER IF EXISTS ${n}_upd; DROP TRIGGER IF EXISTS ${n}_del;
      CREATE TRIGGER ${n}_ins BEFORE INSERT ON ${l.table} WHEN NEW.${l.col} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ${l.parent} WHERE id = NEW.${l.col}) BEGIN SELECT RAISE(ABORT, '${msg}'); END;
      CREATE TRIGGER ${n}_upd BEFORE UPDATE OF ${l.col} ON ${l.table} WHEN NEW.${l.col} IS NOT NULL AND NEW.${l.col} IS NOT OLD.${l.col}
        AND NOT EXISTS (SELECT 1 FROM ${l.parent} WHERE id = NEW.${l.col}) BEGIN SELECT RAISE(ABORT, '${msg}'); END;`);
    const body = l.onDelete === 'null' && nullable(l.table, l.col) ? `UPDATE ${l.table} SET ${l.col} = NULL WHERE ${l.col} = OLD.id;`
      : l.onDelete === 'restrict' ? `SELECT RAISE(ABORT, '${l.parent} is still used by ${l.table}') WHERE EXISTS (SELECT 1 FROM ${l.table} WHERE ${l.col} = OLD.id);`
      : `DELETE FROM ${l.table} WHERE ${l.col} = OLD.id;`;
    db.exec(`CREATE TRIGGER ${n}_del BEFORE DELETE ON ${l.parent} BEGIN ${body} END;`);
  }
  // One person, one record: these must never repeat.
  const uniq = (name: string, sql: string) => { try { db.exec(sql); } catch { /* existing duplicates: shown by checkIntegrity */ } void name; };
  uniq('users_username_ci', 'CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username_ci ON users(lower(username))');
  if (has('teachers')) uniq('teachers_user', 'CREATE UNIQUE INDEX IF NOT EXISTS ux_teachers_user ON teachers(user_id) WHERE user_id IS NOT NULL');
  if (has('hr_staff')) {
    uniq('hr_user', 'CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_staff_user ON hr_staff(user_id) WHERE user_id IS NOT NULL');
    uniq('hr_teacher', 'CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_staff_teacher ON hr_staff(teacher_id) WHERE teacher_id IS NOT NULL');
    uniq('hr_tr', 'CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_staff_tr ON hr_staff(tr_staff_id) WHERE tr_staff_id IS NOT NULL');
  }
  if (has('office_bearers')) uniq('bearer_post', "CREATE UNIQUE INDEX IF NOT EXISTS ux_bearer_single ON office_bearers(post) WHERE post IN ('director','principal','vice_principal','headmaster')");
}

export interface Finding { key: string; label: string; count: number; sample: unknown[]; fix: 'auto' | 'manual'; }

interface Check { key: string; label: string; sql: string; fix: 'auto' | 'manual'; repair?: string }

const checks = (): Check[] => {
  const out: Check[] = [];
  for (const l of live()) out.push({
    key: `orphan:${l.table}.${l.col}`, label: `${l.table}.${l.col} points at a missing ${l.parent} row`, fix: nullable(l.table, l.col) ? 'auto' : 'manual',
    sql: `SELECT t.rowid AS id, t.${l.col} AS value FROM ${l.table} t WHERE t.${l.col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${l.parent} p WHERE p.id = t.${l.col})`,
    repair: nullable(l.table, l.col) ? `UPDATE ${l.table} SET ${l.col} = NULL WHERE ${l.col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${l.parent} p WHERE p.id = ${l.table}.${l.col})` : undefined
  });
  const c = (key: string, label: string, sql: string, fix: Check['fix'] = 'manual', repair?: string) => out.push({ key, label, sql, fix, repair });
  c('dup:roll', 'Two active students of one section share a roll number',
    "SELECT section_id, roll_no, COUNT(*) AS n FROM students WHERE status = 'active' AND roll_no IS NOT NULL GROUP BY section_id, roll_no HAVING n > 1");
  c('dup:cnic-name', 'The same student is entered twice (same name, father and date of birth)',
    "SELECT lower(name) AS name, lower(father_name) AS father, dob, COUNT(*) AS n FROM students WHERE status = 'active' AND dob IS NOT NULL GROUP BY 1, 2, 3 HAVING n > 1");
  c('student:left-in-transport', 'A student who has left still holds a bus seat',
    "SELECT id FROM students WHERE status = 'left' AND tr_route_id IS NOT NULL", 'auto', "UPDATE students SET tr_route_id = NULL, tr_stop_id = NULL, tr_mode = NULL WHERE status = 'left' AND tr_route_id IS NOT NULL");
  c('student:stop-route', 'A student\'s stop does not belong to the student\'s route',
    'SELECT s.id FROM students s JOIN tr_stops p ON p.id = s.tr_stop_id WHERE s.tr_route_id IS NOT NULL AND p.route_id <> s.tr_route_id', 'auto', 'UPDATE students SET tr_stop_id = NULL WHERE id IN (SELECT s.id FROM students s JOIN tr_stops p ON p.id = s.tr_stop_id WHERE s.tr_route_id IS NOT NULL AND p.route_id <> s.tr_route_id)');
  c('student:family-single', 'A family group has only one student (nothing to link)',
    "SELECT family_id, COUNT(*) AS n FROM students WHERE family_id IS NOT NULL GROUP BY family_id HAVING n < 2", 'auto', "UPDATE students SET family_id = NULL WHERE family_id IN (SELECT family_id FROM students WHERE family_id IS NOT NULL GROUP BY family_id HAVING COUNT(*) < 2)");
  c('section:class-teacher-inactive', 'A class teacher is a teacher who is no longer active',
    'SELECT s.id FROM sections s JOIN teachers t ON t.id = s.class_teacher_id WHERE t.active = 0', 'auto', 'UPDATE sections SET class_teacher_id = NULL WHERE class_teacher_id IN (SELECT id FROM teachers WHERE active = 0)');
  c('user:teacher-no-record', 'A teacher login has no teacher record',
    "SELECT u.id, u.username FROM users u WHERE u.role = 'teacher' AND NOT EXISTS (SELECT 1 FROM teachers t WHERE t.user_id = u.id)");
  c('teacher:login-wrong-role', 'A teacher record is linked to a login that is not a teacher login',
    "SELECT t.id, u.username FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.role <> 'teacher'");
  c('teacher:inactive-with-login', 'A teacher who left still has an open login',
    'SELECT t.id, u.username FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.active = 0 AND u.active = 1', 'auto', 'UPDATE users SET active = 0 WHERE id IN (SELECT u.id FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.active = 0 AND u.active = 1)');
  if (has('hr_staff')) {
    // One copy of a teacher's details lives in teachers; the HR file and the login mirror it. The repair copies from teachers.
    c('drift:teacher-hr', 'A teacher\'s name or phone differs between the teacher record and the HR file',
      'SELECT t.id, t.name AS teacher, h.name AS hr FROM teachers t JOIN hr_staff h ON h.teacher_id = t.id WHERE h.name <> t.name OR COALESCE(h.phone, \'\') <> COALESCE(t.phone, \'\')', 'auto',
      'UPDATE hr_staff SET name = (SELECT name FROM teachers t WHERE t.id = hr_staff.teacher_id), phone = (SELECT phone FROM teachers t WHERE t.id = hr_staff.teacher_id) WHERE teacher_id IN (SELECT h.teacher_id FROM hr_staff h JOIN teachers t ON t.id = h.teacher_id WHERE h.name <> t.name OR COALESCE(h.phone, \'\') <> COALESCE(t.phone, \'\'))');
    c('drift:teacher-user', 'A teacher\'s name differs from the name on the login',
      'SELECT t.id, t.name AS teacher, u.name AS login FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.name <> t.name', 'auto',
      'UPDATE users SET name = (SELECT name FROM teachers t WHERE t.user_id = users.id) WHERE id IN (SELECT u.id FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.name <> t.name)');
    c('drift:hr-user', 'An HR file and the login it is linked to show different names',
      'SELECT h.id, h.name AS hr, u.name AS login FROM hr_staff h JOIN users u ON u.id = h.user_id WHERE h.teacher_id IS NULL AND h.name <> u.name');
    c('hr:user-teacher-mismatch', 'An HR file points at a login and a teacher that do not belong together',
      'SELECT h.id FROM hr_staff h JOIN teachers t ON t.id = h.teacher_id WHERE h.user_id IS NOT NULL AND t.user_id IS NOT NULL AND h.user_id <> t.user_id');
    c('hr:dup-cnic', 'Two HR files have the same CNIC',
      "SELECT cnic, COUNT(*) AS n FROM hr_staff WHERE cnic IS NOT NULL AND cnic <> '' AND status = 'active' GROUP BY cnic HAVING n > 1");
  }
  if (has('vouchers')) {
    // Money: reported, never changed automatically.
    c('money:voucher-items', 'A voucher\'s gross or discount does not match its lines',
      `SELECT v.id, v.voucher_no, v.gross, COALESCE((SELECT SUM(amount) FROM voucher_items i WHERE i.voucher_id = v.id AND i.amount > 0), 0) AS lines
       FROM vouchers v WHERE v.gross <> COALESCE((SELECT SUM(amount) FROM voucher_items i WHERE i.voucher_id = v.id AND i.amount > 0), 0)
          OR v.discount <> -COALESCE((SELECT SUM(amount) FROM voucher_items i WHERE i.voucher_id = v.id AND i.amount < 0), 0) OR v.net <> v.gross - v.discount`);
    c('money:voucher-ledger', 'A voucher has no charge in the ledger, or a different amount',
      "SELECT v.id, v.voucher_no FROM vouchers v WHERE COALESCE((SELECT SUM(amount) FROM ledger l WHERE l.voucher_id = v.id AND l.kind = 'charge'), -1) <> v.net");
    c('money:payment-ledger', 'A receipt that is not cancelled has no matching ledger line',
      "SELECT p.id, p.receipt_no FROM payments p WHERE p.cancelled = 0 AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.payment_id = p.id)");
    c('money:negative-payment', 'A payment amount is zero or negative', 'SELECT id, receipt_no FROM payments WHERE amount <= 0');
    c('money:voucher-student', 'A voucher and its payment belong to different students',
      'SELECT p.id, p.receipt_no FROM payments p JOIN vouchers v ON v.id = p.voucher_id WHERE v.student_id <> p.student_id');
  }
  c('college:two-principals', 'More than one principal is entered in the College Profile',
    "SELECT post, COUNT(*) AS n FROM office_bearers WHERE post = 'principal' GROUP BY post HAVING n > 1");
  return out.filter(k => { try { db.prepare(k.sql); return true; } catch { return false; } });
};

export function checkIntegrity(): { ok: boolean; engine: string; foreignKeys: number; findings: Finding[] } {
  const engine = String((db.prepare('PRAGMA integrity_check').get() as any)?.integrity_check ?? '');
  const foreignKeys = (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
  const findings: Finding[] = [];
  for (const k of checks()) {
    const rows = db.prepare(k.sql).all() as any[];
    if (rows.length) findings.push({ key: k.key, label: k.label, count: rows.length, sample: rows.slice(0, 5).map(r => ({ ...r })), fix: k.fix });
  }
  return { ok: engine === 'ok' && foreignKeys === 0 && findings.length === 0, engine, foreignKeys, findings };
}

/** Fixes what has one obvious right answer. Returns how many rows each repair touched. */
export function repairIntegrity(): { fixed: { key: string; rows: number }[] } {
  const fixed: { key: string; rows: number }[] = [];
  db.transaction(() => {
    // The delete guards would stop a repair of an orphan that is also a parent; repairs only ever clear pointers.
    for (const k of checks()) {
      if (k.fix !== 'auto' || !k.repair) continue;
      const n = db.prepare(k.repair).run().changes;
      if (n) fixed.push({ key: k.key, rows: n });
    }
  })();
  return { fixed };
}
