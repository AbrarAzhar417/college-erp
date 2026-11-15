import { db, getSetting, setSetting } from '../db.js';
import { attConfig, sectionStudents, todayISO } from '../attendance/service.js';

export const KINDS: Record<string, { label: string; max: number }> = {
  test: { label: 'Fortnightly test', max: 25 }, terminal: { label: 'Mid-term / terminal', max: 100 }, sendup: { label: 'Send-up exam', max: 100 },
  preboard: { label: 'Pre-board exam', max: 100 }, annual: { label: 'Annual exam', max: 100 }, board: { label: 'Board exam', max: 100 }
};
export const BOARD_CLASSES = [9, 10, 11, 12];

const GRADES = [{ min: 80, grade: 'A-1' }, { min: 70, grade: 'A' }, { min: 60, grade: 'B' }, { min: 50, grade: 'C' }, { min: 40, grade: 'D' }, { min: 33, grade: 'E' }, { min: 0, grade: 'F' }];
const CATS = {
  A: { label: 'A - Father working in KRL', venue: 'KMCB' },
  B: { label: 'B - Father retired from KRL', venue: 'KMCB' },
  C: { label: 'C - Father in private job', venue: 'Govt Associate College Kahuta' }
} as const;

export interface ExamConfig {
  session: string; session_start: string; drop_pct: number; board_min_att: number; grade_scale: { min: number; grade: string }[];
  categories: Record<'A' | 'B' | 'C', { label: string; venue: string }>;
}

export function examConfig(): ExamConfig {
  const t = new Date(), y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
  let scale = GRADES; try { const s = JSON.parse(getSetting('grade_scale') || 'null'); if (Array.isArray(s) && s.length) scale = s; } catch { /* default */ }
  const cat = (k: 'A' | 'B' | 'C') => ({ label: getSetting(`cat_${k.toLowerCase()}_label`) || CATS[k].label, venue: getSetting(`cat_${k.toLowerCase()}_venue`) || CATS[k].venue });
  return {
    session: getSetting('exam_session') || `${y}-${String(y + 1).slice(2)}`, session_start: getSetting('session_start') || `${y}-04-01`,
    drop_pct: Number(getSetting('exam_drop_pct') || 5), board_min_att: Number(getSetting('board_min_att') || 75),
    grade_scale: [...scale].sort((a, b) => b.min - a.min), categories: { A: cat('A'), B: cat('B'), C: cat('C') }
  };
}

export function saveExamConfig(b: any) {
  if (b.session !== undefined) setSetting('exam_session', String(b.session).trim().slice(0, 20));
  if (b.session_start !== undefined) setSetting('session_start', String(b.session_start));
  if (b.drop_pct !== undefined) setSetting('exam_drop_pct', String(Math.max(1, Math.min(50, Math.round(Number(b.drop_pct))))));
  if (b.board_min_att !== undefined) setSetting('board_min_att', String(Math.max(0, Math.min(100, Math.round(Number(b.board_min_att))))));
  if (Array.isArray(b.grade_scale)) {
    const g = b.grade_scale.map((x: any) => ({ min: Number(x.min), grade: String(x.grade).trim().slice(0, 4) })).filter((x: any) => x.grade && x.min >= 0 && x.min <= 100);
    if (g.length) setSetting('grade_scale', JSON.stringify(g));
  }
  if (b.categories) for (const k of ['A', 'B', 'C'] as const) if (b.categories[k]) {
    setSetting(`cat_${k.toLowerCase()}_label`, String(b.categories[k].label ?? '').trim().slice(0, 60));
    setSetting(`cat_${k.toLowerCase()}_venue`, String(b.categories[k].venue ?? '').trim().slice(0, 80));
  }
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const gradeFor = (pct: number | null, scale = examConfig().grade_scale) => (pct === null ? null : (scale.find(s => pct >= s.min)?.grade ?? scale[scale.length - 1]?.grade ?? ''));

export interface ExamRow { id: number; name: string; kind: string; session: string; seq: number; pass_percent: number; pass_rule: 'subjects' | 'total'; status: string; start_date: string | null; end_date: string | null }
export const getExam = (id: number) => db.prepare('SELECT * FROM exams WHERE id = ?').get(id) as ExamRow | undefined;

/** Papers of an exam are created from each section's curriculum (subject + teacher). Safe to run again. */
export function syncPapers(examId: number, defaultMax?: number) {
  const exam = getExam(examId); if (!exam) return { added: 0, removed: 0 };
  const max = defaultMax ?? KINDS[exam.kind]?.max ?? 25;
  const rows = db.prepare(`SELECT ss.section_id, ss.subject_id, ss.teacher_id FROM section_subjects ss JOIN sections s ON s.id = ss.section_id
    WHERE s.class_id IN (SELECT class_id FROM exam_classes WHERE exam_id = ?)`).all(examId) as any[];
  let added = 0, removed = 0;
  db.transaction(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO exam_papers (exam_id, section_id, subject_id, teacher_id, max_marks, test_date) VALUES (?,?,?,?,?,NULL)');
    const key = new Set<string>();
    for (const r of rows) {
      key.add(`${r.section_id}-${r.subject_id}`);
      added += ins.run(examId, r.section_id, r.subject_id, r.teacher_id, max).changes;
      db.prepare('UPDATE exam_papers SET teacher_id = ? WHERE exam_id = ? AND section_id = ? AND subject_id = ?').run(r.teacher_id, examId, r.section_id, r.subject_id);
    }
    for (const p of db.prepare('SELECT id, section_id, subject_id FROM exam_papers WHERE exam_id = ?').all(examId) as any[])
      if (!key.has(`${p.section_id}-${p.subject_id}`) && !(db.prepare('SELECT 1 FROM exam_marks WHERE paper_id = ?').get(p.id)))
        { db.prepare('DELETE FROM exam_papers WHERE id = ?').run(p.id); removed++; }
  })();
  return { added, removed };
}

// ---------------------------------------------------------------------------
// Results of one section in one exam
// ---------------------------------------------------------------------------
export interface SheetStudent {
  id: number; name: string; father_name: string; roll_no: number | null; reg_no: string; category: string | null; p_number: string | null;
  phone: string | null; father_phone: string | null; mother_phone: string | null;
  marks: Record<number, { marks: number | null; status: string; pass: boolean | null }>;
  total: number; max: number; pct: number | null; grade: string | null; failed: string[]; missing: number;
  result: 'PASS' | 'FAIL' | 'INCOMPLETE'; rank: number | null;
  prev: { pct: number | null; rank: number | null; result: string } | null; delta: number | null; trend: 'up' | 'down' | 'same' | null; rankChange: number | null;
  needsCall: boolean; reason: 'fail' | 'down' | 'both' | null;
}

export function previousExam(exam: ExamRow, classId: number, sectionId: number): ExamRow | null {
  const cand = db.prepare(`SELECT e.* FROM exams e JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = ?
    WHERE e.session = ? AND e.id <> ? AND (COALESCE(e.start_date, '9999') < COALESCE(?, '9999') OR (COALESCE(e.start_date, '9999') = COALESCE(?, '9999') AND e.id < ?))
    ORDER BY COALESCE(e.start_date, '9999') DESC, e.id DESC`).all(classId, exam.session, exam.id, exam.start_date, exam.start_date, exam.id) as ExamRow[];
  for (const c of cand) if (db.prepare('SELECT 1 FROM exam_marks m JOIN exam_papers p ON p.id = m.paper_id WHERE p.exam_id = ? AND p.section_id = ? LIMIT 1').get(c.id, sectionId)) return c;
  return null;
}

/** extraIds: students who sat the exam in this section but have since moved or left; they stay in that exam's sheet when asked for by id. */
export function computeSection(examId: number, sectionId: number, withPrev = true, extraIds: number[] = []) {
  const exam = getExam(examId)!, cfg = examConfig();
  const sec = db.prepare(`SELECT s.id, s.name, c.id AS class_id, c.name AS class_name, c.grade, t.name AS class_teacher FROM sections s JOIN classes c ON c.id = s.class_id LEFT JOIN teachers t ON t.id = s.class_teacher_id WHERE s.id = ?`).get(sectionId) as any;
  const papers = db.prepare(`SELECT p.id, p.subject_id, sub.name AS subject, p.max_marks, p.test_date, p.teacher_id, t.name AS teacher FROM exam_papers p
    JOIN subjects sub ON sub.id = p.subject_id LEFT JOIN teachers t ON t.id = p.teacher_id WHERE p.exam_id = ? AND p.section_id = ? ORDER BY sub.name`).all(examId, sectionId) as any[];
  const students = db.prepare(`SELECT id, name, father_name, roll_no, reg_no, category, p_number, phone, father_phone, mother_phone FROM students WHERE (section_id = ? AND status = 'active')${extraIds.length ? ` OR id IN (${extraIds.map(() => '?').join(',')})` : ''} ORDER BY roll_no, name`).all(sectionId, ...extraIds) as any[];
  const mk = new Map<string, { marks: number | null; status: string }>();
  if (papers.length) for (const m of db.prepare(`SELECT paper_id, student_id, marks, status FROM exam_marks WHERE paper_id IN (${papers.map(() => '?').join(',')})`).all(...papers.map(p => p.id)) as any[]) mk.set(`${m.paper_id}|${m.student_id}`, m);

  const rows: SheetStudent[] = students.map(s => {
    let total = 0, max = 0, missing = 0; const failed: string[] = [], marks: SheetStudent['marks'] = {};
    for (const p of papers) {
      const m = mk.get(`${p.id}|${s.id}`);
      if (!m) { missing++; marks[p.subject_id] = { marks: null, status: '', pass: null }; continue; }
      if (m.status === 'L') { marks[p.subject_id] = { marks: null, status: 'L', pass: null }; continue; }
      const got = m.status === 'A' ? 0 : (m.marks ?? 0), ok = got + 1e-9 >= (p.max_marks * exam.pass_percent) / 100;
      total += got; max += p.max_marks; if (!ok) failed.push(p.subject);
      marks[p.subject_id] = { marks: m.status === 'A' ? null : got, status: m.status, pass: ok };
    }
    const pct = max ? round1((total / max) * 100) : null;
    const complete = papers.length > 0 && missing === 0 && max > 0;
    const result = !complete ? 'INCOMPLETE' : exam.pass_rule === 'total' ? (pct! >= exam.pass_percent ? 'PASS' : 'FAIL') : failed.length ? 'FAIL' : 'PASS';
    return { ...s, marks, total, max, pct, grade: gradeFor(pct, cfg.grade_scale), failed, missing, result, rank: null, prev: null, delta: null, trend: null, rankChange: null, needsCall: false, reason: null };
  });

  const ranked = rows.filter(r => r.result !== 'INCOMPLETE').sort((a, b) => b.pct! - a.pct! || b.total - a.total);
  ranked.forEach((r, i) => { r.rank = i > 0 && ranked[i - 1].pct === r.pct && ranked[i - 1].total === r.total ? ranked[i - 1].rank : i + 1; });

  let prevExam: ExamRow | null = null;
  if (withPrev) {
    prevExam = previousExam(exam, sec.class_id, sectionId);
    if (prevExam) {
      const prev = new Map(computeSection(prevExam.id, sectionId, false, extraIds).students.map(s => [s.id, s]));
      for (const r of rows) {
        const p = prev.get(r.id); if (!p || p.pct === null) continue;
        r.prev = { pct: p.pct, rank: p.rank, result: p.result };
        if (r.pct !== null) { r.delta = round1(r.pct - p.pct); r.trend = r.delta > 0.5 ? 'up' : r.delta < -0.5 ? 'down' : 'same'; }
        if (r.rank && p.rank) r.rankChange = p.rank - r.rank;
      }
    }
  }
  for (const r of rows) {
    const fail = r.result === 'FAIL', down = r.delta !== null && r.delta <= -cfg.drop_pct;
    r.needsCall = fail || down; r.reason = fail && down ? 'both' : fail ? 'fail' : down ? 'down' : null;
  }

  const done = rows.filter(r => r.result !== 'INCOMPLETE');
  const stats = {
    students: rows.length, complete: done.length, incomplete: rows.length - done.length, pass: done.filter(r => r.result === 'PASS').length, fail: done.filter(r => r.result === 'FAIL').length,
    passPct: done.length ? round1((done.filter(r => r.result === 'PASS').length / done.length) * 100) : null,
    avg: done.length ? round1(done.reduce((a, r) => a + r.pct!, 0) / done.length) : null,
    highest: done.length ? Math.max(...done.map(r => r.pct!)) : null, lowest: done.length ? Math.min(...done.map(r => r.pct!)) : null,
    needCall: rows.filter(r => r.needsCall).length
  };
  const subjectStats = papers.map(p => {
    const got = students.map(s => mk.get(`${p.id}|${s.id}`)).filter(Boolean) as { marks: number | null; status: string }[];
    const sat = got.filter(m => m.status !== 'L'), vals = sat.map(m => (m.status === 'A' ? 0 : m.marks ?? 0));
    const passed = vals.filter(v => v + 1e-9 >= (p.max_marks * exam.pass_percent) / 100).length;
    return { paper_id: p.id, subject_id: p.subject_id, subject: p.subject, teacher: p.teacher, max_marks: p.max_marks, test_date: p.test_date, entered: got.length, total: students.length,
      absent: got.filter(m => m.status === 'A').length, avgPct: vals.length ? round1((vals.reduce((a, b) => a + b, 0) / vals.length / p.max_marks) * 100) : null,
      highest: vals.length ? Math.max(...vals) : null, lowest: vals.length ? Math.min(...vals) : null, passPct: vals.length ? round1((passed / vals.length) * 100) : null, failed: vals.length - passed };
  });
  return { exam, section: { id: sec.id, label: `${sec.class_name}-${sec.name}`, class_id: sec.class_id, class_name: sec.class_name, section_name: sec.name, grade: sec.grade, class_teacher: sec.class_teacher },
    papers: subjectStats, students: rows, stats, prevExam: prevExam ? { id: prevExam.id, name: prevExam.name } : null, dropPct: cfg.drop_pct };
}

/** Several exams together (for awards): only exams whose marks are complete for the whole section are counted. */
export function computeAggregate(examIds: number[], sectionId: number) {
  const per = examIds.map(id => computeSection(id, sectionId, false)).filter(r => r.students.length && r.students.every(s => s.result !== 'INCOMPLETE'));
  if (!per.length) return [];
  const by = new Map<number, { s: SheetStudent; total: number; max: number; failedAny: boolean }>();
  for (const r of per) for (const s of r.students) {
    const e = by.get(s.id) ?? by.set(s.id, { s, total: 0, max: 0, failedAny: false }).get(s.id)!;
    e.total += s.total; e.max += s.max; if (s.result === 'FAIL') e.failedAny = true;
  }
  const rows = [...by.values()].map(e => ({ ...e.s, total: e.total, max: e.max, pct: e.max ? round1((e.total / e.max) * 100) : null, result: (e.failedAny ? 'FAIL' : 'PASS') as SheetStudent['result'], rank: null as number | null }));
  const ranked = [...rows].sort((a, b) => b.pct! - a.pct! || b.total - a.total);
  ranked.forEach((r, i) => { r.rank = i > 0 && ranked[i - 1].pct === r.pct && ranked[i - 1].total === r.total ? ranked[i - 1].rank : i + 1; });
  return rows;
}

/** Attendance percentage of students since the session started. */
export function sessionAttendance(ids: number[]): Map<number, number | null> {
  const out = new Map<number, number | null>(ids.map(i => [i, null])), cfg = attConfig(), from = examConfig().session_start, today = todayISO();
  for (let i = 0; i < ids.length; i += 500) {
    const c = ids.slice(i, i + 500);
    for (const r of db.prepare(`SELECT student_id, SUM(status IN ('P','LT')) AS p, SUM(status = 'A') AS a, SUM(status = 'L') AS l FROM att_daily
      WHERE date BETWEEN ? AND ? AND student_id IN (${c.map(() => '?').join(',')}) GROUP BY student_id`).all(from, today, ...c) as any[]) {
      const rec = r.p + r.a + r.l; out.set(r.student_id, rec ? round1(((r.p + (cfg.leave_counts ? r.l : 0)) / rec) * 100) : null);
    }
  }
  return out;
}
