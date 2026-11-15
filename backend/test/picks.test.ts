import test from 'node:test';
import assert from 'node:assert/strict';
import { ENTRIES, PICKS } from '../../frontend/src/app/pages/admission/form-entries.ts';

test('fields with ready-made answers become pick-lists with the right options', () => {
  for (const type of ['school', 'registration', 'college'] as const) {
    for (const sec of ENTRIES[type]) for (const e of sec.items) {
      if (e.t === 'f' && e.k && PICKS[e.k] && !(e.kind && e.kind !== 'pick')) { assert.equal(e.kind, 'pick', e.k); assert.deepEqual(e.opts, PICKS[e.k]); }
    }
  }
  const keys = (t: 'school' | 'registration' | 'college') => ENTRIES[t].flatMap(s => s.items).filter(e => e.kind === 'pick').map(e => e.k);
  assert.ok(keys('college').includes('sports') && keys('college').includes('cocurricular') && keys('college').includes('future_plan'));
  assert.ok(keys('registration').includes('blood_group') && keys('registration').includes('admit_class'));
  assert.ok(keys('school').includes('religion') && keys('school').includes('father_sps_bps'));
});
test('session choices look like 2026-27', () => {
  for (const x of PICKS.apply_session) assert.match(x, /^\d{4}-\d{2}$/);
});
