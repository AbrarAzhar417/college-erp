import { checkRows, type Checked, type FileRow } from '../exam/marksfile.js';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z؀-ۿ ]/g, ' ').split(/\s+/).filter(w => w.length > 1);
/** The name on the sheet should share at least one word with the student found by roll number; otherwise the roll number was probably misread. */
export const nameLooksRight = (onSheet: string, real: string) => {
  const a = norm(onSheet), b = norm(real); if (!a.length || !b.length) return true;
  return a.some(w => b.some(x => x === w || (w.length > 3 && x.startsWith(w.slice(0, 3)))));
};

export interface ScanRow extends Checked { read_marks: string; read_name: string; warning: string | null }

/** Turns what the AI read into the same preview rows the Excel/CSV upload gives, plus a warning where the name does not fit. */
export function scanPreview(read: any, max: number, students: { id: number; reg_no: string; roll_no: number | null; name: string }[]): ScanRow[] {
  const list: any[] = Array.isArray(read?.rows) ? read.rows.slice(0, 300) : [];
  const rows: FileRow[] = list.map((r, i) => ({ line: i + 1, reg_no: String(r.adm_no ?? '').trim(), roll_no: String(r.roll_no ?? '').replace(/\D/g, ''), name: String(r.name ?? '').trim(), marks: String(r.marks ?? '').trim(), status: String(r.status ?? '').trim() }));
  const byId = new Map(students.map(s => [s.id, s]));
  return checkRows(rows, max, students).map((c, i) => {
    const raw = rows[i], real = c.student_id ? byId.get(c.student_id) : null;
    const warning = real && raw.name && !nameLooksRight(raw.name, real.name) ? `The sheet says "${raw.name}" but roll ${real.roll_no ?? ''} is ${real.name}. Check the roll number.` : null;
    return { ...c, read_marks: raw.marks || raw.status, read_name: raw.name, warning };
  });
}
