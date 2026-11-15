import zlib from 'node:zlib';
import JSZip from 'jszip';

/**
 * Reads the text of a CV (PDF, Word .docx / .doc, plain text) without any extra library, then pulls the
 * name, phone, email, CNIC, qualification, city and years of experience out of it.
 * A scanned CV (a picture) has no text: the functions return '' and the office fills the details by hand.
 */

// ---------------------------------------------------------------- Word
async function docxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml');
  if (!f) return '';
  const xml = await f.async('string');
  return decodeEntities(xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<w:br[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ''));
}
const decodeEntities = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/** Old binary .doc: keep the long runs of readable characters (good enough to find a phone number and a name). */
function docText(buf: Buffer): string {
  const runs = (s: string) => (s.match(/[\x20-\x7e -ɏ؀-ۿ\r\n\t]{6,}/g) ?? []).join('\n');
  const a = runs(buf.toString('latin1')), b = runs(buf.toString('utf16le'));
  return (b.length > a.length / 2 ? b + '\n' + a : a).replace(/\r/g, '\n');
}

// ---------------------------------------------------------------- PDF
interface PObj { num: number; dict: string; stream: Buffer | null }
interface PFont { map: Map<number, string> | null; codeLen: number }

function inflate(b: Buffer): Buffer | null {
  try { return zlib.inflateSync(b); } catch { /* maybe truncated or raw */ }
  try { return zlib.inflateRawSync(b); } catch { return null; }
}

/** ASCII85 (reportlab and some other generators wrap every stream in it). */
function ascii85(b: Buffer): Buffer {
  const s = b.toString('latin1').replace(/\s+/g, '').replace(/^<~/, ''), end = s.indexOf('~>'), t = end >= 0 ? s.slice(0, end) : s, out: number[] = [];
  let grp: number[] = [];
  const flush = (n: number) => { let v = 0; for (let i = 0; i < 5; i++) v = v * 85 + (grp[i] ?? 84); for (let i = 0; i < n - 1; i++) out.push((v >>> (24 - 8 * i)) & 255); grp = []; };
  for (const ch of t) {
    if (ch === 'z' && !grp.length) { out.push(0, 0, 0, 0); continue; }
    grp.push(ch.charCodeAt(0) - 33);
    if (grp.length === 5) flush(5);
  }
  if (grp.length > 1) flush(grp.length);
  return Buffer.from(out);
}

function parseObjects(buf: Buffer): Map<number, PObj> {
  const s = buf.toString('latin1'), objs = new Map<number, PObj>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, end = s.indexOf('endobj', start);
    if (end < 0) break;
    const body = s.slice(start, end), si = body.indexOf('stream');
    let dict = body, stream: Buffer | null = null;
    if (si >= 0 && /^\s*stream/.test(body.slice(si - 0)) ) {
      dict = body.slice(0, si);
      let from = start + si + 6;
      if (s[from] === '\r') from++;
      if (s[from] === '\n') from++;
      const to = s.lastIndexOf('endstream', end);
      let raw = buf.subarray(from, to > from ? to : end);
      if (/\/ASCII85Decode|\/A85\b/.test(dict)) raw = ascii85(raw);
      if (/\/FlateDecode|\/Fl\b/.test(dict)) { const d = inflate(raw); raw = d ?? Buffer.alloc(0); }
      stream = raw;
    }
    objs.set(Number(m[1]), { num: Number(m[1]), dict, stream });
    re.lastIndex = end + 6;
  }
  // objects packed inside object streams (/Type /ObjStm), common in PDFs saved by Word
  for (const o of [...objs.values()]) {
    if (!o.stream || !/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] ?? 0), first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const text = o.stream.toString('latin1'), head = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = head[i * 2], off = head[i * 2 + 1], next = i + 1 < n ? head[(i + 1) * 2 + 1] : text.length - first;
      if (Number.isFinite(num) && Number.isFinite(off)) objs.set(num, { num, dict: text.slice(first + off, first + next), stream: null });
    }
  }
  return objs;
}

const hexToStr = (h: string) => { let o = ''; for (let i = 0; i + 3 < h.length + 1; i += 4) { const c = parseInt(h.slice(i, i + 4), 16); if (!Number.isNaN(c)) o += String.fromCharCode(c); } return o; };

function parseCMap(text: string): { map: Map<number, string>; codeLen: number } {
  const map = new Map<number, string>();
  const cs = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(text);
  const codeLen = cs ? Math.max(1, Math.round(cs[1].length / 2)) : 1;
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]+>)/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[3].startsWith('[')) { [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((d, i) => map.set(lo + i, hexToStr(d[1]))); }
      else { const base = hexToStr(m[3].slice(1, -1)); for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo))); }
    }
  }
  return { map, codeLen };
}

function refs(s: string): number[] { return [...s.matchAll(/(\d+)\s+\d+\s+R/g)].map(m => Number(m[1])); }
/** The text between the << >> that follows `key` in a dictionary (balanced), or the object it points to. */
function subDict(dict: string, key: string, objs: Map<number, PObj>): string {
  const i = dict.search(new RegExp(`/${key}\\b`));
  if (i < 0) return '';
  const rest = dict.slice(i + key.length + 1).trimStart();
  const r = /^(\d+)\s+\d+\s+R/.exec(rest);
  if (r) return objs.get(Number(r[1]))?.dict ?? '';
  if (rest.startsWith('<<')) { let d = 0, k = 0; for (; k < rest.length; k++) { if (rest.startsWith('<<', k)) { d++; k++; } else if (rest.startsWith('>>', k)) { d--; k++; if (!d) break; } } return rest.slice(0, k + 1); }
  return '';
}

function pageOrder(objs: Map<number, PObj>): PObj[] {
  const pages = [...objs.values()].filter(o => /\/Type\s*\/Page\b(?!s)/.test(o.dict));
  const root = [...objs.values()].find(o => /\/Type\s*\/Pages\b/.test(o.dict) && !/\/Parent\b/.test(o.dict));
  if (!root) return pages.sort((a, b) => a.num - b.num);
  const out: PObj[] = [], seen = new Set<number>();
  const walk = (o: PObj) => {
    if (seen.has(o.num)) return; seen.add(o.num);
    if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) { out.push(o); return; }
    const kids = subKids(o.dict, objs);
    for (const k of kids) { const c = objs.get(k); if (c) walk(c); }
  };
  walk(root);
  return out.length ? out : pages.sort((a, b) => a.num - b.num);
}
function subKids(dict: string, objs: Map<number, PObj>): number[] {
  const m = /\/Kids\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(dict);
  if (!m) return [];
  return m[1].startsWith('[') ? refs(m[1]) : refs(objs.get(refs(m[1])[0])?.dict ?? '');
}

function pdfString(tok: string, font: PFont | undefined): string {
  let bytes: number[] = [];
  if (tok[0] === '<') { const h = tok.slice(1, -1).replace(/\s+/g, ''); for (let i = 0; i < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2).padEnd(2, '0'), 16)); }
  else {
    const t = tok.slice(1, -1);
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c !== '\\') { bytes.push(t.charCodeAt(i) & 255); continue; }
      const n = t[++i];
      if (n === 'n') bytes.push(10); else if (n === 'r') bytes.push(13); else if (n === 't') bytes.push(9); else if (n === 'b') bytes.push(8); else if (n === 'f') bytes.push(12);
      else if (n >= '0' && n <= '7') { let o = n; while (o.length < 3 && t[i + 1] >= '0' && t[i + 1] <= '7') o += t[++i]; bytes.push(parseInt(o, 8) & 255); }
      else if (n === '\n' || n === '\r') { /* line continuation */ } else if (n !== undefined) bytes.push(n.charCodeAt(0) & 255);
    }
  }
  if (font?.map) {
    let out = '';
    for (let i = 0; i < bytes.length; i += font.codeLen) {
      let code = 0; for (let k = 0; k < font.codeLen; k++) code = (code << 8) | (bytes[i + k] ?? 0);
      out += font.map.get(code) ?? '';
    }
    return out;
  }
  return String.fromCharCode(...bytes.filter(b => b >= 32 || b === 9));
}

function contentText(content: string, fonts: Map<string, PFont>): string {
  const tok = /\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[|\]|\/[^\s\/\[\]<>()]+|[-+]?\d*\.?\d+|[A-Za-z'"*]+/g;
  let out = '', font: PFont | undefined, lastY = Number.NaN, stack: any[] = [], arr: any[] | null = null, m: RegExpExecArray | null;
  const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  while ((m = tok.exec(content))) {
    const t = m[0], c = t[0];
    if (t === '[') { arr = []; continue; }
    if (t === ']') { if (arr) { stack.push({ arr }); arr = null; } continue; }
    if (c === '(' || c === '<') { (arr ?? stack).push({ s: t }); continue; }
    if (c === '/') { stack.push({ name: t.slice(1) }); continue; }
    if (/^[-+.\d]/.test(t)) { (arr ?? stack).push({ n: Number(t) }); continue; }
    // an operator
    switch (t) {
      case 'Tf': { const nm = stack[stack.length - 2]?.name; font = nm ? fonts.get(nm) : undefined; break; }
      case 'Tj': { const a = stack[stack.length - 1]; if (a?.s) out += pdfString(a.s, font); break; }
      case "'": case '"': { const a = stack[stack.length - 1]; nl(); if (a?.s) out += pdfString(a.s, font); break; }
      case 'TJ': {
        const a = stack[stack.length - 1]?.arr as any[] | undefined;
        if (a) for (const e of a) { if (e.s) out += pdfString(e.s, font); else if (e.n !== undefined && e.n < -250 && !out.endsWith(' ')) out += ' '; }
        break;
      }
      case 'Td': case 'TD': { const ty = stack[stack.length - 1]?.n ?? 0; if (Math.abs(ty) > 0.5) nl(); break; }
      case 'T*': nl(); break;
      case 'Tm': { const y = stack[stack.length - 1]?.n; if (y !== undefined && Math.abs(y - lastY) > 1) nl(); else if (!out.endsWith(' ') && !out.endsWith('\n')) out += ' '; if (y !== undefined) lastY = y; break; }
      case 'ET': nl(); break;
    }
    stack = [];
  }
  return out;
}

function pdfText(buf: Buffer): string {
  const objs = parseObjects(buf);
  if (/\/Encrypt\b/.test(buf.toString('latin1', Math.max(0, buf.length - 2048)))) return '';
  const fontCache = new Map<number, PFont>();
  const fontOf = (num: number): PFont => {
    let f = fontCache.get(num); if (f) return f;
    const o = objs.get(num), tu = o ? /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.dict) : null;
    const cm = tu ? objs.get(Number(tu[1]))?.stream : null;
    f = cm ? (() => { const p = parseCMap(cm.toString('latin1')); return { map: p.map, codeLen: p.codeLen }; })() : { map: null, codeLen: 1 };
    fontCache.set(num, f); return f;
  };
  const resourcesOf = (p: PObj): string => {
    for (let o: PObj | undefined = p, k = 0; o && k < 8; k++) {
      const r = subDict(o.dict, 'Resources', objs); if (r) return r;
      const par = /\/Parent\s+(\d+)\s+\d+\s+R/.exec(o.dict); o = par ? objs.get(Number(par[1])) : undefined;
    }
    return '';
  };
  let text = '';
  for (const p of pageOrder(objs)) {
    const fonts = new Map<string, PFont>();
    const fd = subDict(resourcesOf(p), 'Font', objs);
    for (const m of fd.matchAll(/\/([^\s\/\[\]<>()]+)\s+(\d+)\s+\d+\s+R/g)) fonts.set(m[1], fontOf(Number(m[2])));
    const cm = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(p.dict);
    for (const n of cm ? refs(cm[1]) : []) { const st = objs.get(n)?.stream; if (st) text += contentText(st.toString('latin1'), fonts) + '\n'; }
    text += '\n';
  }
  return text;
}

// ---------------------------------------------------------------- entry point
export async function extractText(buf: Buffer, ext: string): Promise<string> {
  try {
    const e = ext.toLowerCase();
    const raw = e === 'docx' ? await docxText(buf) : e === 'doc' ? docText(buf) : e === 'pdf' ? pdfText(buf) : e === 'txt' ? buf.toString('utf8') : '';
    return raw.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 60000);
  } catch { return ''; }
}

// ---------------------------------------------------------------- reading the details
export interface CvInfo { name: string | null; phone: string | null; email: string | null; cnic: string | null; qualification: string | null; experience_years: number | null; city: string | null }

const QUAL: [string, RegExp][] = [
  ['PhD', /\b(ph\.?\s?d|doctorate)\b/i], ['M.Phil', /\b(m\.?\s?phil)\b/i], ['MS / M.Sc / MA / M.Ed', /\b(m\.?\s?sc|m\.?\s?a\b|m\.?\s?ed|m\.?\s?s\b|mba|mcs|masters?|ma\s+(english|urdu|islamiat|education|economics|psychology|mass))/i],
  ['BS / B.Sc / BA / B.Ed', /\b(b\.?\s?s\b|bs\s*\(|b\.?\s?sc|b\.?\s?a\b|b\.?\s?ed|bba|bcs|bachelors?|b\.?\s?com|bs\s+(hons|computer|physics|math|chem))/i],
  ['FSc / FA / ICS / I.Com', /\b(f\.?\s?sc|f\.?\s?a\b|ics\b|i\.?\s?com|intermediate|hssc|dae)\b/i], ['Matric / SSC', /\b(matric|ssc|o[- ]?level)\b/i]
];
export const QUAL_RANK = (q: string | null | undefined): number => { if (!q) return -1; const i = QUAL.findIndex(([label, re]) => label.toLowerCase() === q.toLowerCase() || re.test(q)); return i < 0 ? -1 : QUAL.length - i; };
const CITIES = ['Islamabad', 'Rawalpindi', 'Lahore', 'Karachi', 'Peshawar', 'Quetta', 'Faisalabad', 'Multan', 'Gujranwala', 'Sialkot', 'Sargodha', 'Hyderabad', 'Abbottabad', 'Wah Cantt', 'Wah', 'Taxila', 'Attock', 'Jhelum', 'Bahawalpur', 'Mardan', 'Swat', 'Mirpur', 'Muzaffarabad'];
const NOT_NAME = /(curriculum|vitae|resume|résumé|\bcv\b|profile|objective|address|e-?mail|contact|phone|mobile|cell|skills|education|experience|personal|summary|declaration|references?|page \d)/i;

export function parseCv(text: string): CvInfo {
  const t = text ?? '';
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(t)?.[0].toLowerCase() ?? null;
  const ph = /(?:\+?\s?92[\s-]?|\b0)\(?3\d{2}\)?[\s-]?\d{7}\b/.exec(t)?.[0] ?? /\b0\d{2,3}[\s-]?\d{7}\b/.exec(t)?.[0] ?? null;
  let phone: string | null = null;
  if (ph) { let d = ph.replace(/\D/g, ''); if (d.startsWith('92')) d = '0' + d.slice(2); phone = d.length === 11 ? d : d; }
  const cnic = /\b\d{5}-?\d{7}-?\d\b/.exec(t)?.[0] ?? null;
  let name: string | null = null;
  const labelled = /(?:^|\n)\s*(?:full\s+)?name\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{2,50})/i.exec(t);
  if (labelled) name = labelled[1].trim();
  else for (const line of t.split('\n').slice(0, 12).map(l => l.trim()).filter(Boolean)) {
    const w = line.split(/\s+/);
    if (w.length >= 2 && w.length <= 4 && /^[A-Za-z][A-Za-z .'-]+$/.test(line) && !NOT_NAME.test(line) && line.length <= 40) { name = line; break; }
  }
  if (name) name = name.replace(/\s+/g, ' ').replace(/\w\S*/g, w => (w === w.toUpperCase() || w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).trim();
  let exp: number | null = null;
  const e1 = /(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)(?:'s)?\s*(?:of\s+)?(?:\w+\s+){0,2}experience/i.exec(t) ?? /experience\s*[:\-–]?\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i.exec(t);
  if (e1) exp = Number(e1[1]);
  else {
    const span = [...t.matchAll(/\b((?:19|20)\d{2})\s*[-–to]+\s*((?:19|20)\d{2}|present|till date|to date|current)\b/gi)];
    const now = new Date().getFullYear();
    if (span.length) exp = Math.min(40, span.reduce((a, m) => a + Math.max(0, (/^\d/.test(m[2]) ? Number(m[2]) : now) - Number(m[1])), 0)) || null;
  }
  const qual = QUAL.find(([, re]) => re.test(t))?.[0] ?? null;
  const city = CITIES.find(c => new RegExp(`\\b${c}\\b`, 'i').test(t)) ?? null;
  return { name, phone, email, cnic, qualification: qual, experience_years: exp, city };
}

// ---------------------------------------------------------------- score out of 100
export interface Score { score: number; keywords: number; experience: number; qualification: number; found: string[]; missing: string[] }
const firstNumber = (s: string | null | undefined) => { const m = /(\d+(?:\.\d+)?)/.exec(s ?? ''); return m ? Number(m[1]) : null; };

/** keywords 40, experience 30, qualification 30 (when a post has no keywords, those 40 marks are shared by the other two). */
export function scoreCandidate(c: { qualification: string | null; experience_years: number | null; notes?: string | null }, job: { keywords?: string | null; experience?: string | null; qualification?: string | null } | null, text: string): Score {
  const kws = (job?.keywords ?? '').split(/[,\n;]+/).map(k => k.trim().toLowerCase()).filter(Boolean);
  const hay = `${text}\n${c.qualification ?? ''}\n${c.notes ?? ''}`.toLowerCase();
  const found = kws.filter(k => hay.includes(k)), missing = kws.filter(k => !hay.includes(k));
  const wk = kws.length ? 40 : 0, rest = 100 - wk, we = Math.round(rest / 2), wq = rest - we;
  const kw = kws.length ? Math.round((wk * found.length) / kws.length) : 0;
  const req = firstNumber(job?.experience), have = c.experience_years;
  const exp = have === null ? Math.round(we * 0.3) : req === null || req === 0 ? we : Math.round(we * Math.min(1, have / req));
  const needQ = QUAL_RANK(job?.qualification), textQ = QUAL.find(([, re]) => re.test(text))?.[0] ?? null, haveQ = Math.max(QUAL_RANK(c.qualification), QUAL_RANK(textQ));
  const qual = haveQ < 0 ? Math.round(wq * 0.3) : needQ < 0 || haveQ >= needQ ? wq : haveQ === needQ - 1 ? Math.round(wq * 0.5) : Math.round(wq * 0.2);
  return { score: Math.min(100, kw + exp + qual), keywords: kw, experience: exp, qualification: qual, found, missing };
}
