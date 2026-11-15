import { db } from './db.js';

/**
 * Start-up for hosted demos. With DEMO_SEED=1 an empty database is filled with the demo data first, so a demo host that
 * forgets its files (free plans usually do) always comes back with a working college. Real use starts server.js directly.
 */
if (process.env.DEMO_SEED === '1') {
  let students = 0;
  try { students = (db.prepare('SELECT COUNT(*) AS n FROM students').get() as { n: number }).n; } catch { /* a brand new file */ }
  if (!students) await import('./seedDemo.js');
}
await import('./server.js');
