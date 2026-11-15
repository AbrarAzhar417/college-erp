import { SafeHtml } from '@angular/platform-browser';

export interface Exam { year: string; roll: string; marks: string; total: string; grade: string; subjects: string; board: string }
export interface FeeLine { name: string; when: string; amount: number }
export interface FeeView {
  category: string; rows: FeeLine[]; discounts: { text: string; amount: number }[]; transport: FeeLine | null;
  monthly: number; once: number; firstPayable: number;
}
export interface ChartRow { name: string; when: string; A: number; B: number; C: number }
export interface Chart { className: string; rows: ChartRow[]; monthly: { A: number; B: number; C: number }; once: { A: number; B: number; C: number }; routes: { name: string; both: number; one: number }[] }
export interface Transport { need: boolean; route: string; stop: string; mode: string; fee: number; times?: string }

/** Everything a printed form shows, already turned into text, so the two form layouts only have to place it. */
export interface FormView {
  filled: boolean; regNo: string; issueDate: string; category: string; className: string; session: string;
  name: string; dob: string; pob: string; religion: string; nationality: string; bform: string;
  father: string; fatherQual: string; fatherDesig: string; fatherDiv: string; cnic: string; pno: string; spsBps: string; income: string;
  address: string; permanent: string; telOffice: string; telRes: string; cell: string; mother: string;
  prevSchool: string; duesUpto: string; prevClass: string; medium: string; distinction: string; cocurricular: string; sports: string;
  group: string; ssc: Exam; hssc1: Exam; health: string; disease: string; doctor: string; diseaseStatus: string; future: string;
  siblings: { name: string; class_session: string }[];
  transport: Transport; photo: string | null; qr: SafeHtml | null; missing: string[];
  testDate: string; house: string; decision: string; decisionDate: string; admissionNo: string; section: string; admissionDate: string;
  feeReceived: string; receiptNo: string; receiptDate: string;
  fee: FeeView | null; chart: Chart | null;
  bloodGroup: string; officialAddress: string; admitClass: string; reported: string; dobWords: string; remarks: string;
  result: Marks; retest: Marks;
}
export interface Marks { urdu: string; english: string; maths: string; science: string; total: string }

export const GROUPS = ['Pre Medical', 'Pre-Engineering', 'Sc. General', 'Humanities (a)', 'Humanities (b)', 'Commerce'];
export const MODE_LABEL: Record<string, string> = { both: 'Pick and drop', pickup: 'Pick up only', drop: 'Drop only' };

/** 15 cells for a CNIC / B-form number: 13 digits with a dash after the 5th and the 12th. */
/** 12345-1234567-1 while typing. */
export function fmtCnic(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 13);
  return d.length > 12 ? `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}` : d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
/** 0300-1234567 while typing; +92 / 92 is turned into 0. */
export function fmtPhone(v: string): string {
  let d = (v || '').replace(/\D/g, '');
  if (d.startsWith('92') && d.length > 10) d = '0' + d.slice(2);
  d = d.slice(0, 11);
  return d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
}

export function cnicCells(v: string): string[] {
  const d = (v || '').replace(/\D/g, '').slice(0, 13).split('');
  const out: string[] = []; let k = 0;
  for (let i = 0; i < 15; i++) out.push(i === 5 || i === 13 ? '-' : (d[k++] ?? ''));
  return out;
}

/** Shared print styles of both forms. */
export const FORM_CSS = `
  * { box-sizing: border-box; }
  .pg { width: var(--pw, 194mm); zoom: var(--ps, 1); margin: 0 auto 4mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.25; padding: 2mm 3mm; page-break-after: always; position: relative; }
  .pg:last-child { page-break-after: auto; }
  .cen { text-align: center; } .t1 { font-size: 17pt; font-weight: 800; margin: 0; } .t2 { font-size: 12.5pt; font-weight: 800; text-decoration: underline; margin: 0; } .t3 { font-size: 9.5pt; font-weight: 700; margin: 0; }
  .logo { width: 24mm; height: 22mm; margin: 0 auto; display: flex; align-items: center; justify-content: center; } .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .logo span { width: 20mm; height: 20mm; border-radius: 50%; border: .5mm solid #000; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16pt; }
  .f { display: flex; align-items: flex-end; gap: 1.5mm; margin: .9mm 0; min-height: 5mm; } .f > .n { width: 8mm; flex: none; } .f > .q { white-space: nowrap; }
  .ln { flex: 1; border-bottom: .25mm dotted #000; min-height: 4.4mm; padding: 0 1mm; font-weight: 700; font-size: 9.5pt; overflow: hidden; }
  .sol .ln { border-bottom-style: solid; }
  .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 6mm; } .g3 { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 0 4mm; }
  .sub { padding-left: 8mm; }
  .bold { font-weight: 800; } .u { text-decoration: underline; }
  .bar { background: #111; color: #fff; text-align: center; font-weight: 800; padding: .8mm 0; margin: 2mm 0; font-size: 10pt; }
  .sig { display: flex; justify-content: space-between; margin-top: 8mm; font-weight: 700; font-size: 9.5pt; } .sig div { border-top: .3mm solid #000; padding-top: 1mm; min-width: 44mm; text-align: center; }
  .bx { display: inline-block; width: 6mm; height: 6.5mm; border: .3mm solid #000; text-align: center; font-weight: 700; font-size: 9pt; line-height: 6mm; vertical-align: middle; }
  .bxs { display: inline-flex; margin-left: 1mm; } .bxs .bx { border-right-width: 0; } .bxs .bx:last-child { border-right-width: .3mm; }
  .tick { display: inline-block; width: 4mm; height: 4mm; border: .3mm solid #000; text-align: center; font-size: 8pt; line-height: 3.5mm; vertical-align: -.6mm; margin: 0 1mm 0 2mm; font-weight: 800; }
  table.tb { width: 100%; border-collapse: collapse; } .tb th, .tb td { border: .3mm solid #000; padding: 1.2mm 1.5mm; font-size: 9pt; text-align: left; } .tb th { font-weight: 800; } .tb .r { text-align: right; }
  .dec { padding-left: 6mm; margin: 2mm 0; } .dec li { margin: 2.2mm 0; text-align: justify; }
  .photo { width: 36mm; height: 44mm; border: .3mm solid #000; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 9pt; flex: none; } img.photo { object-fit: cover; display: block; }
  .qr { width: 17mm; height: 17mm; margin: 0 auto; } .sigrow { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; column-gap: 4mm; } .sigrow > :first-child { justify-self: start; } .sigrow > :last-child { justify-self: end; } .qr svg { width: 100%; height: 100%; display: block; }
  .feebox { border: .35mm solid #000; padding: 2mm 3mm; margin: 3mm 0; } .feebox h4 { margin: 0 0 1.5mm; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .05em; }
  .small { font-size: 8pt; color: #333; }
  .sel { font-weight: 800; border: .35mm solid #000; border-radius: 3mm; padding: 0 2mm; }
`;

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const ORD = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const below100 = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));

/** "2012-03-15" -> "Fifteenth March Two Thousand Twelve" (the form asks for the date of birth in words). */
export function dateInWords(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!mo || mo > 12 || !d || d > 31) return '';
  const day = d <= 20 ? ORD[d] : d === 30 ? 'Thirtieth' : TENS[Math.floor(d / 10)] + ' ' + ORD[d % 10];
  let year: string;
  if (y >= 2000 && y < 2100) year = 'Two Thousand' + (y % 100 ? ' ' + below100(y % 100) : '');
  else if (y >= 1900 && y < 2000) year = 'Nineteen' + (y % 100 ? ' ' + below100(y % 100) : ' Hundred');
  else year = String(y);
  return `${day} ${MONTHS[mo - 1]} ${year}`;
}
