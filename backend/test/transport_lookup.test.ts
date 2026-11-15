import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import '../src/transport/schema.js';
import { transportRouter } from '../src/transport/routes.js';

test('transport lookup carries times, stop times and seats for the picker', () => {
  const v = db.prepare("INSERT INTO tr_vehicles (number, capacity) VALUES ('Bus T', 30)").run().lastInsertRowid;
  const r = db.prepare("INSERT INTO tr_routes (name, vehicle_id, morning_time, afternoon_time, fee_both, fee_one) VALUES ('Lookup Route', ?, '07:10', '14:00', 3000, 1800)").run(v).lastInsertRowid;
  db.prepare("INSERT INTO tr_stops (route_id, name, pickup_time, drop_time, fee_both) VALUES (?, 'Stop 1', '07:20', '14:30', 3500)").run(r);
  const route = (transportRouter as any).routes.find((x: any) => x.method === 'GET' && x.path === '/lookup');
  let out: any; route.h[route.h.length - 1]({ user: { id: 1, role: 'principal' }, query: {}, params: {}, body: {} }, { json: (b: any) => { out = b; } });
  const x = out.find((y: any) => y.name === 'Lookup Route');
  assert.equal(x.morning_time, '07:10'); assert.equal(x.capacity, 30); assert.equal(x.used, 0);
  assert.equal(x.stops[0].pickup_time, '07:20'); assert.equal(x.stops[0].drop_time, '14:30'); assert.equal(x.stops[0].fee_both, 3500);
});
