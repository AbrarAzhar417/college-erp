import { addColumn, db, getSetting, setSetting } from '../db.js';
import { audit } from '../audit/service.js';
import { examConfig, saveExamConfig } from '../exam/service.js';

addColumn('students', 'left_reason', 'TEXT');
addColumn('students', 'left_date', 'TEXT');

const nextSession = (s: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) { const y = new Date().getFullYear(); return `${y}-${String(y + 1).slice(2)}`; }
  const y = Number(m[1]) + 1; return `${y}-${String(y + 1).slice(2)}`;
};
const nextStart = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${Number(s.slice(0, 4)) + 1}${s.slice(4)}` : s;

export interface PlanRow { section_id: number; grade: number; class_name: string; section_name: string; to: string; graduating: boolean; students: { id: number; name: string; roll_no: number | null; reg_no: string }[] }

/** What would happen: every active student goes to the same-lettered section of the next class; the top class is passed out. */
export function rolloverPlan() {
  const topGrade = (db.prepare('SELECT MAX(grade) AS g FROM classes').get() as { g: number }).g;
  const secs = db.prepare('SELECT s.id, s.name, c.grade, c.name AS class_name FROM sections s JOIN classes c ON c.id = s.class_id ORDER BY c.grade, s.name').all() as { id: number; name: string; grade: number; class_name: string }[];
  const rows: PlanRow[] = [];
  for (const s of secs) {
    const students = db.prepare("SELECT id, name, roll_no, reg_no FROM students WHERE section_id = ? AND status = 'active' ORDER BY roll_no, name").all(s.id) as PlanRow['students'];
    if (!students.length) continue;
    const grad = s.grade >= topGrade;
    const nc = grad ? null : (db.prepare('SELECT name FROM classes WHERE grade = ?').get(s.grade + 1) as { name: string } | undefined);
    rows.push({ section_id: s.id, grade: s.grade, class_name: s.class_name, section_name: s.name, graduating: grad, to: grad ? 'Passed out' : `${nc?.name ?? 'Class ' + (s.grade + 1)}-${s.name}`, students });
  }
  const cur = examConfig();
  return { session: cur.session, next_session: nextSession(cur.session), rows, total: rows.reduce((n, r) => n + r.students.length, 0) };
}

export interface RolloverInput { hold?: number[]; advance_session?: boolean; by?: { id?: number; name?: string; role?: string } }

export function rolloverCommit(inp: RolloverInput) {
  const hold = new Set((inp.hold ?? []).map(Number));
  const plan = rolloverPlan();
  const topGrade = (db.prepare('SELECT MAX(grade) AS g FROM classes').get() as { g: number }).g;
  const today = new Date().toISOString().slice(0, 10);
  let promoted = 0, passedOut = 0, held = 0;
  const upd = db.prepare('UPDATE students SET section_id = ?, roll_no = ? WHERE id = ?');
  const out = db.prepare("UPDATE students SET status = 'left', left_reason = 'passed_out', left_date = ? WHERE id = ?");
  db.transaction(() => {
    // Highest class first, so nobody is moved twice.
    for (const r of [...plan.rows].sort((a, b) => b.grade - a.grade)) {
      const go = r.students.filter(s => !hold.has(s.id)); held += r.students.length - go.length;
      if (!go.length) continue;
      if (r.grade >= topGrade) { for (const s of go) { out.run(today, s.id); passedOut++; } continue; }
      const nc = db.prepare('SELECT id FROM classes WHERE grade = ?').get(r.grade + 1) as { id: number } | undefined;
      if (!nc) { for (const s of go) held++; continue; }
      db.prepare('INSERT OR IGNORE INTO sections (class_id, name) VALUES (?, ?)').run(nc.id, r.section_name);
      const target = (db.prepare('SELECT id FROM sections WHERE class_id = ? AND name = ?').get(nc.id, r.section_name) as { id: number }).id;
      let n = (db.prepare("SELECT COALESCE(MAX(roll_no), 0) AS n FROM students WHERE section_id = ? AND status = 'active'").get(target) as { n: number }).n;
      for (const s of go) { upd.run(target, ++n, s.id); promoted++; }
    }
    // Students kept back stay in their class; give them fresh roll numbers if the old ones now clash.
    if (inp.advance_session !== false) {
      const cur = examConfig();
      saveExamConfig({ session: nextSession(cur.session), session_start: nextStart(cur.session_start) });
    }
    setSetting('last_rollover', JSON.stringify({ at: new Date().toISOString(), from: plan.session, promoted, passedOut, held }));
  })();
  audit(inp.by, 'rollover.commit', 'session', plan.session, { promoted, passedOut, held });
  return { promoted, passed_out: passedOut, held, session: examConfig().session };
}

export const lastRollover = () => { try { return JSON.parse(getSetting('last_rollover') || 'null'); } catch { return null; } };
