const DAY_MS = 86400000;
const GRACE_DAYS = 5;
const PAID_PERIOD_DAYS = 30;

function toDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Derives subscription status from the already-loaded barber document.
 * This function does not read or write Firestore.
 */
function subscription(barber, nowValue = Date.now()) {
  const rawExpiry = barber && barber.subscriptionExpiresAt;
  const expiry = toDate(rawExpiry);
  const now = nowValue instanceof Date ? nowValue.getTime() : Number(nowValue);
  const isTrial = !!(barber && barber.trialStartedAt) && barber.hasPaidSubscription !== true;

  if (!expiry || !Number.isFinite(now)) {
    // A trial marker alone is not enough: without a valid expiry the UI must
    // never present a missing/invalid subscription as an active free trial.
    return { status: 'suspended', label: 'Fecha de vencimiento sin configurar', daysRemaining: null, expiresAt: null, isTrial: false };
  }

  const ms = expiry.getTime() - now;
  const days = Math.ceil(ms / DAY_MS);
  if (ms >= 0) {
    return {
      status: 'active',
      label: isTrial ? 'Prueba gratuita' : 'Cuenta activa',
      daysRemaining: days,
      expiresAt: expiry.toISOString(),
      isTrial
    };
  }

  // A free trial ends on its expiry date. Grace is reserved for accounts
  // that have successfully paid at least once; it is never an extension of a trial.
  if (isTrial) {
    return {
      status: 'suspended',
      label: 'Prueba finalizada',
      daysRemaining: days,
      expiresAt: expiry.toISOString(),
      isTrial: false,
      trialEnded: true
    };
  }

  const graceRemaining = expiry.getTime() + GRACE_DAYS * DAY_MS - now;
  if (barber.hasPaidSubscription === true && graceRemaining > 0) {
    return {
      status: 'grace',
      label: 'Período de gracia',
      daysRemaining: Math.ceil(graceRemaining / DAY_MS),
      expiresAt: expiry.toISOString(),
      isTrial: false
    };
  }

  return {
    status: 'suspended',
    label: 'Cuenta vencida',
    daysRemaining: days,
    expiresAt: expiry.toISOString(),
    isTrial: false,
    trialEnded: false
  };
}

/**
 * Adds a paid 30-day period.
 * - Activating payment during the free trial starts the paid period on approval.
 * - A renewal paid before its current expiry extends that expiry.
 * - A renewal paid during grace or after expiry starts on payment approval.
 */
function calculateRenewalExpiry(currentExpiry, approvedAt, billingAction = 'renew') {
  const approved = toDate(approvedAt);
  if (!approved) throw new Error('La fecha de aprobación del pago no es válida.');

  const current = toDate(currentExpiry);
  const skipTrial = billingAction === 'skip-trial';
  const base = !skipTrial && current && current.getTime() > approved.getTime()
    ? current
    : approved;

  return new Date(base.getTime() + PAID_PERIOD_DAYS * DAY_MS);
}

module.exports = { subscription, calculateRenewalExpiry, toDate, DAY_MS, GRACE_DAYS, PAID_PERIOD_DAYS };
