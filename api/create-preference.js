const { send, method } = require('../lib/http');
const { requireBarber, subscription } = require('../lib/security');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;
    const barberSnap = await ctx.db.collection('barbers').doc(ctx.uid).get();
    if (!barberSnap.exists) return send(res, 404, {ok:false,error:'No se encontró el perfil de tu cuenta.'});
    if (subscription(barberSnap.data()).status === 'active') return send(res, 409, {ok:false,error:'Tu cuenta está activa. No necesitás iniciar un pago ahora.'});
    const token = process.env.MP_ACCESS_TOKEN;
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const price = Number.parseInt(process.env.SUBSCRIPTION_PRICE_ARS || '2500', 10);
    if (!Number.isFinite(price) || price < 1) return send(res, 503, { ok: false, error: 'SUBSCRIPTION_PRICE_ARS debe ser un importe válido en pesos.' });
    if (!token) return send(res, 503, { ok: false, error: 'Falta configurar MP_ACCESS_TOKEN en Vercel.' });
    if (!appUrl.startsWith('https://')) return send(res, 503, { ok: false, error: 'Falta configurar APP_URL con la URL HTTPS real de Vercel.' });

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: 'barber-vip-monthly', title: 'Barber VIP — suscripción mensual', description: 'Acceso mensual a Barber VIP', quantity: 1, currency_id: 'ARS', unit_price: price }],
        external_reference: ctx.uid,
        metadata: { barber_uid: ctx.uid, product: 'barber-vip-monthly' },
        back_urls: { success: `${appUrl}/?payment=success`, failure: `${appUrl}/?payment=failure`, pending: `${appUrl}/?payment=pending` },
        auto_return: 'approved',
        notification_url: `${appUrl}/api/mercadopago-webhook`
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.init_point) {
      console.error('Mercado Pago preference error', response.status, result);
      return send(res, 502, { ok: false, error: 'Mercado Pago no pudo crear el pago. Revisá que MP_ACCESS_TOKEN sea correcto y corresponda al ambiente configurado.' });
    }
    return send(res, 200, { ok: true, url: result.init_point, preferenceId: result.id });
  } catch (error) {
    console.error('create preference error', error);
    return send(res, 500, { ok: false, error: 'No se pudo iniciar el pago.' });
  }
};
