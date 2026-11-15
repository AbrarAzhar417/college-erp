import { fmtDate, today } from '../fee/fee';
export { fmtDate, today };

export interface Item { id: number; plan_id: number; month: string; week: number; sort: number; kind: string; topic: string; chapter: string | null; outcomes: string | null; activities: string | null; resources: string | null; assessment: string | null; periods: number | null }
export interface PlanInfo { id: number; session: string; class_id: number; class_name: string; subject_id: number; subject: string; overview: string | null; books: string | null; assessment: string | null; status: 'draft' | 'submitted' | 'approved'; note: string | null; author: string | null; approver: string | null; approved_at: string | null; updated_at: string }
export interface PlanFull {
  plan: PlanInfo; items: Item[]; files: { id: number; name: string; size: number; created_at: string; by: string | null }[]; versions: { id: number; label: string; created_at: string; by: string | null }[];
  canEdit: boolean; canApprove: boolean; perWeek: number; sections: { id: number; name: string }[];
}
export interface CalWeek { week: number; from: string; to: string; days: number; working: number; holidays: { date: string; name: string }[]; exams: { id: number; name: string; from: string; to: string }[]; events: { id: number; date: string; to_date: string; title: string; kind: string }[] }
export interface CalMonth { month: string; label: string; weeks: CalWeek[] }
export interface SylCfg { session: string; start: string; end: string; months: string[]; today: string; currentMonth: string; currentWeek: number; kinds: string[] }
export interface Cov { items: number; total: number; done: number; planned: number; plannedDone: number; pct: number | null; plannedPct: number | null; behind: number; status: string }

export const KINDS: Record<string, { label: string; cls: string }> = {
  lesson: { label: 'Lesson', cls: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' }, revision: { label: 'Revision', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  test: { label: 'Test', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' }, project: { label: 'Project', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' }, activity: { label: 'Activity', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' }
};
export const PLAN_STATUS: Record<string, { label: string; cls: string }> = {
  none: { label: 'No plan', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' }, draft: { label: 'Draft', cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-300' },
  submitted: { label: 'Waiting approval', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' }, approved: { label: 'Approved', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' }
};
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthShort = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 3);
export const weekDates = (w: { from: string; to: string }) => `${Number(w.from.slice(8))} to ${Number(w.to.slice(8))} ${monthShort(w.from.slice(0, 7))}`;
export const covBar = (pct: number | null, planned: number | null) => (pct === null ? 'bg-slate-300' : planned !== null && pct + 5 < planned ? 'bg-rose-500' : 'bg-emerald-500');
export const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// ---------- reading a table from Word, Excel (pasted) or CSV ----------
export interface ImportRow { month: string; week: number; topic: string; chapter: string; outcomes: string; activities: string; resources: string; assessment: string; periods: string; ok: boolean }
const HEAD: Record<string, string[]> = {
  month: ['month'], week: ['week', 'wk'], topic: ['topic', 'content', 'lesson', 'syllabus', 'chapter / topic', 'topic / chapter', 'chapters'],
  chapter: ['chapter', 'unit', 'reference', 'ref'], outcomes: ['outcome', 'objective', 'slo', 'learning'], activities: ['activit', 'method', 'strateg'],
  resources: ['resource', 'material', 'book'], assessment: ['assess', 'homework', 'evaluation'], periods: ['period', 'lecture', 'no. of', 'hours']
};
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  const delim = text.includes('\t') ? '\t' : text.split('\n')[0]?.includes(';') && !text.split('\n')[0].includes(',') ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(c => c.trim())) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); if (row.some(c => c.trim())) rows.push(row);
  return rows.map(r => r.map(c => c.trim()));
}
export function toImportRows(table: string[][], months: string[], defMonth: string, defWeek: number): ImportRow[] {
  if (!table.length) return [];
  const hdrIdx = table.findIndex(r => r.filter(c => Object.values(HEAD).some(keys => keys.some(k => c.toLowerCase().includes(k)))).length >= 2);
  const header = hdrIdx >= 0 ? table[hdrIdx].map(c => c.toLowerCase()) : null, body = table.slice(hdrIdx >= 0 ? hdrIdx + 1 : 0);
  const col: Record<string, number> = {};
  if (header) for (const [field, keys] of Object.entries(HEAD)) { const i = header.findIndex((c, ix) => !Object.values(col).includes(ix) && keys.some(k => c.includes(k))); if (i >= 0) col[field] = i; }
  else { col['topic'] = 0; }
  const get = (r: string[], f: string) => (col[f] === undefined ? '' : (r[col[f]] ?? '').trim());
  const parseMonth = (s: string): string => {
    const t = s.trim().toLowerCase(); if (!t) return '';
    const iso = /(\d{4})-(\d{2})/.exec(t); if (iso) return `${iso[1]}-${iso[2]}`;
    const idx = MONTHS.findIndex(m => t.includes(m.toLowerCase().slice(0, 3))); if (idx < 0) return '';
    const y = /(\d{4})/.exec(t)?.[1]; const hit = months.find(m => Number(m.slice(5, 7)) === idx + 1 && (!y || m.startsWith(y)));
    return hit ?? (y ? `${y}-${String(idx + 1).padStart(2, '0')}` : '');
  };
  let lastMonth = defMonth, lastWeek = defWeek;
  const out: ImportRow[] = [];
  for (const r of body) {
    let topic = get(r, 'topic'), chapter = get(r, 'chapter');
    if (!topic && !chapter) continue;
    if (!col['chapter'] && topic.includes('\n')) { const [first, ...rest] = topic.split('\n'); topic = first.trim(); chapter = rest.join(', ').trim(); }
    if (!topic) { topic = chapter; chapter = ''; }
    const m = parseMonth(get(r, 'month')); if (m) lastMonth = m;
    const wk = /(\d)/.exec(get(r, 'week')); if (wk) lastWeek = Number(wk[1]);
    const week = col['week'] === undefined ? lastWeek : (wk ? Number(wk[1]) : lastWeek);
    out.push({ month: lastMonth, week, topic: topic.replace(/\s+/g, ' ').slice(0, 300), chapter: chapter.slice(0, 200), outcomes: get(r, 'outcomes'), activities: get(r, 'activities'), resources: get(r, 'resources'), assessment: get(r, 'assessment'), periods: (/\d+/.exec(get(r, 'periods')) ?? [''])[0], ok: !!lastMonth && week >= 1 && week <= 4 && !!topic });
  }
  return out;
}
