import { today, fmtDate, monthLabel } from '../fee/fee';
export { today, fmtDate, monthLabel };

export type Status = 'P' | 'A' | 'L' | 'LT';
export const STATUS_LIST: { key: Status; label: string; short: string; on: string; dot: string }[] = [
  { key: 'P', label: 'Present', short: 'P', on: 'bg-emerald-600 text-white', dot: 'bg-emerald-500' },
  { key: 'A', label: 'Absent', short: 'A', on: 'bg-rose-600 text-white', dot: 'bg-rose-500' },
  { key: 'L', label: 'Leave', short: 'L', on: 'bg-amber-500 text-white', dot: 'bg-amber-500' },
  { key: 'LT', label: 'Late', short: 'T', on: 'bg-sky-600 text-white', dot: 'bg-sky-500' }
];
export const SHORT: Record<string, string> = { P: 'P', A: 'A', L: 'L', LT: 'T' };
export const cellClass = (s: string | null | undefined) =>
  s === 'P' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : s === 'A' ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
    : s === 'L' ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : s === 'LT' ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300' : 'bg-slate-100 dark:bg-slate-800/60 text-slate-300';

export interface MarkRow { id: number; name: string; father_name: string; roll_no: number | null; reg_no: string; phone: string | null; status: Status | null; note: string; onLeave: string | null }
export interface Cfg { edit_days: number; low_pct: number; leave_counts: boolean; days: number[]; periodCount: number; breakAfter: number; periods: { start: string; end: string }[]; today: string }
export interface MySection { id: number; section_name: string; class_id: number; class_name: string; grade: number }
export interface Meta { date: string; marked: boolean; working: boolean; holiday: string | null; weekOff?: boolean; canEdit: boolean; lockReason: string | null; markedBy?: string | null; markedAt?: string | null }
export interface Stats { present: number; late: number; absent: number; leave: number; recorded: number; pct: number | null; source: 'daily' | 'totals' | 'none'; workingDays: number }

export const DOW_LETTER = ['', 'M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const DOW_NAME = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const pctText = (p: number | null | undefined) => (p === null || p === undefined ? '-' : `${p}%`);
export const pctColor = (p: number | null | undefined, low: number) => (p === null || p === undefined ? 'text-slate-400' : p < low ? 'text-rose-500' : p < 90 ? 'text-amber-500' : 'text-emerald-600');

/** First look at a section that has no register yet: everyone present, students on approved leave marked L. */
export function initialRows(rows: MarkRow[]): MarkRow[] {
  const anyMarked = rows.some(r => r.status);
  return rows.map(r => (r.status ? r : { ...r, status: r.onLeave ? 'L' : anyMarked ? null : 'P' }));
}

/** "3, 7, 12-14" -> [3, 7, 12, 13, 14]. Anything that is not a day number is returned in `bad`. */
export function parseDays(text: string, max = 31): { days: number[]; bad: string[] } {
  const days = new Set<number>(), bad: string[] = [];
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(tok);
    if (!m) { bad.push(tok); continue; }
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > max || b < a) { bad.push(tok); continue; }
    for (let d = a; d <= b; d++) days.add(d);
  }
  return { days: [...days].sort((x, y) => x - y), bad };
}
export const daysToText = (days: number[]) => {
  const out: string[] = []; let i = 0;
  while (i < days.length) { let j = i; while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++; out.push(j - i >= 2 ? `${days[i]}-${days[j]}` : days.slice(i, j + 1).join(', ')); i = j + 1; }
  return out.join(', ');
};
