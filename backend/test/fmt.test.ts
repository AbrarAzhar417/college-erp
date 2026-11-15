import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtCnic, fmtPhone } from '../../frontend/src/app/pages/admission/form-data.ts';

test('CNIC is formatted while typing', () => {
  assert.equal(fmtCnic('1234'), '1234');
  assert.equal(fmtCnic('123456'), '12345-6');
  assert.equal(fmtCnic('3520212345671'), '35202-1234567-1');
  assert.equal(fmtCnic('35202-1234567-19999'), '35202-1234567-1');
  assert.equal(fmtCnic('ab12'), '12');
});
test('phone is formatted while typing', () => {
  assert.equal(fmtPhone('0300'), '0300');
  assert.equal(fmtPhone('03001234567'), '0300-1234567');
  assert.equal(fmtPhone('+92 300 1234567'), '0300-1234567');
  assert.equal(fmtPhone('0300-1234567-99'), '0300-1234567');
});
