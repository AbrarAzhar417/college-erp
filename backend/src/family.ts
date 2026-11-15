import { db, addColumn } from './db.js';

addColumn('students', 'family_id', 'INTEGER');
db.exec('CREATE INDEX IF NOT EXISTS idx_students_family ON students(family_id)');
// A family is a row of its own, so a student's family_id is a real relationship and not a loose number.
db.exec('CREATE TABLE IF NOT EXISTS families (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
db.exec('INSERT OR IGNORE INTO families (id) SELECT DISTINCT family_id FROM students WHERE family_id IS NOT NULL');
export const pruneFamilies = () => db.prepare('DELETE FROM families WHERE id NOT IN (SELECT family_id FROM students WHERE family_id IS NOT NULL)').run().changes;

export const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const COLS = `st.id, st.name, st.father_name, st.reg_no, st.roll_no, st.gender, st.dob, st.address, st.family_id, st.father_cnic, st.phone, st.father_phone, st.mother_phone,
  s.name AS section_name, c.name AS class_name, c.grade`;
const FROM = 'FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id';
const strip = ({ father_cnic, phone, father_phone, mother_phone, address, dob, ...keep }: any) => keep;

/** Same father CNIC (13 digits), or the same last 10 digits on any phone. Active students only. */
export function findSiblings(cnic: unknown, phones: unknown[], exceptId = 0) {
  const c = digits(cnic), ph = [...new Set(phones.map(digits).filter(p => p.length >= 10))].map(p => p.slice(-10));
  if (c.length < 13 && !ph.length) return [];
  const rows = db.prepare(`SELECT ${COLS} ${FROM} WHERE st.status = 'active' AND st.id <> ? ORDER BY c.grade, st.name`).all(exceptId) as any[];
  return rows.filter(r => (c.length >= 13 && digits(r.father_cnic) === c) || (ph.length && [r.father_phone, r.mother_phone, r.phone].map(digits).some(p => p.length >= 10 && ph.includes(p.slice(-10)))))
    .map(strip);
}

const getStudent = (id: number) => db.prepare('SELECT id, father_name, address, family_id, father_cnic, phone, father_phone, mother_phone FROM students WHERE id = ?').get(id) as any;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9؀-ۿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s: unknown) => new Set(norm(s).split(' ').filter(t => t.length >= 3));
export function addressSimilarity(a: unknown, b: unknown) {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0;
  let both = 0; for (const t of A) if (B.has(t)) both++;
  return both / (A.size + B.size - both);
}

export function linkedSiblings(id: number) {
  const st = getStudent(id); if (!st?.family_id) return [];
  return (db.prepare(`SELECT ${COLS} ${FROM} WHERE st.status = 'active' AND st.family_id = ? AND st.id <> ? ORDER BY st.dob IS NULL, st.dob, st.id`).all(st.family_id, id) as any[]).map(strip);
}

/** strong = same CNIC / phone but not linked yet; possible = same father name and similar address, to be confirmed by a person. */
export function familyView(id: number) {
  const st = getStudent(id); if (!st) return null;
  const linked = linkedSiblings(id), linkedIds = new Set(linked.map(x => x.id));
  const strong = findSiblings(st.father_cnic, [st.phone, st.father_phone, st.mother_phone], id).filter(x => !linkedIds.has(x.id) && !(st.family_id && x.family_id === st.family_id));
  const skip = new Set([...linkedIds, ...strong.map(x => x.id)]);
  const fn = norm(st.father_name);
  const possible = !fn || !tokens(st.address).size ? [] : (db.prepare(`SELECT ${COLS} ${FROM} WHERE st.status = 'active' AND st.id <> ?`).all(id) as any[])
    .filter(r => !skip.has(r.id) && norm(r.father_name) === fn && addressSimilarity(st.address, r.address) >= 0.5)
    .map(r => ({ ...strip(r), similarity: Math.round(addressSimilarity(st.address, r.address) * 100) }));
  return { family_id: st.family_id as number | null, order: siblingOrder(id), linked, strong, possible };
}

const nextFamily = () => Number(db.prepare('INSERT INTO families DEFAULT VALUES').run().lastInsertRowid);

/** Puts two students in one family (merging two existing families if both have one). Returns every student whose family changed. */
export function linkStudents(a: number, b: number): number[] | string {
  if (a === b) return 'A student cannot be linked to themselves.';
  const x = getStudent(a), y = getStudent(b);
  if (!x || !y) return 'Student not found.';
  const fam = x.family_id ?? y.family_id ?? nextFamily();
  const ids = new Set<number>([a, b]);
  db.transaction(() => {
    for (const old of [x.family_id, y.family_id]) if (old && old !== fam) for (const r of db.prepare('SELECT id FROM students WHERE family_id = ?').all(old) as any[]) ids.add(r.id);
    for (const id of ids) db.prepare('UPDATE students SET family_id = ? WHERE id = ?').run(fam, id);
    pruneFamilies();
  })();
  return [...ids];
}

/** Takes a student out of their family. A family with one student left is dissolved. Returns affected ids. */
export function unlinkStudent(id: number): number[] {
  const st = getStudent(id); if (!st?.family_id) return [];
  const ids = [id];
  db.transaction(() => {
    db.prepare('UPDATE students SET family_id = NULL WHERE id = ?').run(id);
    const rest = db.prepare('SELECT id FROM students WHERE family_id = ?').all(st.family_id) as any[];
    if (rest.length < 2) for (const r of rest) { db.prepare('UPDATE students SET family_id = NULL WHERE id = ?').run(r.id); ids.push(r.id); }
    else for (const r of rest) ids.push(r.id);
    pruneFamilies();
  })();
  return ids;
}

/** Links a student to every strong (CNIC / phone) match. */
export function acceptStrong(id: number): number[] | string {
  const v = familyView(id); if (!v) return 'Student not found.';
  const all = new Set<number>();
  for (const s of v.strong) { const r = linkStudents(id, s.id); if (typeof r === 'string') return r; r.forEach(i => all.add(i)); }
  return [...all];
}

/** 1 = eldest child of the family (by date of birth, then admission order). Only linked, active students count. */
export function siblingOrder(id: number): number {
  const st = getStudent(id); if (!st?.family_id) return 1;
  const fam = db.prepare("SELECT id FROM students WHERE family_id = ? AND status = 'active' ORDER BY dob IS NULL, dob, id").all(st.family_id) as any[];
  const i = fam.findIndex(r => r.id === id);
  return i < 0 ? 1 : i + 1;
}
