const { send, method } = require('../lib/http');
const { requireBarber, subscription } = require('../lib/security');
const { admin } = require('../lib/admin');

function expiryDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function getPreapproval(id, token) {
  const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const result = await response.json().catch(() => ({}));
  return response.ok ? result : null;
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  // Preview deployments share production credentials unless a separate sandbox is configured.
  // Never create a real recurring contract from a protected preview URL.
  if (process.env.VERCEL_ENV === 'preview') {
    return send(res, 503, { ok:false, error:'Los cobros automáticos están deshabilitados en vistas previas para evitar cargos reales. Probá este flujo únicamente en el entorno de pruebas de Mercado Pago.' });
  }
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;
    const barberRef = ctx.db.collection('barbers').doc(ctx.uid);
    const barberSnap = await barberRef.get();
    if (!barberSnap.exists) return send(res, 404, {ok:false,error:'No se encontró el perfil de tu cuenta.'});
    const barber = barberSnap.data();
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const action = data.action === 'skip-trial' ? 'skip-trial' : data.action === 'auto-renew' ? 'auto-renew' : 'renew';
    const currentStatus = subscription(barber);
    const token = process.env.MP_ACCESS_TOKEN;
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const price = Number.parseInt(process.env.SUBSCRIPTION_PRICE_ARS || '2500', 10);
    const payerEmail = String(ctx.decoded.email || '').trim().toLowerCase();

    if (!Number.isFinite(price) || price < 1) return send(res, 503, { ok:false,error:'SUBSCRIPTION_PRICE_ARS debe ser un importe válido en pesos.' });
    if (!token) return send(res, 503, { ok:false,error:'Falta configurar MP_ACCESS_TOKEN en Vercel.' });
    if (!appUrl.startsWith('https://')) return send(res, 503, { ok:false,error:'Falta configurar APP_URL con la URL HTTPS real de Vercel.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) return send(res, 400, {ok:false,error:'La cuenta de Barber VIP necesita un correo electrónico válido para asociar la suscripción automática.'});
    if (barber.autoRenewalEnabled === true && barber.mpSubscriptionId && barber.mpSubscriptionStatus === 'authorized') {
      return send(res, 409, {ok:false,error:'La renovación automática ya está activada.'});
    }
    if (currentStatus.status === 'active' && action === 'renew') {
      return send(res, 409, {ok:false,error:'Tu plan está activo. Elegí activar la renovación automática o consultá el período vigente.'});
    }

    const existingId = String(barber.mpSubscriptionId || '');
    if (existingId && !['cancelled','canceled','paused','rejected'].includes(String(barber.mpSubscriptionStatus || '').toLowerCase())) {
      const existing = await getPreapproval(existingId, token);
      if (existing && existing.external_reference === ctx.uid && existing.status === 'pending' && existing.init_point) {
        return send(res, 200, {ok:true,url:existing.init_point,subscriptionId:existing.id,autoRenewalPending:true,reused:true});
      }
      if (existing && existing.external_reference === ctx.uid && existing.status === 'authorized') {
        await barberRef.update({mpSubscriptionStatus:'authorized',autoRenewalEnabled:true,autoRenewalPending:false,updatedAt:admin().firestore.FieldValue.serverTimestamp()});
        return send(res, 409, {ok:false,error:'La renovación automática ya está autorizada en Mercado Pago.'});
      }
    }

    const currentExpiry = expiryDate(barber.subscriptionExpiresAt);
    const startDate = action === 'auto-renew' && currentExpiry && currentExpiry.getTime() > Date.now()
      ? currentExpiry.toISOString()
      : null;
    const autoRecurring = {frequency:1,frequency_type:'months',transaction_amount:price,currency_id:'ARS'};
    if (startDate) autoRecurring.start_date = startDate;
    const response = await fetch('https://api.mercadopago.com/preapproval', {
      method:'POST',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        reason:'Barber VIP — suscripción mensual',
        external_reference:ctx.uid,
        payer_email:payerEmail,
        auto_recurring:autoRecurring,
        back_url:`${appUrl}/?subscription=return`,
        notification_url:`${appUrl}/api/mercadopago-webhook`,
        status:'pending',
        metadata:{barber_uid:ctx.uid,product:'barber-vip-monthly',billing_action:action}
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id || !result.init_point) {
      console.error('Mercado Pago subscription creation error',response.status,result.message||result.error||'unknown');
      return send(res,502,{ok:false,error:'Mercado Pago no pudo crear la suscripción. Revisá las credenciales y el correo asociado a tu cuenta.'});
    }
    const now=admin().firestore.FieldValue.serverTimestamp();
    await barberRef.update({
      mpSubscriptionId:String(result.id),
      mpSubscriptionStatus:String(result.status||'pending'),
      autoRenewalEnabled:false,
      autoRenewalPending:true,
      autoRenewalStartAt:startDate,
      autoRenewalBillingAction:action,
      autoRenewalInitialPaymentProcessed:false,
      updatedAt:now
    });
    await barberRef.collection('recurringSubscriptions').doc(String(result.id)).set({
      subscriptionId:String(result.id),status:String(result.status||'pending'),billingAction:action,startDate:startDate||null,
      amount:price,currency:'ARS',payerEmail,createdAt:now,updatedAt:now
    },{merge:true});
    return send(res,200,{ok:true,url:result.init_point,subscriptionId:String(result.id),autoRenewalPending:true,startDate});
  } catch(error) {
    console.error('create recurring subscription error',error.message||error);
    return send(res,500,{ok:false,error:'No se pudo iniciar la suscripción automática por un problema temporal.'});
  }
};
