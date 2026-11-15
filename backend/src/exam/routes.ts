import { teacherOpen } from '../policy.js';
import { allowScan, marksPrompt, readImage, sniffImage, visionReady, VisionError } from '../ocr/vision.js';
import { scanPreview } from '../ocr/service.js';
import { audit } from '../audit/service.js';
import express, { Router } from 'express';
import { db } from '../db.js';
import { requireAccess, requireRole } from '../auth.js';
import { hasDuty } from '../duties.js';
import { MANAGE, canSection as classTeacherOf, isDate, isManager as officeRole, myTeacherId, todayISO } from '../attendance/service.js';
/** The office, or a teacher who has the Exam Department charge. */
const isManager = (u: any) => officeRole(u) || hasDuty(u, 'exam_dept');
const canSection = (u: any, sectionId: number) => hasDuty(u, 'exam_dept') || classTeacherOf(u, sectionId);
import { checkRows, readRows, templateCsv, toFileRows } from './marksfile.js';
import { BOARD_CLASSES, KINDS, computeAggregate, computeSection, examConfig, getExam, gradeFor, previousExam, round1, saveExamConfig, sessionAttendance, syncPapers } from './service.js';

export const examRouter = Router();
examRouter.use(requireRole('director', 'principal', 'admin', 'teacher'));
const office = requireAccess(['director', 'principal', 'admin'], 'exam_dept');
const leadership = requireRole('director', 'principal');
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const noExam = (res: any) => bad(res, 'Exam not found.', 404);

examRouter.get('/config', (_req, res) => res.json({ ...examConfig(), kinds: KINDS, boardClasses: BOARD_CLASSES, today: todayISO() }));
examRouter.put('/config', leadership, (req, res) => { saveExamConfig(req.body ?? {}); res.json(examConfig()); });

// ---------- exams ----------
examRouter.get('/exams', (_req, res) => {
  const exams = db.prepare('SELECT * FROM exams ORDER BY COALESCE(start_date, \'9999\') DESC, id DESC').all() as any[];
  const cls = new Map<number, string[]>();
  for (const r of db.prepare('SELECT ec.exam_id, c.name FROM exam_classes ec JOIN classes c ON c.id = ec.class_id ORDER BY c.grade').all() as any[]) (cls.get(r.exam_id) ?? cls.set(r.exam_id, []).get(r.exam_id)!).push(r.name);
  const prog = new Map<number, { papers: number; expected: number; entered: number }>();
  for (const r of db.prepare(`SELECT p.exam_id, COUNT(*) AS papers, SUM((SELECT COUNT(*) FROM students st WHERE st.section_id = p.section_id AND st.status = 'active')) AS expected,
    SUM((SELECT COUNT(*) FROM exam_marks m WHERE m.paper_id = p.id)) AS entered FROM exam_papers p GROUP BY p.exam_id`).all() as any[]) prog.set(r.exam_id, r);
  res.json(exams.map(e => ({ ...e, classes: cls.get(e.id) ?? [], papers: prog.get(e.id)?.papers ?? 0, expected: prog.get(e.id)?.expected ?? 0, entered: prog.get(e.id)?.entered ?? 0 })));
});

examRouter.post('/exams', office, (req, res) => {
  const b = req.body ?? {}, cfg = examConfig();
  if (!KINDS[b.kind]) return bad(res, 'Choose the kind of exam.');
  const classIds = (Array.isArray(b.class_ids) ? b.class_ids : []).map(Number).filter((id: number) => db.prepare('SELECT 1 FROM classes WHERE id = ?').get(id));
  if (!classIds.length) return bad(res, 'Choose at least one class.');
  const session = String(b.session || cfg.session).trim().slice(0, 20);
  const seq = (db.prepare('SELECT COUNT(*) AS n FROM exams WHERE kind = ? AND session = ?').get(b.kind, session) as any).n + 1;
  const name = String(b.name ?? '').trim().slice(0, 60) || (b.kind === 'test' ? `Test ${seq}` : `${KINDS[b.kind].label} ${session}`);
  const pass = Math.round(Number(b.pass_percent ?? 33)), max = Math.round(Number(b.max_marks ?? KINDS[b.kind].max));
  if (!(pass >= 1 && pass <= 100)) return bad(res, 'Pass percentage must be 1 to 100.');
  if (!(max >= 1 && max <= 500)) return bad(res, 'Maximum marks must be 1 to 500.');
  if ((b.start_date && !isDate(b.start_date)) || (b.end_date && !isDate(b.end_date))) return bad(res, 'Enter valid dates.');
  const id = db.transaction(() => {
    const eid = Number(db.prepare('INSERT INTO exams (name, kind, session, seq, pass_percent, pass_rule, start_date, end_date) VALUES (?,?,?,?,?,?,?,?)')
      .run(name, b.kind, session, seq, pass, b.pass_rule === 'total' ? 'total' : 'subjects', b.start_date || null, b.end_date || null).lastInsertRowid);
    for (const c of classIds) db.prepare('INSERT INTO exam_classes (exam_id, class_id) VALUES (?, ?)').run(eid, c);
    return eid;
  })();
  const r = syncPapers(id, max);
  res.status(201).json({ id, papers: r.added });
});

examRouter.get('/exams/:id', (req, res) => {
  const e = getExam(Number(req.params.id)); if (!e) return noExam(res);
  res.json({ ...e, classes: db.prepare('SELECT c.id, c.name, c.grade FROM exam_classes ec JOIN classes c ON c.id = ec.class_id WHERE ec.exam_id = ? ORDER BY c.grade').all(e.id) });
});

examRouter.put('/exams/:id', office, (req, res) => {
  const id = Number(req.params.id), e = getExam(id), b = req.body ?? {}; if (!e) return noExam(res);
  const status = ['open', 'locked', 'published'].includes(b.status) ? b.status : e.status;
  const pass = b.pass_percent !== undefined ? Math.round(Number(b.pass_percent)) : e.pass_percent;
  if (!(pass >= 1 && pass <= 100)) return bad(res, 'Pass percentage must be 1 to 100.');
  if ((b.start_date && !isDate(b.start_date)) || (b.end_date && !isDate(b.end_date))) return bad(res, 'Enter valid dates.');
  db.prepare('UPDATE exams SET name = ?, status = ?, pass_percent = ?, pass_rule = ?, start_date = ?, end_date = ? WHERE id = ?')
    .run(String(b.name ?? e.name).trim().slice(0, 60) || e.name, status, pass, b.pass_rule === 'total' ? 'total' : b.pass_rule === 'subjects' ? 'subjects' : e.pass_rule,
      b.start_date !== undefined ? b.start_date || null : e.start_date, b.end_date !== undefined ? b.end_date || null : e.end_date, id);
  res.json({ ok: true });
});

examRouter.delete('/exams/:id', leadership, (req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT 1 FROM exam_marks m JOIN exam_papers p ON p.id = m.paper_id WHERE p.exam_id = ? LIMIT 1').get(id)) return bad(res, 'Marks are already entered for this exam, so it cannot be deleted. Lock it instead.', 409);
  db.prepare('DELETE FROM exams WHERE id = ?').run(id); res.json({ ok: true });
});

/** Add classes and/or pick up curriculum or teacher changes. */
examRouter.post('/exams/:id/sync', office, (req, res) => {
  const id = Number(req.params.id); if (!getExam(id)) return noExam(res);
  for (const c of (Array.isArray(req.body?.class_ids) ? req.body.class_ids : []).map(Number)) if (db.prepare('SELECT 1 FROM classes WHERE id = ?').get(c)) db.prepare('INSERT OR IGNORE INTO exam_classes (exam_id, class_id) VALUES (?, ?)').run(id, c);
  const sample = db.prepare('SELECT max_marks FROM exam_papers WHERE exam_id = ? LIMIT 1').get(id) as any;
  res.json(syncPapers(id, sample?.max_marks));
});

examRouter.get('/exams/:id/progress', office, (req, res) => {
  const id = Number(req.params.id); if (!getExam(id)) return noExam(res);
  res.json(db.prepare(`SELECT p.id, p.section_id, c.name AS class_name, c.grade, s.name AS section_name, sub.name AS subject, t.name AS teacher, p.test_date, p.max_marks,
      (SELECT COUNT(*) FROM exam_marks m WHERE m.paper_id = p.id) AS entered, (SELECT COUNT(*) FROM students st WHERE st.section_id = p.section_id AND st.status = 'active') AS total
    FROM exam_papers p JOIN sections s ON s.id = p.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = p.subject_id LEFT JOIN teachers t ON t.id = p.teacher_id
    WHERE p.exam_id = ? ORDER BY c.grade, s.name, sub.name`).all(id));
});

examRouter.get('/exams/:id/datesheet', (req, res) => {
  const id = Number(req.params.id), classId = Number(req.query.classId), e = getExam(id); if (!e) return noExam(res);
  const rows = db.prepare(`SELECT p.subject_id, sub.name AS subject, MIN(p.test_date) AS test_date, MAX(p.test_date) AS test_date_max, MAX(p.max_marks) AS max_marks, MIN(p.max_marks) AS max_min
    FROM exam_papers p JOIN sections s ON s.id = p.section_id JOIN subjects sub ON sub.id = p.subject_id WHERE p.exam_id = ? AND s.class_id = ? GROUP BY p.subject_id ORDER BY COALESCE(MIN(p.test_date), '9999'), sub.name`).all(id, classId) as any[];
  res.json({ exam: e, class: db.prepare('SELECT id, name FROM classes WHERE id = ?').get(classId), rows: rows.map(r => ({ ...r, mixed: r.test_date !== r.test_date_max || r.max_marks !== r.max_min })) });
});

examRouter.put('/exams/:id/datesheet', office, (req, res) => {
  const id = Number(req.params.id), classId = Number(req.body?.class_id), e = getExam(id); if (!e) return noExam(res);
  if (e.status === 'published') return bad(res, 'This exam is published. Re-open it to change the date sheet.', 409);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  for (const r of rows) {
    const max = Math.round(Number(r.max_marks));
    if (!(max >= 1 && max <= 500) || (r.test_date && !isDate(r.test_date))) return bad(res, 'Check the dates and maximum marks.');
    const hi = db.prepare(`SELECT MAX(m.marks) AS n FROM exam_marks m JOIN exam_papers p ON p.id = m.paper_id JOIN sections s ON s.id = p.section_id WHERE p.exam_id = ? AND p.subject_id = ? AND s.class_id = ?`).get(id, r.subject_id, classId) as any;
    if (hi?.n > max) return bad(res, `Marks above ${max} are already entered for one subject.`, 409);
  }
  db.transaction(() => { for (const r of rows) db.prepare(`UPDATE exam_papers SET test_date = ?, max_marks = ? WHERE exam_id = ? AND subject_id = ? AND section_id IN (SELECT id FROM sections WHERE class_id = ?)`)
    .run(r.test_date || null, Math.round(Number(r.max_marks)), id, r.subject_id, classId); })();
  res.json({ ok: true });
});

// ---------- papers and marks ----------
const paperInfo = (id: number) => db.prepare(`SELECT p.*, e.name AS exam_name, e.status AS exam_status, e.pass_percent, e.start_date, c.id AS class_id, c.name AS class_name, s.name AS section_name, sub.name AS subject, t.name AS teacher
  FROM exam_papers p JOIN exams e ON e.id = p.exam_id JOIN sections s ON s.id = p.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = p.subject_id LEFT JOIN teachers t ON t.id = p.teacher_id WHERE p.id = ?`).get(id) as any;

function canEditPaper(user: any, p: any): { ok: boolean; reason?: string } {
  if (p.exam_status === 'published') return { ok: false, reason: 'This exam is published. Ask the principal to re-open it.' };
  if (isManager(user)) return { ok: true };
  const own = !!p.teacher_id && myTeacherId(user.id) === p.teacher_id;
  if (user.role !== 'teacher' || !(own || teacherOpen())) return { ok: false, reason: 'Only the subject teacher or the office can enter these marks.' };
  if (p.exam_status !== 'open') return { ok: false, reason: 'Marks entry is closed for this exam. Ask the office.' };
  return { ok: true };
}

examRouter.get('/my-papers', (req, res) => {
  const everything = req.query.scope === 'all' && !isManager(req.user!) && teacherOpen();   // open teaching: every paper of the open exams
  const teacherId = isManager(req.user!) ? Number(req.query.teacherId) || null : myTeacherId(req.user!.id);
  if (everything) {
    return res.json({ teacher: null, papers: db.prepare(`SELECT p.id, p.exam_id, e.name AS exam_name, e.status AS exam_status, c.name AS class_name, s.name AS section_name, sub.name AS subject, p.test_date, p.max_marks, t.name AS teacher_name,
        (SELECT COUNT(*) FROM exam_marks m WHERE m.paper_id = p.id) AS entered, (SELECT COUNT(*) FROM students st WHERE st.section_id = p.section_id AND st.status = 'active') AS total
      FROM exam_papers p JOIN exams e ON e.id = p.exam_id JOIN sections s ON s.id = p.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = p.subject_id LEFT JOIN teachers t ON t.id = p.teacher_id
      WHERE e.status = 'open' ORDER BY COALESCE(e.start_date, '9999') DESC, e.id DESC, c.grade, s.name, sub.name`).all() });
  }
  if (!teacherId) return res.json({ teacher: null, papers: [], note: isManager(req.user!) ? 'Choose a teacher.' : 'Your login is not linked to a teacher record. Ask the office.' });
  const open = req.query.all === '1' ? '' : "AND e.status = 'open'";
  res.json({
    teacher: db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(teacherId),
    papers: db.prepare(`SELECT p.id, p.exam_id, e.name AS exam_name, e.status AS exam_status, c.name AS class_name, s.name AS section_name, sub.name AS subject, p.test_date, p.max_marks,
        (SELECT COUNT(*) FROM exam_marks m WHERE m.paper_id = p.id) AS entered, (SELECT COUNT(*) FROM students st WHERE st.section_id = p.section_id AND st.status = 'active') AS total
      FROM exam_papers p JOIN exams e ON e.id = p.exam_id JOIN sections s ON s.id = p.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = p.subject_id
      WHERE p.teacher_id = ? ${open} ORDER BY COALESCE(e.start_date, '9999') DESC, e.id DESC, c.grade, s.name, sub.name`).all(teacherId)
  });
});

examRouter.get('/papers/:id', (req, res) => {
  const p = paperInfo(Number(req.params.id)); if (!p) return bad(res, 'Paper not found.', 404);
  const rule = canEditPaper(req.user!, p);
  if (!rule.ok && !isManager(req.user!) && !canSection(req.user!, p.section_id) && !(p.teacher_id && myTeacherId(req.user!.id) === p.teacher_id)) return bad(res, 'This is not your paper.', 403);
  const marks = new Map((db.prepare('SELECT student_id, marks, status FROM exam_marks WHERE paper_id = ?').all(p.id) as any[]).map(m => [m.student_id, m]));
  const prevEx = previousExam({ id: p.exam_id, start_date: p.start_date, session: (db.prepare('SELECT session FROM exams WHERE id = ?').get(p.exam_id) as any).session } as any, p.class_id, p.section_id);
  const prevPaper = prevEx ? db.prepare('SELECT id, max_marks FROM exam_papers WHERE exam_id = ? AND section_id = ? AND subject_id = ?').get(prevEx.id, p.section_id, p.subject_id) as any : null;
  const prev = new Map<number, any>(prevPaper ? (db.prepare('SELECT student_id, marks, status FROM exam_marks WHERE paper_id = ?').all(prevPaper.id) as any[]).map(m => [m.student_id, m]) : []);
  const students = db.prepare("SELECT id, name, father_name, roll_no FROM students WHERE section_id = ? AND status = 'active' ORDER BY roll_no, name").all(p.section_id) as any[];
  res.json({
    paper: { id: p.id, exam_id: p.exam_id, exam_name: p.exam_name, exam_status: p.exam_status, pass_percent: p.pass_percent, class_name: p.class_name, section_name: p.section_name, subject: p.subject, teacher: p.teacher, max_marks: p.max_marks, test_date: p.test_date },
    canEdit: rule.ok, lockReason: rule.reason ?? null, prevName: prevEx?.name ?? null, prevMax: prevPaper?.max_marks ?? null,
    students: students.map(s => ({ ...s, marks: marks.get(s.id)?.marks ?? null, status: marks.get(s.id)?.status ?? null, prev: prev.has(s.id) ? (prev.get(s.id).status === 'P' ? prev.get(s.id).marks : prev.get(s.id).status) : null }))
  });
});

examRouter.put('/papers/:id', (req, res) => {
  const p = paperInfo(Number(req.params.id)); if (!p) return bad(res, 'Paper not found.', 404);
  const rule = canEditPaper(req.user!, p); if (!rule.ok) return bad(res, rule.reason!, 403);
  const b = req.body ?? {};
  const date = b.test_date === undefined ? p.test_date : b.test_date || null, max = b.max_marks === undefined ? p.max_marks : Math.round(Number(b.max_marks));
  if (date && !isDate(date)) return bad(res, 'Enter a valid test date.');
  if (!(max >= 1 && max <= 500)) return bad(res, 'Maximum marks must be 1 to 500.');
  const hi = db.prepare('SELECT MAX(marks) AS n FROM exam_marks WHERE paper_id = ?').get(p.id) as any;
  if (hi?.n > max) return bad(res, `Marks above ${max} are already entered. Correct them first.`, 409);
  db.prepare('UPDATE exam_papers SET test_date = ?, max_marks = ? WHERE id = ?').run(date, max, p.id);
  res.json({ ok: true });
});

examRouter.post('/papers/:id/marks', (req, res) => {
  const p = paperInfo(Number(req.params.id)); if (!p) return bad(res, 'Paper not found.', 404);
  const rule = canEditPaper(req.user!, p); if (!rule.ok) return bad(res, rule.reason!, 403);
  const valid = new Set((db.prepare("SELECT id FROM students WHERE section_id = ? AND status = 'active'").all(p.section_id) as any[]).map(r => r.id));
  const list = (Array.isArray(req.body?.entries) ? req.body.entries : []).filter((e: any) => valid.has(e.student_id));
  for (const e of list) {
    if (e.status === 'P' && e.marks !== null && e.marks !== undefined && e.marks !== '') {
      const m = Number(e.marks);
      if (!(m >= 0 && m <= p.max_marks) || !Number.isFinite(m)) return bad(res, `Marks must be between 0 and ${p.max_marks}.`);
    } else if (!['A', 'L', 'P'].includes(e.status)) return bad(res, 'Use a number, A (absent) or L (leave).');
  }
  let saved = 0, cleared = 0;
  const up = db.prepare(`INSERT INTO exam_marks (paper_id, student_id, marks, status, entered_by) VALUES (?,?,?,?,?)
    ON CONFLICT(paper_id, student_id) DO UPDATE SET marks = excluded.marks, status = excluded.status, entered_by = excluded.entered_by, entered_at = datetime('now')`);
  db.transaction(() => {
    for (const e of list) {
      const blank = e.status === 'P' && (e.marks === null || e.marks === undefined || e.marks === '');
      if (blank) { db.prepare('DELETE FROM exam_marks WHERE paper_id = ? AND student_id = ?').run(p.id, e.student_id); cleared++; continue; }
      up.run(p.id, e.student_id, e.status === 'P' ? Math.round(Number(e.marks) * 100) / 100 : null, e.status, req.user!.id); saved++;
    }
  })();
  res.json({ saved, cleared });
});

// ---------- marks by file: download a template, fill it in Excel, upload it again ----------
const paperStudents = (p: any) => db.prepare("SELECT st.id, st.reg_no, st.roll_no, st.name, m.marks, m.status FROM students st LEFT JOIN exam_marks m ON m.paper_id = ? AND m.student_id = st.id WHERE st.section_id = ? AND st.status = 'active' ORDER BY st.roll_no, st.name").all(p.id, p.section_id) as any[];
examRouter.get('/papers/:id/marks-template', (req, res) => {
  const p = paperInfo(Number(req.params.id)) as any; if (!p) return bad(res, 'Paper not found.', 404);
  const rule = canEditPaper(req.user!, p); if (!rule.ok) return bad(res, rule.reason!, 403);
  res.json({ filename: `marks-${p.class_name}-${p.section_name}-${p.subject}.csv`.replace(/[^\w.\-]+/g, '_'), csv: templateCsv(p, paperStudents(p)) });
});
examRouter.post('/papers/:id/marks-upload', express.raw({ type: () => true, limit: '4mb' }), (req, res) => {
  const p = paperInfo(Number(req.params.id)) as any; if (!p) return bad(res, 'Paper not found.', 404);
  const rule = canEditPaper(req.user!, p); if (!rule.ok) return bad(res, rule.reason!, 403);
  const buf = req.body as Buffer; if (!Buffer.isBuffer(buf) || !buf.length) return bad(res, 'The file is empty.');
  let rows; try { const t = toFileRows(readRows(buf, String(req.query.name ?? ''))); if (typeof t === 'string') return bad(res, t); rows = t; } catch (e: any) { return bad(res, e.message); }
  if (!rows.length) return bad(res, 'The file has no student rows.');
  const checked = checkRows(rows, p.max_marks, paperStudents(p)), good = checked.filter(c => c.entry);
  if (req.query.mode !== 'commit') return res.json({ max: p.max_marks, rows: checked, ok: good.length, skipped: checked.filter(c => c.skipped).length, problems: checked.filter(c => c.problem).length });
  const up = db.prepare(`INSERT INTO exam_marks (paper_id, student_id, marks, status, entered_by) VALUES (?,?,?,?,?)
    ON CONFLICT(paper_id, student_id) DO UPDATE SET marks = excluded.marks, status = excluded.status, entered_by = excluded.entered_by, entered_at = datetime('now')`);
  db.transaction(() => { for (const c of good) up.run(p.id, c.student_id, c.entry!.marks, c.entry!.status, req.user!.id); })();
  res.json({ saved: good.length, problems: checked.filter(c => c.problem).length });
});

/** A photo of the handwritten award list. The AI only reads; a person confirms every row before anything is saved. */
examRouter.post('/papers/:id/marks-scan', express.raw({ type: () => true, limit: '8mb' }), async (req, res) => {
  const p = paperInfo(Number(req.params.id)) as any; if (!p) return bad(res, 'Paper not found.', 404);
  const rule = canEditPaper(req.user!, p); if (!rule.ok) return bad(res, rule.reason!, 403);
  const buf = req.body as Buffer; const mime = Buffer.isBuffer(buf) ? sniffImage(buf) : null;
  if (!mime) return bad(res, 'Send a photo (JPG or PNG) of the sheet.');
  if (!visionReady()) return bad(res, 'Photo reading is not set up. The Director can add the key in System & Safety → Photo reading.', 503);
  if (!allowScan(req.user!.id)) return bad(res, 'Too many photos this hour. Try again later.', 429);
  try {
    const read = await readImage(buf, mime, marksPrompt(p.max_marks, p.subject));
    const rows = scanPreview(read, p.max_marks, paperStudents(p));
    audit(req.user, 'marks.scan', 'paper', p.id, `${rows.length} rows read`);
    res.json({ max: p.max_marks, rows, ok: rows.filter(r => r.entry).length, problems: rows.filter(r => r.problem).length });
  } catch (e: any) { bad(res, e instanceof VisionError ? e.message : 'The photo could not be read.', e instanceof VisionError ? 502 : 500); }
});
/** Saves the rows the teacher confirmed (marks may have been corrected on screen). Everything is checked again. */
examRouter.post('/papers/:id/marks-scan/commit', (req, res) => {
  const p = paperInfo(Number(req.params.id)) as any; if (!p) return bad(res, 'Paper not found.', 404);
  const rule = canEditPaper(req.user!, p); if (!rule.ok) return bad(res, rule.reason!, 403);
  const students = paperStudents(p), ids = new Set(students.map((x: any) => x.id));
  const items: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const up = db.prepare(`INSERT INTO exam_marks (paper_id, student_id, marks, status, entered_by) VALUES (?,?,?,?,?)
    ON CONFLICT(paper_id, student_id) DO UPDATE SET marks = excluded.marks, status = excluded.status, entered_by = excluded.entered_by, entered_at = datetime('now')`);
  const good: { id: number; marks: number | null; status: string }[] = [];
  for (const it of items) {
    const id = Number(it.student_id); if (!ids.has(id)) continue;
    const st = String(it.status ?? 'P').toUpperCase();
    if (st === 'A' || st === 'L') { good.push({ id, marks: null, status: st }); continue; }
    const m = Number(it.marks); if (it.marks === '' || it.marks == null || !Number.isFinite(m) || m < 0 || m > p.max_marks) continue;
    good.push({ id, marks: Math.round(m * 100) / 100, status: 'P' });
  }
  db.transaction(() => { for (const g of good) up.run(p.id, g.id, g.marks, g.status, req.user!.id); })();
  audit(req.user, 'marks.scan.commit', 'paper', p.id, `${good.length} saved`);
  res.json({ saved: good.length, skipped: items.length - good.length });
});

// ---------- the class incharge sheet ----------
examRouter.get('/exams/:id/sheet', (req, res) => {
  const id = Number(req.params.id), sectionId = Number(req.query.sectionId);
  if (!getExam(id)) return noExam(res);
  if (!db.prepare('SELECT 1 FROM sections WHERE id = ?').get(sectionId)) return bad(res, 'Section not found.', 404);
  if (!canSection(req.user!, sectionId)) return bad(res, 'Only the class teacher or the office can open the class sheet.', 403);
  const r = computeSection(id, sectionId, true), att = sessionAttendance(r.students.map(s => s.id));
  const photos = req.query.photos ? photoMap(r.students.map(s => s.id)) : null, genders = genderMap(r.students.map(s => s.id));
  res.json({ ...r, students: r.students.map(s => ({ ...s, gender: genders.get(s.id) ?? 'male', attendance: att.get(s.id) ?? null, ...(photos ? { photo: photos.get(s.id) ?? null } : {}) })), categories: examConfig().categories, scale: examConfig().grade_scale });
});

/** Pictures are only sent when a print page asks for them (they are the heavy part). */
function genderMap(ids: number[]): Map<number, string> {
  const out = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 500) { const c = ids.slice(i, i + 500); for (const r of db.prepare(`SELECT id, gender FROM students WHERE id IN (${c.map(() => '?').join(',')})`).all(...c) as any[]) out.set(r.id, r.gender); }
  return out;
}
function photoMap(ids: number[]): Map<number, string | null> {
  const out = new Map<number, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    const c = ids.slice(i, i + 500);
    for (const r of db.prepare(`SELECT id, photo FROM students WHERE id IN (${c.map(() => '?').join(',')})`).all(...c) as any[]) out.set(r.id, r.photo);
  }
  return out;
}

// ---------- one student: every exam, every subject (profile page, analysis, progress report) ----------
examRouter.get('/students/:id/results', (req, res) => {
  const sid = Number(req.params.id);
  const st = db.prepare(`SELECT st.id, st.name, st.father_name, st.roll_no, st.reg_no, st.photo, st.gender, st.section_id, s.name AS section_name, c.name AS class_name, c.grade
    FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE st.id = ?`).get(sid) as any;
  if (!st) return bad(res, 'Student not found.', 404);
  if (!canSection(req.user!, st.section_id)) return bad(res, 'Only the class teacher or the office can see a student\'s results.', 403);
  const session = String(req.query.session ?? '');
  const exams = db.prepare(`SELECT DISTINCT e.id, e.name, e.kind, e.session, e.seq, e.start_date, e.status, e.pass_percent, p.section_id
    FROM exam_marks m JOIN exam_papers p ON p.id = m.paper_id JOIN exams e ON e.id = p.exam_id
    WHERE m.student_id = ? AND (? = '' OR e.session = ?) ORDER BY e.session, COALESCE(e.start_date, '9999'), e.id`).all(sid, session, session) as any[];
  const sessions = (db.prepare('SELECT DISTINCT e.session FROM exam_marks m JOIN exam_papers p ON p.id = m.paper_id JOIN exams e ON e.id = p.exam_id WHERE m.student_id = ? ORDER BY e.session DESC').all(sid) as any[]).map(r => r.session);
  const out: any[] = [], seen = new Set<number>();
  for (const e of exams) {
    if (seen.has(e.id)) continue; seen.add(e.id);
    const r = computeSection(e.id, e.section_id, true, [sid]), me = r.students.find(x => x.id === sid);
    if (!me) continue;
    const done = r.students.filter(x => x.pct !== null);
    out.push({
      exam: { id: e.id, name: e.name, kind: e.kind, session: e.session, start_date: e.start_date, status: e.status, pass_percent: e.pass_percent },
      section_id: e.section_id, class_name: r.section.class_name, section_name: r.section.section_name,
      papers: r.papers.map((p: any) => ({ subject_id: p.subject_id, subject: p.subject, max_marks: p.max_marks })),
      row: { marks: me.marks, total: me.total, max: me.max, pct: me.pct, grade: me.grade, result: me.result, rank: me.rank, failed: me.failed, missing: me.missing, delta: me.delta, trend: me.trend, prev: me.prev },
      classSize: r.students.length,
      sectionAvg: done.length ? round1(done.reduce((a, x) => a + (x.pct ?? 0), 0) / done.length) : null,
      topPct: done.length ? Math.max(...done.map(x => x.pct ?? 0)) : null,
      subjectAvg: Object.fromEntries(r.papers.map((p: any) => {
        const v = r.students.map(x => x.marks[p.subject_id]).filter(m => m && m.marks !== null).map(m => m!.marks as number);
        return [p.subject_id, v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null];
      }))
    });
  }
  res.json({ student: st, session, sessions, attendance: sessionAttendance([sid]).get(sid) ?? null, scale: examConfig().grade_scale, exams: out });
});

examRouter.get('/exams/:id/summary', office, (req, res) => {
  const id = Number(req.params.id), classId = Number(req.query.classId), exam = getExam(id); if (!exam) return noExam(res);
  const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(classId) as any; if (!cls) return bad(res, 'Class not found.', 404);
  const secs = db.prepare('SELECT id FROM sections WHERE class_id = ? ORDER BY name').all(classId) as { id: number }[];
  const results = secs.map(s => computeSection(id, s.id, true));
  const all = results.flatMap(r => r.students.map(s => ({ ...s, label: r.section.label })));
  const done = all.filter(s => s.result !== 'INCOMPLETE');
  const subj = new Map<string, any>();
  for (const r of results) for (const p of r.papers) { const e = subj.get(p.subject) ?? subj.set(p.subject, { subject: p.subject, sections: [] }).get(p.subject); e.sections.push({ label: r.section.label, teacher: p.teacher, avgPct: p.avgPct, passPct: p.passPct, entered: p.entered, total: p.total }); }
  const cat = (['A', 'B', 'C'] as const).map(c => { const g = done.filter(s => s.category === c); return { cat: c, students: g.length, avg: g.length ? round1(g.reduce((a, s) => a + s.pct!, 0) / g.length) : null, passPct: g.length ? round1((g.filter(s => s.result === 'PASS').length / g.length) * 100) : null }; });
  const noCat = done.filter(s => !s.category);
  const trend = (db.prepare(`SELECT e.id, e.name FROM exams e JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = ? WHERE e.session = ? ORDER BY COALESCE(e.start_date, '9999'), e.id`).all(classId, exam.session) as any[]).map(e => {
    const rows = secs.flatMap(s => computeSection(e.id, s.id, false).students).filter(s => s.result !== 'INCOMPLETE');
    return { exam: e.name, students: rows.length, avg: rows.length ? round1(rows.reduce((a, s) => a + s.pct!, 0) / rows.length) : null, passPct: rows.length ? round1((rows.filter(s => s.result === 'PASS').length / rows.length) * 100) : null };
  }).filter(t => t.students > 0);
  const pick = (s: any) => ({ id: s.id, name: s.name, label: s.label, pct: s.pct, delta: s.delta, rank: s.rank });
  res.json({
    exam, class: cls, sections: results.map(r => ({ section_id: r.section.id, label: r.section.label, class_teacher: r.section.class_teacher, ...r.stats })),
    overall: { students: all.length, complete: done.length, pass: done.filter(s => s.result === 'PASS').length, fail: done.filter(s => s.result === 'FAIL').length, avg: done.length ? round1(done.reduce((a, s) => a + s.pct!, 0) / done.length) : null,
      passPct: done.length ? round1((done.filter(s => s.result === 'PASS').length / done.length) * 100) : null, needCall: all.filter(s => s.needsCall).length },
    subjects: [...subj.values()], categories: [...cat, ...(noCat.length ? [{ cat: '-', students: noCat.length, avg: round1(noCat.reduce((a, s) => a + s.pct!, 0) / noCat.length), passPct: round1((noCat.filter(s => s.result === 'PASS').length / noCat.length) * 100) }] : [])],
    top: [...done].sort((a, b) => b.pct! - a.pct!).slice(0, 5).map(pick),
    up: all.filter(s => s.delta !== null && s.delta > 0).sort((a, b) => b.delta! - a.delta!).slice(0, 5).map(pick),
    down: all.filter(s => s.delta !== null && s.delta < 0).sort((a, b) => a.delta! - b.delta!).slice(0, 5).map(pick), trend
  });
});

// ---------- guardian calls and parent meetings ----------
const cfgVenue = (cat: string | null) => (cat && (examConfig().categories as any)[cat] ? (examConfig().categories as any)[cat].venue : '');

examRouter.post('/exams/:id/followups/generate', (req, res) => {
  const id = Number(req.params.id); if (!getExam(id)) return noExam(res);
  const sectionId = Number(req.body?.sectionId) || undefined, classId = Number(req.body?.classId) || undefined;
  if (!sectionId && !classId) return bad(res, 'Choose a class or section.');
  if (!isManager(req.user!) && !(sectionId && canSection(req.user!, sectionId))) return bad(res, 'Only the class teacher or the office can do this.', 403);
  const secs = sectionId ? [{ id: sectionId }] : db.prepare('SELECT id FROM sections WHERE class_id = ?').all(classId) as { id: number }[];
  let created = 0, kept = 0;
  const up = db.prepare(`INSERT INTO exam_followups (exam_id, student_id, reason, pct, prev_pct, failed) VALUES (?,?,?,?,?,?)
    ON CONFLICT(exam_id, student_id) DO UPDATE SET reason = excluded.reason, pct = excluded.pct, prev_pct = excluded.prev_pct, failed = excluded.failed, updated_at = datetime('now') WHERE exam_followups.status = 'pending'`);
  db.transaction(() => {
    for (const s of secs) for (const st of computeSection(id, s.id, true).students) {
      if (!st.needsCall) continue;
      const had = db.prepare('SELECT 1 FROM exam_followups WHERE exam_id = ? AND student_id = ?').get(id, st.id);
      up.run(id, st.id, st.reason, st.pct, st.prev?.pct ?? null, st.failed.join(', ') || null); had ? kept++ : created++;
    }
  })();
  res.json({ created, kept });
});

examRouter.get('/followups', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const where = ['1=1']; const p: any[] = [];
  if (q.examId) { where.push('f.exam_id = ?'); p.push(Number(q.examId)); }
  if (q.sectionId) { where.push('s.id = ?'); p.push(Number(q.sectionId)); } else if (q.classId) { where.push('c.id = ?'); p.push(Number(q.classId)); }
  if (q.status) { where.push('f.status = ?'); p.push(q.status); }
  if (q.category) { where.push(q.category === '-' ? 'st.category IS NULL' : 'st.category = ?'); if (q.category !== '-') p.push(q.category); }
  if (!isManager(req.user!)) { where.push('s.class_teacher_id = ?'); p.push(myTeacherId(req.user!.id) ?? -1); }
  const rows = db.prepare(`SELECT f.*, e.name AS exam_name, st.name, st.father_name, st.roll_no, st.reg_no, st.category, st.p_number, st.phone, st.father_phone, st.mother_phone,
      c.name AS class_name, s.name AS section_name, s.id AS section_id FROM exam_followups f JOIN exams e ON e.id = f.exam_id JOIN students st ON st.id = f.student_id
    JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE ${where.join(' AND ')} ORDER BY c.grade, s.name, st.roll_no LIMIT 2000`).all(...p) as any[];
  res.json(rows.map(r => ({ ...r, venue: cfgVenue(r.category) })));
});

function followupAccess(req: any, res: any, id: number) {
  const f = db.prepare('SELECT f.*, st.section_id FROM exam_followups f JOIN students st ON st.id = f.student_id WHERE f.id = ?').get(id) as any;
  if (!f) { bad(res, 'Follow-up not found.', 404); return null; }
  if (!canSection(req.user!, f.section_id)) { bad(res, 'Only the class teacher or the office can change this.', 403); return null; }
  return f;
}
examRouter.put('/followups/:id', (req, res) => {
  const f = followupAccess(req, res, Number(req.params.id)); if (!f) return;
  const b = req.body ?? {};
  const status = ['pending', 'called', 'meeting_set', 'attended', 'no_show', 'closed'].includes(b.status) ? b.status : f.status;
  if ((b.call_date && !isDate(b.call_date)) || (b.ptm_date && !isDate(b.ptm_date))) return bad(res, 'Enter valid dates.');
  db.prepare("UPDATE exam_followups SET status = ?, call_date = ?, ptm_date = ?, notes = ?, called_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, b.call_date !== undefined ? b.call_date || null : f.call_date, b.ptm_date !== undefined ? b.ptm_date || null : f.ptm_date, b.notes !== undefined ? String(b.notes).trim().slice(0, 300) || null : f.notes, req.user!.id, f.id);
  res.json({ ok: true });
});
examRouter.delete('/followups/:id', office, (req, res) => { db.prepare('DELETE FROM exam_followups WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

/** Set the meeting date: categories A and B meet at one place, category C at another, so they get their own dates. */
examRouter.post('/followups/schedule', (req, res) => {
  const { ids, ptm_date_kmcb, ptm_date_govt } = req.body ?? {};
  if ((ptm_date_kmcb && !isDate(ptm_date_kmcb)) || (ptm_date_govt && !isDate(ptm_date_govt))) return bad(res, 'Enter valid dates.');
  if (!ptm_date_kmcb && !ptm_date_govt) return bad(res, 'Choose at least one meeting date.');
  let n = 0;
  db.transaction(() => {
    for (const id of (Array.isArray(ids) ? ids : []).map(Number)) {
      const f = db.prepare('SELECT f.id, f.status, st.category, st.section_id FROM exam_followups f JOIN students st ON st.id = f.student_id WHERE f.id = ?').get(id) as any;
      if (!f || !canSection(req.user!, f.section_id)) continue;
      const date = f.category === 'C' ? ptm_date_govt : ptm_date_kmcb;
      if (!date) continue;
      db.prepare("UPDATE exam_followups SET ptm_date = ?, status = CASE WHEN status IN ('pending','called') THEN 'meeting_set' ELSE status END, updated_at = datetime('now') WHERE id = ?").run(date, id); n++;
    }
  })();
  res.json({ scheduled: n });
});

// ---------- awards ----------
examRouter.get('/awards', office, (req, res) => {
  const ids = String(req.query.examIds ?? req.query.examId ?? '').split(',').map(Number).filter(n => n && getExam(n));
  if (!ids.length) return bad(res, 'Choose an exam.');
  const aggregate = ids.length > 1, classId = Number(req.query.classId) || undefined, sectionId = Number(req.query.sectionId) || undefined;
  const cfg = examConfig(), label = aggregate ? `All selected tests (${ids.length})` : getExam(ids[0])!.name;
  const secs = db.prepare(`SELECT s.id, s.name, c.id AS class_id, c.name AS class_name, c.grade FROM sections s JOIN classes c ON c.id = s.class_id
    WHERE (? IS NULL OR s.id = ?) AND (? IS NULL OR c.id = ?) ORDER BY c.grade, s.name`).all(sectionId ?? null, sectionId ?? null, classId ?? null, classId ?? null) as any[];
  const entries: any[] = [], byClass = new Map<number, any[]>();
  const att = new Map<number, number | null>(), subj = new Map<number, any[]>();
  const who = (s: any, sec: any) => ({ student_id: s.id, name: s.name, father_name: s.father_name, roll_no: s.roll_no, class_name: sec.class_name, section_name: sec.name, exam: label });
  for (const sec of secs) {
    const single = aggregate ? null : computeSection(ids[0], sec.id, true);
    const rows: any[] = aggregate ? computeAggregate(ids, sec.id) : single!.students;
    if (single) for (const st of single.students) subj.set(st.id, single.papers.map((p: any) => { const m = st.marks[p.subject_id]; return { subject: p.subject, max: p.max_marks, marks: m?.marks ?? null, status: m?.status ?? '', pass: m?.pass ?? null }; }));
    for (const [k, v] of sessionAttendance(rows.map(r => r.id))) att.set(k, v);
    const passed = rows.filter(r => r.result === 'PASS');
    (byClass.get(sec.class_id) ?? byClass.set(sec.class_id, []).get(sec.class_id)!).push(...passed.map(r => ({ ...r, sec })));
    for (const r of passed.filter(r => r.rank && r.rank <= 3)) entries.push({ type: 'position', title: `${ord(r.rank)} Position - ${sec.class_name}-${sec.name}`, ...who(r, sec), detail: `${r.pct}% (${r.total}/${r.max})`, pct: r.pct, rank: r.rank });
    if (single) {
      const imp = passed.filter(r => r.delta !== null && r.delta >= 5).sort((a, b) => b.delta - a.delta)[0];
      if (imp) entries.push({ type: 'improved', title: `Most Improved - ${sec.class_name}-${sec.name}`, ...who(imp, sec), detail: `Up ${imp.delta} points (${imp.prev?.pct}% to ${imp.pct}%)`, pct: imp.pct, rank: null });
    }
    for (const r of passed.filter(r => r.pct! >= cfg.grade_scale[0].min && !(r.rank && r.rank <= 3))) entries.push({ type: 'distinction', title: `Distinction (${gradeFor(r.pct)})`, ...who(r, sec), detail: `${r.pct}% (${r.total}/${r.max})`, pct: r.pct, rank: null });
    for (const r of passed) if (att.get(r.id) === 100 && (db.prepare('SELECT COUNT(*) AS n FROM att_daily WHERE student_id = ?').get(r.id) as any).n >= 20) entries.push({ type: 'attendance', title: 'Perfect Attendance', ...who(r, sec), detail: '100% attendance', pct: r.pct, rank: null });
  }
  for (const [, list] of byClass) {
    const sorted = [...list].sort((a, b) => b.pct - a.pct || b.total - a.total);
    sorted.forEach((r, i) => { r._cr = i > 0 && sorted[i - 1].pct === r.pct && sorted[i - 1].total === r.total ? sorted[i - 1]._cr : i + 1; });
    for (const r of sorted.filter(r => r._cr <= 3)) entries.push({ type: 'class_position', title: `${ord(r._cr)} Position - ${r.sec.class_name} (whole class)`, ...who(r, r.sec), detail: `${r.pct}% (${r.total}/${r.max})`, pct: r.pct, rank: r._cr });
  }
  if (!aggregate) for (const sec of secs) { /* subject toppers are collected per class below */ }
  if (!aggregate) {
    const classes = [...new Set(secs.map(s => s.class_id))];
    for (const cid of classes) {
      const best = new Map<string, any[]>();
      for (const sec of secs.filter(s => s.class_id === cid)) {
        const r = computeSection(ids[0], sec.id, false);
        for (const p of r.papers) for (const s of r.students) {
          const m = s.marks[p.subject_id]; if (!m || m.marks === null || !m.pass) continue;
          const pct = (m.marks / p.max_marks) * 100, cur = best.get(p.subject) ?? best.set(p.subject, []).get(p.subject)!;
          if (!cur.length || pct > cur[0].pct + 1e-9) { cur.length = 0; cur.push({ s, sec, pct, m, max: p.max_marks }); } else if (Math.abs(pct - cur[0].pct) < 1e-9) cur.push({ s, sec, pct, m, max: p.max_marks });
        }
      }
      for (const [subject, list] of best) for (const b of list) entries.push({ type: 'subject', title: `${subject} Topper - ${b.sec.class_name}`, ...who(b.s, b.sec), detail: `${b.m.marks}/${b.max} in ${subject}`, pct: round1(b.pct), rank: null });
    }
  }
  if (req.query.photos) { const ids = [...new Set(entries.map(e => e.student_id))], pm = photoMap(ids), gm = genderMap(ids); for (const e of entries) { e.photo = pm.get(e.student_id) ?? null; e.gender = gm.get(e.student_id) ?? 'male'; e.subjects = subj.get(e.student_id) ?? null; } }
  res.json({ exam: label, entries });
});

// ---------- board admission ----------
examRouter.get('/board', office, (req, res) => {
  const cfg = examConfig();
  let examId = Number(req.query.examId) || 0;
  const boardClasses = db.prepare(`SELECT id FROM classes WHERE grade IN (${BOARD_CLASSES.join(',')})`).all() as { id: number }[];
  const hasMarks = (id: number) => !!db.prepare('SELECT 1 FROM exam_marks m JOIN exam_papers p ON p.id = m.paper_id WHERE p.exam_id = ? LIMIT 1').get(id);
  if (!examId) {
    const pool = db.prepare(`SELECT e.id FROM exams e WHERE e.session = ? ORDER BY CASE e.kind WHEN 'sendup' THEN 0 ELSE 1 END, COALESCE(e.start_date, '9999') DESC, e.id DESC`).all(cfg.session) as { id: number }[];
    // the send-up if it has marks, otherwise the latest exam whose marks are complete for the board classes (shown as a preview)
    const complete = (id: number) => {
      const r = db.prepare(`SELECT SUM((SELECT COUNT(*) FROM students st WHERE st.section_id = p.section_id AND st.status = 'active')) AS expected, SUM((SELECT COUNT(*) FROM exam_marks m WHERE m.paper_id = p.id)) AS entered
        FROM exam_papers p JOIN sections s ON s.id = p.section_id JOIN classes c ON c.id = s.class_id WHERE p.exam_id = ? AND c.grade IN (${BOARD_CLASSES.join(',')})`).get(id) as any;
      return r?.expected > 0 && r.entered >= r.expected;
    };
    examId = pool.find(e => hasMarks(e.id) && complete(e.id))?.id ?? pool.find(e => hasMarks(e.id))?.id ?? 0;
  }
  const exam = examId ? getExam(examId) : null;
  const classId = Number(req.query.classId) || undefined;
  const secs = db.prepare(`SELECT s.id, s.name, c.name AS class_name, c.grade FROM sections s JOIN classes c ON c.id = s.class_id WHERE c.grade IN (${BOARD_CLASSES.join(',')}) AND (? IS NULL OR c.id = ?) ORDER BY c.grade, s.name`).all(classId ?? null, classId ?? null) as any[];
  const adm = new Map((db.prepare('SELECT * FROM board_admissions WHERE session = ?').all(cfg.session) as any[]).map(a => [a.student_id, a]));
  const dues = new Map((db.prepare('SELECT student_id, SUM(amount) AS n FROM ledger GROUP BY student_id').all() as any[]).map(r => [r.student_id, r.n]));
  const rows: any[] = [];
  for (const sec of secs) {
    const res2 = exam && boardClasses.length ? computeSection(exam.id, sec.id, false) : null;
    const by = new Map((res2?.students ?? []).map(s => [s.id, s]));
    const subjects = (db.prepare('SELECT sub.name FROM section_subjects ss JOIN subjects sub ON sub.id = ss.subject_id WHERE ss.section_id = ? ORDER BY sub.name').all(sec.id) as any[]).map(r => r.name);
    const studs = db.prepare("SELECT id, name, father_name, dob, roll_no, reg_no, category, p_number, phone FROM students WHERE section_id = ? AND status = 'active' ORDER BY roll_no, name").all(sec.id) as any[];
    const att = sessionAttendance(studs.map(s => s.id));
    for (const s of studs) {
      const r = by.get(s.id), a = adm.get(s.id), attendance = att.get(s.id) ?? null, due = Math.max(0, dues.get(s.id) ?? 0);
      const checks = { result: r?.result === 'PASS', attendance: attendance !== null && attendance >= cfg.board_min_att, fee: due <= 0 };
      rows.push({ ...s, class_name: sec.class_name, section_name: sec.name, grade: sec.grade, pct: r?.pct ?? null, result: r?.result ?? 'INCOMPLETE', failed: r?.failed ?? [], attendance, dues: due, checks,
        eligible: checks.result && checks.attendance && checks.fee, status: a?.status ?? 'pending', board_reg_no: a?.board_reg_no ?? '', board_roll_no: a?.board_roll_no ?? '', note: a?.note ?? '', subjects });
    }
  }
  res.json({ exam, preview: !!exam && exam.kind !== 'sendup', minAttendance: cfg.board_min_att, session: cfg.session, rows });
});

examRouter.put('/board/:studentId', office, (req, res) => {
  const b = req.body ?? {}, session = examConfig().session, sid = Number(req.params.studentId);
  if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(sid)) return bad(res, 'Student not found.', 404);
  const status = ['pending', 'form_ready', 'submitted', 'roll_issued', 'withheld'].includes(b.status) ? b.status : 'pending';
  db.prepare(`INSERT INTO board_admissions (student_id, session, status, board_reg_no, board_roll_no, note) VALUES (?,?,?,?,?,?)
    ON CONFLICT(student_id, session) DO UPDATE SET status = excluded.status, board_reg_no = excluded.board_reg_no, board_roll_no = excluded.board_roll_no, note = excluded.note, updated_at = datetime('now')`)
    .run(sid, session, status, String(b.board_reg_no ?? '').trim().slice(0, 30) || null, String(b.board_roll_no ?? '').trim().slice(0, 30) || null, String(b.note ?? '').trim().slice(0, 200) || null);
  res.json({ ok: true });
});
examRouter.post('/board/bulk', office, (req, res) => {
  const status = ['pending', 'form_ready', 'submitted', 'roll_issued', 'withheld'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return bad(res, 'Choose a status.');
  const session = examConfig().session; let n = 0;
  db.transaction(() => { for (const id of (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number)) {
    n += db.prepare(`INSERT INTO board_admissions (student_id, session, status) VALUES (?,?,?) ON CONFLICT(student_id, session) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`).run(id, session, status).changes; } })();
  res.json({ updated: n });
});
