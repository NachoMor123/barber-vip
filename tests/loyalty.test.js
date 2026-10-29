'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFixedRewards,
  normalizeCustomerLoyaltyOverride
} = require('../lib/loyalty');

test('normaliza hitos históricos 2, 4 y 8 a los hitos fijos 2, 4 y 6 sin perder descuentos', () => {
  assert.deepEqual(
    normalizeFixedRewards([
      { cut: 2, discount: 15 },
      { cut: 4, discount: 35 },
      { cut: 8, discount: 60 }
    ]).map(({ cut, discount }) => ({ cut, discount })),
    [{ cut: 2, discount: 15 }, { cut: 4, discount: 35 }, { cut: 6, discount: 60 }]
  );
});

test('los descuentos personalizados solo aceptan los hitos fijos 2, 4 y 6', () => {
  assert.deepEqual(
    normalizeCustomerLoyaltyOverride('custom', [
      { cut: 2, discount: 10 },
      { cut: 4, discount: 25 },
      { cut: 6, discount: 75 }
    ]),
    {
      mode: 'custom',
      rewards: [
        { cut: 2, discount: 10, label: '10% OFF' },
        { cut: 4, discount: 25, label: '25% OFF' },
        { cut: 6, discount: 75, label: '75% OFF' }
      ]
    }
  );
  assert.throws(() => normalizeCustomerLoyaltyOverride('custom', [
    { cut: 2, discount: 10 },
    { cut: 4, discount: 25 },
    { cut: 8, discount: 75 }
  ]), /son fijos/);
});

test('mantiene el modo estándar sin crear un programa de premios personalizado', () => {
  assert.deepEqual(normalizeCustomerLoyaltyOverride('standard', []), { mode: 'standard' });
});

test('rechaza programas personalizados incompletos y descuentos inválidos', () => {
  assert.throws(() => normalizeCustomerLoyaltyOverride('custom', [{ cut: 2, discount: 10 }]), /debe incluir descuentos/);
  assert.throws(() => normalizeCustomerLoyaltyOverride('custom', [
    { cut: 2, discount: 10 },
    { cut: 4, discount: 101 },
    { cut: 6, discount: 30 }
  ]), /entre 0% y 100%/);
});
