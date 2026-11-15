import test from 'node:test'; import assert from 'node:assert/strict';
import { dateInWords } from '../../frontend/src/app/pages/admission/form-data.ts';
test('dates in words', () => {
  assert.equal(dateInWords('2012-03-15'), 'Fifteenth March Two Thousand Twelve');
  assert.equal(dateInWords('2011-12-01'), 'First December Two Thousand Eleven');
  assert.equal(dateInWords('2010-08-23'), 'Twenty Third August Two Thousand Ten');
  assert.equal(dateInWords('2010-01-30'), 'Thirtieth January Two Thousand Ten');
  assert.equal(dateInWords('2000-05-20'), 'Twentieth May Two Thousand');
  assert.equal(dateInWords('1998-07-31'), 'Thirty First July Nineteen Ninety Eight');
  assert.equal(dateInWords(null), ''); assert.equal(dateInWords('bad'), '');
});
