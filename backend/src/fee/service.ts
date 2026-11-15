import { db, getSetting, setSetting } from '../db.js';
import { siblingOrder } from '../family.js';

export const pad = (n: number, w: number) => String(n).padStart(w, '0');
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const payable = (net: number, arrears: number) => Math.max(0, net + arrears);

// ---------- settings used on vouchers ----------
const DEFAULT_NOTES = [
  'Deposit the fee on or before the due date.',
  'A late fine is charged after the due date.',
  'Keep this voucher and the bank receipt safe.',
  'Fee once paid is not refundable.'
].join('\n');

export const FEE_KEYS = ['bank_name', 'bank_branch', 'account_title', 'account_no', 'iban', 'late_fine', 'due_day', 'voucher_notes'] as const;

export function feeSettings() {
  return {
    bank_name: getSetting('bank_name'), bank_branch: getSetting('bank_branch'), account_title: getSetting('account_title'),
    account_no: getSetting('account_no'), iban: getSetting('iban'),
    late_fine: Number(getSetting('late_fine') || 100), due_day: Number(getSetting('due_day') || 10),
    voucher_notes: getSetting('voucher_notes') || DEFAULT_NOTES
  };
}
export function saveFeeSettings(b: Record<string, unknown>) {
  for (const k of FEE_KEYS) if (b[k] !== undefined) setSetting(k, String(b[k]).trim().slice(0, k === 'voucher_notes' ? 600 : 120));
}

export function institute() {
  const f = feeSettings();
  return {
    name: getSetting('institute_name'), shortName: getSetting('short_name'), address: getSetting('inst_address'),
    phone: getSetting('inst_phone'), email: getSetting('inst_email'),
    hasLogo: !!getSetting('logo'), logoVersion: getSetting('logo_version'),
    bank: { name: f.bank_name, branch: f.bank_branch, title: f.account_title || getSetting('institute_name'), accountNo: f.account_no, iban: f.iban },
    lateFine: f.late_fine, notes: f.voucher_notes.split('\n').map(x => x.trim()).filter(Boolean)
  };
}

// ---------- the student account ----------
export interface VAlloc { net: number; paid: number; balance: number }

/**
 * Payments and waivers are applied to the oldest charges first (FIFO).
 * Returns, for every voucher of the given students, how much of it is paid.
 */
export function allocate(studentIds: number[]): Map<number, VAlloc> {
  const out = new Map<number, VAlloc>();
  for (let i = 0; i < studentIds.length; i += 500) {
    const chunk = studentIds.slice(i, i + 500);
    const rows = db.prepare(`SELECT student_id, amount, voucher_id FROM ledger WHERE student_id IN (${chunk.map(() => '?').join(',')}) ORDER BY student_id, date, id`).all(...chunk) as any[];
    const by = new Map<number, any[]>();
    for (const r of rows) (by.get(r.student_id) ?? by.set(r.student_id, []).get(r.student_id)!).push(r);
    for (const list of by.values()) {
      let credit = 0;
      for (const r of list) if (r.amount < 0) credit += -r.amount;
      for (const r of list) if (r.amount > 0) {
        const take = Math.min(r.amount, credit); credit -= take;
        if (r.voucher_id) out.set(r.voucher_id, { net: r.amount, paid: take, balance: r.amount - take });
      }
    }
  }
  return out;
}
export const allocOf = (m: Map<number, VAlloc>, v: { id: number; net: number }): VAlloc => m.get(v.id) ?? { net: v.net, paid: v.net, balance: 0 };

export const balanceOf = (studentId: number) =>
  (db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE student_id = ?').get(studentId) as { n: number }).n;

// ---------- building a voucher ----------
interface Item { head_id: number | null; description: string; amount: number }
interface Ctx {
  heads: any[]; structure: Map<string, number>; studentHeads: Map<number, Map<number, number | null>>;
  concessions: Map<number, any[]>; concessionable: Set<number>; fixed: Map<string, number>;
}

function loadCtx(): Ctx {
  const heads = db.prepare('SELECT * FROM fee_heads WHERE active = 1 ORDER BY sort, id').all() as any[];
  const structure = new Map<string, number>();
  for (const r of db.prepare('SELECT class_id, head_id, amount FROM fee_structure').all() as any[]) structure.set(`${r.class_id}-${r.head_id}`, r.amount);
  const studentHeads = new Map<number, Map<number, number | null>>();
  for (const r of db.prepare('SELECT student_id, head_id, amount FROM student_heads').all() as any[])
    (studentHeads.get(r.student_id) ?? studentHeads.set(r.student_id, new Map()).get(r.student_id)!).set(r.head_id, r.amount);
  const concessions = new Map<number, any[]>();
  for (const r of db.prepare('SELECT * FROM student_concessions').all() as any[])
    (concessions.get(r.student_id) ?? concessions.set(r.student_id, []).get(r.student_id)!).push(r);
  const fixed = new Map<string, number>();
  for (const r of db.prepare('SELECT class_id, category, head_id, amount FROM fee_category_fees').all() as any[]) fixed.set(`${r.class_id}-${r.category}-${r.head_id}`, r.amount);
  return { heads, structure, studentHeads, concessions, fixed, concessionable: new Set(heads.filter(h => h.concessionable).map(h => h.id)) };
}

function draftFor(ctx: Ctx, st: { id: number; class_id: number; category: string | null }, includeMonthly: boolean, include: Set<number>): Item[] {
  const items: Item[] = []; const extra: Item[] = [];
  const sh = ctx.studentHeads.get(st.id), fixedHeads = new Set<number>();
  for (const h of ctx.heads) {
    if (!(h.frequency === 'monthly' ? includeMonthly : include.has(h.id))) continue;
    if (h.optional && !sh?.has(h.id)) continue;
    // a student's own amount wins, then the fixed fee of his category, then the class fee
    const fx = st.category ? ctx.fixed.get(`${st.class_id}-${st.category}-${h.id}`) : undefined;
    if (fx !== undefined && sh?.get(h.id) == null) fixedHeads.add(h.id);
    const amt = sh?.get(h.id) ?? fx ?? ctx.structure.get(`${st.class_id}-${h.id}`) ?? 0;
    if (amt > 0) items.push({ head_id: h.id, description: h.name, amount: amt });
  }
  // Each concession works on what is left after the earlier ones, so two rules can never take more than the fee.
  const taken = new Map<Item, number>();
  for (const c of ctx.concessions.get(st.id) ?? []) {
    const isCat = String(c.reason ?? '').startsWith('CAT:');
    const target = items.filter(i => i.amount > 0 && !(isCat && fixedHeads.has(i.head_id!)) && (c.head_id ? i.head_id === c.head_id : ctx.concessionable.has(i.head_id!)));
    const left = (i: Item) => i.amount - (taken.get(i) ?? 0);
    const base = target.reduce((a, i) => a + left(i), 0);
    if (!base) continue;
    const d = Math.min(base, c.kind === 'percent' ? Math.round((base * c.value) / 100) : Math.round(c.value));
    if (d <= 0) continue;
    let rest = d;
    for (const i of target) { const t = Math.min(rest, left(i)); taken.set(i, (taken.get(i) ?? 0) + t); rest -= t; if (!rest) break; }
    extra.push({ head_id: c.head_id ?? null, description: c.reason ? `Concession - ${c.reason}` : 'Concession', amount: -d });
  }
  items.push(...extra);
  return items;
}

export interface GenOpts {
  period: string; label: string; issueDate: string; dueDate: string;
  scope: { classId?: number; sectionId?: number; studentId?: number };
  includeMonthly: boolean; includeHeadIds: number[]; lateFine: number; createdBy: number | null;
}

function pickStudents(scope: GenOpts['scope']) {
  const where = ["st.status = 'active'"]; const params: any[] = [];
  if (scope.studentId) { where.push('st.id = ?'); params.push(scope.studentId); }
  else {
    if (scope.sectionId) { where.push('s.id = ?'); params.push(scope.sectionId); }
    else if (scope.classId) { where.push('c.id = ?'); params.push(scope.classId); }
  }
  return db.prepare(`SELECT st.id, st.name, st.category, c.id AS class_id FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
    WHERE ${where.join(' AND ')} ORDER BY c.grade, s.name, st.roll_no, st.name`).all(...params) as { id: number; name: string; category: string | null; class_id: number }[];
}

export function previewVouchers(o: GenOpts) {
  const ctx = loadCtx();
  const have = new Set((db.prepare("SELECT student_id FROM vouchers WHERE period = ? AND status = 'open'").all(o.period) as any[]).map(r => r.student_id));
  const inc = new Set(o.includeHeadIds);
  let willCreate = 0, alreadyHave = 0, noAmounts = 0, total = 0;
  const students = pickStudents(o.scope);
  for (const st of students) {
    if (have.has(st.id)) { alreadyHave++; continue; }
    const items = draftFor(ctx, st, o.includeMonthly, inc);
    if (!items.length) { noAmounts++; continue; }
    willCreate++; total += items.reduce((a, i) => a + i.amount, 0);
  }
  return { students: students.length, willCreate, alreadyHave, noAmounts, total };
}

export function generateVouchers(o: GenOpts) {
  const ctx = loadCtx();
  const have = new Set((db.prepare("SELECT student_id FROM vouchers WHERE period = ? AND status = 'open'").all(o.period) as any[]).map(r => r.student_id));
  const inc = new Set(o.includeHeadIds);
  const created: number[] = [];
  const skipped: { studentId: number; name: string; reason: string }[] = [];
  const insV = db.prepare(`INSERT INTO vouchers (seq, voucher_no, student_id, period, period_label, issue_date, due_date, gross, discount, net, arrears, late_fine, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insI = db.prepare('INSERT INTO voucher_items (voucher_id, head_id, description, amount) VALUES (?,?,?,?)');
  const insL = db.prepare("INSERT INTO ledger (student_id, date, kind, amount, voucher_id, note) VALUES (?,?,'charge',?,?,?)");
  const yymm = o.issueDate.slice(2, 4) + o.issueDate.slice(5, 7);

  db.transaction(() => {
    let seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM vouchers').get() as any).n;
    for (const st of pickStudents(o.scope)) {
      if (have.has(st.id)) { skipped.push({ studentId: st.id, name: st.name, reason: 'Already has a voucher for this period.' }); continue; }
      const items = draftFor(ctx, st, o.includeMonthly, inc);
      if (!items.length) { skipped.push({ studentId: st.id, name: st.name, reason: 'No fee amounts are set for this class.' }); continue; }
      const gross = items.filter(i => i.amount > 0).reduce((a, i) => a + i.amount, 0);
      const discount = -items.filter(i => i.amount < 0).reduce((a, i) => a + i.amount, 0);
      const net = gross - discount;
      seq++;
      const no = `${yymm}-${pad(seq, 5)}`;
      const id = Number(insV.run(seq, no, st.id, o.period, o.label, o.issueDate, o.dueDate, gross, discount, net, balanceOf(st.id), o.lateFine, o.createdBy).lastInsertRowid);
      for (const i of items) insI.run(id, i.head_id, i.description, i.amount);
      insL.run(st.id, o.issueDate, net, id, `Fee voucher ${no} (${o.label})`);
      created.push(id);
    }
  })();
  return { created, skipped };
}

// ---------- data for printing ----------
export function printData(ids: number[]) {
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const c = ids.slice(i, i + 500);
    rows.push(...db.prepare(`
      SELECT v.*, st.name, st.father_name, st.gender, st.phone, st.address, st.reg_no, st.roll_no, st.father_cnic, st.admission_date,
             c.name AS class_name, c.grade, s.name AS section_name
      FROM vouchers v JOIN students st ON st.id = v.student_id JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
      WHERE v.id IN (${c.map(() => '?').join(',')})`).all(...c));
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const alloc = allocate([...new Set(rows.map(r => r.student_id))]);
  const itemRows = new Map<number, any[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const c = ids.slice(i, i + 500);
    for (const it of db.prepare(`SELECT voucher_id, head_id, description, amount FROM voucher_items WHERE voucher_id IN (${c.map(() => '?').join(',')}) ORDER BY id`).all(...c) as any[])
      (itemRows.get(it.voucher_id) ?? itemRows.set(it.voucher_id, []).get(it.voucher_id)!).push(it);
  }
  return rows.map(r => {
    const a = allocOf(alloc, r);
    const pay = payable(r.net, r.arrears);
    return { ...r, items: itemRows.get(r.id) ?? [], payable: pay, after_due: pay > 0 ? pay + r.late_fine : 0, paid: r.status === 'open' && a.balance <= 0 };
  });
}

// ---------- payments ----------
export function recordPayment(o: { studentId: number; amount: number; paidOn: string; mode: string; reference?: string; note?: string; voucherId?: number | null; addFine?: number; receivedBy: number | null }) {
  const yymm = o.paidOn.slice(2, 4) + o.paidOn.slice(5, 7);
  return db.transaction(() => {
    if (o.addFine && o.addFine > 0)
      db.prepare("INSERT INTO ledger (student_id, date, kind, amount, note) VALUES (?, ?, 'fine', ?, 'Late fee fine')").run(o.studentId, o.paidOn, Math.round(o.addFine));
    const seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM payments').get() as any).n;
    const no = `R${yymm}-${pad(seq, 5)}`;
    const id = Number(db.prepare(`INSERT INTO payments (seq, receipt_no, student_id, voucher_id, amount, paid_on, mode, reference, note, received_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(seq, no, o.studentId, o.voucherId ?? null, o.amount, o.paidOn, o.mode, o.reference || null, o.note || null, o.receivedBy).lastInsertRowid);
    db.prepare("INSERT INTO ledger (student_id, date, kind, amount, voucher_id, payment_id, note) VALUES (?, ?, 'payment', ?, ?, ?, ?)")
      .run(o.studentId, o.paidOn, -o.amount, o.voucherId ?? null, id, `Payment received (${o.mode}) ${no}`);
    return { id, receipt_no: no, balance: balanceOf(o.studentId) };
  })();
}


// ---------- category (A / B / C) and sibling fee rules ----------
export interface DiscountRule { head_id: number | null; kind: 'percent' | 'fixed'; value: number; tag: string; note: string | null }
interface Row { head_id: number; name: string; frequency: string; amount: number; discount: number; fixed?: boolean }

export const siblingMode = (): 'highest' | 'stack' => (getSetting('sibling_mode') === 'stack' ? 'stack' : 'highest');
/** The rule for a child's place in the family: the largest configured order that is not above it (a rule for "3" covers the 3rd child and later ones). */
export function siblingRuleFor(order: number): DiscountRule | null {
  if (order < 2) return null;
  const r = db.prepare('SELECT child_order, kind, value FROM sibling_discount_rules WHERE child_order <= ? ORDER BY child_order DESC LIMIT 1').get(order) as any;
  return r ? { head_id: null, kind: r.kind, value: r.value, tag: `SIB:${order}`, note: `${order}${['st', 'nd', 'rd'][order - 1] ?? 'th'} child` } : null;
}

/** Applies rules one after another; each rule works on what is left after the earlier ones. A discount never goes below zero fee. */
function runRules(rows: Row[], rules: DiscountRule[], concessionable: Set<number>) {
  // a fixed category fee replaces the class fee, so the category rules do not discount it again
  const lines: { text: string; amount: number; tag: string }[] = [];
  for (const r of rules) {
    const target = rows.filter(x => !(r.tag.startsWith('CAT:') && x.fixed) && (r.head_id ? x.head_id === r.head_id : concessionable.has(x.head_id)));
    const base = target.reduce((a, x) => a + x.amount - x.discount, 0);
    if (!base) continue;
    const d = Math.min(base, r.kind === 'percent' ? Math.round((base * r.value) / 100) : Math.round(r.value));
    if (d <= 0) continue;
    let left = d;
    for (const x of target) { const take = Math.min(left, x.amount - x.discount); x.discount += take; left -= take; if (!left) break; }
    lines.push({ text: `${r.tag.startsWith('SIB') ? 'Sibling discount' : 'Category ' + r.tag.slice(4)} - ${r.kind === 'percent' ? r.value + '%' : 'Rs ' + r.value} off${r.note ? ' (' + r.note + ')' : ''}`, amount: d, tag: r.tag });
  }
  return lines;
}

function classRows(classId: number, withTransport: boolean, category: string | null = null) {
  const heads = db.prepare('SELECT id, name, frequency, optional, concessionable FROM fee_heads WHERE active = 1 ORDER BY sort, id').all() as any[];
  const amounts = new Map((db.prepare('SELECT head_id, amount FROM fee_structure WHERE class_id = ?').all(classId) as any[]).map(r => [r.head_id, r.amount as number]));
  const fixed = new Map<number, number>(category ? (db.prepare('SELECT head_id, amount FROM fee_category_fees WHERE class_id = ? AND category = ?').all(classId, category) as any[]).map(r => [r.head_id, r.amount] as [number, number]) : []);
  const amountOf = (id: number) => fixed.get(id) ?? amounts.get(id) ?? 0;
  const rows: Row[] = heads.filter(h => amountOf(h.id) > 0 && (!h.optional || withTransport)).map(h => ({ head_id: h.id, name: h.name, frequency: h.frequency as string, amount: amountOf(h.id), discount: 0, fixed: fixed.has(h.id) }));
  return { rows, concessionable: new Set<number>(heads.filter(h => h.concessionable).map(h => h.id)) };
}
const catRules = (category: string | null): DiscountRule[] => category
  ? (db.prepare('SELECT head_id, kind, value, note FROM fee_category_rules WHERE category = ? ORDER BY id').all(category) as any[]).map(r => ({ ...r, tag: `CAT:${category}` })) : [];

/** Which rules a student gets. "highest" keeps only the bigger of category and sibling discount; "stack" gives both. */
export function chosenRules(classId: number, category: string | null, order: number, mode = siblingMode()) {
  const cat = catRules(category), sib = siblingRuleFor(order);
  if (!sib) return { rules: cat, sibling: null as DiscountRule | null, used: cat.length ? 'category' : 'none' };
  if (mode === 'stack') return { rules: [...cat, sib], sibling: sib, used: cat.length ? 'both' : 'sibling' };
  const total = (rs: DiscountRule[]) => { const { rows, concessionable } = classRows(classId, false, category); return runRules(rows, rs, concessionable).reduce((a, l) => a + l.amount, 0); };
  return total([sib]) > total(cat) ? { rules: [sib], sibling: sib, used: 'sibling' } : { rules: cat, sibling: sib, used: cat.length ? 'category' : 'none' };
}

/** Gives a student the concessions of their category and place in the family. Concessions added by hand on the fee plan are left alone. */
export function applyCategoryRules(studentId: number) {
  const st = db.prepare('SELECT st.category, s.class_id FROM students st JOIN sections s ON s.id = st.section_id WHERE st.id = ?').get(studentId) as { category: string | null; class_id: number } | undefined;
  if (!st) return;
  const { rules } = chosenRules(st.class_id, st.category, siblingOrder(studentId));
  db.transaction(() => {
    db.prepare("DELETE FROM student_concessions WHERE student_id = ? AND (reason LIKE 'CAT:%' OR reason LIKE 'SIB:%')").run(studentId);
    for (const r of rules)
      db.prepare('INSERT INTO student_concessions (student_id, head_id, kind, value, reason) VALUES (?,?,?,?,?)').run(studentId, r.head_id, r.kind, r.value, `${r.tag}${r.note ? ' ' + r.note : ''}`);
  })();
}

export function applyCategoryRulesToAll(): number {
  const ids = db.prepare("SELECT id FROM students WHERE status = 'active'").all() as { id: number }[];
  for (const s of ids) applyCategoryRules(s.id);
  return ids.length;
}

/** What a new student of this class, category and family position will be charged: class fees, then the rules. */
export function categoryPreview(classId: number, category: string | null, withTransport = false, order = 1) {
  const { rows, concessionable } = classRows(classId, withTransport, category);
  const ch = chosenRules(classId, category, order);
  const lines = runRules(rows, ch.rules, concessionable);
  const monthly = rows.filter(x => x.frequency === 'monthly').reduce((a, x) => a + x.amount - x.discount, 0);
  const once = rows.filter(x => x.frequency !== 'monthly').reduce((a, x) => a + x.amount - x.discount, 0);
  return { category, order, mode: siblingMode(), used: ch.used, sibling_rule: ch.sibling, rows, lines, monthly, once, total: monthly + once };
}
