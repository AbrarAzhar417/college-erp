import { fmtDate, today } from '../fee/fee';
export { fmtDate, today };

export interface ExamCfg {
  session: string; session_start: string; drop_pct: number; board_min_att: number; grade_scale: { min: number; grade: string }[];
  categories: Record<'A' | 'B' | 'C', { label: string; venue: string }>; kinds: Record<string, { label: string; max: number }>; boardClasses: number[]; today: string;
}
export interface ExamItem { id: number; name: string; kind: string; session: string; seq: number; pass_percent: number; pass_rule: 'subjects' | 'total'; status: 'open' | 'locked' | 'published'; start_date: string | null; end_date: string | null; classes: string[]; papers: number; expected: number; entered: number }
export interface PaperStat { paper_id: number; subject_id: number; subject: string; teacher: string | null; max_marks: number; test_date: string | null; entered: number; total: number; absent: number; avgPct: number | null; highest: number | null; lowest: number | null; passPct: number | null; failed: number }
export interface SheetStudent {
  id: number; name: string; father_name: string; roll_no: number | null; reg_no: string; category: string | null; p_number: string | null; phone: string | null; father_phone: string | null; mother_phone: string | null;
  marks: Record<number, { marks: number | null; status: string; pass: boolean | null }>; total: number; max: number; pct: number | null; grade: string | null; failed: string[]; missing: number;
  result: 'PASS' | 'FAIL' | 'INCOMPLETE'; rank: number | null; prev: { pct: number | null; rank: number | null; result: string } | null; delta: number | null; trend: 'up' | 'down' | 'same' | null; rankChange: number | null;
  needsCall: boolean; reason: 'fail' | 'down' | 'both' | null; attendance: number | null; photo?: string | null; gender?: string;
}
export interface SheetData {
  exam: ExamItem; section: { id: number; label: string; class_id: number; class_name: string; section_name: string; class_teacher: string | null };
  papers: PaperStat[]; students: SheetStudent[]; prevExam: { id: number; name: string } | null; dropPct: number; scale: { min: number; grade: string }[];
  stats: { students: number; complete: number; incomplete: number; pass: number; fail: number; passPct: number | null; avg: number | null; highest: number | null; lowest: number | null; needCall: number };
}
export interface Followup {
  id: number; exam_id: number; exam_name: string; student_id: number; reason: string; pct: number | null; prev_pct: number | null; failed: string | null; status: string; call_date: string | null; ptm_date: string | null; notes: string | null;
  name: string; father_name: string; roll_no: number | null; reg_no: string; category: string | null; p_number: string | null; phone: string | null; father_phone: string | null; mother_phone: string | null;
  class_name: string; section_name: string; section_id: number; venue: string;
}
export interface Award { type: string; gender?: string; title: string; student_id: number; name: string; father_name: string; roll_no: number | null; class_name: string; section_name: string; exam: string; detail: string; pct: number | null; rank: number | null; photo?: string | null; subjects?: { subject: string; max: number; marks: number | null; status: string; pass: boolean | null }[] | null }

export const KIND_ORDER = ['test', 'terminal', 'sendup', 'preboard', 'annual', 'board'];
export const STATUS_LABEL: Record<string, string> = { open: 'Marks entry open', locked: 'Locked', published: 'Published' };
export const FU_STATUS: Record<string, string> = { pending: 'To call', called: 'Called', meeting_set: 'Meeting set', attended: 'Attended', no_show: 'Did not come', closed: 'Closed' };
export const REASON_LABEL: Record<string, string> = { fail: 'Failed', down: 'Performance down', both: 'Failed and down' };
export const BOARD_STATUS: Record<string, string> = { pending: 'Pending', form_ready: 'Form ready', submitted: 'Sent to board', roll_issued: 'Roll no. received', withheld: 'Withheld' };
export const catClass = (c: string | null) => c === 'A' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : c === 'B' ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : c === 'C' ? 'bg-slate-500/15 text-slate-600 dark:text-slate-300' : 'bg-slate-500/10 text-slate-400';
export const resultClass = (r: string) => r === 'PASS' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : r === 'FAIL' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-slate-500/10 text-slate-400';
export const pctClass = (p: number | null, pass = 33) => (p === null ? 'text-slate-400' : p < pass ? 'text-rose-500' : p < 60 ? 'text-amber-500' : 'text-emerald-600');
export const deltaText = (d: number | null) => (d === null ? '' : d > 0 ? `+${d}` : String(d));
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayOf = (iso: string | null) => (iso ? DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()] : '');
export const phones = (s: { phone: string | null; father_phone: string | null; mother_phone: string | null }) => [...new Set([s.father_phone, s.mother_phone, s.phone].filter(Boolean) as string[])];

// ---------- one student, every exam ----------
export interface ExamResult {
  exam: { id: number; name: string; kind: string; session: string; start_date: string | null; status: string; pass_percent: number };
  section_id: number; class_name: string; section_name: string;
  papers: { subject_id: number; subject: string; max_marks: number }[];
  row: {
    marks: Record<number, { marks: number | null; status: string; pass: boolean | null }>; total: number; max: number; pct: number | null; grade: string | null;
    result: 'PASS' | 'FAIL' | 'INCOMPLETE'; rank: number | null; failed: string[]; missing: number; delta: number | null; trend: 'up' | 'down' | 'same' | null;
    prev: { pct: number | null; rank: number | null; result: string } | null;
  };
  classSize: number; sectionAvg: number | null; topPct: number | null; subjectAvg: Record<number, number | null>;
}
export interface StudentResults {
  student: { id: number; name: string; father_name: string; roll_no: number | null; reg_no: string; photo: string | null; gender?: string; section_id: number; section_name: string; class_name: string; grade: number };
  session: string; sessions: string[]; attendance: number | null; scale: { min: number; grade: string }[]; exams: ExamResult[];
}
/** The text shown in a marks cell: marks, A (absent), L (leave) or a dash. */
export function markText(r: ExamResult, subjectId: number): string {
  if (!r.papers.some(p => p.subject_id === subjectId)) return '-';
  const m = r.row.marks[subjectId];
  return !m ? '-' : m.status === 'A' ? 'A' : m.status === 'L' ? 'L' : m.marks === null ? '-' : String(m.marks);
}
export function allSubjects(exams: ExamResult[]): { id: number; name: string }[] {
  const m = new Map<number, string>();
  for (const e of exams) for (const p of e.papers) if (!m.has(p.subject_id)) m.set(p.subject_id, p.subject);
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
