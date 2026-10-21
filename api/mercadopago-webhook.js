const crypto = require('crypto');
const { db, admin } = require('../lib/admin');
const { send } = require('../lib/http');

function verifySignature(req, paymentId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) throw new Error('Falta configurar MP_WEBHOOK_SECRET en Vercel.');
  const signature = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const parts = Object.fromEntries(signature.split(',').map(part => part.trim().split('=').map(v => v.trim())));
  const ts = parts.ts;
  const received = parts.v1;
  if (!ts || !received || !requestId || !paymentId) return false;
  const manifest = `id:${String(paymentId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex')); }
  catch (_) { return false; }
}

module.exports = async function handler(req, res) {
  if (!['POST', 'GET'].includes(req.method)) return send(res, 405, { ok: false, error: 'Método no permitido.' });
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const paymentId = String((req.query && req.query['data.id']) || (req.query && req.query.id) || (body.data && body.data.id) || body.id || '');
    const topic = String((req.query && (req.query.type || req.query.topic)) || body.type || body.topic || '');
    if (!paymentId || (topic && !['payment', 'payments'].includes(topic))) return send(res, 200, { ok: true, ignored: true });
    if (!verifySignature(req, paymentId)) return send(res, 401, { ok: false, error: 'Firma de notificación inválida.' });

    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return send(res, 503, { ok: false, error: 'Falta MP_ACCESS_TOKEN.' });
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${token}` } });
    const payment = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok) return send(res, 502, { ok: false, error: 'No se pudo consultar el pago en Mercado Pago.' });
    if (payment.status !== 'approved') return send(res, 200, { ok: true, ignored: true, status: payment.status || 'unknown' });
    const configuredPrice = Number.parseInt(process.env.SUBSCRIPTION_PRICE_ARS || '2500', 10);
    if (!Number.isFinite(configuredPrice) || configuredPrice < 1) return send(res, 503, { ok: false, error: 'SUBSCRIPTION_PRICE_ARS debe ser un importe válido en pesos.' });
    if (Number(payment.transaction_amount) !== configuredPrice || payment.currency_id !== 'ARS') return send(res, 400, { ok: false, error: 'El importe o la moneda del pago no coinciden con el precio configurado.' });

    const barberUid = String(payment.external_reference || (payment.metadata && payment.metadata.barber_uid) || '');
    let skipTrial = payment.metadata && payment.metadata.billing_action === 'skip-trial';
    if (!barberUid || (payment.metadata && payment.metadata.barber_uid && payment.metadata.barber_uid !== barberUid)) return send(res, 400, { ok: false, error: 'El pago no está asociado a una cuenta de Kelvori.' });
    const barberRef = db().collection('barbers').doc(barberUid);
    const payRef = barberRef.collection('payments').doc(String(payment.id));
    const preferenceId = String(payment.preference_id || '');
    const preferenceRef = preferenceId ? barberRef.collection('paymentPreferences').doc(preferenceId) : null;
    if (preferenceRef) {
      try { const preferenceSnap = await preferenceRef.get(); if (preferenceSnap.exists && preferenceSnap.data().billingAction === 'skip-trial') skipTrial = true; } catch (_) {}
    }
    const approvedAt = payment.date_approved ? new Date(payment.date_approved) : new Date();
    await db().runTransaction(async transaction => {
      const [barberSnap, paidSnap] = await Promise.all([transaction.get(barberRef), transaction.get(payRef)]);
      if (paidSnap.exists) return;
      if (!barberSnap.exists) throw new Error('No existe la cuenta asociada al pago.');
      const rawExpiry = barberSnap.data().subscriptionExpiresAt;
      const expiry = rawExpiry && rawExpiry.toDate ? rawExpiry.toDate() : (rawExpiry ? new Date(rawExpiry) : null);
      const base = !skipTrial && expiry && expiry.getTime() > approvedAt.getTime() ? expiry : approvedAt;
      const newExpiry = new Date(base.getTime() + 30 * 86400000);
      transaction.update(barberRef, { subscriptionExpiresAt: admin().firestore.Timestamp.fromDate(newExpiry), hasPaidSubscription: true, lastPaymentAt: admin().firestore.Timestamp.fromDate(approvedAt), updatedAt: admin().firestore.FieldValue.serverTimestamp() });
      transaction.set(payRef, {
        paymentId: String(payment.id), amount: Number(payment.transaction_amount), currency: payment.currency_id,
        status: 'approved', approvedAt: admin().firestore.Timestamp.fromDate(approvedAt), newExpiry: admin().firestore.Timestamp.fromDate(newExpiry), createdAt: admin().firestore.FieldValue.serverTimestamp()
      });
      if (preferenceRef) transaction.set(preferenceRef, { processedAt: admin().firestore.FieldValue.serverTimestamp(), paymentId: String(payment.id) }, { merge: true });
    });
    return send(res, 200, { ok: true, received: true });
  } catch (error) {
    console.error('Mercado Pago webhook error', error);
    return send(res, 500, { ok: false, error: error.message || 'No se pudo procesar la notificación.' });
  }
};
