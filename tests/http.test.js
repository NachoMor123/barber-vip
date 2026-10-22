const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeArgentinaPhone, validArgentinaWhatsapp } = require('../lib/http');

test('normaliza un número mendocino local de 10 dígitos', () => {
  assert.equal(normalizeArgentinaPhone('261 752 9885'), '5492617529885');
  assert.equal(validArgentinaWhatsapp('261 752 9885'), true);
});

test('normaliza el formato argentino de discado con 0 y 15', () => {
  assert.equal(normalizeArgentinaPhone('0261 15 752-9885'), '5492617529885');
  assert.equal(validArgentinaWhatsapp('0261 15 752-9885'), true);
});

test('acepta números con prefijo internacional ya incluido', () => {
  assert.equal(normalizeArgentinaPhone('+54 9 261 752-9885'), '5492617529885');
  assert.equal(normalizeArgentinaPhone('54 261 752 9885'), '5492617529885');
});

test('rechaza números argentinos incompletos', () => {
  assert.equal(validArgentinaWhatsapp('261 752'), false);
  assert.equal(validArgentinaWhatsapp(''), false);
});
