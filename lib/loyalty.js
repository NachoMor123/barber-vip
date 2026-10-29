'use strict';

const FIXED_MILESTONES = Object.freeze([2, 4, 6]);
const DEFAULT_DISCOUNTS = Object.freeze([10, 20, 30]);

function normalizeFixedRewards(input) {
  const source = Array.isArray(input)
    ? [...input].sort((a, b) => Number(a?.cut || 0) - Number(b?.cut || 0))
    : [];
  return FIXED_MILESTONES.map((cut, index) => {
    const existing = source.find(row => Number(row?.cut) === cut) || source[index] || {};
    const value = Number(existing?.discount);
    const discount = Number.isInteger(value) && value >= 0 && value <= 100
      ? value
      : DEFAULT_DISCOUNTS[index];
    return { cut, discount, label: discount === 100 ? 'Servicio gratis' : `${discount}% OFF` };
  });
}

function normalizeCustomerLoyaltyOverride(mode, input) {
  if (mode !== 'custom') return { mode: 'standard' };
  if (!Array.isArray(input) || input.length !== FIXED_MILESTONES.length) {
    throw new Error('El programa personalizado debe incluir descuentos para las visitas 2, 4 y 6.');
  }
  const rewards = normalizeFixedRewards(input);
  const sorted = [...input].sort((a, b) => Number(a?.cut || 0) - Number(b?.cut || 0));
  const invalid = FIXED_MILESTONES.find((cut, index) => {
    const row = sorted.find(item => Number(item?.cut) === cut) || sorted[index] || {};
    const discount = Number(row?.discount);
    return !Number.isInteger(discount) || discount < 0 || discount > 100;
  });
  if (invalid) throw new Error('Cada descuento personalizado debe ser un número entero entre 0% y 100%.');
  return { mode: 'custom', rewards };
}

module.exports = { FIXED_MILESTONES, DEFAULT_DISCOUNTS, normalizeFixedRewards, normalizeCustomerLoyaltyOverride };
