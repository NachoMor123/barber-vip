const { db, admin } = require('../lib/admin');
const { send, method, body, text } = require('../lib/http');
const { requireUser, requireBarber, subscription } = require('../lib/security');
const { sendPushToBarberCustomers } = require('../lib/push');

const cleanDate = value => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
const view = doc => {
  const d = doc.data();
  const date = v => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v || null;
  return { id: doc.id, ...d, startsAt: date(d.startsAt), endsAt: date(d.endsAt), createdAt: date(d.createdAt), updatedAt: date(d.updatedAt) };
};
function customerPromotions(snapshot, customerId) {
  const now = Date.now();
  const eligible = snapshot.docs.map(view).filter(promo => {
    return promo.audience === 'all'
      || (Array.isArray(promo.customerIds) && promo.customerIds.includes(customerId));
  });
  // Return the next eligible scheduled start without exposing other customers' targeted promotions.
  // This lets clients expire their local cache at the right time without polling Firestore.
  const nextScheduledAt = eligible
    .filter(promo => promo.active !== false && promo.startsAt && new Date(promo.startsAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0]?.startsAt || null;
  const promotions = eligible.filter(promo => {
    const start = promo.startsAt ? new Date(promo.startsAt).getTime() : 0;
    const end = promo.endsAt ? new Date(promo.endsAt).getTime() : Infinity;
    return promo.active !== false && start <= now && end >= now;
  }).map(promo => {
    const { customerIds, ...publicPromo } = promo;
    return publicPromo;
  });
  return { promotions, nextScheduledAt };
}

async function touchPromotionRevision(barberRef) {
  // One tiny write is the signal. Connected clients listen to this document and fetch the
  // actual promotion list only after a revision changes; no periodic polling.
  const revision = admin().firestore.Timestamp.now();
  const revisionId = require('crypto').randomUUID();
  await barberRef.collection('publicMeta').doc('promotions').set({ updatedAt: revision, revision: revisionId });
}
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return;
  try {
    if (req.method === 'GET') {
      const decoded = await requireUser(req, res); if (!decoded) return;
      const database = db();
      // Customer app passes its linked barber ID. Validate access with the customer's own
      // document so a promotion refresh does not need an extra userProfiles read.
      const requestedBarberUid = new URL(req.url || '/', 'https://barber-vip.internal').searchParams.get('barberUid') || '';
      if (requestedBarberUid) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestedBarberUid)) {
          return send(res, 400, {ok:false,error:'Identificador profesional inválido.'});
        }
        const customerSnap = await database.collection('barbers').doc(requestedBarberUid).collection('customers').doc(decoded.uid).get();
        const customer = customerSnap.exists ? customerSnap.data() : null;
        if (!customer || customer.active === false || customer.barberUid !== requestedBarberUid) {
          return send(res, 403, {ok:false,error:'No tenés permiso para ver estas promociones.'});
        }
        const promosSnap = await database.collection('barbers').doc(requestedBarberUid).collection('promotions').where('active','==',true).limit(100).get();
        const result = customerPromotions(promosSnap, decoded.uid);
        return send(res, 200, {ok:true,...result});
      }
      const profileSnap = await database.collection('userProfiles').doc(decoded.uid).get();
      if (!profileSnap.exists) return send(res, 403, { ok:false, error:'No se encontró tu perfil.' });
      const profile = profileSnap.data();
      if (profile.role === 'barber') {
        if (profile.role !== 'barber') return send(res, 403, { ok:false, error:'Esta acción es exclusiva del administrador de la barbería.' });
        // profileSnap already authorized this identity; do not read userProfiles a second time.
        const barberRef = database.collection('barbers').doc(decoded.uid);
        const promosRef = barberRef.collection('promotions');
        const barberSnap = await barberRef.get();
        if (!barberSnap.data()?.promotionsInitialized && subscription(barberSnap.data() || {}).status !== 'suspended') {
          const now = admin().firestore.FieldValue.serverTimestamp();
          const examples = [
            { title:'Promo de bienvenida', description:'Un detalle especial para tu próxima visita.', conditions:'Mostrá esta promoción a tu profesional.', audience:'all', customerIds:[], active:true, createdAt:now, updatedAt:now },
            { title:'Días de la semana', description:'Consultá con tu profesional si hay una promo vigente para días tranquilos.', conditions:'Consultar disponibilidad antes del servicio.', audience:'all', customerIds:[], active:false, createdAt:now, updatedAt:now }
          ];
          const batch = database.batch(); examples.forEach(promo => batch.set(promosRef.doc(), promo)); batch.update(barberRef, { promotionsInitialized:true }); await batch.commit();
          await touchPromotionRevision(barberRef);
        }
        const snap = await promosRef.orderBy('createdAt','desc').limit(100).get();
        return send(res, 200, { ok:true, promotions:snap.docs.map(view) });
      }
      if (profile.role === 'customer' && profile.barberUid) {
        const customerSnap = await database.collection('barbers').doc(profile.barberUid).collection('customers').doc(decoded.uid).get();
        if (!customerSnap.exists || customerSnap.data().active === false) return send(res, 403, { ok:false, error:'Este cliente no está activo.' });
        const snap = await database.collection('barbers').doc(profile.barberUid).collection('promotions').where('active','==',true).limit(100).get();
        const result = customerPromotions(snap, decoded.uid);
        return send(res, 200, { ok:true, ...result });
      }
      return send(res, 403, { ok:false, error:'No tenés permiso para ver estas promociones.' });
    }
    const ctx = await requireBarber(req, res); if (!ctx) return;
    const barberRef = ctx.db.collection('barbers').doc(ctx.uid);
    const barberSnap = await barberRef.get();
    if (!barberSnap.exists) return send(res, 404, {ok:false,error:'No se encontró el perfil profesional.'});
    if (subscription(barberSnap.data()).status === 'suspended') {
      return send(res, 402, {ok:false,error:'Tu plan está vencido. Renovalo para modificar promociones.'});
    }
    const data = body(req);
    const collection = barberRef.collection('promotions');
    const id = text(data.id, 120);
    if (req.method === 'DELETE') {
      if (!id) return send(res, 400, {ok:false,error:'Falta identificar la promoción.'});
      await collection.doc(id).delete();
      await touchPromotionRevision(barberRef);
      return send(res, 200, {ok:true});
    }
    const title = text(data.title, 80), description = text(data.description, 500), conditions = text(data.conditions, 300);
    const audience = data.audience === 'selected' ? 'selected' : 'all';
    const customerIds = audience === 'selected' && Array.isArray(data.customerIds) ? [...new Set(data.customerIds.map(v=>text(v,100)).filter(Boolean))].slice(0,500) : [];
    const startsAt = cleanDate(data.startsAt), endsAt = cleanDate(data.endsAt);
    // date-only values keep whole-day semantics; datetime-local values arrive as ISO timestamps and retain their exact time.
    if (startsAt && !String(data.startsAt).includes('T')) startsAt.setHours(0,0,0,0);
    if (endsAt && !String(data.endsAt).includes('T')) endsAt.setHours(23,59,59,999);
    if (title.length < 3) return send(res, 400, {ok:false,error:'El título debe tener al menos 3 caracteres.'});
    if (/\[[^\]]{1,100}\]/.test(title+' '+description+' '+conditions)) return send(res, 400, {ok:false,error:'Reemplazá los textos entre corchetes por el beneficio y las condiciones reales antes de guardar la promoción.'});
    if (startsAt && endsAt && endsAt < startsAt) return send(res, 400, {ok:false,error:'La fecha de fin no puede ser anterior a la fecha de inicio.'});
    if (audience === 'selected' && !customerIds.length) return send(res, 400, {ok:false,error:'Seleccioná al menos un cliente para esta promoción.'});
    const now = admin().firestore.FieldValue.serverTimestamp();
    const payload = { title, description, conditions, audience, customerIds, startsAt: startsAt ? admin().firestore.Timestamp.fromDate(startsAt) : null, endsAt: endsAt ? admin().firestore.Timestamp.fromDate(endsAt) : null, active: data.active !== false, updatedAt: now };
    if (req.method === 'POST') {
      payload.createdAt = now;
      const ref = await collection.add(payload);
      await touchPromotionRevision(barberRef);
      const nowMs = Date.now();
      const currentlyActive = payload.active !== false && (!startsAt || startsAt.getTime() <= nowMs) && (!endsAt || endsAt.getTime() >= nowMs);
      if (currentlyActive) {
        await sendPushToBarberCustomers({
          barberUid: ctx.uid,
          customerIds: audience === 'selected' ? customerIds : null,
          title: 'Nueva promoción: '+title,
          body: 'Hay una nueva promoción disponible. Abrí Barber VIP para verla.',
          tag: 'barber-vip-promo-'+ref.id,
          url: '/'
        });
      }
      return send(res, 201, {ok:true,id:ref.id});
    }
    if (!id) return send(res, 400, {ok:false,error:'Falta identificar la promoción.'});
    const promotionRef = collection.doc(id);
    const existingPromotion = await promotionRef.get();
    if (!existingPromotion.exists) return send(res, 404, {ok:false,error:'No se encontró esa promoción.'});
    const existingData = existingPromotion.data() || {};
    const millis = value => {
      if (!value) return null;
      const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    };
    const sameCustomerIds = JSON.stringify((Array.isArray(existingData.customerIds) ? existingData.customerIds : []).map(String).sort())
      === JSON.stringify(customerIds.map(String).sort());
    const unchanged = String(existingData.title || '') === title
      && String(existingData.description || '') === description
      && String(existingData.conditions || '') === conditions
      && String(existingData.audience || 'all') === audience
      && (existingData.active !== false) === (payload.active !== false)
      && sameCustomerIds
      && millis(existingData.startsAt) === (startsAt ? startsAt.getTime() : null)
      && millis(existingData.endsAt) === (endsAt ? endsAt.getTime() : null);
    if (unchanged) return send(res, 200, {ok:true,id,unchanged:true});
    const wasActive = existingData.active !== false;
    await promotionRef.update(payload);
    await touchPromotionRevision(barberRef);
    const nowMs = Date.now();
    const currentlyActive = payload.active !== false && (!startsAt || startsAt.getTime() <= nowMs) && (!endsAt || endsAt.getTime() >= nowMs);
    if (!wasActive && currentlyActive) {
      await sendPushToBarberCustomers({
        barberUid: ctx.uid,
        customerIds: audience === 'selected' ? customerIds : null,
        title: 'Nueva promoción: '+title,
        body: 'Se activó una promoción para vos. Abrí Barber VIP para verla.',
        tag: 'barber-vip-promo-'+id,
        url: '/'
      });
    }
    return send(res, 200, {ok:true,id});
  } catch (error) {
    console.error('promotions error', error);
    return send(res, 500, {ok:false,error:'No se pudo guardar la promoción. Revisá los datos e intentá otra vez.'});
  }
};
