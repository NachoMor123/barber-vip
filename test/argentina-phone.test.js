const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeArgentinaPhone, validArgentinaWhatsapp } = require('../lib/http');

test('normalizes a Mendoza local mobile number without asking for +54 9', () => {
  assert.equal(normalizeArgentinaPhone('261 752 9885'), '5492617529885');
  assert.equal(validArgentinaWhatsapp('261 752 9885'), true);
});

test('normalizes common international Argentine formats', () => {
  assert.equal(normalizeArgentinaPhone('+54 9 261 752-9885'), '5492617529885');
  assert.equal(normalizeArgentinaPhone('0054 9 261 752 9885'), '5492617529885');
  assert.equal(validArgentinaWhatsapp('0261 15 752-9885'), true);
});

test('rejects incomplete or invalid Argentine WhatsApp numbers', () => {
  assert.equal(validArgentinaWhatsapp('261 752 988'), false);
  assert.equal(validArgentinaWhatsapp('12345'), false);
  assert.equal(validArgentinaWhatsapp(''), false);
});
