import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, PageOrientation, ShadingType } from 'docx';
import { DATA_DIR, db, getSetting } from '../db.js';
import { getSettings } from '../timetable/schema.js';
import { addDays, dowOf, holidaysBetween, todayISO } from '../attendance/service.js';
import { examConfig } from '../exam/service.js';
import type { AuthUser } from '../auth.js';
import { isManager, myTeacherId } from '../attendance/service.js';

const pad = (n: number) => String(n).padStart(2, '0');
export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const KINDS = ['lesson', 'revision', 'test', 'project', 'activity'];

export function sylConfig() {
  const y = new Date().getFullYear();
  return { session: examConfig().session, start: getSetting('syl_start') || `${y}-08-01`, end: getSetting('syl_end') || `${y + 1}-03-31` };
}

const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
export function weekRange(month: string, week: number) {
  const r = [[1, 7], [8, 14], [15, 21], [22, lastDay(month)]][week - 1];
  return { from: `${month}-${pad(r[0])}`, to: `${month}-${pad(r[1])}` };
}
export const weekOf = (date: string) => { const d = Number(date.slice(8, 10)); return { month: date.slice(0, 7), week: d <= 7 ? 1 : d <= 14 ? 2 : d <= 21 ? 3 : 4 }; };

export function monthsBetween(startIso: string, endIso: string): string[] {
  const out: string[] = []; let m = startIso.slice(0, 7);
  while (m <= endIso.slice(0, 7) && out.length < 36) { out.push(m); const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)); m = d.toISOString().slice(0, 7); }
  return out;
}

/** The academic calendar: every week with its school days, holidays, exams and events. */
export function calendar(months?: string[]) {
  const cfg = sylConfig(), list = months ?? monthsBetween(cfg.start, cfg.end), schoolDays = getSettings().days;
  const exams = db.prepare("SELECT id, name, start_date AS from_d, COALESCE(end_date, start_date) AS to_d FROM exams WHERE start_date IS NOT NULL").all() as any[];
  const events = db.prepare('SELECT id, date, to_date, title, kind FROM syl_events').all() as any[];
  return list.map(month => {
    const hol = holidaysBetween(`${month}-01`, `${month}-31`);
    return {
      month, label: monthLabel(month),
      weeks: [1, 2, 3, 4].map(week => {
        const { from, to } = weekRange(month, week);
        let days = 0, working = 0;
        for (let d = from; d <= to; d = addDays(d, 1)) if (schoolDays.includes(dowOf(d))) { days++; if (!hol.has(d)) working++; }
        return {
          week, from, to, days, working,
          holidays: [...hol].filter(([d]) => d >= from && d <= to).map(([date, name]) => ({ date, name })),
          exams: exams.filter(e => e.from_d <= to && e.to_d >= from).map(e => ({ id: e.id, name: e.name, from: e.from_d, to: e.to_d })),
          events: events.filter(e => e.date <= to && e.to_date >= from)
        };
      })
    };
  });
}

// ---------- plans and who may change them ----------
export const planRow = (id: number) => db.prepare(`SELECT p.*, c.name AS class_name, c.grade, sub.name AS subject, u.name AS author, a.name AS approver
  FROM syl_plans p JOIN classes c ON c.id = p.class_id JOIN subjects sub ON sub.id = p.subject_id LEFT JOIN users u ON u.id = p.author_id LEFT JOIN users a ON a.id = p.approved_by WHERE p.id = ?`).get(id) as any;

export function qualified(user: AuthUser, subjectId: number): boolean {
  if (isManager(user)) return true;
  const t = myTeacherId(user.id);
  return !!t && !!db.prepare('SELECT 1 FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ?').get(t, subjectId);
}
/** The office can always edit. A subject teacher can edit while the plan is still a draft. */
export const canEditPlan = (user: AuthUser, plan: any) => isManager(user) || (plan.status === 'draft' && qualified(user, plan.subject_id));

/** May this person mark progress for this section and subject? */
export function canTrack(user: AuthUser, sectionId: number, subjectId: number): boolean {
  if (isManager(user)) return true;
  const t = myTeacherId(user.id);
  return !!t && !!db.prepare('SELECT 1 FROM section_subjects WHERE section_id = ? AND subject_id = ? AND teacher_id = ?').get(sectionId, subjectId, t);
}

export const touch = (planId: number) => db.prepare("UPDATE syl_plans SET updated_at = datetime('now') WHERE id = ?").run(planId);

export function snapshot(planId: number) {
  const p = db.prepare('SELECT overview, books, assessment FROM syl_plans WHERE id = ?').get(planId);
  return JSON.stringify({ plan: p, items: db.prepare('SELECT month, week, sort, kind, topic, chapter, outcomes, activities, resources, assessment, periods FROM syl_items WHERE plan_id = ? ORDER BY month, week, sort').all(planId) });
}

export function insertItems(planId: number, rows: any[]) {
  const nextSort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM syl_items WHERE plan_id = ? AND month = ? AND week = ?');
  const ins = db.prepare('INSERT INTO syl_items (plan_id, month, week, sort, kind, topic, chapter, outcomes, activities, resources, assessment, periods) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  let n = 0;
  for (const r of rows) {
    const topic = String(r.topic ?? '').trim().slice(0, 300), week = Math.round(Number(r.week));
    if (!topic || !isMonth(r.month) || !(week >= 1 && week <= 4)) continue;
    const t = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max) || null;
    const periods = r.periods === '' || r.periods == null ? null : Math.max(0, Math.min(40, Math.round(Number(r.periods)) || 0)) || null;
    ins.run(planId, r.month, week, r.sort ?? (nextSort.get(planId, r.month, week) as any).n, KINDS.includes(r.kind) ? r.kind : 'lesson', topic, t(r.chapter, 200), t(r.outcomes, 1500), t(r.activities, 1500), t(r.resources, 800), t(r.assessment, 800), periods);
    n++;
  }
  return n;
}

// ---------- how much has been taught ----------
export interface Cov { items: number; total: number; done: number; planned: number; plannedDone: number; pct: number | null; plannedPct: number | null; behind: number; status: 'none' | 'ahead' | 'on_track' | 'behind' }
export function coverage(planId: number, sectionIds: number[]): Map<number, Cov> {
  const today = todayISO();
  const items = db.prepare('SELECT id, month, week, periods FROM syl_items WHERE plan_id = ?').all(planId) as any[];
  const prog = new Map<string, string>();
  if (items.length && sectionIds.length) for (const r of db.prepare(`SELECT item_id, section_id, status FROM syl_progress WHERE item_id IN (${items.map(() => '?').join(',')}) AND section_id IN (${sectionIds.map(() => '?').join(',')})`).all(...items.map(i => i.id), ...sectionIds) as any[]) prog.set(`${r.item_id}|${r.section_id}`, r.status);
  const out = new Map<number, Cov>();
  for (const sec of sectionIds) {
    let total = 0, done = 0, planned = 0, plannedDone = 0, behind = 0;
    for (const it of items) {
      const st = prog.get(`${it.id}|${sec}`) ?? 'pending', w = it.periods > 0 ? it.periods : 1;
      if (st === 'skipped') continue;
      total += w; if (st === 'done') done += w;
      if (weekRange(it.month, it.week).to <= today) { planned += w; if (st === 'done') plannedDone += w; else behind++; }
    }
    const pct = total ? Math.round((done / total) * 1000) / 10 : null, plannedPct = total ? Math.round((planned / total) * 1000) / 10 : null;
    out.set(sec, { items: items.length, total, done, planned, plannedDone, pct, plannedPct, behind,
      status: !items.length ? 'none' : done > planned ? 'ahead' : plannedDone >= planned * 0.9 ? 'on_track' : 'behind' });
  }
  return out;
}

// ---------- Word files ----------
export const uploadDir = () => { const d = path.join(DATA_DIR, 'uploads', 'syllabus'); fs.mkdirSync(d, { recursive: true }); return d; };

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** Reads the tables of a .docx file (so a syllabus made in Word can be imported). */
export async function parseDocx(buf: Buffer): Promise<{ tables: string[][][]; lines: string[] }> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This is not a Word (.docx) file.');
  const text = (frag: string) => (frag.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(p => decode([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map(m => (m[1] !== undefined ? m[1] : ' ')).join('')).trim()).filter(Boolean).join('\n');
  const tables = (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []).map(t => (t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map(r => (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map(text)));
  const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '');
  return { tables: tables.filter(t => t.length), lines: text(body).split('\n').filter(Boolean).slice(0, 400) };
}

export async function planToDocx(planId: number): Promise<Buffer> {
  const p = planRow(planId), items = db.prepare('SELECT * FROM syl_items WHERE plan_id = ? ORDER BY month, week, sort').all(planId) as any[];
  const inst = getSetting('institute_name') || 'College';
  const para = (t: string, o: { bold?: boolean; size?: number; center?: boolean } = {}) => new Paragraph({ alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 60 }, children: [new TextRun({ text: t, bold: o.bold, size: o.size ?? 20 })] });
  const cell = (t: string, o: { bold?: boolean; fill?: string; w?: number } = {}) => new TableCell({ width: o.w ? { size: o.w, type: WidthType.PERCENTAGE } : undefined, shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined, children: (t || ' ').split('\n').map(l => para(l, { bold: o.bold, size: 18 })) });
  const head = ['Month', 'Week', 'Topic / chapter', 'Learning outcomes', 'Activities / resources', 'Assessment', 'Periods'];
  const widths = [10, 7, 25, 25, 18, 10, 5];
  const rows = [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, { bold: true, fill: 'ECEEF7', w: widths[i] })) })];
  for (const it of items) {
    const wr = weekRange(it.month, it.week);
    rows.push(new TableRow({ children: [cell(monthLabel(it.month), { bold: true }), cell(`W${it.week}\n${wr.from.slice(8)}-${wr.to.slice(8)}`), cell([it.topic, it.chapter].filter(Boolean).join('\n'), { bold: false }), cell(it.outcomes ?? ''), cell([it.activities, it.resources].filter(Boolean).join('\n')), cell(it.assessment ?? ''), cell(it.periods ? String(it.periods) : '')] }));
  }
  const doc = new Document({ sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 700, bottom: 700, left: 700, right: 700 } } }, children: [
    para(inst.toUpperCase(), { bold: true, size: 30, center: true }), para('Syllabus Distribution Plan', { bold: true, size: 26, center: true }),
    para(`Class: ${p.class_name}     Subject: ${p.subject}     Session: ${p.session}`, { bold: true }),
    ...(p.books ? [para(`Books: ${p.books}`)] : []), ...(p.overview ? [para(`Overview: ${p.overview}`)] : []), ...(p.assessment ? [para(`Assessment: ${p.assessment}`)] : []),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
  ] }] });
  return Packer.toBuffer(doc);
}
