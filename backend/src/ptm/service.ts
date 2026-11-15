import '../diary/service.js';   // makes sure the diary tables exist (student notes are shown to parents)
import { db } from '../db.js';
import { addDays, addMonths, attConfig, isDate, monthDays, monthOf, monthStats, pctOf, sectionLabel, todayISO } from '../attendance/service.js';
import { computeSection, examConfig, getExam, round1 } from '../exam/service.js';

db.exec(`
CREATE TABLE IF NOT EXISTS ptm_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL, slot_minutes INTEGER NOT NULL DEFAULT 10,
  exam_id INTEGER REFERENCES exams(id), att_from TEXT NOT NULL, att_to TEXT NOT NULL,
  venue TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ptm_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES ptm_meetings(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  slot_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','attended','no_show')),
  attended_by TEXT, discussed TEXT NOT NULL DEFAULT '', parent_remarks TEXT NOT NULL DEFAULT '', action_points TEXT NOT NULL DEFAULT '', follow_up TEXT,
  notified_at TEXT, updated_by INTEGER, updated_at TEXT,
  UNIQUE (meeting_id, student_id), UNIQUE (meeting_id, section_id, slot_time)
);
`);

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const validTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isMonthStr = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// ---------------------------------------------------------------- creating a meeting
export function createMeeting(b: any, userId: number): { id: number } | string {
  const title = str(b.title, 100), date = b.date, start = b.start_time, slot = Number(b.slot_minutes ?? 10);
  if (!title) return 'Write a title for the meeting.';
  if (!isDate(date)) return 'Choose the meeting date.';
  if (!validTime(start)) return 'Start time must look like 09:00.';
  if (!Number.isInteger(slot) || slot < 5 || slot > 60) return 'Time for each parent must be between 5 and 60 minutes.';
  if (b.end_time && !validTime(b.end_time)) return 'End time must look like 13:00.';
  const sections = [...new Set((Array.isArray(b.section_ids) ? b.section_ids : []).map(Number))].filter(Boolean) as number[];
  if (!sections.length) return 'Choose at least one class and section.';
  for (const s of sections) if (!db.prepare('SELECT 1 FROM sections WHERE id = ?').get(s)) return 'A chosen section does not exist.';
  let examId: number | null = null;
  if (b.exam_id) {
    examId = Number(b.exam_id);
    if (!getExam(examId)) return 'That exam does not exist.';
    for (const s of sections) if (!db.prepare('SELECT 1 FROM exam_classes ec JOIN sections sec ON sec.class_id = ec.class_id WHERE ec.exam_id = ? AND sec.id = ?').get(examId, s)) return `${sectionLabel(s)} did not sit this exam.`;
  }
  const cfg = examConfig();
  const from = isMonthStr(b.att_from) ? b.att_from : monthOf(cfg.session_start), to = isMonthStr(b.att_to) ? b.att_to : monthOf(date);
  if (from > to) return 'Attendance period starts after it ends.';
  const order = b.order === 'priority' ? 'priority' : 'roll';

  const plan: { section: number; student: number; time: string }[] = [];
  for (const sec of sections) {
    let kids = db.prepare("SELECT id FROM students WHERE section_id = ? AND status = 'active' ORDER BY roll_no, name").all(sec) as { id: number }[];
    if (!kids.length) return `${sectionLabel(sec)} has no active students.`;
    if (order === 'priority' && examId) {
      const need = new Set(computeSection(examId, sec).students.filter(s => s.needsCall).map(s => s.id));
      kids = [...kids.filter(k => need.has(k.id)), ...kids.filter(k => !need.has(k.id))];
    }
    const endLimit = b.end_time ? toMin(b.end_time) : null, need = kids.length * slot;
    if (endLimit !== null && toMin(start) + need > endLimit) return `${sectionLabel(sec)} has ${kids.length} students and needs ${need} minutes; it would end at ${hhmm(toMin(start) + need)}, after ${b.end_time}.`;
    kids.forEach((k, i) => plan.push({ section: sec, student: k.id, time: hhmm(toMin(start) + i * slot) }));
  }
  const tx = db.transaction(() => {
    const id = Number(db.prepare('INSERT INTO ptm_meetings (title,date,start_time,slot_minutes,exam_id,att_from,att_to,venue,created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(title, date, start, slot, examId, from, to, str(b.venue, 80) || null, userId).lastInsertRowid);
    const ins = db.prepare('INSERT INTO ptm_slots (meeting_id,section_id,student_id,slot_time) VALUES (?,?,?,?)');
    for (const p of plan) ins.run(id, p.section, p.student, p.time);
    return id;
  });
  return { id: tx() };
}

/** Students who joined a section after the schedule was made get the next free slot. */
export function addLateStudents(meetingId: number): number {
  const m = db.prepare('SELECT * FROM ptm_meetings WHERE id = ?').get(meetingId) as any; if (!m) return 0;
  let added = 0;
  const secs = db.prepare('SELECT DISTINCT section_id FROM ptm_slots WHERE meeting_id = ?').all(meetingId) as { section_id: number }[];
  for (const { section_id } of secs) {
    const kids = db.prepare("SELECT id FROM students WHERE section_id = ? AND status = 'active' AND id NOT IN (SELECT student_id FROM ptm_slots WHERE meeting_id = ?) ORDER BY roll_no, name").all(section_id, meetingId) as { id: number }[];
    for (const k of kids) {
      const last = (db.prepare('SELECT MAX(slot_time) t FROM ptm_slots WHERE meeting_id = ? AND section_id = ?').get(meetingId, section_id) as any).t as string;
      db.prepare('INSERT INTO ptm_slots (meeting_id,section_id,student_id,slot_time) VALUES (?,?,?,?)').run(meetingId, section_id, k.id, hhmm(toMin(last) + m.slot_minutes)); added++;
    }
  }
  return added;
}

export function checkSlotUpdate(b: any, slot: any): { sets: Record<string, any> } | string {
  const sets: Record<string, any> = {};
  if (b.status !== undefined) { if (!['scheduled', 'attended', 'no_show'].includes(b.status)) return 'Unknown status.'; sets.status = b.status; }
  if (b.slot_time !== undefined) {
    if (!validTime(b.slot_time)) return 'Time must look like 09:30.';
    const clash = db.prepare('SELECT 1 FROM ptm_slots WHERE meeting_id = ? AND section_id = ? AND slot_time = ? AND id <> ?').get(slot.meeting_id, slot.section_id, b.slot_time, slot.id);
    if (clash) return 'Another parent already has that time in this class.';
    sets.slot_time = b.slot_time;
  }
  for (const [k, n] of [['attended_by', 60], ['discussed', 1500], ['parent_remarks', 1000], ['action_points', 1000]] as const) if (b[k] !== undefined) sets[k] = str(b[k], n);
  if (b.follow_up !== undefined) { if (b.follow_up && !isDate(b.follow_up)) return 'Follow-up date is not valid.'; sets.follow_up = b.follow_up || null; }
  if (sets.status === 'no_show') sets.attended_by = '';
  if (!Object.keys(sets).length) return 'Nothing to change.';
  return { sets };
}
/** Keeps the exam module's "parents to be called" list in step with what happened at the meeting. */
export function syncFollowup(slot: any, status: string, date: string) {
  const m = db.prepare('SELECT exam_id FROM ptm_meetings WHERE id = ?').get(slot.meeting_id) as any;
  if (!m?.exam_id || status === 'scheduled') return;
  db.prepare("UPDATE exam_followups SET status = ?, ptm_date = ?, updated_at = datetime('now') WHERE exam_id = ? AND student_id = ? AND status <> 'closed'").run(status === 'attended' ? 'attended' : 'no_show', date, m.exam_id, slot.student_id);
}

// ---------------------------------------------------------------- attendance of a period
export interface AttPeriod { present: number; late: number; absent: number; leave: number; recorded: number; pct: number | null; months: { month: string; pct: number | null; absent: number; recorded: number }[]; absentDates: string[]; lateCount: number }
export function monthsBetween(from: string, to: string) { const out: string[] = []; for (let m = from; m <= to && out.length < 24; m = addMonths(m, 1)) out.push(m); return out; }
export function attendanceFor(ids: number[], from: string, to: string): Map<number, AttPeriod> {
  const out = new Map<number, AttPeriod>(ids.map(i => [i, { present: 0, late: 0, absent: 0, leave: 0, recorded: 0, pct: null, months: [], absentDates: [], lateCount: 0 }]));
  for (const month of monthsBetween(from, to)) {
    const st = monthStats(ids, month);
    for (const [id, s] of st) {
      const o = out.get(id)!; o.present += s.present; o.late += s.late; o.absent += s.absent; o.leave += s.leave;
      if (s.recorded) o.months.push({ month, pct: s.pct, absent: s.absent, recorded: s.recorded });
    }
  }
  const first = `${from}-01`, last = `${to}-31`;
  for (let i = 0; i < ids.length; i += 500) {
    const c = ids.slice(i, i + 500);
    for (const r of db.prepare(`SELECT student_id, date FROM att_daily WHERE status = 'A' AND date BETWEEN ? AND ? AND student_id IN (${c.map(() => '?').join(',')}) ORDER BY date`).all(first, last, ...c) as any[]) out.get(r.student_id)!.absentDates.push(r.date);
  }
  for (const o of out.values()) { o.recorded = o.present + o.late + o.absent + o.leave; o.pct = pctOf(o); o.lateCount = o.late; }
  return out;
}

// ---------------------------------------------------------------- talking points
export interface Point { kind: 'good' | 'concern'; text: string }
export function talkingPoints(x: { result: string | null; failed: string[]; delta: number | null; prevName: string | null; dropPct: number; rank: number | null; students: number;
  subjects: { subject: string; pct: number | null; classAvg: number | null }[]; att: { pct: number | null; absent: number; late: number; recorded: number }; lowAtt: number; concerns: number }): Point[] {
  const p: Point[] = [];
  if (x.result === 'FAIL') p.push({ kind: 'concern', text: `Did not pass: ${x.failed.join(', ')}.` });
  if (x.result === 'PASS' && x.rank && x.rank <= 3) p.push({ kind: 'good', text: `Position ${x.rank} in the class of ${x.students}.` });
  if (x.delta !== null && x.delta <= -x.dropPct) p.push({ kind: 'concern', text: `Marks fell by ${Math.abs(x.delta)}% since ${x.prevName}.` });
  if (x.delta !== null && x.delta >= 5) p.push({ kind: 'good', text: `Marks improved by ${x.delta}% since ${x.prevName}.` });
  const scored = x.subjects.filter(s => s.pct !== null && s.classAvg !== null) as { subject: string; pct: number; classAvg: number }[];
  const weak = scored.filter(s => s.classAvg - s.pct >= 15).sort((a, b) => (a.pct - a.classAvg) - (b.pct - b.classAvg))[0];
  if (weak) p.push({ kind: 'concern', text: `${weak.subject} is ${round1(weak.classAvg - weak.pct)}% below the class average.` });
  const strong = scored.filter(s => s.pct - s.classAvg >= 10).sort((a, b) => (b.pct - b.classAvg) - (a.pct - a.classAvg))[0];
  if (strong) p.push({ kind: 'good', text: `${strong.subject} is clearly strong (${round1(strong.pct - strong.classAvg)}% above class average).` });
  if (x.att.pct !== null) {
    if (x.att.pct < x.lowAtt) p.push({ kind: 'concern', text: `Attendance is ${x.att.pct}%, below the ${x.lowAtt}% minimum (${x.att.absent} absent days).` });
    else if (x.att.pct >= 95) p.push({ kind: 'good', text: `Excellent attendance (${x.att.pct}%).` });
    if (x.att.late >= 5) p.push({ kind: 'concern', text: `Came late ${x.att.late} times.` });
  }
  if (x.concerns >= 3) p.push({ kind: 'concern', text: `${x.concerns} teacher notes about concerns, late, uniform or missing homework.` });
  return p;
}

// ---------------------------------------------------------------- reports
const meetingOf = (id: number) => db.prepare('SELECT * FROM ptm_meetings WHERE id = ?').get(id) as any;
export const slotOf = (id: number) => db.prepare('SELECT * FROM ptm_slots WHERE id = ?').get(id) as any;

export function studentReport(meetingId: number, studentId: number) {
  const m = meetingOf(meetingId); if (!m) return null;
  const slot = db.prepare('SELECT * FROM ptm_slots WHERE meeting_id = ? AND student_id = ?').get(meetingId, studentId) as any; if (!slot) return null;
  const st = db.prepare('SELECT id, name, father_name, gender, roll_no, reg_no, category, phone, father_phone, mother_phone FROM students WHERE id = ?').get(studentId) as any;
  const cfg = examConfig(), lowAtt = attConfig().low_pct;
  let exam: any = null, result: any = null, history: any[] = [];
  if (m.exam_id) {
    const sheet = computeSection(m.exam_id, slot.section_id, true, [studentId]), row = sheet.students.find(s => s.id === studentId);
    if (row) {
      const subjects = sheet.papers.map(p => { const mk = row.marks[p.subject_id]; return { subject: p.subject, max: p.max_marks, marks: mk?.marks ?? null, status: mk?.status ?? '', pass: mk?.pass ?? null, pct: mk && mk.marks !== null ? round1((mk.marks / p.max_marks) * 100) : null, classAvg: p.avgPct, highest: p.highest }; });
      exam = { id: sheet.exam.id, name: sheet.exam.name, status: sheet.exam.status, date: sheet.exam.start_date };
      result = { subjects, total: row.total, max: row.max, pct: row.pct, grade: row.grade, rank: row.rank, students: sheet.stats.students, result: row.result, failed: row.failed, missing: row.missing,
        prev: row.prev && sheet.prevExam ? { name: sheet.prevExam.name, pct: row.prev.pct, rank: row.prev.rank } : null, delta: row.delta, trend: row.trend, classAvg: sheet.stats.avg, classHighest: sheet.stats.highest };
      const exams = db.prepare(`SELECT e.id, e.name FROM exams e JOIN exam_classes ec ON ec.exam_id = e.id JOIN sections s ON s.class_id = ec.class_id AND s.id = ? WHERE e.session = ? AND e.id <> ? AND COALESCE(e.start_date,'9999') <= COALESCE(?,'9999') ORDER BY COALESCE(e.start_date,'9999'), e.id`).all(slot.section_id, sheet.exam.session, sheet.exam.id, sheet.exam.start_date) as any[];
      for (const e of exams) { const r = computeSection(e.id, slot.section_id, false, [studentId]).students.find(s => s.id === studentId); if (r && r.pct !== null) history.push({ exam: e.name, pct: r.pct, rank: r.rank }); }
      history.push({ exam: sheet.exam.name, pct: row.pct, rank: row.rank });
    }
  }
  const att = attendanceFor([studentId], m.att_from, m.att_to).get(studentId)!;
  const notes = db.prepare("SELECT date, kind, note FROM diary_student_notes WHERE student_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC").all(studentId, `${m.att_from}-01`, `${m.att_to}-31`) as any[];
  const concerns = notes.filter(n => n.kind !== 'praise').length;
  const points = talkingPoints({ result: result?.result ?? null, failed: result?.failed ?? [], delta: result?.delta ?? null, prevName: result?.prev?.name ?? null, dropPct: cfg.drop_pct, rank: result?.rank ?? null, students: result?.students ?? 0,
    subjects: (result?.subjects ?? []).map((s: any) => ({ subject: s.subject, pct: s.pct, classAvg: s.classAvg })), att, lowAtt, concerns });
  return { meeting: { id: m.id, title: m.title, date: m.date, venue: m.venue, att_from: m.att_from, att_to: m.att_to }, student: { ...st, section: sectionLabel(slot.section_id) },
    slot: { id: slot.id, time: slot.slot_time, status: slot.status, attended_by: slot.attended_by, discussed: slot.discussed, parent_remarks: slot.parent_remarks, action_points: slot.action_points, follow_up: slot.follow_up },
    exam, result, history, attendance: { ...att, low: att.pct !== null && att.pct < lowAtt, lowLimit: lowAtt }, notes, points };
}

export function classReport(meetingId: number, sectionId: number) {
  const m = meetingOf(meetingId); if (!m) return null;
  const slots = db.prepare('SELECT * FROM ptm_slots WHERE meeting_id = ? AND section_id = ? ORDER BY slot_time').all(meetingId, sectionId) as any[]; if (!slots.length) return null;
  const ids = slots.map(s => s.student_id), lowAtt = attConfig().low_pct;
  const sheet = m.exam_id ? computeSection(m.exam_id, sectionId, true, ids) : null, byId = new Map((sheet?.students ?? []).map(s => [s.id, s]));
  const att = attendanceFor(ids, m.att_from, m.att_to);
  const names = new Map((db.prepare(`SELECT id, name, father_name, roll_no, phone, father_phone, mother_phone FROM students WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as any[]).map(s => [s.id, s]));
  const rows = slots.map(sl => {
    const s = names.get(sl.student_id), r = byId.get(sl.student_id), a = att.get(sl.student_id)!;
    return { slot_id: sl.id, time: sl.slot_time, status: sl.status, notified: !!sl.notified_at, student_id: sl.student_id, name: s.name, father_name: s.father_name, roll_no: s.roll_no,
      pct: r?.pct ?? null, grade: r?.grade ?? null, rank: r?.rank ?? null, result: r?.result ?? null, failed: r?.failed ?? [], trend: r?.trend ?? null, delta: r?.delta ?? null, needsCall: r?.needsCall ?? false,
      att_pct: a.pct, absent: a.absent, lowAtt: a.pct !== null && a.pct < lowAtt };
  });
  const withAtt = rows.filter(r => r.att_pct !== null), avgAtt = withAtt.length ? round1(withAtt.reduce((x, r) => x + r.att_pct!, 0) / withAtt.length) : null;
  const top = rows.filter(r => r.rank && r.rank <= 3).sort((a, b) => a.rank! - b.rank!).map(r => ({ name: r.name, pct: r.pct, rank: r.rank }));
  return { meeting: { id: m.id, title: m.title, date: m.date, venue: m.venue, att_from: m.att_from, att_to: m.att_to }, section: { id: sectionId, label: sectionLabel(sectionId), class_teacher: sheet?.section.class_teacher ?? null },
    exam: sheet ? { id: sheet.exam.id, name: sheet.exam.name, status: sheet.exam.status } : null,
    result: sheet ? { ...sheet.stats, subjects: sheet.papers.map(p => ({ subject: p.subject, teacher: p.teacher, avgPct: p.avgPct, highest: p.highest, lowest: p.lowest, passPct: p.passPct, failed: p.failed })), top } : null,
    attendance: { avgPct: avgAtt, lowCount: rows.filter(r => r.lowAtt).length, perfect: rows.filter(r => r.att_pct === 100).length, lowLimit: lowAtt },
    meetingStats: { total: rows.length, attended: rows.filter(r => r.status === 'attended').length, no_show: rows.filter(r => r.status === 'no_show').length, pending: rows.filter(r => r.status === 'scheduled').length },
    students: rows };
}

// ---------------------------------------------------------------- invitations
export const phoneIntl = (p: string | null | undefined): string | null => {
  const d = (p ?? '').replace(/\D/g, ''); if (!d) return null;
  if (d.startsWith('92') && d.length === 12) return d; if (d.startsWith('0') && d.length === 11) return `92${d.slice(1)}`; if (d.length === 10 && d.startsWith('3')) return `92${d}`; return null;
};
export function invitations(meetingId: number, sectionId: number, school: string) {
  const m = meetingOf(meetingId); if (!m) return [];
  const rows = db.prepare(`SELECT sl.id slot_id, sl.slot_time, sl.notified_at, s.name, s.father_name, s.father_phone, s.mother_phone, s.phone FROM ptm_slots sl JOIN students s ON s.id = sl.student_id WHERE sl.meeting_id = ? AND sl.section_id = ? ORDER BY sl.slot_time`).all(meetingId, sectionId) as any[];
  const when = new Date(`${m.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return rows.map(r => {
    const phone = phoneIntl(r.father_phone) ?? phoneIntl(r.phone) ?? phoneIntl(r.mother_phone);
    const message = `Assalam o Alaikum ${r.father_name}. ${school}: parent-teacher meeting "${m.title}" on ${when}. Your time to meet about ${r.name} is ${r.slot_time}${m.venue ? ` at ${m.venue}` : ''}. Results and attendance will be discussed. Please come on time.`;
    return { slot_id: r.slot_id, student: r.name, father: r.father_name, time: r.slot_time, phone, notified: !!r.notified_at, message };
  });
}
export const today = todayISO; export { addDays, monthDays };
