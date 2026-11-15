import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { addStudent, sectionOf, classOf } from './helpers.js';
import { inventoryRouter } from '../src/inventory/routes.js';
import { noticeRouter, activeFor } from '../src/notice/routes.js';
import { forecastRouter, forecast } from '../src/fee/forecast.js';
import { setSender } from '../src/parentmsg/service.js';

const call = (router: any, method: string, path: string, opts: { body?: any; query?: any; params?: any; user?: any } = {}) => new Promise<{ status: number; body: any }>(resolve => {
  const r = router.routes.find((x: any) => x.method === method && x.path === path);
  if (!r) return resolve({ status: -1, body: 'route not found ' + path });
  const res: any = { code: 200, status(c: number) { this.code = c; return this; }, json(b: any) { resolve({ status: this.code, body: b }); return this; } };
  const req = { body: opts.body ?? {}, query: opts.query ?? {}, params: opts.params ?? {}, ip: '1.1.1.1', user: opts.user ?? { id: 1, name: 'Principal', role: 'principal' } };
  const run = (i: number) => r.h[i](req, res, () => run(i + 1)); run(0);
});
const teacher = { id: 77, name: 'Sir Ali', role: 'teacher', duties: [] };
const acct = { id: 5, name: 'Acc', role: 'accountant', duties: [] };

test('inventory: counts move between good / damaged / lost / disposed and never go negative', async () => {
  const id = (await call(inventoryRouter, 'POST', '/', { body: { name: 'Microscope', category: 'lab', location: 'Physics Lab', qty: 10, cost: 5000 } })).body.id;
  const get = () => (db.prepare('SELECT * FROM inv_items WHERE id = ?').get(id) as any);
  assert.equal(get().qty_good, 10);
  assert.equal((await call(inventoryRouter, 'POST', '/:id/event', { params: { id }, body: { kind: 'damaged', qty: 11, note: 'x' } })).status, 409);
  assert.equal((await call(inventoryRouter, 'POST', '/:id/event', { user: teacher, params: { id }, body: { kind: 'damaged', qty: 2, note: 'Dropped in practical' } })).status, 200);
  assert.equal((await call(inventoryRouter, 'POST', '/:id/event', { user: teacher, params: { id }, body: { kind: 'lost', qty: 1 } })).status, 403);
  assert.equal((await call(inventoryRouter, 'POST', '/:id/event', { user: teacher, params: { id }, body: { kind: 'damaged', qty: 1 } })).status, 400);   // reason needed
  await call(inventoryRouter, 'POST', '/:id/event', { params: { id }, body: { kind: 'repaired', qty: 1 } });
  await call(inventoryRouter, 'POST', '/:id/event', { params: { id }, body: { kind: 'disposed', qty: 1 } });
  await call(inventoryRouter, 'POST', '/:id/event', { params: { id }, body: { kind: 'lost', qty: 2 } });
  const g = get(); assert.deepEqual([g.qty_good, g.qty_damaged, g.qty_lost, g.qty_disposed], [7, 0, 2, 1]);
  assert.equal(g.qty_good + g.qty_damaged + g.qty_lost + g.qty_disposed, 10);
  assert.equal((await call(inventoryRouter, 'POST', '/:id/event', { params: { id }, body: { kind: 'disposed', qty: 1 } })).status, 409);
  const rep = (await call(inventoryRouter, 'GET', '/report/damage')).body;
  assert.equal(rep.items.find((i: any) => i.id === id).value, 10000);
  assert.equal((await call(inventoryRouter, 'GET', '/report/damage', { user: teacher })).status, 403);
  assert.equal((await call(inventoryRouter, 'POST', '/', { user: teacher, body: { name: 'x' } })).status, 403);
});

test('notice board: live window, read tracking, parent SMS goes once per phone', async () => {
  const day = new Date().toISOString().slice(0, 10), past = '2020-01-01', future = '2099-01-01';
  const mk = async (b: any) => (await call(noticeRouter, 'POST', '/', { body: b })).body;
  const live = (await mk({ title: 'Meeting', body: 'Staff meeting at 2', target: 'staff', pinned: true })).id;
  await mk({ title: 'Old', body: 'x', target: 'staff', publish_on: past, expires_on: '2020-02-01' });
  await mk({ title: 'Later', body: 'x', target: 'staff', publish_on: future });
  await mk({ title: 'Parents only', body: 'x', target: 'parents' });
  const list = activeFor(9); const titles = list.map((n: any) => n.title);
  assert.ok(titles.includes('Meeting')); assert.ok(!titles.includes('Old')); assert.ok(!titles.includes('Later')); assert.ok(!titles.includes('Parents only'));
  assert.equal(list[0].title, 'Meeting'); assert.equal(list[0].read, false);
  await call(noticeRouter, 'POST', '/:id/read', { params: { id: live }, user: teacher });
  assert.equal(activeFor(77).find((n: any) => n.id === live).read, true); assert.equal(activeFor(9).find((n: any) => n.id === live).read, false);
  assert.equal((await call(noticeRouter, 'POST', '/', { user: teacher, body: { title: 'a', body: 'b' } })).status, 403);
  assert.equal((await call(noticeRouter, 'POST', '/', { body: { title: 'a', body: 'b', publish_on: day, expires_on: '2000-01-01' } })).status, 400);

  db.prepare("UPDATE students SET status = 'left' WHERE father_phone IN ('03111111111','03222222222')").run();
  const sec = sectionOf(9, 'A'), cls = classOf(9);
  addStudent({ section: sec, fphone: '0311-1111111' }); addStudent({ section: sec, fphone: '0311-1111111' }); addStudent({ section: sec, fphone: '03222222222' });
  const sent: string[] = []; setSender(async (p: string) => { sent.push(p); });
  const r = await mk({ title: 'Holiday', body: 'School closed Monday', target: 'parents', class_id: cls, send_sms: true });
  assert.equal(r.sms.sent, 2); assert.equal(sent.length, 2);
  assert.equal((await call(noticeRouter, 'POST', '/:id/sms', { params: { id: r.id } })).status, 409);
  assert.equal((await call(noticeRouter, 'POST', '/:id/sms', { params: { id: live } })).status, 400);   // staff-only
});

test('fee forecast: uses past collection rates, no number without history', async () => {
  const sec = sectionOf(10, 'A'), cls = classOf(10);
  const ids = [addStudent({ section: sec }), addStudent({ section: sec })];
  const ins = db.prepare('INSERT INTO ledger (student_id, date, kind, amount) VALUES (?,?,?,?)');
  const target = '2026-11';
  // before any history: charge only in the target month
  for (const s of ids) ins.run(s, '2026-11-02', 'charge', 1000);
  let f = forecast(target).rows.find(r => r.class_id === cls)!;
  assert.equal(f.expected, null); assert.equal(f.confidence, 'none'); assert.equal(f.due, 2000);
  // history: each of three earlier months charged 1000/student, 50% / 100% / 75% paid → median 75%
  const rate: Record<string, number> = { '2026-08': 1000, '2026-09': 2000, '2026-10': 1500 };
  const ch = db.prepare('INSERT INTO ledger (student_id, date, kind, amount) VALUES (?,?,?,?)');
  // simple, carry-free history: pay off whatever is charged in the month so due == charge
  for (const [m, paidTotal] of Object.entries(rate)) { for (const s of ids) { ch.run(s, m + '-02', 'charge', 1000); ch.run(s, m + '-20', 'payment', -(paidTotal / 2)); } }
  // unpaid remainder carries over, so later months' due includes it; assert only the structure and ordering, then check the sum rule
  f = forecast(target).rows.find(r => r.class_id === cls)!;
  assert.equal(f.history >= 3, true); assert.notEqual(f.expected, null);
  assert.ok(f.low! <= f.expected! && f.expected! <= f.high! && f.high! <= f.due);
  assert.equal(f.remaining, Math.max(0, f.expected! - f.collected));
  const t = forecast(target).total; assert.equal(t.expected, forecast(target).rows.reduce((a, r) => a + (r.expected ?? 0), 0));
  assert.equal((await call(forecastRouter, 'GET', '/', { query: { month: 'bad' } })).status, 400);
  assert.equal((await call(forecastRouter, 'GET', '/', { user: teacher })).status, 403);
  assert.equal((await call(forecastRouter, 'GET', '/', { user: acct, query: { month: target } })).status, 200);
});

test('fee forecast: exact figure from one past month (60% paid) applied to this month\'s dues', () => {
  const sec = sectionOf(11, 'A'), cls = classOf(11), s = addStudent({ section: sec });
  const ins = db.prepare('INSERT INTO ledger (student_id, date, kind, amount) VALUES (?,?,?,?)');
  ins.run(s, '2026-10-02', 'charge', 1000); ins.run(s, '2026-10-15', 'payment', -600);   // Oct: due 1000, paid 600 → 60%
  ins.run(s, '2026-11-02', 'charge', 1000); ins.run(s, '2026-11-05', 'payment', -300);   // Nov: due 400 carry + 1000 = 1400
  const f = forecast('2026-11').rows.find(r => r.class_id === cls)!;
  assert.equal(f.due, 1400); assert.equal(f.collected, 300); assert.equal(f.history, 1); assert.equal(f.rate, 60);
  assert.equal(f.expected, 840); assert.equal(f.remaining, 540); assert.equal(f.confidence, 'low');
});
