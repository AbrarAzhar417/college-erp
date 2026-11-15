/** Small CSV reader: quotes, "" escapes, line breaks inside quotes, BOM, and , ; tab | as separator (guessed from the first lines). */
export function parseCsv(input: string): { delimiter: string; rows: string[][] } {
  const text = input.replace(/^﻿/, '');
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  const delimiter = [',', ';', '\t', '|'].map(d => ({ d, n: head.split(d).length - 1 })).sort((a, b) => b.n - a.n)[0].n > 0
    ? [',', ';', '\t', '|'].map(d => ({ d, n: head.split(d).length - 1 })).sort((a, b) => b.n - a.n)[0].d : ',';
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === '') q = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim() !== '')) rows.push(row);
  return { delimiter, rows };
}
export const toCsv = (rows: (string | number | null | undefined)[][]) => rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
