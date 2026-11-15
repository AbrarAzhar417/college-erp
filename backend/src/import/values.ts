export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
export const clean = (v: unknown, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => {
  if (y < 100) y += y > 40 ? 1900 : 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2100 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
};
/** yyyy-mm-dd, dd/mm/yyyy (day first, as used in Pakistan), dd-mm-yy, "12 Jan 2010", or an Excel serial number. Returns null if it is not a real date. */
export function parseDate(v: unknown): string | null {
  const s = clean(v); if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s); if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s); if (m) return iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[ -]([a-z]{3})[a-z]*[ -,]*(\d{2,4})$/i.exec(s); if (m) { const k = MONTHS.indexOf(m[2].toLowerCase()); return k < 0 ? null : iso(+m[3], k + 1, +m[1]); }
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  return null;
}
export function parseGender(v: unknown): 'male' | 'female' | null {
  const s = norm(v); if (!s) return null;
  if (['m', 'male', 'boy', 'son', 'man', 'لڑکا', 'مرد'].includes(s)) return 'male';
  if (['f', 'female', 'girl', 'daughter', 'woman', 'لڑکی', 'عورت'].includes(s)) return 'female';
  return null;
}
export function parseMoney(v: unknown): number | null {
  const s = clean(v).replace(/rs\.?|pkr|,|\s/gi, ''); if (!s) return 0;
  const n = Number(s); return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n) : null;
}
export const parsePhone = (v: unknown) => { const s = clean(v, 40).replace(/[^\d+]/g, ''); return s.length >= 7 ? s.slice(0, 20) : s ? null : ''; };
export const isLeft = (v: unknown) => /left|leave|leav|withdr|struck|soc|pass.?out|inactive|resign|terminat|ختم|فارغ/i.test(clean(v));

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, matric: 10, fsc: 11 };
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
/** "6", "6-A", "Class 6 A", "Six B", "10th", "IX", "XII-C" -> grade and (when written together) section. */
export function parseClass(v: unknown): { grade: number | null; section: string | null } {
  const s = clean(v).toLowerCase().replace(/\b(class|grade|std|standard|cls)\b\.?/g, ' ').replace(/(\d)(st|nd|rd|th)\b/g, '$1').trim();
  if (!s) return { grade: null, section: null };
  const tokens = s.split(/[\s\-_/,.]+/).filter(Boolean);
  let grade: number | null = null, section: string | null = null;
  for (const t of tokens) {
    if (grade === null) { if (/^\d{1,2}$/.test(t)) { grade = +t; continue; } if (WORDS[t]) { grade = WORDS[t]; continue; } if (ROMAN[t]) { grade = ROMAN[t]; continue; } }
    else if (!section && /^[a-z]$/.test(t)) section = t.toUpperCase();
  }
  if (grade === null) { const m = /^(\d{1,2})([a-z])$/.exec(tokens[0] ?? ''); if (m) { grade = +m[1]; section = m[2].toUpperCase(); } }
  return { grade: grade && grade >= 1 && grade <= 12 ? grade : null, section };
}
