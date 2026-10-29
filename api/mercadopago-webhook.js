const crypto = require('crypto');
const { db, admin } = require('../lib/admin');
const { send } = require('../lib/http');
const { calculateRenewalExpiry } = require('../lib/subscription');

function verifySignature(req, notificationId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) throw new Error('Falta configurar MP_WEBHOOK_SECRET en Vercel.');
  const signature = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const parts = Object.fromEntries(signature.split(',').map(part => part.trim().split('=').map(v => v.trim())));
  const ts = parts.ts, received = parts.v1;
  if (!ts || !received || !requestId || !notificationId) return false;
  const expected = crypto.createHmac('sha256', secret).update(`id:${String(notificationId).toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(received,'hex')); }
  catch (_) { return false; }
}
async function mercadoPagoGet(path,token) {
  const response=await fetch(`https://api.mercadopago.com${path}`,{headers:{Authorization:`Bearer ${token}`}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error('No se pudo confirmar el evento en Mercado Pago.');error.status=response.status;throw error;}
  return data;
}
function configuredPrice() {
  const value=Number.parseInt(process.env.SUBSCRIPTION_PRICE_ARS||'2500',10);
  if(!Number.isFinite(value)||value<1)throw new Error('SUBSCRIPTION_PRICE_ARS debe ser un importe válido en pesos.');
  return value;
}
async function processApprovedRecurringPayment({payment,preapprovalId,eventBillingAction}) {
  if(String(payment.status||'')!=='approved')return {ignored:true,reason:'not-approved'};
  const price=configuredPrice();
  if(Number(payment.transaction_amount)!==price||payment.currency_id!=='ARS') {
    console.warn('[Mercado Pago] Recurring payment amount/currency did not match configured subscription.');
    return {ignored:true,reason:'amount-mismatch'};
  }
  const barberUid=String(payment.external_reference||'');
  const paymentId=String(payment.id||'');
  if(!barberUid||!paymentId||!preapprovalId)throw new Error('El pago recurrente no contiene referencias válidas.');
  const barberRef=db().collection('barbers').doc(barberUid);
  const paymentRef=barberRef.collection('payments').doc(paymentId);
  const recurringRef=barberRef.collection('recurringSubscriptions').doc(String(preapprovalId));
  const approvedAt=payment.date_approved?new Date(payment.date_approved):new Date();
  if(Number.isNaN(approvedAt.getTime()))throw new Error('La fecha de aprobación del pago recurrente no es válida.');
  let duplicate=false;
  await db().runTransaction(async transaction=>{
    const [barberSnap,paidSnap]=await Promise.all([transaction.get(barberRef),transaction.get(paymentRef)]);
    if(paidSnap.exists){duplicate=true;return;}
    if(!barberSnap.exists)throw new Error('No existe la cuenta asociada al pago recurrente.');
    const barber=barberSnap.data();
    if(String(barber.mpSubscriptionId||'')!==String(preapprovalId))throw new Error('El pago corresponde a una suscripción que ya no es la actual.');
    const firstInvoice=barber.autoRenewalInitialPaymentProcessed!==true;
    const requestedAction=String(eventBillingAction||barber.autoRenewalBillingAction||'renew');
    const billingAction=firstInvoice&&requestedAction==='skip-trial'?'skip-trial':'renew';
    const newExpiry=calculateRenewalExpiry(barber.subscriptionExpiresAt,approvedAt,billingAction);
    transaction.update(barberRef,{
      subscriptionExpiresAt:admin().firestore.Timestamp.fromDate(newExpiry),hasPaidSubscription:true,
      lastPaymentAt:admin().firestore.Timestamp.fromDate(approvedAt),autoRenewalInitialPaymentProcessed:true,
      autoRenewalEnabled:barber.mpSubscriptionStatus==='authorized'||barber.autoRenewalEnabled===true,
      autoRenewalPending:barber.mpSubscriptionStatus!=='authorized'&&barber.autoRenewalEnabled!==true,
      updatedAt:admin().firestore.FieldValue.serverTimestamp()
    });
    transaction.set(paymentRef,{
      paymentId,amount:Number(payment.transaction_amount),currency:payment.currency_id,status:'approved',
      billingAction,source:'recurring-subscription',recurringSubscriptionId:String(preapprovalId),
      approvedAt:admin().firestore.Timestamp.fromDate(approvedAt),newExpiry:admin().firestore.Timestamp.fromDate(newExpiry),
      createdAt:admin().firestore.FieldValue.serverTimestamp()
    });
    transaction.set(recurringRef,{
      subscriptionId:String(preapprovalId),lastApprovedPaymentId:paymentId,lastApprovedAt:admin().firestore.Timestamp.fromDate(approvedAt),
      lastExpiry:admin().firestore.Timestamp.fromDate(newExpiry),lastPaymentStatus:'approved',
      updatedAt:admin().firestore.FieldValue.serverTimestamp()
    },{merge:true});
  });
  return {duplicate,received:true};
}
async function processSubscriptionState(id,token) {
  const remote=await mercadoPagoGet(`/preapproval/${encodeURIComponent(id)}`,token);
  const barberUid=String(remote.external_reference||'');
  if(!barberUid||String(remote.id||'')!==String(id))throw new Error('La suscripción no está asociada a una cuenta válida de Barber VIP.');
  const barberRef=db().collection('barbers').doc(barberUid);
  const barberSnap=await barberRef.get();
  if(!barberSnap.exists)throw new Error('No existe la cuenta asociada a la suscripción.');
  const current=barberSnap.data();
  const currentContract=String(current.mpSubscriptionId||'')===String(id);
  const status=String(remote.status||'unknown').toLowerCase();
  if(currentContract)await barberRef.update({
    mpSubscriptionStatus:status,autoRenewalEnabled:status==='authorized',autoRenewalPending:status==='pending',
    autoRenewalUpdatedAt:admin().firestore.FieldValue.serverTimestamp(),updatedAt:admin().firestore.FieldValue.serverTimestamp()
  });
  await barberRef.collection('recurringSubscriptions').doc(String(id)).set({subscriptionId:String(id),status,updatedAt:admin().firestore.FieldValue.serverTimestamp()},{merge:true});
  return {received:true,status,currentContract};
}
async function processOneTimePayment(payment) {
  if(payment.status!=='approved')return {ignored:true,status:payment.status||'unknown'};
  const price=configuredPrice();
  if(Number(payment.transaction_amount)!==price||payment.currency_id!=='ARS')return {ignored:true,reason:'amount-mismatch'};
  const barberUid=String(payment.external_reference||(payment.metadata&&payment.metadata.barber_uid)||'');
  if(!barberUid||(payment.metadata&&payment.metadata.barber_uid&&payment.metadata.barber_uid!==barberUid))throw new Error('El pago no está asociado a una cuenta de Barber VIP.');
  const barberRef=db().collection('barbers').doc(barberUid);
  const payRef=barberRef.collection('payments').doc(String(payment.id));
  const preferenceId=String(payment.preference_id||'');
  const preferenceRef=preferenceId?barberRef.collection('paymentPreferences').doc(preferenceId):null;
  let skipTrial=payment.metadata&&payment.metadata.billing_action==='skip-trial';
  if(preferenceRef) {
    const preferenceSnap=await preferenceRef.get();
    if(preferenceSnap.exists) {
      const action=preferenceSnap.data().billingAction;
      if(!['skip-trial','renew'].includes(action))throw new Error('La preferencia no tiene una acción de renovación válida.');
      skipTrial=action==='skip-trial';
    } else if(payment.metadata&&['skip-trial','renew'].includes(payment.metadata.billing_action)) {
      skipTrial=payment.metadata.billing_action==='skip-trial';
    } else throw new Error('No se pudo confirmar el tipo de renovación del pago.');
  } else if(!payment.metadata||!['skip-trial','renew'].includes(payment.metadata.billing_action)) {
    throw new Error('No se pudo confirmar el tipo de renovación del pago.');
  }
  const approvedAt=payment.date_approved?new Date(payment.date_approved):new Date();
  await db().runTransaction(async transaction=>{
    const [barberSnap,paidSnap]=await Promise.all([transaction.get(barberRef),transaction.get(payRef)]);
    if(paidSnap.exists)return;
    if(!barberSnap.exists)throw new Error('No existe la cuenta asociada al pago.');
    const newExpiry=calculateRenewalExpiry(barberSnap.data().subscriptionExpiresAt,approvedAt,skipTrial?'skip-trial':'renew');
    transaction.update(barberRef,{subscriptionExpiresAt:admin().firestore.Timestamp.fromDate(newExpiry),hasPaidSubscription:true,lastPaymentAt:admin().firestore.Timestamp.fromDate(approvedAt),updatedAt:admin().firestore.FieldValue.serverTimestamp()});
    transaction.set(payRef,{paymentId:String(payment.id),amount:Number(payment.transaction_amount),currency:payment.currency_id,status:'approved',billingAction:skipTrial?'skip-trial':'renew',approvedAt:admin().firestore.Timestamp.fromDate(approvedAt),newExpiry:admin().firestore.Timestamp.fromDate(newExpiry),createdAt:admin().firestore.FieldValue.serverTimestamp()});
    if(preferenceRef)transaction.set(preferenceRef,{processedAt:admin().firestore.FieldValue.serverTimestamp(),paymentId:String(payment.id)},{merge:true});
  });
  return {received:true};
}
module.exports=async function handler(req,res) {
  if(!['POST','GET'].includes(req.method))return send(res,405,{ok:false,error:'Método no permitido.'});
  try {
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const notificationId=String((req.query&&req.query['data.id'])||(req.query&&req.query.id)||(body.data&&body.data.id)||body.id||'');
    const topic=String((req.query&&(req.query.type||req.query.topic))||body.type||body.topic||'');
    if(!notificationId||(topic&&!['payment','payments','subscription_preapproval','subscription_authorized_payment'].includes(topic)))return send(res,200,{ok:true,ignored:true});
    if(!verifySignature(req,notificationId))return send(res,401,{ok:false,error:'Firma de notificación inválida.'});
    const token=process.env.MP_ACCESS_TOKEN;
    if(!token)return send(res,503,{ok:false,error:'Falta MP_ACCESS_TOKEN.'});
    if(topic==='subscription_preapproval')return send(res,200,{ok:true,...await processSubscriptionState(notificationId,token)});
    if(topic==='subscription_authorized_payment') {
      const invoice=await mercadoPagoGet(`/authorized_payments/${encodeURIComponent(notificationId)}`,token);
      const preapprovalId=String(invoice.preapproval_id||'');
      const nested=invoice.payment&&typeof invoice.payment==='object'?invoice.payment:{};
      const paymentId=String(nested.id||'');
      if(!preapprovalId||!paymentId||(nested.status&&nested.status!=='approved'))return send(res,200,{ok:true,ignored:true,reason:'invoice-not-approved'});
      const payment=await mercadoPagoGet(`/v1/payments/${encodeURIComponent(paymentId)}`,token);
      if(!payment.preapproval_id)payment.preapproval_id=preapprovalId;
      if(!payment.external_reference&&invoice.external_reference)payment.external_reference=String(invoice.external_reference);
      return send(res,200,{ok:true,...await processApprovedRecurringPayment({payment,preapprovalId,eventBillingAction:invoice.metadata&&invoice.metadata.billing_action})});
    }
    const payment=await mercadoPagoGet(`/v1/payments/${encodeURIComponent(notificationId)}`,token);
    if(payment.preapproval_id)return send(res,200,{ok:true,...await processApprovedRecurringPayment({payment,preapprovalId:String(payment.preapproval_id),eventBillingAction:payment.metadata&&payment.metadata.billing_action})});
    return send(res,200,{ok:true,...await processOneTimePayment(payment)});
  } catch(error) {
    console.error('Mercado Pago webhook error',error.message||error);
    const status=Number(error.status);
    return send(res,status>=400&&status<500?400:500,{ok:false,error:'No se pudo procesar la notificación de pago por un problema temporal.'});
  }
};
