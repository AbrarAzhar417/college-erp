import zlib from 'node:zlib';

/** Reads the first sheet of an .xlsx file as rows of text. No library: an xlsx is a zip of XML files. Old .xls files are not supported. */
const MAX_PART = 20 * 1024 * 1024;
function entries(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && n < 2000; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The Excel file is damaged.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen); p += 46 + nlen + elen + clen;
    if (!/^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml)$/.test(name)) continue;
    const dataStart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), raw = buf.subarray(dataStart, dataStart + csize);
    try { out.set(name, method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: MAX_PART })); } catch { throw new Error('The Excel file is damaged or too large.'); }
  }
  return out;
}
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const texts = (xml: string) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join('');
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export function readXlsx(buf: Buffer): string[][] {
  const parts = entries(buf);
  const sheetName = [...parts.keys()].filter(k => k.includes('worksheets')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  if (!sheetName) throw new Error('The Excel file has no sheet.');
  const shared = parts.has('xl/sharedStrings.xml') ? [...parts.get('xl/sharedStrings.xml')!.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1])) : [];
  const rows: string[][] = [];
  for (const rm of parts.get(sheetName)!.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] ?? '', ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1], type = /t="(\w+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : row.length; if (idx > 200) continue;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      row[idx] = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? texts(body) : v === undefined ? '' : unxml(v);
    }
    for (let i = 0; i < row.length; i++) row[i] ??= '';
    rows.push(row);
    if (rows.length > 5000) break;
  }
  return rows;
}
