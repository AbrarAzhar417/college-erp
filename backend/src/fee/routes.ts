import { receiptCode } from './verify.js';
import { Router } from 'express';
import { db, setSetting } from '../db.js';
import { requireRole } from '../auth.js';
import { siblingMode, applyCategoryRulesToAll, categoryPreview, allocate, allocOf, balanceOf, feeSettings, generateVouchers, institute, isDate, payable, previewVouchers, printData, recordPayment, saveFeeSettings, todayISO, type GenOpts } from './service.js';

export const feeRouter = Router();
const FEE_ROLES = ['director', 'principal', 'accountant', 'admin'] as const;
const money = requireRole('director', 'principal', 'accountant');   // cancelling / settings
feeRouter.use(requireRole(...FEE_ROLES));
const bad = (res: any, msg: string, code = 400) => res.status(code).json({ message: msg });
const int = (v: unknown) => Math.round(Number(v));

const studentJoin = `FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id`;

// ---------- overview ----------
feeRouter.get('/summary', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : todayISO().slice(0, 7);
  const one = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any).n as number;
  const balances = db.prepare('SELECT student_id, SUM(amount) AS bal FROM ledger GROUP BY student_id HAVING bal > 0').all() as { student_id: number; bal: number }[];
  const byClass = db.prepare(`SELECT c.name, c.grade, COALESCE(SUM(b.bal), 0) AS outstanding FROM classes c
    LEFT JOIN sections s ON s.class_id = c.id LEFT JOIN students st ON st.section_id = s.id
    LEFT JOIN (SELECT student_id, SUM(amount) AS bal FROM ledger GROUP BY student_id HAVING bal > 0) b ON b.student_id = st.id
    GROUP BY c.id ORDER BY c.grade`).all();
  res.json({
    month,
    billed: one("SELECT COALESCE(SUM(net), 0) AS n FROM vouchers WHERE status = 'open' AND substr(issue_date, 1, 7) = ?", month),
    collected: one('SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE cancelled = 0 AND substr(paid_on, 1, 7) = ?', month),
    collectedToday: one('SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE cancelled = 0 AND paid_on = ?', todayISO()),
    outstanding: balances.reduce((a, b) => a + b.bal, 0), defaulters: balances.length,
    vouchers: one("SELECT COUNT(*) AS n FROM vouchers WHERE status = 'open' AND substr(issue_date, 1, 7) = ?", month),
    byClass,
    recent: db.prepare(`SELECT p.id, p.receipt_no, p.amount, p.paid_on, p.mode, st.name, c.name AS class_name, s.name AS section_name
      FROM payments p JOIN students st ON st.id = p.student_id JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
      WHERE p.cancelled = 0 ORDER BY p.id DESC LIMIT 8`).all()
  });
});

// ---------- fee heads and class amounts ----------
feeRouter.get('/heads', (_req, res) => res.json(db.prepare('SELECT * FROM fee_heads WHERE active = 1 ORDER BY sort, id').all()));

function headBody(b: any): { error?: string; v?: any[] } {
  const name = String(b?.name ?? '').trim();
  if (!name) return { error: 'Fee name is required.' };
  if (!['monthly', 'annual', 'one_time'].includes(b?.frequency)) return { error: 'Choose how often this fee is charged.' };
  return { v: [name, b.frequency, b.optional ? 1 : 0, b.concessionable ? 1 : 0] };
}
feeRouter.post('/heads', (req, res) => {
  const h = headBody(req.body); if (h.error) return bad(res, h.error);
  try {
    const sort = (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM fee_heads').get() as any).n;
    const r = db.prepare('INSERT INTO fee_heads (name, frequency, optional, concessionable, sort) VALUES (?,?,?,?,?)').run(...h.v!, sort);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch { bad(res, 'A fee with this name already exists.', 409); }
});
feeRouter.put('/heads/:id', (req, res) => {
  const h = headBody(req.body); if (h.error) return bad(res, h.error);
  try {
    const r = db.prepare('UPDATE fee_heads SET name=?, frequency=?, optional=?, concessionable=? WHERE id=?').run(...h.v!, Number(req.params.id));
    r.changes ? res.json({ ok: true }) : bad(res, 'Fee not found.', 404);
  } catch { bad(res, 'A fee with this name already exists.', 409); }
});
feeRouter.delete('/heads/:id', (req, res) => {
  const id = Number(req.params.id);
  const used = (db.prepare('SELECT COUNT(*) AS n FROM voucher_items WHERE head_id = ?').get(id) as any).n;
  if (used) db.prepare('UPDATE fee_heads SET active = 0 WHERE id = ?').run(id);   // keep history readable
  else db.transaction(() => { db.prepare('DELETE FROM fee_structure WHERE head_id = ?').run(id); db.prepare('DELETE FROM student_heads WHERE head_id = ?').run(id); db.prepare('DELETE FROM student_concessions WHERE head_id = ?').run(id); db.prepare('DELETE FROM fee_heads WHERE id = ?').run(id); })();
  res.json({ ok: true, hidden: !!used });
});

feeRouter.get('/structure', (_req, res) => res.json({
  classes: db.prepare('SELECT id, name, grade FROM classes ORDER BY grade').all(),
  heads: db.prepare('SELECT * FROM fee_heads WHERE active = 1 ORDER BY sort, id').all(),
  amounts: db.prepare('SELECT class_id, head_id, amount FROM fee_structure').all()
}));
feeRouter.put('/structure', (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  db.transaction(() => {
    for (const e of entries) {
      const amt = int(e.amount);
      if (amt > 0) db.prepare('INSERT INTO fee_structure (class_id, head_id, amount) VALUES (?,?,?) ON CONFLICT(class_id, head_id) DO UPDATE SET amount = excluded.amount').run(e.class_id, e.head_id, amt);
      else db.prepare('DELETE FROM fee_structure WHERE class_id = ? AND head_id = ?').run(e.class_id, e.head_id);
    }
  })();
  res.json({ ok: true });
});

// ---------- settings (bank, fine, notes) ----------
feeRouter.get('/settings', (_req, res) => res.json(feeSettings()));
feeRouter.put('/settings', money, (req, res) => {
  const f = req.body ?? {};
  if (f.late_fine !== undefined && !(Number(f.late_fine) >= 0)) return bad(res, 'Late fine must be a number.');
  if (f.due_day !== undefined && !(Number(f.due_day) >= 1 && Number(f.due_day) <= 28)) return bad(res, 'Due day must be between 1 and 28.');
  saveFeeSettings(f);
  res.json(feeSettings());
});
feeRouter.get('/institute', (_req, res) => res.json(institute()));

// ---------- students ----------
feeRouter.get('/students/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json([]);
  const v = db.prepare("SELECT student_id FROM vouchers WHERE voucher_no = ?").get(q.toUpperCase()) as any;
  const like = `%${q}%`;
  res.json(db.prepare(`
    SELECT st.id, st.name, st.father_name, st.reg_no, st.roll_no, st.phone, c.name AS class_name, s.name AS section_name,
           (SELECT COALESCE(SUM(amount), 0) FROM ledger WHERE student_id = st.id) AS balance
    ${studentJoin}
    WHERE st.status = 'active' AND (st.id = ? OR st.name LIKE ? OR st.father_name LIKE ? OR st.reg_no LIKE ? OR st.phone LIKE ? OR CAST(st.roll_no AS TEXT) = ?)
    ORDER BY st.name LIMIT 15`).all(v?.student_id ?? 0, like, like, like, like, q));
});

feeRouter.get('/student/:id', (req, res) => {
  const id = Number(req.params.id);
  const student = db.prepare(`SELECT st.*, c.id AS class_id, c.name AS class_name, s.name AS section_name ${studentJoin} WHERE st.id = ?`).get(id) as any;
  if (!student) return bad(res, 'Student not found.', 404);

  let running = 0;
  const ledger = (db.prepare(`SELECT l.*, v.voucher_no, p.receipt_no FROM ledger l LEFT JOIN vouchers v ON v.id = l.voucher_id LEFT JOIN payments p ON p.id = l.payment_id
    WHERE l.student_id = ? ORDER BY l.date, l.id`).all(id) as any[]).map(r => ({ ...r, balance: (running += r.amount) }));
  const totals = {
    charged: ledger.filter(r => r.amount > 0).reduce((a, r) => a + r.amount, 0),
    paid: -ledger.filter(r => r.kind === 'payment').reduce((a, r) => a + r.amount, 0),
    waived: -ledger.filter(r => r.kind === 'waiver').reduce((a, r) => a + r.amount, 0),
    balance: running
  };

  const alloc = allocate([id]);
  const vouchers = (db.prepare("SELECT id, voucher_no, period_label, issue_date, due_date, net, arrears, late_fine, status FROM vouchers WHERE student_id = ? ORDER BY id DESC").all(id) as any[]).map(v => {
    const a = allocOf(alloc, v);
    return { ...v, paid: a.paid, balance: v.status === 'open' ? a.balance : 0, payable: payable(v.net, v.arrears) };
  });

  const assigned = new Map((db.prepare('SELECT head_id, amount FROM student_heads WHERE student_id = ?').all(id) as any[]).map(r => [r.head_id, r.amount]));
  const classAmt = new Map((db.prepare('SELECT head_id, amount FROM fee_structure WHERE class_id = ?').all(student.class_id) as any[]).map(r => [r.head_id, r.amount]));
  const heads = (db.prepare('SELECT * FROM fee_heads WHERE active = 1 ORDER BY sort, id').all() as any[])
    .map(h => ({ id: h.id, name: h.name, frequency: h.frequency, optional: !!h.optional, classAmount: classAmt.get(h.id) ?? 0, assigned: assigned.has(h.id), amount: assigned.get(h.id) ?? null }));
  const concessions = db.prepare('SELECT id, head_id, kind, value, reason FROM student_concessions WHERE student_id = ?').all(id);
  res.json({ student, ledger, totals, vouchers, plan: { heads, concessions } });
});

feeRouter.put('/student/:id/plan', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) return bad(res, 'Student not found.', 404);
  const heads = Array.isArray(req.body?.heads) ? req.body.heads : [];
  const concessions = Array.isArray(req.body?.concessions) ? req.body.concessions : [];
  for (const c of concessions) {
    if (!['fixed', 'percent'].includes(c.kind) || !(Number(c.value) > 0)) return bad(res, 'Each concession needs a type and an amount.');
    if (c.kind === 'percent' && Number(c.value) > 100) return bad(res, 'A percent concession cannot be more than 100.');
  }
  db.transaction(() => {
    db.prepare('DELETE FROM student_heads WHERE student_id = ?').run(id);
    for (const h of heads) db.prepare('INSERT OR REPLACE INTO student_heads (student_id, head_id, amount) VALUES (?,?,?)').run(id, Number(h.head_id), h.amount ? int(h.amount) : null);
    db.prepare('DELETE FROM student_concessions WHERE student_id = ?').run(id);
    for (const c of concessions) db.prepare('INSERT INTO student_concessions (student_id, head_id, kind, value, reason) VALUES (?,?,?,?,?)').run(id, c.head_id ? Number(c.head_id) : null, c.kind, Number(c.value), String(c.reason ?? '').trim().slice(0, 60) || null);
  })();
  res.json({ ok: true });
});

const ADJUST: Record<string, { kind: string; sign: 1 | -1 }> = {
  opening: { kind: 'opening', sign: 1 }, fine: { kind: 'fine', sign: 1 }, other_charge: { kind: 'adjustment', sign: 1 },
  waiver: { kind: 'waiver', sign: -1 }, other_credit: { kind: 'adjustment', sign: -1 }
};
feeRouter.post('/student/:id/adjust', (req, res) => {
  const id = Number(req.params.id);
  const a = ADJUST[String(req.body?.type)];
  const amount = int(req.body?.amount);
  if (!a) return bad(res, 'Choose what kind of entry this is.');
  if (!(amount > 0)) return bad(res, 'Enter an amount greater than zero.');
  if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) return bad(res, 'Student not found.', 404);
  const date = isDate(req.body?.date) ? req.body.date : todayISO();
  const labels: Record<string, string> = { opening: 'Previous balance brought forward', fine: 'Fine', other_charge: 'Other charge', waiver: 'Waiver', other_credit: 'Other credit' };
  const note = String(req.body?.note ?? '').trim().slice(0, 120) || labels[req.body.type];
  db.prepare('INSERT INTO ledger (student_id, date, kind, amount, note) VALUES (?,?,?,?,?)').run(id, date, a.kind, a.sign * amount, note);
  res.json({ balance: balanceOf(id) });
});

// ---------- vouchers ----------
function genOpts(req: any): GenOpts | string {
  const b = req.body ?? {};
  const period = String(b.period ?? '').trim(), label = String(b.label ?? '').trim();
  if (!period || !label) return 'Choose the fee period.';
  if (!isDate(b.issue_date) || !isDate(b.due_date)) return 'Enter the issue date and due date.';
  if (b.due_date < b.issue_date) return 'The due date cannot be before the issue date.';
  return {
    period: period.slice(0, 40), label: label.slice(0, 60), issueDate: b.issue_date, dueDate: b.due_date,
    scope: { classId: b.scope?.classId ? Number(b.scope.classId) : undefined, sectionId: b.scope?.sectionId ? Number(b.scope.sectionId) : undefined, studentId: b.scope?.studentId ? Number(b.scope.studentId) : undefined },
    includeMonthly: b.include_monthly !== false, includeHeadIds: (Array.isArray(b.include_head_ids) ? b.include_head_ids : []).map(Number),
    lateFine: b.late_fine !== undefined && b.late_fine !== '' ? Math.max(0, int(b.late_fine)) : feeSettings().late_fine, createdBy: req.user?.id ?? null
  };
}
feeRouter.post('/vouchers/preview', (req, res) => { const o = genOpts(req); typeof o === 'string' ? bad(res, o) : res.json(previewVouchers(o)); });
feeRouter.post('/vouchers/generate', (req, res) => {
  const o = genOpts(req); if (typeof o === 'string') return bad(res, o);
  res.status(201).json(generateVouchers(o));
});

feeRouter.get('/vouchers', (req, res) => {
  const { period, classId, sectionId, status, q } = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
  const where = [status === 'cancelled' ? "v.status = 'cancelled'" : "v.status = 'open'"]; const params: any[] = [];
  if (period) { where.push('v.period = ?'); params.push(period); }
  if (sectionId) { where.push('s.id = ?'); params.push(Number(sectionId)); }
  else if (classId) { where.push('c.id = ?'); params.push(Number(classId)); }
  if (q?.trim()) { where.push('(v.voucher_no LIKE ? OR st.name LIKE ? OR st.father_name LIKE ? OR st.reg_no LIKE ? OR CAST(st.roll_no AS TEXT) = ?)'); const l = `%${q.trim()}%`; params.push(l, l, l, l, q.trim()); }
  const rows = db.prepare(`
    SELECT v.id, v.voucher_no, v.period, v.period_label, v.issue_date, v.due_date, v.net, v.arrears, v.late_fine, v.status,
           st.id AS student_id, st.name, st.father_name, st.roll_no, st.reg_no, c.name AS class_name, s.name AS section_name
    ${studentJoin} JOIN vouchers v ON v.student_id = st.id WHERE ${where.join(' AND ')}
    ORDER BY c.grade, s.name, st.roll_no, v.id`).all(...params) as any[];
  const alloc = allocate([...new Set(rows.map(r => r.student_id))]);
  const today = todayISO();
  let list = rows.map(r => {
    const a = allocOf(alloc, r);
    const st = r.status === 'cancelled' ? 'cancelled' : a.balance <= 0 ? 'paid' : a.paid > 0 ? 'partial' : 'unpaid';
    return { ...r, payable: payable(r.net, r.arrears), paid: a.paid, balance: r.status === 'cancelled' ? 0 : a.balance, state: st, overdue: st !== 'paid' && st !== 'cancelled' && r.due_date < today };
  });
  if (status === 'overdue') list = list.filter(r => r.overdue);
  else if (status && ['paid', 'partial', 'unpaid'].includes(status)) list = list.filter(r => r.state === status);
  res.json({
    items: list.slice((page - 1) * limit, page * limit), total: list.length, page, limit,
    totals: { net: list.reduce((a, r) => a + r.net, 0), balance: list.reduce((a, r) => a + r.balance, 0) },
    allIds: list.slice(0, 5000).map(r => r.id)
  });
});

feeRouter.post('/vouchers/print-data', (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 5000);
  if (!ids.length) return bad(res, 'Nothing to print.');
  res.json({ vouchers: printData(ids), institute: institute() });
});

feeRouter.post('/vouchers/:id/cancel', money, (req, res) => {
  const id = Number(req.params.id);
  const v = db.prepare('SELECT status FROM vouchers WHERE id = ?').get(id) as any;
  if (!v) return bad(res, 'Voucher not found.', 404);
  if (v.status === 'cancelled') return bad(res, 'This voucher is already cancelled.', 409);
  db.transaction(() => {
    db.prepare("UPDATE vouchers SET status = 'cancelled' WHERE id = ?").run(id);
    db.prepare("DELETE FROM ledger WHERE voucher_id = ? AND kind = 'charge'").run(id);
  })();
  res.json({ ok: true });
});

// ---------- payments ----------
feeRouter.post('/payments', (req, res) => {
  const b = req.body ?? {};
  const studentId = Number(b.student_id), amount = int(b.amount);
  if (!db.prepare("SELECT 1 FROM students WHERE id = ? AND status = 'active'").get(studentId)) return bad(res, 'Choose a student.');
  if (!(amount > 0)) return bad(res, 'Enter the amount received.');
  const paidOn = isDate(b.paid_on) ? b.paid_on : todayISO();
  const mode = ['cash', 'bank', 'online', 'cheque'].includes(b.mode) ? b.mode : 'cash';
  const r = recordPayment({ studentId, amount, paidOn, mode, reference: String(b.reference ?? '').trim().slice(0, 60), note: String(b.note ?? '').trim().slice(0, 120),
    voucherId: b.voucher_id ? Number(b.voucher_id) : null, addFine: b.add_fine ? int(b.add_fine) : 0, receivedBy: req.user?.id ?? null });
  res.status(201).json(r);
});

feeRouter.get('/payments', (req, res) => {
  const from = isDate(req.query.from) ? String(req.query.from) : todayISO(), to = isDate(req.query.to) ? String(req.query.to) : from;
  const rows = db.prepare(`SELECT p.id, p.receipt_no, p.amount, p.paid_on, p.mode, p.reference, p.cancelled, st.name, c.name AS class_name, s.name AS section_name, v.voucher_no
    FROM payments p JOIN students st ON st.id = p.student_id JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
    LEFT JOIN vouchers v ON v.id = p.voucher_id WHERE p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on DESC, p.id DESC`).all(from, to) as any[];
  const live = rows.filter(r => !r.cancelled);
  const byMode: Record<string, number> = {};
  for (const r of live) byMode[r.mode] = (byMode[r.mode] ?? 0) + r.amount;
  res.json({ from, to, rows, total: live.reduce((a, r) => a + r.amount, 0), byMode });
});

feeRouter.get('/payments/:id', (req, res) => {
  const p = db.prepare(`SELECT p.*, st.name, st.father_name, st.reg_no, st.roll_no, st.phone, c.name AS class_name, s.name AS section_name, v.voucher_no, v.period_label, u.name AS received_by_name
    FROM payments p JOIN students st ON st.id = p.student_id JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
    LEFT JOIN vouchers v ON v.id = p.voucher_id LEFT JOIN users u ON u.id = p.received_by WHERE p.id = ?`).get(Number(req.params.id)) as any;
  if (!p) return bad(res, 'Receipt not found.', 404);
  res.json({ payment: { ...p, balance: balanceOf(p.student_id), code: receiptCode(p) }, institute: institute() });
});

feeRouter.post('/payments/:id/cancel', money, (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT cancelled FROM payments WHERE id = ?').get(id) as any;
  if (!p) return bad(res, 'Receipt not found.', 404);
  if (p.cancelled) return bad(res, 'This receipt is already cancelled.', 409);
  db.transaction(() => { db.prepare('UPDATE payments SET cancelled = 1 WHERE id = ?').run(id); db.prepare('DELETE FROM ledger WHERE payment_id = ?').run(id); })();
  res.json({ ok: true });
});

// ---------- defaulters ----------
feeRouter.get('/defaulters', (req, res) => {
  const { classId, sectionId } = req.query as Record<string, string | undefined>;
  const min = Math.max(0, int(req.query.min) || 0);
  const where = ['b.bal > ?']; const params: any[] = [min];
  if (sectionId) { where.push('s.id = ?'); params.push(Number(sectionId)); } else if (classId) { where.push('c.id = ?'); params.push(Number(classId)); }
  const rows = db.prepare(`SELECT st.id AS student_id, st.name, st.father_name, st.phone, st.roll_no, st.reg_no, c.name AS class_name, s.name AS section_name, b.bal AS balance
    ${studentJoin} JOIN (SELECT student_id, SUM(amount) AS bal FROM ledger GROUP BY student_id) b ON b.student_id = st.id
    WHERE st.status = 'active' AND ${where.join(' AND ')} ORDER BY b.bal DESC LIMIT 3000`).all(...params) as any[];
  const alloc = allocate(rows.map(r => r.student_id));
  const vs = rows.length ? db.prepare(`SELECT id, student_id, due_date, net FROM vouchers WHERE status = 'open' AND student_id IN (${rows.map(() => '?').join(',')})`).all(...rows.map(r => r.student_id)) as any[] : [];
  const stat = new Map<number, { n: number; oldest: string }>();
  for (const v of vs) {
    if (allocOf(alloc, v).balance <= 0) continue;
    const s = stat.get(v.student_id) ?? { n: 0, oldest: v.due_date };
    s.n++; if (v.due_date < s.oldest) s.oldest = v.due_date;
    stat.set(v.student_id, s);
  }
  res.json(rows.map(r => ({ ...r, pending_vouchers: stat.get(r.student_id)?.n ?? 0, oldest_due: stat.get(r.student_id)?.oldest ?? null })));
});

// ---------- category A / B / C fee rules ----------
const CATS = ['A', 'B', 'C'];
function ruleBody(b: any): { v?: [string, number | null, string, number, string | null]; err?: string } {
  if (!CATS.includes(String(b?.category))) return { err: 'Choose category A, B or C.' };
  if (!['fixed', 'percent'].includes(b?.kind)) return { err: 'Choose a percent or a fixed amount.' };
  const val = Number(b?.value);
  if (!(val > 0)) return { err: 'Enter the discount value.' };
  if (b.kind === 'percent' && val > 100) return { err: 'A percent cannot be more than 100.' };
  const head = b.head_id ? Number(b.head_id) : null;
  if (head && !db.prepare('SELECT 1 FROM fee_heads WHERE id = ?').get(head)) return { err: 'That fee head does not exist.' };
  return { v: [b.category, head, b.kind, b.kind === 'percent' ? val : Math.round(val), String(b.note ?? '').trim().slice(0, 60) || null] };
}
feeRouter.get('/category-rules', (_req, res) => res.json(db.prepare(`SELECT r.*, h.name AS head_name,
  (SELECT COUNT(*) FROM students st WHERE st.category = r.category AND st.status = 'active') AS students
  FROM fee_category_rules r LEFT JOIN fee_heads h ON h.id = r.head_id ORDER BY r.category, r.id`).all()));
feeRouter.post('/category-rules', money, (req, res) => {
  const b = ruleBody(req.body); if (b.err) return bad(res, b.err);
  const r = db.prepare('INSERT INTO fee_category_rules (category, head_id, kind, value, note) VALUES (?,?,?,?,?)').run(...b.v!);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
feeRouter.put('/category-rules/:id', money, (req, res) => {
  const b = ruleBody(req.body); if (b.err) return bad(res, b.err);
  const r = db.prepare('UPDATE fee_category_rules SET category=?, head_id=?, kind=?, value=?, note=? WHERE id=?').run(...b.v!, Number(req.params.id));
  if (!r.changes) return bad(res, 'Rule not found.', 404);
  res.json({ ok: true });
});
feeRouter.delete('/category-rules/:id', money, (req, res) => {
  const r = db.prepare('DELETE FROM fee_category_rules WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return bad(res, 'Rule not found.', 404);
  res.json({ ok: true });
});
/** Rules only reach a student when they are applied; this re-applies them to every active student. */
feeRouter.post('/category-rules/apply', money, (_req, res) => res.json({ students: applyCategoryRulesToAll() }));
feeRouter.get('/category-preview', (req, res) => {
  const classId = Number(req.query.classId);
  if (!db.prepare('SELECT 1 FROM classes WHERE id = ?').get(classId)) return bad(res, 'Choose a class.');
  const cat = CATS.includes(String(req.query.category)) ? String(req.query.category) : null;
  res.json(categoryPreview(classId, cat, req.query.transport === '1', Math.min(20, Math.max(1, Math.floor(Number(req.query.order)) || 1))));
});

// ---------- sibling discount (by child order) ----------
feeRouter.get('/sibling-rules', (_req, res) => res.json({ mode: siblingMode(), rules: db.prepare('SELECT child_order, kind, value FROM sibling_discount_rules ORDER BY child_order').all() }));
/** Replaces the whole list. Body: { mode: 'highest' | 'stack', rules: [{ child_order, kind, value }] } */
feeRouter.put('/sibling-rules', money, (req, res) => {
  const b = req.body ?? {};
  if (!['highest', 'stack'].includes(b.mode)) return bad(res, 'Choose "highest only" or "stack".');
  if (!Array.isArray(b.rules) || b.rules.length > 20) return bad(res, 'Send a list of rules (at most 20).');
  const seen = new Set<number>(); const rows: [number, string, number][] = [];
  for (const r of b.rules) {
    const order = Number(r?.child_order), val = Number(r?.value);
    if (!Number.isInteger(order) || order < 2 || order > 20) return bad(res, 'Child order must be 2 or more (2 = second child).');
    if (seen.has(order)) return bad(res, `Child order ${order} is listed twice.`);
    if (!['fixed', 'percent'].includes(r?.kind)) return bad(res, 'Choose a percent or a fixed amount.');
    if (!(val > 0)) return bad(res, 'Enter the discount value.');
    if (r.kind === 'percent' && val > 100) return bad(res, 'A percent cannot be more than 100.');
    seen.add(order); rows.push([order, r.kind, r.kind === 'percent' ? val : Math.round(val)]);
  }
  db.transaction(() => {
    setSetting('sibling_mode', b.mode);
    db.prepare('DELETE FROM sibling_discount_rules').run();
    for (const r of rows) db.prepare('INSERT INTO sibling_discount_rules (child_order, kind, value) VALUES (?,?,?)').run(...r);
  })();
  res.json({ ok: true });
});

// ---------- fixed fee per category (class x category x head) ----------
feeRouter.get('/category-fees', (_req, res) => res.json(db.prepare('SELECT class_id, category, head_id, amount FROM fee_category_fees').all()));
/** Replaces the whole grid. Body: { fees: [{ class_id, category, head_id, amount }] } - an empty cell is simply not sent. */
feeRouter.put('/category-fees', money, (req, res) => {
  const list = req.body?.fees; if (!Array.isArray(list) || list.length > 2000) return bad(res, 'Send a list of fees.');
  const classes = new Set((db.prepare('SELECT id FROM classes').all() as any[]).map(r => r.id)), heads = new Set((db.prepare('SELECT id FROM fee_heads').all() as any[]).map(r => r.id));
  const seen = new Set<string>(); const rows: [number, string, number, number][] = [];
  for (const f of list) {
    const c = Number(f?.class_id), h = Number(f?.head_id), a = Number(f?.amount);
    if (!classes.has(c) || !heads.has(h)) return bad(res, 'Unknown class or fee head.');
    if (!['A', 'B', 'C'].includes(f?.category)) return bad(res, 'Category must be A, B or C.');
    if (!Number.isFinite(a) || a < 0) return bad(res, 'Amounts must be zero or more.');
    const k = `${c}-${f.category}-${h}`; if (seen.has(k)) return bad(res, 'The same cell is listed twice.'); seen.add(k);
    rows.push([c, f.category, h, Math.round(a)]);
  }
  db.transaction(() => { db.prepare('DELETE FROM fee_category_fees').run(); for (const r of rows) db.prepare('INSERT INTO fee_category_fees (class_id, category, head_id, amount) VALUES (?,?,?,?)').run(...r); })();
  res.json({ ok: true, saved: rows.length });
});
