import { teacherOpen } from '../policy.js';
import { Router } from 'express';
import { db, setSetting } from '../db.js';
import { requireRole } from '../auth.js';
import { getSettings, periodTimes, settingsForSection } from '../timetable/schema.js';

/** Start time of a period of a section: the school wing and the college wing have their own bell times. */
const startOf = (sectionId: number, period: number) => periodTimes(settingsForSection(sectionId))[period]?.start;
import {
  MANAGE, STATUSES, addDays, addMonths, applyLeave, attConfig, canMark, canSection, dateRange, dateRule, dayInfo, dowOf, holidaysBetween, isDate, isManager, isMonth,
  monthDays, monthOf, monthStats, myTeacherId, pctOf, removeLeaveMarks, sectionLabel, sectionStudents, todayISO, workingDates, type Stats
} from './service.js';

export const attendanceRouter = Router();
const manage = requireRole('director', 'principal', 'admin');
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const int = (v: unknown) => Math.round(Number(v));

// Teachers are allowed on the marking endpoints only; everything marked `manage` is for the office.
attendanceRouter.use(requireRole('director', 'principal', 'admin', 'teacher'));

// ---------- settings, holidays, class teachers ----------
attendanceRouter.get('/config', (_req, res) => {
  const s = getSettings();
  res.json({ ...attConfig(), days: s.days, periodCount: s.periodCount, breakAfter: s.breakAfter, periods: periodTimes(s), today: todayISO() });
});

attendanceRouter.put('/config', manage, (req, res) => {
  const b = req.body ?? {};
  const edit = int(b.edit_days), low = int(b.low_pct);
  if (!(edit >= 0 && edit <= 60)) return bad(res, 'Teacher edit window must be 0 to 60 days.');
  if (!(low >= 1 && low <= 100)) return bad(res, 'Minimum attendance must be between 1 and 100 percent.');
  setSetting('att_edit_days', String(edit)); setSetting('att_low_pct', String(low)); setSetting('att_leave_counts', b.leave_counts ? '1' : '0');
  res.json(attConfig());
});

attendanceRouter.get('/holidays', manage, (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year)) ? String(req.query.year) : todayISO().slice(0, 4);
  res.json(db.prepare('SELECT date, name FROM att_holidays WHERE date LIKE ? ORDER BY date').all(`${year}-%`));
});
attendanceRouter.post('/holidays', manage, (req, res) => {
  const from = req.body?.from, to = req.body?.to || from, name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (!isDate(from) || !isDate(to) || to < from) return bad(res, 'Enter a valid date (and an end date that is not before it).');
  if (!name) return bad(res, 'Enter the name of the holiday.');
  const dates = dateRange(from, to);
  db.transaction(() => {
    for (const d of dates) {
      db.prepare('INSERT INTO att_holidays (date, name) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET name = excluded.name').run(d, name);
      db.prepare('DELETE FROM att_daily WHERE date = ? AND leave_id IS NOT NULL').run(d);   // leave marks on a holiday make no sense
    }
  })();
  res.status(201).json({ days: dates.length });
});
attendanceRouter.delete('/holidays/:date', manage, (req, res) => { db.prepare('DELETE FROM att_holidays WHERE date = ?').run(req.params.date); res.json({ ok: true }); });

attendanceRouter.get('/class-teachers', manage, (_req, res) => res.json({
  sections: db.prepare(`SELECT s.id, c.name AS class_name, s.name AS section_name, s.class_teacher_id, c.grade FROM sections s JOIN classes c ON c.id = s.class_id ORDER BY c.grade, s.name`).all(),
  teachers: db.prepare('SELECT id, name FROM teachers WHERE active = 1 ORDER BY name').all()
}));
attendanceRouter.put('/class-teachers', manage, (req, res) => {
  const { section_id, teacher_id } = req.body ?? {};
  if (!db.prepare('SELECT 1 FROM sections WHERE id = ?').get(section_id)) return bad(res, 'Section not found.', 404);
  if (teacher_id != null && !db.prepare('SELECT 1 FROM teachers WHERE id = ? AND active = 1').get(teacher_id)) return bad(res, 'Teacher not found.');
  db.prepare('UPDATE sections SET class_teacher_id = ? WHERE id = ?').run(teacher_id ?? null, section_id);
  res.json({ ok: true });
});

/** Sections the logged-in person can mark daily attendance for. */
attendanceRouter.get('/my-sections', (req, res) => {
  const all = isManager(req.user!) || teacherOpen();
  const where = all ? '' : 'WHERE s.class_teacher_id = ?';
  const params = all ? [] : [myTeacherId(req.user!.id) ?? -1];
  res.json(db.prepare(`SELECT s.id, s.name AS section_name, c.id AS class_id, c.name AS class_name, c.grade FROM sections s JOIN classes c ON c.id = s.class_id ${where} ORDER BY c.grade, s.name`).all(...params));
});

// ---------- daily register ----------
attendanceRouter.get('/daily', (req, res) => {
  const sectionId = Number(req.query.sectionId), date = isDate(req.query.date) ? String(req.query.date) : todayISO();
  if (!sectionLabel(sectionId)) return bad(res, 'Section not found.', 404);
  if (!canMark(req.user!, sectionId)) return bad(res, 'You can only mark attendance for your own class.', 403);
  const students = sectionStudents(sectionId);
  const recs = new Map((db.prepare(`SELECT d.student_id, d.status, d.note, d.marked_at, u.name AS by FROM att_daily d LEFT JOIN users u ON u.id = d.marked_by
    WHERE d.date = ? AND d.student_id IN (SELECT id FROM students WHERE section_id = ?)`).all(date, sectionId) as any[]).map(r => [r.student_id, r]));
  const leaves = new Map((db.prepare("SELECT student_id, reason FROM att_leaves WHERE status = 'approved' AND from_date <= ? AND to_date >= ?").all(date, date) as any[]).map(r => [r.student_id, r.reason]));
  const info = dayInfo(date), rule = dateRule(req.user!, date);
  const first = [...recs.values()][0];
  res.json({
    section: sectionLabel(sectionId),
    meta: { date, working: info.working, holiday: info.holiday, weekOff: info.off, marked: recs.size > 0, markedBy: first?.by ?? null, markedAt: first?.marked_at ?? null, canEdit: rule.ok, lockReason: rule.reason ?? null },
    students: students.map(s => ({ ...s, status: recs.get(s.id)?.status ?? null, note: recs.get(s.id)?.note ?? '', onLeave: leaves.has(s.id) ? (leaves.get(s.id) || 'Leave') : null }))
  });
});

attendanceRouter.post('/daily', (req, res) => {
  const { section_id, date, entries, force } = req.body ?? {};
  if (!isDate(date)) return bad(res, 'Choose a date.');
  if (!sectionLabel(section_id)) return bad(res, 'Section not found.', 404);
  if (!canMark(req.user!, section_id)) return bad(res, 'You can only mark attendance for your own class.', 403);
  const rule = dateRule(req.user!, date); if (!rule.ok) return bad(res, rule.reason!, 403);
  const info = dayInfo(date);
  if (!info.working && !(force && isManager(req.user!))) return bad(res, info.holiday ? `${date} is a holiday (${info.holiday}). Attendance is not taken.` : 'That day is a weekly off. Attendance is not taken.', 409);
  const valid = new Set(sectionStudents(section_id).map(s => s.id));
  const list = (Array.isArray(entries) ? entries : []).filter((e: any) => valid.has(e.student_id));
  if (!list.length) return bad(res, 'There are no students to save.');
  if (list.some((e: any) => !STATUSES.includes(e.status))) return bad(res, 'Every student needs a status.');
  const up = db.prepare(`INSERT INTO att_daily (student_id, date, status, note, marked_by) VALUES (?,?,?,?,?)
    ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = datetime('now'), leave_id = NULL`);
  db.transaction(() => { for (const e of list) up.run(e.student_id, date, e.status, String(e.note ?? '').trim().slice(0, 80) || null, req.user!.id); })();
  const c: Record<string, number> = { P: 0, A: 0, L: 0, LT: 0 }; for (const e of list) c[e.status]++;
  res.json({ saved: list.length, counts: c });
});

/** If only period attendance was taken, build the daily register from it. */
attendanceRouter.post('/daily/fill-from-periods', (req, res) => {
  const { section_id, date } = req.body ?? {};
  if (!isDate(date) || !sectionLabel(section_id)) return bad(res, 'Choose a section and date.');
  if (!canMark(req.user!, section_id)) return bad(res, 'You can only mark attendance for your own class.', 403);
  const rule = dateRule(req.user!, date); if (!rule.ok) return bad(res, rule.reason!, 403);
  const rows = db.prepare(`SELECT ap.student_id, ap.status FROM att_period ap JOIN students st ON st.id = ap.student_id
    WHERE st.section_id = ? AND ap.date = ? AND ap.student_id NOT IN (SELECT student_id FROM att_daily WHERE date = ?)`).all(section_id, date, date) as any[];
  const by = new Map<number, string[]>();
  for (const r of rows) (by.get(r.student_id) ?? by.set(r.student_id, []).get(r.student_id)!).push(r.status);
  let n = 0;
  db.transaction(() => {
    for (const [sid, st] of by) {
      const present = st.filter(x => x === 'P' || x === 'LT').length, leave = st.filter(x => x === 'L').length;
      const status = present * 2 >= st.length ? (st.includes('LT') && present === st.filter(x => x === 'LT').length ? 'LT' : 'P') : leave * 2 >= st.length ? 'L' : 'A';
      db.prepare("INSERT INTO att_daily (student_id, date, status, note, marked_by) VALUES (?,?,?,'From period attendance',?)").run(sid, date, status, req.user!.id); n++;
    }
  })();
  res.json({ filled: n });
});

// ---------- period by period ----------
function slotAt(sectionId: number, date: string, period: number) {
  return db.prepare(`SELECT ts.teacher_id, ts.subject_id, sub.name AS subject_name, t.name AS teacher_name
    FROM tt_slots ts JOIN subjects sub ON sub.id = ts.subject_id JOIN teachers t ON t.id = ts.teacher_id
    WHERE ts.section_id = ? AND ts.day = ? AND ts.period = ?`).get(sectionId, dowOf(date), period) as any;
}

attendanceRouter.get('/my-lessons', (req, res) => {
  const date = isDate(req.query.date) ? String(req.query.date) : todayISO();
  const teacherId = isManager(req.user!) ? Number(req.query.teacherId) || null : myTeacherId(req.user!.id);
  if (!teacherId) return res.json({ lessons: [], note: isManager(req.user!) ? 'Choose a teacher.' : 'Your login is not linked to a teacher record. Ask the office.' });
  const times = periodTimes(getSettings());
  const lessons = (db.prepare(`SELECT ts.section_id, ts.period, ts.subject_id, sub.name AS subject_name, c.name AS class_name, sec.name AS section_name
    FROM tt_slots ts JOIN subjects sub ON sub.id = ts.subject_id JOIN sections sec ON sec.id = ts.section_id JOIN classes c ON c.id = sec.class_id
    WHERE ts.teacher_id = ? AND ts.day = ? ORDER BY ts.period`).all(teacherId, dowOf(date)) as any[]).map(l => ({
    ...l, time: startOf(l.section_id, l.period) ?? '',
    marked: (db.prepare('SELECT COUNT(*) AS n FROM att_period ap JOIN students st ON st.id = ap.student_id WHERE st.section_id = ? AND ap.date = ? AND ap.period = ?').get(l.section_id, date, l.period) as any).n,
    total: (db.prepare("SELECT COUNT(*) AS n FROM students WHERE section_id = ? AND status = 'active'").get(l.section_id) as any).n
  }));
  const info = dayInfo(date);
  res.json({ lessons, holiday: info.holiday, weekOff: info.off, teacher: db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(teacherId) });
});

attendanceRouter.get('/period', (req, res) => {
  const sectionId = Number(req.query.sectionId), period = Number(req.query.period), date = isDate(req.query.date) ? String(req.query.date) : todayISO();
  if (!sectionLabel(sectionId)) return bad(res, 'Section not found.', 404);
  const slot = slotAt(sectionId, date, period);
  const me = myTeacherId(req.user!.id);
  const mayMark = isManager(req.user!) || (!!slot && slot.teacher_id === me);
  if (!mayMark && !canMark(req.user!, sectionId)) return bad(res, 'This is not your lesson.', 403);
  const students = sectionStudents(sectionId);
  const recs = new Map((db.prepare('SELECT ap.student_id, ap.status FROM att_period ap JOIN students st ON st.id = ap.student_id WHERE st.section_id = ? AND ap.date = ? AND ap.period = ?').all(sectionId, date, period) as any[]).map(r => [r.student_id, r.status]));
  const daily = new Map((db.prepare('SELECT d.student_id, d.status FROM att_daily d JOIN students st ON st.id = d.student_id WHERE st.section_id = ? AND d.date = ?').all(sectionId, date) as any[]).map(r => [r.student_id, r.status]));
  const rule = dateRule(req.user!, date), info = dayInfo(date);
  res.json({
    section: sectionLabel(sectionId), period, subject: slot ? { id: slot.subject_id, name: slot.subject_name } : null, teacher: slot?.teacher_name ?? null,
    meta: { date, marked: recs.size > 0, working: info.working, holiday: info.holiday, canEdit: mayMark && rule.ok, lockReason: !mayMark ? 'Only the lesson teacher or the office can mark this period.' : rule.reason ?? null },
    // not marked yet: start from the morning register (absent/leave carry over), everyone else present
    students: students.map(s => ({ ...s, note: '', onLeave: null, status: recs.get(s.id) ?? (['A', 'L'].includes(daily.get(s.id)) ? daily.get(s.id) : null) }))
  });
});

attendanceRouter.post('/period', (req, res) => {
  const { section_id, date, period, entries } = req.body ?? {};
  if (!isDate(date) || !sectionLabel(section_id) || !Number.isInteger(period)) return bad(res, 'Choose a date, section and period.');
  const slot = slotAt(section_id, date, period), me = myTeacherId(req.user!.id);
  if (!isManager(req.user!) && !(slot && slot.teacher_id === me)) return bad(res, 'Only the lesson teacher or the office can mark this period.', 403);
  const rule = dateRule(req.user!, date); if (!rule.ok) return bad(res, rule.reason!, 403);
  const info = dayInfo(date); if (!info.working) return bad(res, info.holiday ? `${date} is a holiday (${info.holiday}).` : 'That day is a weekly off.', 409);
  const valid = new Set(sectionStudents(section_id).map(s => s.id));
  const list = (Array.isArray(entries) ? entries : []).filter((e: any) => valid.has(e.student_id));
  if (!list.length || list.some((e: any) => !STATUSES.includes(e.status))) return bad(res, 'Every student needs a status.');
  const subjectId = slot?.subject_id ?? (Number(req.body.subject_id) || null), teacherId = slot?.teacher_id ?? me;
  const up = db.prepare(`INSERT INTO att_period (student_id, date, period, subject_id, teacher_id, status, marked_by) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(student_id, date, period) DO UPDATE SET status = excluded.status, subject_id = excluded.subject_id, teacher_id = excluded.teacher_id, marked_by = excluded.marked_by, marked_at = datetime('now')`);
  db.transaction(() => { for (const e of list) up.run(e.student_id, date, period, subjectId, teacherId, e.status, req.user!.id); })();
  res.json({ saved: list.length });
});

// ---------- the monthly register and its shortcuts ----------
function loadMonth(sectionId: number, month: string) {
  const days = monthDays(month), today = todayISO();
  const students = sectionStudents(sectionId);
  const marks = new Map<number, Record<string, string>>();
  for (const r of db.prepare(`SELECT student_id, date, status FROM att_daily WHERE date BETWEEN ? AND ? AND student_id IN (SELECT id FROM students WHERE section_id = ?)`).all(`${month}-01`, `${month}-31`, sectionId) as any[])
    (marks.get(r.student_id) ?? marks.set(r.student_id, {}).get(r.student_id)!)[r.date] = r.status;
  const stats = monthStats(students.map(s => s.id), month);
  const totals = new Map((db.prepare('SELECT * FROM att_month_totals WHERE month = ? AND student_id IN (SELECT id FROM students WHERE section_id = ?)').all(month, sectionId) as any[]).map(r => [r.student_id, r]));
  return {
    month, section: sectionLabel(sectionId), workingDays: workingDates(month, today).length,
    days: days.map(d => ({ ...d, future: d.date > today })),
    students: students.map(s => ({ ...s, marks: marks.get(s.id) ?? {}, stats: stats.get(s.id)!, totals: totals.get(s.id) ?? null }))
  };
}

attendanceRouter.get('/month', (req, res) => {
  const sectionId = Number(req.query.sectionId), month = String(req.query.month);
  if (!isMonth(month) || !sectionLabel(sectionId)) return bad(res, 'Choose a month and a section.');
  if (!canMark(req.user!, sectionId)) return bad(res, 'You can only open your own class.', 403);
  res.json(loadMonth(sectionId, month));
});

function monthGuard(req: any, res: any): { sectionId: number; month: string } | null {
  const sectionId = Number(req.body?.section_id), month = String(req.body?.month);
  if (!isMonth(month) || !sectionLabel(sectionId)) { bad(res, 'Choose a month and a section.'); return null; }
  if (!canMark(req.user!, sectionId)) { bad(res, 'You can only change your own class.', 403); return null; }
  const last = workingDates(month).pop();
  if (!isManager(req.user!) && last && last < addDays(todayISO(), -attConfig().edit_days) && monthOf(todayISO()) !== month) { bad(res, 'This month is locked for teachers. Ask the office.', 403); return null; }
  return { sectionId, month };
}

/** Edits of single cells in the register grid. status null = clear. */
attendanceRouter.post('/month/cells', (req, res) => {
  const g = monthGuard(req, res); if (!g) return;
  const valid = new Set(sectionStudents(g.sectionId).map(s => s.id));
  const days = new Map(monthDays(g.month).map(d => [d.date, d])), today = todayISO();
  const changes = (Array.isArray(req.body.changes) ? req.body.changes : []).slice(0, 6000);
  let n = 0;
  const up = db.prepare(`INSERT INTO att_daily (student_id, date, status, marked_by) VALUES (?,?,?,?)
    ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by, marked_at = datetime('now'), leave_id = NULL`);
  db.transaction(() => {
    for (const c of changes) {
      const d = days.get(c.date);
      if (!valid.has(c.student_id) || !d || !d.working || d.date > today) continue;
      if (c.status === null) db.prepare('DELETE FROM att_daily WHERE student_id = ? AND date = ?').run(c.student_id, c.date);
      else if (STATUSES.includes(c.status)) up.run(c.student_id, c.date, c.status, req.user!.id);
      else continue;
      n++;
    }
  })();
  res.json({ changed: n });
});

/** THE SHORTCUT: type only the absent / leave / late days, every other school day becomes Present. */
attendanceRouter.post('/month/quick', (req, res) => {
  const g = monthGuard(req, res); if (!g) return;
  const valid = new Set(sectionStudents(g.sectionId).map(s => s.id));
  const wd = workingDates(g.month);
  if (!wd.length) return bad(res, 'There are no school days to mark in this month yet.');
  const dateOf = (n: number) => `${g.month}-${String(n).padStart(2, '0')}`;
  const up = db.prepare(`INSERT INTO att_daily (student_id, date, status, marked_by) VALUES (?,?,?,?)
    ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by, marked_at = datetime('now'), leave_id = NULL`);
  const ignored: { student_id: number; day: number }[] = [];
  let students = 0;
  db.transaction(() => {
    for (const r of (Array.isArray(req.body.rows) ? req.body.rows : [])) {
      if (!valid.has(r.student_id)) continue;
      const set = (arr: unknown) => new Set((Array.isArray(arr) ? arr : []).map(Number));
      const A = set(r.absent), L = set(r.leave), T = set(r.late);
      for (const d of [...A, ...L, ...T]) if (!wd.includes(dateOf(d))) ignored.push({ student_id: r.student_id, day: d });
      for (const date of wd) {
        const day = Number(date.slice(8, 10));
        up.run(r.student_id, date, A.has(day) ? 'A' : L.has(day) ? 'L' : T.has(day) ? 'LT' : 'P', req.user!.id);
      }
      students++;
    }
  })();
  res.json({ students, days: wd.length, ignored });
});

/** Second shortcut: only the month's totals are known. */
attendanceRouter.post('/month/totals', (req, res) => {
  const g = monthGuard(req, res); if (!g) return;
  const valid = new Set(sectionStudents(g.sectionId).map(s => s.id));
  const rows = (Array.isArray(req.body.rows) ? req.body.rows : []).filter((r: any) => valid.has(r.student_id));
  for (const r of rows) {
    r.late = r.late ?? 0;
    for (const k of ['working_days', 'present', 'absent', 'leave', 'late'] as const) if (!(Number.isInteger(Number(r[k])) && Number(r[k]) >= 0 && Number(r[k]) <= 31)) return bad(res, 'Totals must be whole numbers from 0 to 31.');
    if (Number(r.present) + Number(r.absent) + Number(r.leave) + Number(r.late) > Number(r.working_days)) return bad(res, 'Present + absent + leave + late is more than the working days for one of the students.');
  }
  const up = db.prepare(`INSERT INTO att_month_totals (student_id, month, working_days, present, absent, leave, late, entered_by) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(student_id, month) DO UPDATE SET working_days = excluded.working_days, present = excluded.present, absent = excluded.absent, leave = excluded.leave, late = excluded.late, entered_by = excluded.entered_by, updated_at = datetime('now')`);
  db.transaction(() => { for (const r of rows) up.run(r.student_id, g.month, int(r.working_days), int(r.present), int(r.absent), int(r.leave), int(r.late ?? 0), req.user!.id); })();
  res.json({ saved: rows.length });
});

// ---------- leave applications ----------
attendanceRouter.get('/students/search', manage, (req, res) => {
  const q = String(req.query.q ?? '').trim(); if (!q) return res.json([]);
  const l = `%${q}%`;
  res.json(db.prepare(`SELECT st.id, st.name, st.father_name, st.roll_no, st.reg_no, c.name AS class_name, s.name AS section_name FROM students st
    JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
    WHERE st.status = 'active' AND (st.name LIKE ? OR st.father_name LIKE ? OR st.reg_no LIKE ? OR CAST(st.roll_no AS TEXT) = ?) ORDER BY st.name LIMIT 12`).all(l, l, l, q));
});

attendanceRouter.get('/leaves', manage, (req, res) => {
  const status = String(req.query.status ?? '');
  const where = ['1=1']; const params: any[] = [];
  if (['pending', 'approved', 'rejected'].includes(status)) { where.push('l.status = ?'); params.push(status); }
  if (req.query.studentId) { where.push('l.student_id = ?'); params.push(Number(req.query.studentId)); }
  res.json(db.prepare(`SELECT l.*, st.name, st.father_name, st.roll_no, c.name AS class_name, s.name AS section_name FROM att_leaves l
    JOIN students st ON st.id = l.student_id JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
    WHERE ${where.join(' AND ')} ORDER BY l.from_date DESC, l.id DESC LIMIT 300`).all(...params));
});

attendanceRouter.post('/leaves', manage, (req, res) => {
  const b = req.body ?? {};
  if (!db.prepare("SELECT 1 FROM students WHERE id = ? AND status = 'active'").get(b.student_id)) return bad(res, 'Choose a student.');
  if (!isDate(b.from_date) || !isDate(b.to_date) || b.to_date < b.from_date) return bad(res, 'Enter the leave dates (the last day cannot be before the first).');
  if (dateRange(b.from_date, b.to_date).length > 120) return bad(res, 'A leave cannot be longer than 120 days.');
  const kind = ['sick', 'casual', 'family', 'other'].includes(b.kind) ? b.kind : 'casual';
  const status = b.status === 'pending' ? 'pending' : 'approved';
  const id = Number(db.prepare('INSERT INTO att_leaves (student_id, from_date, to_date, kind, reason, status, applied_by, decided_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(b.student_id, b.from_date, b.to_date, kind, String(b.reason ?? '').trim().slice(0, 120) || null, status, req.user!.id, status === 'approved' ? req.user!.id : null).lastInsertRowid);
  const marked = status === 'approved' ? applyLeave(id, req.user!.id) : 0;
  res.status(201).json({ id, marked });
});

attendanceRouter.put('/leaves/:id/status', manage, (req, res) => {
  const id = Number(req.params.id), status = String(req.body?.status);
  if (!['approved', 'rejected', 'pending'].includes(status)) return bad(res, 'Choose approve or reject.');
  const l = db.prepare('SELECT status FROM att_leaves WHERE id = ?').get(id) as any;
  if (!l) return bad(res, 'Leave not found.', 404);
  removeLeaveMarks(id);
  db.prepare('UPDATE att_leaves SET status = ?, decided_by = ? WHERE id = ?').run(status, req.user!.id, id);
  res.json({ marked: status === 'approved' ? applyLeave(id, req.user!.id) : 0 });
});
attendanceRouter.delete('/leaves/:id', manage, (req, res) => {
  removeLeaveMarks(Number(req.params.id)); db.prepare('DELETE FROM att_leaves WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true });
});

// ---------- dashboard ----------
attendanceRouter.get('/dashboard', manage, (req, res) => {
  const date = isDate(req.query.date) ? String(req.query.date) : todayISO();
  const info = dayInfo(date);
  const sections = db.prepare(`SELECT sec.id, c.name AS class_name, c.grade, sec.name AS section_name, t.name AS class_teacher,
      COUNT(st.id) AS total, COUNT(d.student_id) AS marked,
      COALESCE(SUM(d.status = 'P'), 0) AS present, COALESCE(SUM(d.status = 'LT'), 0) AS late, COALESCE(SUM(d.status = 'A'), 0) AS absent, COALESCE(SUM(d.status = 'L'), 0) AS leave
    FROM sections sec JOIN classes c ON c.id = sec.class_id LEFT JOIN teachers t ON t.id = sec.class_teacher_id
    LEFT JOIN students st ON st.section_id = sec.id AND st.status = 'active' LEFT JOIN att_daily d ON d.student_id = st.id AND d.date = ?
    GROUP BY sec.id ORDER BY c.grade, sec.name`).all(date) as any[];
  const sum = (k: string) => sections.reduce((a, s) => a + s[k], 0);
  // period attendance still to do (only periods that have already started when looking at today)
  const times = periodTimes(getSettings()), now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const slots = (db.prepare(`SELECT ts.section_id, ts.period, t.name AS teacher_name, sub.name AS subject_name, c.name AS class_name, sec.name AS section_name,
      (SELECT COUNT(*) FROM att_period ap JOIN students st ON st.id = ap.student_id WHERE st.section_id = ts.section_id AND ap.date = ? AND ap.period = ts.period) AS n
    FROM tt_slots ts JOIN teachers t ON t.id = ts.teacher_id JOIN subjects sub ON sub.id = ts.subject_id JOIN sections sec ON sec.id = ts.section_id JOIN classes c ON c.id = sec.class_id
    WHERE ts.day = ?`).all(date, dowOf(date)) as any[]).filter(s => date < todayISO() || (date === todayISO() && (startOf(s.section_id, s.period) ?? '99') <= hhmm));
  const pending = slots.filter(s => !s.n);
  const byTeacher = new Map<string, number>();
  for (const p of pending) byTeacher.set(p.teacher_name, (byTeacher.get(p.teacher_name) ?? 0) + 1);
  res.json({
    date, working: info.working, holiday: info.holiday, weekOff: info.off, sections,
    totals: { students: sum('total'), marked: sum('marked'), present: sum('present'), late: sum('late'), absent: sum('absent'), leave: sum('leave') },
    periods: { scheduled: slots.length, marked: slots.length - pending.length, pendingByTeacher: [...byTeacher].map(([teacher, n]) => ({ teacher, n })).sort((a, b) => b.n - a.n).slice(0, 12) }
  });
});

// ---------- reports and analysis ----------
function scopeStudents(classId?: number, sectionId?: number) {
  const where = ["st.status = 'active'"]; const p: any[] = [];
  if (sectionId) { where.push('s.id = ?'); p.push(sectionId); } else if (classId) { where.push('c.id = ?'); p.push(classId); }
  return db.prepare(`SELECT st.id, st.name, st.father_name, st.phone, st.roll_no, st.reg_no, s.id AS section_id, s.name AS section_name, c.id AS class_id, c.name AS class_name, c.grade
    FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE ${where.join(' AND ')} ORDER BY c.grade, s.name, st.roll_no, st.name`).all(...p) as any[];
}
const sumStats = (list: Stats[]) => {
  const t = { present: 0, late: 0, absent: 0, leave: 0 };
  for (const s of list) { t.present += s.present; t.late += s.late; t.absent += s.absent; t.leave += s.leave; }
  return { ...t, recorded: t.present + t.late + t.absent + t.leave, pct: pctOf(t) };
};

/** Section by section summary (and student rows when a class or section is chosen). */
attendanceRouter.get('/reports/month', manage, (req, res) => {
  const month = String(req.query.month); if (!isMonth(month)) return bad(res, 'Choose a month.');
  const classId = Number(req.query.classId) || undefined, sectionId = Number(req.query.sectionId) || undefined;
  const students = scopeStudents(classId, sectionId), stats = monthStats(students.map(s => s.id), month), low = attConfig().low_pct;
  const secs = new Map<number, any>();
  for (const s of students) {
    const e = secs.get(s.section_id) ?? secs.set(s.section_id, { section_id: s.section_id, class_name: s.class_name, section_name: s.section_name, grade: s.grade, students: 0, list: [] as Stats[], low: 0 }).get(s.section_id);
    const st = stats.get(s.id)!; e.students++; e.list.push(st); if (st.pct !== null && st.pct < low) e.low++;
  }
  res.json({
    month, workingDays: workingDates(month).length, lowPct: low,
    sections: [...secs.values()].map(({ list, ...e }) => ({ ...e, ...sumStats(list) })),
    students: classId || sectionId ? students.map(s => ({ ...s, ...stats.get(s.id)! })) : [],
    overall: sumStats([...stats.values()])
  });
});

attendanceRouter.get('/reports/analysis', manage, (req, res) => {
  const month = String(req.query.month); if (!isMonth(month)) return bad(res, 'Choose a month.');
  const classId = Number(req.query.classId) || undefined, sectionId = Number(req.query.sectionId) || undefined;
  const students = scopeStudents(classId, sectionId), ids = students.map(s => s.id), cfg = attConfig();
  const byId = new Map(students.map(s => [s.id, s])), stats = monthStats(ids, month);
  const first = `${month}-01`, last = `${month}-31`, today = todayISO();
  const inList = (arr: number[]) => arr.map(() => '?').join(',');
  const days = monthDays(month);

  // day-by-day records of this month
  const rows: { student_id: number; date: string; status: string }[] = [];
  for (let i = 0; i < ids.length; i += 500) { const c = ids.slice(i, i + 500); rows.push(...db.prepare(`SELECT student_id, date, status FROM att_daily WHERE date BETWEEN ? AND ? AND date <= ? AND student_id IN (${inList(c)})`).all(first, last, today, ...c) as any[]); }

  const weekday = [1, 2, 3, 4, 5, 6, 7].map(dow => {
    const t = { present: 0, late: 0, absent: 0, leave: 0 };
    for (const r of rows) if (dowOf(r.date) === dow) { if (r.status === 'P') t.present++; else if (r.status === 'LT') t.late++; else if (r.status === 'A') t.absent++; else t.leave++; }
    return { dow, ...t, pct: pctOf(t) };
  }).filter(w => w.pct !== null);

  const perDay = days.filter(d => d.working && d.date <= today).map(d => {
    const t = { present: 0, late: 0, absent: 0, leave: 0 };
    for (const r of rows) if (r.date === d.date) { if (r.status === 'P') t.present++; else if (r.status === 'LT') t.late++; else if (r.status === 'A') t.absent++; else t.leave++; }
    return { date: d.date, ...t, pct: pctOf(t) };
  }).filter(d => d.pct !== null);

  const trend = [-5, -4, -3, -2, -1, 0].map(n => { const m = addMonths(month, n); return { month: m, ...sumStats([...monthStats(ids, m).values()]) }; }).filter(t => t.recorded > 0);

  const byClass = !classId && !sectionId ? [...new Set(students.map(s => s.class_id))].map(cid => {
    const g = students.filter(s => s.class_id === cid);
    return { class_name: g[0].class_name, grade: g[0].grade, students: g.length, ...sumStats(g.map(s => stats.get(s.id)!)) };
  }).sort((a, b) => a.grade - b.grade) : [];

  const ranked = students.map(s => ({ ...s, ...stats.get(s.id)! }));
  const lowList = ranked.filter(s => s.pct !== null && s.recorded >= 3 && s.pct < cfg.low_pct).sort((a, b) => a.pct! - b.pct!).slice(0, 60);
  const topAbsent = ranked.filter(s => s.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, 10);

  // students absent on 3 or more school days in a row
  const dates = days.filter(d => d.working && d.date <= today).map(d => d.date);
  const stat = new Map<number, Map<string, string>>();
  for (const r of rows) (stat.get(r.student_id) ?? stat.set(r.student_id, new Map()).get(r.student_id)!).set(r.date, r.status);
  const streaks: any[] = [];
  for (const [sid, m] of stat) {
    let run: string[] = [];
    const flush = () => { if (run.length >= 3) streaks.push({ ...byId.get(sid), days: run.length, from: run[0], to: run[run.length - 1] }); run = []; };
    for (const d of dates) { if (m.get(d) === 'A') run.push(d); else if (m.has(d)) flush(); }
    flush();
  }
  streaks.sort((a, b) => b.days - a.days);

  // period data (subject teachers) for the same students and month
  const prow: any[] = [];
  for (let i = 0; i < ids.length; i += 500) { const c = ids.slice(i, i + 500); prow.push(...db.prepare(`SELECT ap.student_id, ap.date, ap.period, ap.status, sub.name AS subject FROM att_period ap LEFT JOIN subjects sub ON sub.id = ap.subject_id
    WHERE ap.date BETWEEN ? AND ? AND ap.student_id IN (${inList(c)})`).all(first, last, ...c) as any[]); }
  const group = (key: (r: any) => string | number) => { const g = new Map<string | number, { present: number; late: number; absent: number; leave: number }>(); for (const r of prow) { const k = key(r); const t = g.get(k) ?? g.set(k, { present: 0, late: 0, absent: 0, leave: 0 }).get(k)!; if (r.status === 'P') t.present++; else if (r.status === 'LT') t.late++; else if (r.status === 'A') t.absent++; else t.leave++; } return g; };
  const periodWise = [...group(r => r.period)].map(([period, t]) => ({ period: Number(period), ...t, pct: pctOf(t) })).sort((a, b) => a.period - b.period);
  const subjectWise = [...group(r => r.subject ?? 'Other')].map(([subject, t]) => ({ subject: String(subject), ...t, pct: pctOf(t) })).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
  // "bunking": present in the morning register but absent in a period
  const bunk = new Map<number, number>();
  for (const r of prow) if (r.status === 'A' && ['P', 'LT'].includes(stat.get(r.student_id)?.get(r.date) ?? '')) bunk.set(r.student_id, (bunk.get(r.student_id) ?? 0) + 1);
  const bunking = [...bunk].map(([sid, n]) => ({ ...byId.get(sid), missed_periods: n })).sort((a, b) => b.missed_periods - a.missed_periods).slice(0, 15);

  res.json({ month, lowPct: cfg.low_pct, overall: sumStats([...stats.values()]), weekday, perDay, trend, byClass, lowList, topAbsent, streaks: streaks.slice(0, 30), periodWise, subjectWise, bunking });
});

attendanceRouter.get('/reports/student/:id', (req, res) => {
  const id = Number(req.params.id);
  const st = db.prepare(`SELECT st.id, st.name, st.father_name, st.gender, st.phone, st.roll_no, st.reg_no, st.section_id, c.name AS class_name, s.name AS section_name FROM students st
    JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE st.id = ?`).get(id) as any;
  if (!st) return bad(res, 'Student not found.', 404);
  if (!canSection(req.user!, st.section_id)) return bad(res, 'You can only open students of your own class.', 403);
  const month = isMonth(req.query.month) ? String(req.query.month) : monthOf(todayISO());
  const months = [-11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0].map(n => { const m = addMonths(month, n); return { month: m, ...monthStats([id], m).get(id)! }; }).filter(m => m.source !== 'none');
  const recs = new Map((db.prepare('SELECT date, status, note FROM att_daily WHERE student_id = ? AND date BETWEEN ? AND ?').all(id, `${month}-01`, `${month}-31`) as any[]).map(r => [r.date, r]));
  const subjects = (db.prepare(`SELECT COALESCE(sub.name, 'Other') AS subject, SUM(ap.status IN ('P','LT')) AS present, SUM(ap.status = 'A') AS absent, SUM(ap.status = 'L') AS leave, COUNT(*) AS total
    FROM att_period ap LEFT JOIN subjects sub ON sub.id = ap.subject_id WHERE ap.student_id = ? GROUP BY sub.id`).all(id) as any[]).map(r => ({ ...r, pct: r.total ? Math.round((r.present / r.total) * 1000) / 10 : null }));
  const total = months.reduce((a, m) => ({ present: a.present + m.present, late: a.late + m.late, absent: a.absent + m.absent, leave: a.leave + m.leave }), { present: 0, late: 0, absent: 0, leave: 0 });
  res.json({
    student: st, month, lowPct: attConfig().low_pct, months, overall: { ...total, pct: pctOf(total) },
    calendar: monthDays(month).map(d => ({ ...d, status: recs.get(d.date)?.status ?? null, note: recs.get(d.date)?.note ?? null, future: d.date > todayISO() })),
    subjects, leaves: db.prepare('SELECT id, from_date, to_date, kind, reason, status FROM att_leaves WHERE student_id = ? ORDER BY from_date DESC LIMIT 20').all(id)
  });
});
