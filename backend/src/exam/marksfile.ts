import { parseCsv, toCsv } from '../import/csv.js';
import { readXlsx } from '../import/xlsx.js';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS: Record<string, string[]> = {
  reg: ['regno', 'reg', 'registration', 'registrationno', 'admissionno', 'regnumber'], roll: ['roll', 'rollno', 'rollnumber'], name: ['name', 'student', 'studentname'],
  marks: ['marks', 'obtained', 'marksobtained', 'obt', 'score', 'obtainedmarks'], status: ['status', 'attendance', 'apl']
};
export type FileRow = { line: number; reg_no: string; roll_no: string; name: string; marks: string; status: string };

export function templateCsv(paper: { max_marks: number }, students: { reg_no: string; roll_no: number | null; name: string; marks: number | null; status: string | null }[]) {
  return toCsv([['Reg No', 'Roll No', 'Name', `Marks (max ${paper.max_marks})`, 'Status (P / A / L)'], ...students.map(s => [s.reg_no, s.roll_no ?? '', s.name, s.status === 'P' ? s.marks : '', s.status ?? ''])]);
}
/** Turns an uploaded CSV or .xlsx into rows. Old .xls files are refused with a clear message. */
export function readRows(buf: Buffer, filename: string): string[][] {
  const isOle = buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0, isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (isOle) throw new Error('Old Excel (.xls) files cannot be read. In Excel use Save As and choose .xlsx or CSV.');
  if (isZip || /\.xlsx$/i.test(filename)) return readXlsx(buf);
  const text = buf.toString('utf8').replace(/^﻿/, ''); if (text.includes('\u0000')) throw new Error('This does not look like a CSV or Excel (.xlsx) file.');
  return parseCsv(text).rows;
}
export function toFileRows(raw: string[][]): FileRow[] | string {
  const cols: Record<string, number> = {}; let head = -1;
  for (let i = 0; i < Math.min(raw.length, 10) && head < 0; i++) {
    const found: Record<string, number> = {};
    raw[i].forEach((c, j) => {
      const n = norm(String(c ?? ''));
      for (const [k, al] of Object.entries(ALIAS)) if (!(k in found) && (al.includes(n) || (k === 'marks' && n.startsWith('marks')) || (k === 'status' && n.startsWith('status')))) found[k] = j;
    });
    if ('marks' in found && ('reg' in found || 'roll' in found)) { Object.assign(cols, found); head = i; }
  }
  if (head < 0) return 'The first row must have the column names: Reg No (or Roll No) and Marks. Download the template to see the format.';
  const cell = (r: string[], k: string) => (k in cols ? String(r[cols[k]] ?? '').trim() : '');
  return raw.slice(head + 1).map((r, i) => ({ line: head + i + 2, reg_no: cell(r, 'reg'), roll_no: cell(r, 'roll'), name: cell(r, 'name'), marks: cell(r, 'marks'), status: cell(r, 'status') })).filter(r => r.reg_no || r.roll_no || r.marks);
}
export interface Checked { line: number; student_id: number | null; name: string; reg_no: string; entry: { marks: number | null; status: 'P' | 'A' | 'L' } | null; skipped: boolean; problem: string | null }
export function checkRows(rows: FileRow[], max: number, students: { id: number; reg_no: string; roll_no: number | null; name: string }[]): Checked[] {
  const byReg = new Map(students.map(s => [s.reg_no.trim().toLowerCase(), s])), byRoll = new Map(students.filter(s => s.roll_no !== null).map(s => [String(s.roll_no), s])), seen = new Set<number>();
  return rows.map(r => {
    const s = (r.reg_no && byReg.get(r.reg_no.toLowerCase())) || (r.roll_no && byRoll.get(String(Number(r.roll_no)))) || null;
    const base = { line: r.line, student_id: s?.id ?? null, name: s?.name ?? r.name, reg_no: s?.reg_no ?? r.reg_no };
    if (!s) return { ...base, entry: null, skipped: false, problem: 'Student not found in this class. Check the Reg No or Roll No.' };
    if (seen.has(s.id)) return { ...base, entry: null, skipped: false, problem: 'This student appears twice in the file.' };
    seen.add(s.id);
    const st = r.status.trim().toUpperCase(), m = r.marks.trim(), mu = m.toLowerCase();
    const statusWord = (x: string) => (['A', 'AB', 'ABS', 'ABSENT'].includes(x) ? 'A' : ['L', 'LEAVE'].includes(x) ? 'L' : ['P', 'PRESENT'].includes(x) ? 'P' : null);
    const fromStatus = st ? statusWord(st) : null; if (st && !fromStatus) return { ...base, entry: null, skipped: false, problem: `Status "${r.status}" is not P, A or L.` };
    if (fromStatus === 'A' || fromStatus === 'L') return { ...base, entry: { marks: null, status: fromStatus }, skipped: false, problem: null };
    const fromMarks = statusWord(mu.toUpperCase()); if (fromMarks === 'A' || fromMarks === 'L') return { ...base, entry: { marks: null, status: fromMarks }, skipped: false, problem: null };
    if (!m) return { ...base, entry: null, skipped: true, problem: null };   // blank: leave what is saved
    const num = Number(m.replace(',', '.'));
    if (!Number.isFinite(num)) return { ...base, entry: null, skipped: false, problem: `"${m}" is not a number. Use a number, A or L.` };
    if (num < 0 || num > max) return { ...base, entry: null, skipped: false, problem: `${num} is outside 0 to ${max}.` };
    return { ...base, entry: { marks: Math.round(num * 100) / 100, status: 'P' }, skipped: false, problem: null };
  });
}
