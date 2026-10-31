const test = require('node:test');
const assert = require('node:assert/strict');
const { subscription, calculateRenewalExpiry, DAY_MS } = require('../lib/subscription');

const iso = value => new Date(value).toISOString();
const now = new Date('2026-10-26T12:00:00.000Z');

test('marca una prueba vigente como activa y calcula días sin lecturas adicionales', () => {
  const result = subscription({
    trialStartedAt: new Date('2026-10-20T12:00:00.000Z'),
    hasPaidSubscription: false,
    subscriptionExpiresAt: new Date('2026-10-28T12:00:00.000Z')
  }, now);
  assert.equal(result.status, 'active');
  assert.equal(result.label, 'Prueba gratuita');
  assert.equal(result.isTrial, true);
  assert.equal(result.daysRemaining, 2);
});

test('una prueba gratuita vencida se suspende inmediatamente y no recibe gracia', () => {
  const result = subscription({
    trialStartedAt: new Date('2026-10-20T12:00:00.000Z'),
    hasPaidSubscription: false,
    subscriptionExpiresAt: new Date('2026-10-25T12:00:00.000Z')
  }, now);
  assert.equal(result.status, 'suspended');
  assert.equal(result.label, 'Prueba finalizada');
  assert.equal(result.isTrial, false);
  assert.equal(result.trialEnded, true);
});

test('una cuenta sin pagos aprobados nunca recibe período de gracia', () => {
  const result = subscription({
    hasPaidSubscription: false,
    subscriptionExpiresAt: new Date('2026-10-24T12:00:00.000Z')
  }, now);
  assert.equal(result.status, 'suspended');
  assert.equal(result.label, 'Cuenta vencida');
});

test('la gracia de una cuenta paga comienza después del vencimiento y termina al cumplir cinco días', () => {
  const expiry = new Date('2026-10-24T12:00:00.000Z');
  const atExpiry = subscription({hasPaidSubscription:true,subscriptionExpiresAt:expiry}, expiry);
  const afterGrace = subscription({hasPaidSubscription:true,subscriptionExpiresAt:expiry}, new Date(expiry.getTime()+5*DAY_MS));
  assert.equal(atExpiry.status, 'active');
  assert.equal(afterGrace.status, 'suspended');
});

test('clasifica el período de gracia de cinco días', () => {
  const result = subscription({
    hasPaidSubscription: true,
    subscriptionExpiresAt: new Date('2026-10-24T12:00:00.000Z')
  }, now);
  assert.equal(result.status, 'grace');
  assert.equal(result.label, 'Período de gracia');
  assert.equal(result.daysRemaining, 3);
});

test('clasifica como vencida una cuenta una vez agotada la gracia', () => {
  const result = subscription({
    hasPaidSubscription: true,
    subscriptionExpiresAt: new Date('2026-10-20T12:00:00.000Z')
  }, now);
  assert.equal(result.status, 'suspended');
  assert.equal(result.label, 'Cuenta vencida');
});

test('una fecha ausente o inválida bloquea la cuenta y nunca la presenta como prueba activa', () => {
  const missing = subscription({ trialStartedAt: new Date('2026-10-20T12:00:00.000Z'), hasPaidSubscription: false }, now);
  assert.equal(missing.status, 'suspended');
  assert.equal(missing.isTrial, false);
  const invalid = subscription({ subscriptionExpiresAt: 'no-es-fecha', trialStartedAt: new Date('2026-10-20T12:00:00.000Z'), hasPaidSubscription: false }, now);
  assert.equal(invalid.expiresAt, null);
  assert.equal(invalid.isTrial, false);
});

test('pagar durante la prueba activa 30 días desde la aprobación', () => {
  const approved = new Date('2026-10-26T12:00:00.000Z');
  const trialEnds = new Date(approved.getTime() + 3 * DAY_MS);
  assert.equal(
    calculateRenewalExpiry(trialEnds, approved, 'skip-trial').toISOString(),
    new Date(approved.getTime() + 30 * DAY_MS).toISOString()
  );
});

test('una renovación antes del vencimiento extiende 30 días desde el vencimiento existente', () => {
  const approved = new Date('2026-10-26T12:00:00.000Z');
  const currentExpiry = new Date('2026-11-05T12:00:00.000Z');
  assert.equal(
    calculateRenewalExpiry(currentExpiry, approved, 'renew').toISOString(),
    new Date(currentExpiry.getTime() + 30 * DAY_MS).toISOString()
  );
});

test('un pago durante la gracia o después del vencimiento inicia 30 días desde la aprobación', () => {
  const approved = new Date('2026-10-26T12:00:00.000Z');
  for (const currentExpiry of [
    new Date('2026-10-24T12:00:00.000Z'),
    new Date('2026-10-01T12:00:00.000Z')
  ]) {
    assert.equal(
      calculateRenewalExpiry(currentExpiry, approved, 'renew').toISOString(),
      new Date(approved.getTime() + 30 * DAY_MS).toISOString()
    );
  }
});

test('un pago sin fecha de aprobación válida falla explícitamente', () => {
  assert.throws(() => calculateRenewalExpiry(null, 'fecha-inválida'), /fecha de aprobación/);
});
