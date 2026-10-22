const { db, admin } = require('../lib/admin');
const { send, method, body, text } = require('../lib/http');
const { requireUser, requireBarber, subscription } = require('../lib/security');

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
async function touchPromotionRevision(barberRef) {
  // Use the same revision value in the legacy profile field and the public marker,
  // so the client can compare its already-loaded profile without an extra read.
  const revision = admin().firestore.Timestamp.now();
  await Promise.all([
    barberRef.update({ promotionsUpdatedAt: revision }),
    barberRef.collection('publicMeta').doc('promotions').set({ updatedAt: revision })
  ]);
}
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return;
  try {
    if (req.method === 'GET') {
      const decoded = await requireUser(req, res); if (!decoded) return;
      const database = db();
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
        const now = Date.now();
        const promos = snap.docs.map(view).filter(p => {
          const start = p.startsAt ? new Date(p.startsAt).getTime() : 0;
          const end = p.endsAt ? new Date(p.endsAt).getTime() : Infinity;
          const assigned = p.audience === 'all' || (Array.isArray(p.customerIds) && p.customerIds.includes(decoded.uid));
          return assigned && start <= now && end >= now;
        });
        const publicPromos = promos.map(promo => { const { customerIds, ...safePromo } = promo; return safePromo; });
        return send(res, 200, { ok:true, promotions:publicPromos });
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
    if (startsAt && endsAt && endsAt < startsAt) return send(res, 400, {ok:false,error:'La fecha de fin no puede ser anterior a la fecha de inicio.'});
    if (audience === 'selected' && !customerIds.length) return send(res, 400, {ok:false,error:'Seleccioná al menos un cliente para esta promoción.'});
    const now = admin().firestore.FieldValue.serverTimestamp();
    const payload = { title, description, conditions, audience, customerIds, startsAt: startsAt ? admin().firestore.Timestamp.fromDate(startsAt) : null, endsAt: endsAt ? admin().firestore.Timestamp.fromDate(endsAt) : null, active: data.active !== false, updatedAt: now };
    if (req.method === 'POST') {
      payload.createdAt = now;
      const ref = await collection.add(payload);
      await touchPromotionRevision(barberRef);
      return send(res, 201, {ok:true,id:ref.id});
    }
    if (!id) return send(res, 400, {ok:false,error:'Falta identificar la promoción.'});
    await collection.doc(id).update(payload);
    await touchPromotionRevision(barberRef);
    return send(res, 200, {ok:true,id});
  } catch (error) {
    console.error('promotions error', error);
    return send(res, 500, {ok:false,error:'No se pudo guardar la promoción. Revisá los datos e intentá otra vez.'});
  }
};
