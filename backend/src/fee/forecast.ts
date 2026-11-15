import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';

/**
 * Collection forecast. For each class we look at the earlier months (up to six) and work out what share of "what was due" came in
 * during that month: due = what the students already owed at the start of the month (unpaid carry) plus what was charged in the month.
 * This month's expectation is the middle (median) share times what is due now, with the worst and best past month as a range.
 * With no history there is no number — nothing is invented.
 */
const iso = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
const shift = (month: string, d: number) => { const [y, m] = month.split('-').map(Number), t = y * 12 + (m - 1) + d; return iso(Math.floor(t / 12), (t % 12) + 1).slice(0, 7); };
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

interface Cell { owed: number; paid: number; charged: number; students: number }
function month(m: string): Map<number, Cell> {
  const S = m + '-01', E = shift(m, 1) + '-01', out = new Map<number, Cell>();
  const rows = db.prepare(`SELECT s.class_id AS cid, l.student_id AS sid,
      SUM(CASE WHEN l.date < ? THEN l.amount ELSE 0 END) AS before,
      SUM(CASE WHEN l.date >= ? AND l.date < ? AND l.kind IN ('charge','fine') THEN l.amount ELSE 0 END) AS ch,
      SUM(CASE WHEN l.date >= ? AND l.date < ? AND l.kind = 'payment' THEN -l.amount ELSE 0 END) AS paid
    FROM ledger l JOIN students st ON st.id = l.student_id JOIN sections s ON s.id = st.section_id WHERE st.status = 'active' GROUP BY l.student_id`).all(S, S, E, S, E) as any[];
  for (const r of rows) {
    const c = out.get(r.cid) ?? out.set(r.cid, { owed: 0, paid: 0, charged: 0, students: 0 }).get(r.cid)!;
    const due = Math.max(0, r.before) + r.ch;
    if (due > 0) c.students++;
    c.owed += due; c.paid += r.paid; c.charged += r.ch;
  }
  return out;
}

export function forecast(target: string) {
  const past: { month: string; cells: Map<number, Cell> }[] = [];
  for (let i = 1; i <= 6; i++) { const m = shift(target, -i); past.push({ month: m, cells: month(m) }); }
  const now = month(target);
  const classes = db.prepare('SELECT id, name FROM classes ORDER BY grade').all() as { id: number; name: string }[];
  const rows = classes.map(c => {
    const rates: number[] = [];
    for (const p of past) { const x = p.cells.get(c.id); if (x && x.owed > 0) rates.push(Math.min(1, x.paid / x.owed)); }
    const cur = now.get(c.id) ?? { owed: 0, paid: 0, charged: 0, students: 0 };
    const h = rates.length, ok = h > 0 && cur.owed > 0;
    const mid = ok ? Math.min(cur.owed, Math.round(median(rates) * cur.owed)) : null;
    return {
      class_id: c.id, class_name: c.name, students_due: cur.students, due: cur.owed, charged: cur.charged, collected: cur.paid,
      history: h, rate: h ? Math.round(median(rates) * 100) : null,
      expected: mid, low: ok ? Math.round(Math.min(...rates) * cur.owed) : null, high: ok ? Math.min(cur.owed, Math.round(Math.max(...rates) * cur.owed)) : null,
      remaining: mid == null ? null : Math.max(0, mid - cur.paid),
      confidence: h === 0 ? 'none' : h < 3 ? 'low' : h < 5 ? 'medium' : 'good'
    };
  }).filter(r => r.due > 0 || r.collected > 0);
  const sum = (k: 'due' | 'collected' | 'expected' | 'low' | 'high' | 'remaining') => rows.reduce((a, r) => a + ((r as any)[k] ?? 0), 0);
  return { month: target, rows, total: { due: sum('due'), collected: sum('collected'), expected: sum('expected'), low: sum('low'), high: sum('high'), remaining: sum('remaining'), classesWithoutHistory: rows.filter(r => r.expected == null).length } };
}

export const forecastRouter = Router();
forecastRouter.get('/', requireRole('director', 'principal', 'admin', 'accountant'), (req, res) => {
  const m = String(req.query.month || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return res.status(400).json({ message: 'Month must look like 2026-11.' });
  res.json(forecast(m));
});
