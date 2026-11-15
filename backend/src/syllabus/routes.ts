import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, setSetting } from '../db.js';
import { requireRole } from '../auth.js';
import { isDate, isManager, myTeacherId, todayISO, addDays } from '../attendance/service.js';
import { examConfig } from '../exam/service.js';
import { KINDS, calendar, canEditPlan, canTrack, coverage, insertItems, isMonth, monthLabel, monthsBetween, parseDocx, planRow, planToDocx, qualified, snapshot, sylConfig, touch, uploadDir, weekOf, weekRange } from './service.js';

export const syllabusRouter = Router();
syllabusRouter.use(requireRole('director', 'principal', 'admin', 'teacher'));
const office = requireRole('director', 'principal', 'admin');
const leadership = requireRole('director', 'principal');
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const raw = express.raw({ type: () => true, limit: '12mb' });

// ---------- calendar and settings ----------
syllabusRouter.get('/config', (_req, res) => {
  const c = sylConfig(), today = todayISO(), cur = weekOf(today);
  res.json({ ...c, months: monthsBetween(c.start, c.end), today, currentMonth: cur.month, currentWeek: cur.week, kinds: KINDS });
});
syllabusRouter.put('/config', leadership, (req, res) => {
  const { start, end } = req.body ?? {};
  if (!isDate(start) || !isDate(end) || end <= start) return bad(res, 'Enter the first and last day of the session (the last day must come after the first).');
  if (monthsBetween(start, end).length > 18) return bad(res, 'A session can be at most 18 months long.');
  setSetting('syl_start', start); setSetting('syl_end', end); res.json(sylConfig());
});
syllabusRouter.get('/calendar', (_req, res) => res.json(calendar()));

syllabusRouter.post('/events', office, (req, res) => {
  const b = req.body ?? {}, title = String(b.title ?? '').trim().slice(0, 80);
  if (!isDate(b.date) || (b.to_date && !isDate(b.to_date)) || (b.to_date && b.to_date < b.date)) return bad(res, 'Enter valid dates.');
  if (!title) return bad(res, 'Enter the name of the event.');
  const id = Number(db.prepare('INSERT INTO syl_events (date, to_date, title, kind) VALUES (?,?,?,?)').run(b.date, b.to_date || b.date, title, ['event', 'ptm', 'activity', 'deadline'].includes(b.kind) ? b.kind : 'event').lastInsertRowid);
  res.status(201).json({ id });
});
syllabusRouter.delete('/events/:id', office, (req, res) => { db.prepare('DELETE FROM syl_events WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// ---------- plans ----------
syllabusRouter.get('/subjects', (req, res) => {
  const t = myTeacherId(req.user!.id);
  res.json(isManager(req.user!) ? db.prepare('SELECT id, name FROM subjects ORDER BY name').all()
    : db.prepare('SELECT s.id, s.name FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id WHERE ts.teacher_id = ? ORDER BY s.name').all(t ?? -1));
});

syllabusRouter.get('/plans', (req, res) => {
  const q = req.query as Record<string, string | undefined>, where = ['p.session = ?']; const p: any[] = [q.session || sylConfig().session];
  if (q.classId) { where.push('p.class_id = ?'); p.push(Number(q.classId)); }
  if (q.subjectId) { where.push('p.subject_id = ?'); p.push(Number(q.subjectId)); }
  if (q.status) { where.push('p.status = ?'); p.push(q.status); }
  res.json(db.prepare(`SELECT p.id, p.status, p.updated_at, p.class_id, p.subject_id, c.name AS class_name, c.grade, sub.name AS subject, u.name AS author,
      (SELECT COUNT(*) FROM syl_items i WHERE i.plan_id = p.id) AS items, (SELECT COALESCE(SUM(i.periods), 0) FROM syl_items i WHERE i.plan_id = p.id) AS periods
    FROM syl_plans p JOIN classes c ON c.id = p.class_id JOIN subjects sub ON sub.id = p.subject_id LEFT JOIN users u ON u.id = p.author_id
    WHERE ${where.join(' AND ')} ORDER BY c.grade, sub.name`).all(...p));
});

syllabusRouter.post('/plans', (req, res) => {
  const classId = Number(req.body?.class_id), subjectId = Number(req.body?.subject_id), session = sylConfig().session;
  if (!db.prepare('SELECT 1 FROM classes WHERE id = ?').get(classId) || !db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(subjectId)) return bad(res, 'Choose a class and a subject.');
  if (!qualified(req.user!, subjectId)) return bad(res, 'You can make syllabus plans only for subjects you teach. Ask the office to add the subject to your profile.', 403);
  const ex = db.prepare('SELECT id FROM syl_plans WHERE session = ? AND class_id = ? AND subject_id = ?').get(session, classId, subjectId) as any;
  if (ex) return res.status(409).json({ message: 'A plan for this class and subject already exists.', id: ex.id });
  res.status(201).json({ id: Number(db.prepare('INSERT INTO syl_plans (session, class_id, subject_id, author_id) VALUES (?,?,?,?)').run(session, classId, subjectId, req.user!.id).lastInsertRowid) });
});

syllabusRouter.get('/plans/:id', (req, res) => {
  const id = Number(req.params.id), p = planRow(id); if (!p) return bad(res, 'Plan not found.', 404);
  const sections = db.prepare('SELECT s.id, s.name FROM sections s WHERE s.class_id = ? ORDER BY s.name').all(p.class_id);
  const pw = db.prepare('SELECT AVG(periods_per_week) AS n FROM section_subjects ss JOIN sections s ON s.id = ss.section_id WHERE s.class_id = ? AND ss.subject_id = ?').get(p.class_id, p.subject_id) as any;
  res.json({
    plan: p, items: db.prepare('SELECT * FROM syl_items WHERE plan_id = ? ORDER BY month, week, sort, id').all(id),
    files: db.prepare('SELECT f.id, f.name, f.size, f.created_at, u.name AS by FROM syl_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.plan_id = ? ORDER BY f.id DESC').all(id),
    versions: db.prepare('SELECT v.id, v.label, v.created_at, u.name AS by FROM syl_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.plan_id = ? ORDER BY v.id DESC LIMIT 30').all(id),
    canEdit: canEditPlan(req.user!, p), canApprove: isManager(req.user!), perWeek: pw?.n ? Math.round(pw.n * 10) / 10 : 0, sections
  });
});

syllabusRouter.put('/plans/:id', (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  if (!canEditPlan(req.user!, p)) return bad(res, p.status !== 'draft' ? 'This plan is submitted or approved. Ask the office to return it to draft.' : 'You cannot change this plan.', 403);
  const t = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n) || null;
  db.prepare("UPDATE syl_plans SET overview = ?, books = ?, assessment = ?, updated_at = datetime('now') WHERE id = ?").run(t(req.body?.overview, 3000), t(req.body?.books, 800), t(req.body?.assessment, 1500), p.id);
  res.json({ ok: true });
});

syllabusRouter.delete('/plans/:id', (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  if (!(isManager(req.user!) || (p.status === 'draft' && p.author_id === req.user!.id))) return bad(res, 'Only the office, or the author of a draft, can delete a plan.', 403);
  for (const f of db.prepare('SELECT path FROM syl_files WHERE plan_id = ?').all(p.id) as any[]) fs.rmSync(f.path, { force: true });
  db.prepare('DELETE FROM syl_plans WHERE id = ?').run(p.id); res.json({ ok: true });
});

syllabusRouter.post('/plans/:id/status', (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  const to = String(req.body?.status), note = String(req.body?.note ?? '').trim().slice(0, 300) || null, mgr = isManager(req.user!);
  const items = (db.prepare('SELECT COUNT(*) AS n FROM syl_items WHERE plan_id = ?').get(p.id) as any).n;
  if (to === 'submitted') {
    if (p.status !== 'draft' || !canEditPlan(req.user!, p)) return bad(res, 'Only a draft can be sent for approval.', 409);
    if (!items) return bad(res, 'Add at least one topic before sending the plan for approval.');
  } else if (to === 'approved') {
    if (!mgr) return bad(res, 'Only the office can approve a plan.', 403);
    if (!items) return bad(res, 'The plan has no topics yet.');
  } else if (to === 'draft') {
    if (!mgr && !(p.status === 'submitted' && qualified(req.user!, p.subject_id))) return bad(res, 'Only the office can return an approved plan to draft.', 403);
  } else return bad(res, 'Unknown status.');
  db.transaction(() => {
    db.prepare("UPDATE syl_plans SET status = ?, note = ?, approved_by = ?, approved_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(to, note, to === 'approved' ? req.user!.id : null, to === 'approved' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, p.id);
    if (to === 'approved') db.prepare('INSERT INTO syl_versions (plan_id, label, snapshot, created_by) VALUES (?,?,?,?)').run(p.id, 'Approved', snapshot(p.id), req.user!.id);
  })();
  res.json({ ok: true });
});

// ---------- topics (the week-wise plan) ----------
function itemPlan(req: any, res: any, itemId: number) {
  const it = db.prepare('SELECT * FROM syl_items WHERE id = ?').get(itemId) as any;
  if (!it) { bad(res, 'Topic not found.', 404); return null; }
  const p = planRow(it.plan_id);
  if (!canEditPlan(req.user!, p)) { bad(res, 'You cannot change this plan.', 403); return null; }
  return { it, p };
}
syllabusRouter.post('/plans/:id/items', (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  if (!canEditPlan(req.user!, p)) return bad(res, 'You cannot change this plan.', 403);
  const n = insertItems(p.id, [req.body ?? {}]); if (!n) return bad(res, 'Enter the topic, a month and a week (1 to 4).');
  touch(p.id); res.status(201).json({ ok: true });
});
syllabusRouter.put('/items/:id', (req, res) => {
  const a = itemPlan(req, res, Number(req.params.id)); if (!a) return;
  const b = req.body ?? {}, t = (v: unknown, n: number, old: any) => (v === undefined ? old : String(v).trim().slice(0, n) || null);
  const month = b.month ?? a.it.month, week = Math.round(Number(b.week ?? a.it.week)), topic = String(b.topic ?? a.it.topic).trim().slice(0, 300);
  if (!topic || !isMonth(month) || !(week >= 1 && week <= 4)) return bad(res, 'Enter the topic, a month and a week (1 to 4).');
  const moved = month !== a.it.month || week !== a.it.week;
  const sort = moved ? (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM syl_items WHERE plan_id = ? AND month = ? AND week = ?').get(a.it.plan_id, month, week) as any).n : a.it.sort;
  db.prepare('UPDATE syl_items SET month = ?, week = ?, sort = ?, kind = ?, topic = ?, chapter = ?, outcomes = ?, activities = ?, resources = ?, assessment = ?, periods = ? WHERE id = ?')
    .run(month, week, sort, KINDS.includes(b.kind) ? b.kind : a.it.kind, topic, t(b.chapter, 200, a.it.chapter), t(b.outcomes, 1500, a.it.outcomes), t(b.activities, 1500, a.it.activities), t(b.resources, 800, a.it.resources), t(b.assessment, 800, a.it.assessment),
      b.periods === undefined ? a.it.periods : (b.periods === '' || b.periods === null ? null : Math.max(0, Math.min(40, Math.round(Number(b.periods)) || 0)) || null), a.it.id);
  touch(a.it.plan_id); res.json({ ok: true });
});
syllabusRouter.delete('/items/:id', (req, res) => {
  const a = itemPlan(req, res, Number(req.params.id)); if (!a) return;
  db.prepare('DELETE FROM syl_items WHERE id = ?').run(a.it.id); touch(a.it.plan_id); res.json({ ok: true });
});
syllabusRouter.post('/plans/:id/reorder', (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  if (!canEditPlan(req.user!, p)) return bad(res, 'You cannot change this plan.', 403);
  db.transaction(() => (Array.isArray(req.body?.ids) ? req.body.ids : []).forEach((id: number, i: number) => db.prepare('UPDATE syl_items SET sort = ? WHERE id = ? AND plan_id = ?').run(i + 1, Number(id), p.id)))();
  touch(p.id); res.json({ ok: true });
});
/** Import (from Word, CSV or pasted text) and "copy from another plan". */
syllabusRouter.post('/plans/:id/items/bulk', (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  if (!canEditPlan(req.user!, p)) return bad(res, 'You cannot change this plan.', 403);
  const rows = (Array.isArray(req.body?.rows) ? req.body.rows : []).slice(0, 1500);
  let n = 0;
  db.transaction(() => { if (req.body?.mode === 'replace') db.prepare('DELETE FROM syl_items WHERE plan_id = ?').run(p.id); n = insertItems(p.id, rows); })();
  if (!n) return bad(res, 'No usable rows. Each row needs a topic, a month (like 2026-08) and a week (1 to 4).');
  touch(p.id); res.status(201).json({ imported: n, skipped: rows.length - n });
});

// ---------- versions and copying ----------
syllabusRouter.post('/plans/:id/versions', (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  if (!canEditPlan(req.user!, p)) return bad(res, 'You cannot change this plan.', 403);
  db.prepare('INSERT INTO syl_versions (plan_id, label, snapshot, created_by) VALUES (?,?,?,?)').run(p.id, String(req.body?.label ?? '').trim().slice(0, 60) || 'Saved version', snapshot(p.id), req.user!.id);
  res.status(201).json({ ok: true });
});
syllabusRouter.post('/plans/:id/restore/:vid', (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  if (!canEditPlan(req.user!, p)) return bad(res, 'You cannot change this plan.', 403);
  const v = db.prepare('SELECT snapshot FROM syl_versions WHERE id = ? AND plan_id = ?').get(Number(req.params.vid), p.id) as any;
  if (!v) return bad(res, 'Version not found.', 404);
  const s = JSON.parse(v.snapshot);
  db.transaction(() => {
    db.prepare('INSERT INTO syl_versions (plan_id, label, snapshot, created_by) VALUES (?,?,?,?)').run(p.id, 'Before restore', snapshot(p.id), req.user!.id);
    db.prepare('DELETE FROM syl_items WHERE plan_id = ?').run(p.id);
    insertItems(p.id, s.items.map((i: any) => ({ ...i })));
    db.prepare('UPDATE syl_plans SET overview = ?, books = ?, assessment = ? WHERE id = ?').run(s.plan?.overview ?? null, s.plan?.books ?? null, s.plan?.assessment ?? null, p.id);
  })();
  touch(p.id); res.json({ ok: true });
});
syllabusRouter.post('/plans/:id/copy', (req, res) => {
  const src = planRow(Number(req.params.id)); if (!src) return bad(res, 'Plan not found.', 404);
  const classId = Number(req.body?.class_id), subjectId = Number(req.body?.subject_id) || src.subject_id, session = sylConfig().session;
  if (!db.prepare('SELECT 1 FROM classes WHERE id = ?').get(classId)) return bad(res, 'Choose the class to copy to.');
  if (!qualified(req.user!, subjectId)) return bad(res, 'You can copy only into subjects you teach.', 403);
  let target = db.prepare('SELECT id, status FROM syl_plans WHERE session = ? AND class_id = ? AND subject_id = ?').get(session, classId, subjectId) as any;
  if (target && target.id === src.id) return bad(res, 'Choose a different class or subject.');
  if (!target) target = { id: Number(db.prepare('INSERT INTO syl_plans (session, class_id, subject_id, author_id, overview, books, assessment) VALUES (?,?,?,?,?,?,?)').run(session, classId, subjectId, req.user!.id, src.overview, src.books, src.assessment).lastInsertRowid), status: 'draft' };
  else if (!canEditPlan(req.user!, { ...target, subject_id: subjectId })) return bad(res, 'The plan you are copying into is not a draft.', 403);
  const items = db.prepare('SELECT month, week, sort, kind, topic, chapter, outcomes, activities, resources, assessment, periods FROM syl_items WHERE plan_id = ? ORDER BY month, week, sort').all(src.id) as any[];
  let n = 0;
  db.transaction(() => { if (req.body?.mode === 'replace') db.prepare('DELETE FROM syl_items WHERE plan_id = ?').run(target.id); n = insertItems(target.id, items); })();
  touch(target.id); res.status(201).json({ id: target.id, copied: n });
});

// ---------- files ----------
const OK_EXT = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.txt', '.csv'];
syllabusRouter.post('/plans/:id/files', raw, (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  if (!canEditPlan(req.user!, p)) return bad(res, 'You cannot change this plan.', 403);
  const name = path.basename(String(req.query.name ?? 'file')).replace(/[^\w.\- ()]/g, '_').slice(0, 100), ext = path.extname(name).toLowerCase();
  if (!OK_EXT.includes(ext)) return bad(res, 'Upload a Word, Excel, PowerPoint, PDF, image or text file.');
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || !buf.length) return bad(res, 'The file is empty.');
  const file = path.join(uploadDir(), `${p.id}-${Date.now()}-${name}`);
  fs.writeFileSync(file, buf);
  res.status(201).json({ id: Number(db.prepare('INSERT INTO syl_files (plan_id, name, mime, size, path, uploaded_by) VALUES (?,?,?,?,?,?)').run(p.id, name, String(req.headers['content-type'] ?? ''), buf.length, file, req.user!.id).lastInsertRowid) });
});
syllabusRouter.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM syl_files WHERE id = ?').get(Number(req.params.id)) as any;
  if (!f || !fs.existsSync(f.path)) return bad(res, 'File not found.', 404);
  res.download(f.path, f.name);
});
syllabusRouter.delete('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM syl_files WHERE id = ?').get(Number(req.params.id)) as any; if (!f) return bad(res, 'File not found.', 404);
  if (!canEditPlan(req.user!, planRow(f.plan_id))) return bad(res, 'You cannot change this plan.', 403);
  fs.rmSync(f.path, { force: true }); db.prepare('DELETE FROM syl_files WHERE id = ?').run(f.id); res.json({ ok: true });
});
syllabusRouter.post('/import/docx', raw, async (req, res) => {
  try { res.json(await parseDocx(req.body as Buffer)); } catch (e: any) { bad(res, e?.message === 'This is not a Word (.docx) file.' ? e.message : 'This file could not be read. Save it as a .docx Word file and try again.'); }
});
syllabusRouter.get('/plans/:id/export.docx', async (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  const buf = await planToDocx(p.id);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="Syllabus ${p.class_name} ${p.subject}.docx"`);
  res.send(buf);
});

// ---------- teaching progress ----------
syllabusRouter.get('/plans/:id/progress', (req, res) => {
  const p = planRow(Number(req.params.id)); if (!p) return bad(res, 'Plan not found.', 404);
  const sectionId = Number(req.query.sectionId);
  if (!db.prepare('SELECT 1 FROM sections WHERE id = ? AND class_id = ?').get(sectionId, p.class_id)) return bad(res, 'Choose a section of this class.');
  const prog = db.prepare('SELECT pr.item_id, pr.status, pr.done_date, pr.note FROM syl_progress pr JOIN syl_items i ON i.id = pr.item_id WHERE i.plan_id = ? AND pr.section_id = ?').all(p.id, sectionId);
  res.json({ progress: prog, coverage: coverage(p.id, [sectionId]).get(sectionId), canTrack: canTrack(req.user!, sectionId, p.subject_id) });
});
const STAT = ['pending', 'in_progress', 'done', 'skipped'];
function setProgress(user: any, itemId: number, sectionId: number, status: string, note?: string) {
  const it = db.prepare('SELECT i.id, p.subject_id, p.class_id FROM syl_items i JOIN syl_plans p ON p.id = i.plan_id WHERE i.id = ?').get(itemId) as any;
  if (!it || !db.prepare('SELECT 1 FROM sections WHERE id = ? AND class_id = ?').get(sectionId, it.class_id) || !canTrack(user, sectionId, it.subject_id)) return false;
  db.prepare(`INSERT INTO syl_progress (item_id, section_id, status, done_date, note, updated_by) VALUES (?,?,?,?,?,?)
    ON CONFLICT(item_id, section_id) DO UPDATE SET status = excluded.status, done_date = excluded.done_date, note = COALESCE(?, syl_progress.note), updated_by = excluded.updated_by, updated_at = datetime('now')`)
    .run(itemId, sectionId, status, status === 'done' ? todayISO() : null, note ?? null, user.id, note ?? null);
  return true;
}
syllabusRouter.put('/progress', (req, res) => {
  const b = req.body ?? {};
  if (!STAT.includes(b.status)) return bad(res, 'Choose a status.');
  if (!setProgress(req.user, Number(b.item_id), Number(b.section_id), b.status, b.note === undefined ? undefined : String(b.note).trim().slice(0, 200))) return bad(res, 'You can mark progress only for your own sections and subjects.', 403);
  res.json({ ok: true });
});
syllabusRouter.post('/progress/bulk', (req, res) => {
  const b = req.body ?? {};
  if (!STAT.includes(b.status)) return bad(res, 'Choose a status.');
  let n = 0;
  db.transaction(() => { for (const id of (Array.isArray(b.item_ids) ? b.item_ids : []).map(Number)) if (setProgress(req.user, id, Number(b.section_id), b.status)) n++; })();
  if (!n) return bad(res, 'You can mark progress only for your own sections and subjects.', 403);
  res.json({ updated: n });
});

syllabusRouter.get('/mine', (req, res) => {
  const teacherId = isManager(req.user!) ? Number(req.query.teacherId) || null : myTeacherId(req.user!.id);
  if (!teacherId) return res.json({ teacher: null, rows: [], note: isManager(req.user!) ? 'Choose a teacher.' : 'Your login is not linked to a teacher record. Ask the office.' });
  const session = sylConfig().session, cur = weekOf(todayISO());
  const rows = db.prepare(`SELECT ss.section_id, ss.subject_id, ss.periods_per_week, c.id AS class_id, c.name AS class_name, c.grade, sec.name AS section_name, sub.name AS subject
    FROM section_subjects ss JOIN sections sec ON sec.id = ss.section_id JOIN classes c ON c.id = sec.class_id JOIN subjects sub ON sub.id = ss.subject_id
    WHERE ss.teacher_id = ? ORDER BY c.grade, sec.name, sub.name`).all(teacherId) as any[];
  res.json({
    teacher: db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(teacherId),
    rows: rows.map(r => {
      const plan = db.prepare('SELECT id, status FROM syl_plans WHERE session = ? AND class_id = ? AND subject_id = ?').get(session, r.class_id, r.subject_id) as any;
      const thisWeek = plan ? db.prepare('SELECT id, topic, chapter FROM syl_items WHERE plan_id = ? AND month = ? AND week = ? ORDER BY sort').all(plan.id, cur.month, cur.week) : [];
      return { ...r, plan_id: plan?.id ?? null, plan_status: plan?.status ?? null, coverage: plan ? coverage(plan.id, [r.section_id]).get(r.section_id) : null, thisWeek };
    })
  });
});

// ---------- the principal's overview ----------
syllabusRouter.get('/dashboard', office, (_req, res) => {
  const session = sylConfig().session;
  const classes = db.prepare('SELECT id, name FROM classes ORDER BY grade').all() as any[];
  let plans = 0, missing = 0, approved = 0, submitted: any[] = [];
  const out = classes.map(c => {
    const secs = (db.prepare('SELECT id FROM sections WHERE class_id = ?').all(c.id) as any[]).map(s => s.id);
    const subjects = db.prepare(`SELECT DISTINCT sub.id, sub.name FROM section_subjects ss JOIN sections s ON s.id = ss.section_id JOIN subjects sub ON sub.id = ss.subject_id WHERE s.class_id = ? ORDER BY sub.name`).all(c.id) as any[];
    return {
      class_id: c.id, name: c.name,
      subjects: subjects.map(s => {
        const plan = db.prepare('SELECT p.id, p.status, u.name AS author FROM syl_plans p LEFT JOIN users u ON u.id = p.author_id WHERE p.session = ? AND p.class_id = ? AND p.subject_id = ?').get(session, c.id, s.id) as any;
        const teachers = (db.prepare(`SELECT DISTINCT t.name FROM section_subjects ss JOIN sections s ON s.id = ss.section_id JOIN teachers t ON t.id = ss.teacher_id WHERE s.class_id = ? AND ss.subject_id = ?`).all(c.id, s.id) as any[]).map(t => t.name);
        if (!plan) { missing++; return { subject_id: s.id, subject: s.name, teachers, plan_id: null, status: 'none', items: 0, pct: null, plannedPct: null, behindSections: 0, behind: 0 }; }
        plans++; if (plan.status === 'approved') approved++;
        const cov = [...coverage(plan.id, secs).values()], pcts = cov.filter(x => x.pct !== null);
        if (plan.status === 'submitted') submitted.push({ id: plan.id, class_name: c.name, subject: s.name, author: plan.author });
        return { subject_id: s.id, subject: s.name, teachers, plan_id: plan.id, status: plan.status, items: cov[0]?.items ?? 0,
          pct: pcts.length ? Math.round(pcts.reduce((a, x) => a + x.pct!, 0) / pcts.length * 10) / 10 : null, plannedPct: cov[0]?.plannedPct ?? null,
          behindSections: cov.filter(x => x.status === 'behind').length, behind: cov.reduce((a, x) => a + x.behind, 0) };
      })
    };
  });
  res.json({ session, classes: out, totals: { plans, missing, approved, waiting: submitted.length }, submitted });
});

// ---------- the syllabus of a test ----------
syllabusRouter.get('/portion', (req, res) => {
  const examId = Number(req.query.examId), classId = Number(req.query.classId), cfg = sylConfig();
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as any, cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(classId) as any;
  if (!exam || !cls) return bad(res, 'Choose an exam and a class.', 404);
  const prev = db.prepare(`SELECT e.* FROM exams e JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = ? WHERE e.session = ? AND e.id <> ? AND COALESCE(e.start_date, '9999') < COALESCE(?, '9999')
    ORDER BY COALESCE(e.start_date, '9999') DESC LIMIT 1`).get(classId, exam.session, examId, exam.start_date) as any;
  const firstPaper = (db.prepare('SELECT MIN(p.test_date) AS d FROM exam_papers p JOIN sections s ON s.id = p.section_id WHERE p.exam_id = ? AND s.class_id = ?').get(examId, classId) as any).d;
  const from = isDate(req.query.from) ? String(req.query.from) : prev ? addDays(prev.end_date ?? prev.start_date, 1) : cfg.start;
  const to = isDate(req.query.to) ? String(req.query.to) : exam.start_date ?? firstPaper ?? todayISO();
  const subjects = (db.prepare(`SELECT DISTINCT sub.id, sub.name FROM section_subjects ss JOIN sections s ON s.id = ss.section_id JOIN subjects sub ON sub.id = ss.subject_id WHERE s.class_id = ? ORDER BY sub.name`).all(classId) as any[]).map(s => {
    const plan = db.prepare('SELECT id, status FROM syl_plans WHERE session = ? AND class_id = ? AND subject_id = ?').get(exam.session, classId, s.id) as any;
    const items = plan ? (db.prepare('SELECT month, week, topic, chapter, outcomes FROM syl_items WHERE plan_id = ? ORDER BY month, week, sort').all(plan.id) as any[])
      .filter(i => { const w = weekRange(i.month, i.week); return w.from <= to && w.to >= from; }) : [];
    const paper = db.prepare('SELECT MIN(p.test_date) AS d, MAX(p.max_marks) AS m FROM exam_papers p JOIN sections s ON s.id = p.section_id WHERE p.exam_id = ? AND s.class_id = ? AND p.subject_id = ?').get(examId, classId, s.id) as any;
    return { subject_id: s.id, subject: s.name, plan_id: plan?.id ?? null, status: plan?.status ?? 'none', test_date: paper?.d ?? null, max_marks: paper?.m ?? null, items };
  });
  res.json({ exam: { id: exam.id, name: exam.name, session: exam.session }, class: cls, from, to, previous: prev ? { id: prev.id, name: prev.name } : null, subjects });
});
