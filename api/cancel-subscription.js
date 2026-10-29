const { admin, db } = require('../lib/admin');
const { send, method } = require('../lib/http');
const { requireBarber } = require('../lib/security');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;
    const barberRef = db().collection('barbers').doc(ctx.uid);
    const barberSnap = await barberRef.get();
    if (!barberSnap.exists) return send(res, 404, {ok:false,error:'No se encontró el perfil profesional.'});
    const barber = barberSnap.data();
    const id = String(barber.mpSubscriptionId || '');
    if (!id) return send(res, 409, {ok:false,error:'No hay una renovación automática activa para cancelar.'});
    if (['cancelled','canceled','paused','rejected'].includes(String(barber.mpSubscriptionStatus || '').toLowerCase())) {
      return send(res, 200, {ok:true,enabled:false,status:barber.mpSubscriptionStatus});
    }
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return send(res, 503, {ok:false,error:'Falta configurar MP_ACCESS_TOKEN en Vercel.'});
    const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`, {
      method:'PUT',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({status:'canceled'})
    });
    const result = await response.json().catch(()=>({}));
    if (!response.ok || !['cancelled','canceled'].includes(String(result.status||'').toLowerCase())) {
      console.error('Mercado Pago subscription cancellation failed',response.status,result.message||result.error||'unknown');
      return send(res,502,{ok:false,error:'Mercado Pago no confirmó la cancelación. Tu renovación no se marcó como cancelada.'});
    }
    const now = admin().firestore.FieldValue.serverTimestamp();
    await barberRef.update({mpSubscriptionStatus:String(result.status),autoRenewalEnabled:false,autoRenewalPending:false,autoRenewalCanceledAt:now,updatedAt:now});
    await barberRef.collection('recurringSubscriptions').doc(id).set({subscriptionId:id,status:String(result.status),canceledAt:now,updatedAt:now},{merge:true});
    return send(res,200,{ok:true,enabled:false,status:String(result.status),subscriptionExpiresAt:barber.subscriptionExpiresAt&&barber.subscriptionExpiresAt.toDate?barber.subscriptionExpiresAt.toDate().toISOString():barber.subscriptionExpiresAt||null});
  } catch(error) {
    console.error('cancel subscription error',error.message||error);
    return send(res,500,{ok:false,error:'No se pudo cancelar la renovación automática por un problema temporal.'});
  }
};
