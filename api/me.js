const { db, admin } = require('../lib/admin');
const { send, method } = require('../lib/http');
const { requireUser, subscription } = require('../lib/security');
function getSubscriptionPrice(){const n=Number.parseInt(process.env.SUBSCRIPTION_PRICE_ARS||'2500',10);return Number.isFinite(n)&&n>0?n:2500;}


function cleanProgramId(value, fallback='program-general') {
  const id = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return id || fallback;
}
function safeProgramRewards(input) {
  if (!Array.isArray(input)) return [];
  const out = input.map(item => ({ cut: Number(item.cut), discount: Number(item.discount) })).sort((a,b)=>a.cut-b.cut);
  if (!out.length || out.length > 10) return [];
  let previous=0;
  for (const item of out) {
    if (!Number.isInteger(item.cut)||item.cut<1||item.cut>50||item.cut<=previous||!Number.isInteger(item.discount)||item.discount<1||item.discount>100) return [];
    item.label=`${item.discount}% OFF`; previous=item.cut;
  }
  return out;
}
function publicBarberProfile(source) {
  const dateIso = value => {
    if (!value) return null;
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };
  const programs = (Array.isArray(source.loyaltyPrograms) ? source.loyaltyPrograms : [])
    .filter(program => program && program.audience === 'all')
    .slice(0, 1)
    .map(program => ({
      id: cleanProgramId(program.id),
      name: String(program.name || 'Programa de premios').slice(0, 60),
      audience: 'all',
      customerIds: [],
      rewards: safeProgramRewards(program.rewards)
    }));
  const services = source.showServices === true && Array.isArray(source.services)
    ? source.services.slice(0, 20).map(service => {
        const rawPrice = service && service.price;
        const price = rawPrice === null || rawPrice === undefined || rawPrice === ''
          ? null
          : (Number.isFinite(Number(rawPrice)) ? Math.max(0, Math.min(100000000, Number(rawPrice))) : null);
        return {
          id: String(service && service.id || '').slice(0, 80),
          name: String(service && service.name || '').slice(0, 80),
          description: String(service && service.description || '').slice(0, 180),
          price,
          active: !service || service.active !== false
        };
      }).filter(service => service.name)
    : [];
  const themeSource = source.theme && typeof source.theme === 'object' ? source.theme : {};
  return {
    displayName: String(source.displayName || 'Tu profesional').slice(0, 80),
    barberName: String(source.barberName || '').slice(0, 100),
    activityType: 'barberia',
    barberCode: String(source.barberCode || '').slice(0, 16),
    whatsapp: String(source.whatsapp || '').slice(0, 40),
    instagramUrl: String(source.instagramUrl || '').slice(0, 500),
    mapsUrl: String(source.mapsUrl || '').slice(0, 1000),
    schedule: source.schedule && typeof source.schedule === 'object' ? source.schedule : {},
    services,
    showServices: source.showServices === true,
    theme: { accent: '#3478ff', density: themeSource.density === 'compact' ? 'compact' : 'comfortable' },
    loyaltyPrograms: programs,
    defaultLoyaltyProgramId: cleanProgramId(source.defaultLoyaltyProgramId),
    promotionsUpdatedAt: dateIso(source.promotionsUpdatedAt)
  };
}

async function sanitizeBarberLoyalty(database, barberRef, source) {
  const oldPrograms = Array.isArray(source.loyaltyPrograms) ? source.loyaltyPrograms : [];
  const chosen = oldPrograms.find(p => p && p.id === source.defaultLoyaltyProgramId)
    || oldPrograms.find(p => p && p.audience === 'all') || oldPrograms.find(Boolean) || {};
  const chosenRewards = safeProgramRewards(chosen.rewards);
  const fallbackRewards = [{cut:2,discount:10,label:'10% OFF'},{cut:4,discount:20,label:'20% OFF'},{cut:6,discount:30,label:'30% OFF'}];
  const program = {
    id: cleanProgramId(chosen.id),
    name: String(chosen.name || 'Programa de premios').slice(0,60),
    audience: 'all', customerIds: [],
    rewards: (chosenRewards.length ? chosenRewards : fallbackRewards).map(item => {
      const discount = Math.max(1, Math.min(100, Number(item.discount) || 1));
      return {cut:Number(item.cut),discount,label:`${discount}% OFF`};
    })
  };
  const needsMigration = oldPrograms.length !== 1 || oldPrograms[0]?.id !== program.id
    || oldPrograms[0]?.audience !== 'all' || (oldPrograms[0]?.customerIds || []).length > 0
    || source.defaultLoyaltyProgramId !== program.id;
  if (!needsMigration) return { ...source, loyaltyPrograms: [program], defaultLoyaltyProgramId: program.id };

  // Collapse old variants into one global program while keeping all earned rewards.
  const customersRef = barberRef.collection('customers');
  const oldIds = [...new Set(oldPrograms.map(p => cleanProgramId(p?.id, '')).filter(Boolean))];
  const explicitIds = [...new Set(oldPrograms.flatMap(p => Array.isArray(p?.customerIds) ? p.customerIds.map(id => String(id || '').trim()).filter(Boolean) : []))];
  const affected = new Map();
  for (const oldId of oldIds) {
    if (oldId === program.id) continue;
    const snap = await customersRef.where('loyaltyProgramId', '==', oldId).get();
    for (const doc of snap.docs) affected.set(doc.id, doc);
  }
  for (let i=0; i<explicitIds.length; i+=100) {
    const docs = await Promise.all(explicitIds.slice(i,i+100).map(id => customersRef.doc(id).get()));
    for (const doc of docs) if (doc.exists) affected.set(doc.id, doc);
  }
  let batch=database.batch(), writes=0;
  for (const doc of affected.values()) {
    if (doc.data().loyaltyProgramId === program.id) continue;
    batch.update(doc.ref,{loyaltyProgramId:program.id,updatedAt:admin().firestore.FieldValue.serverTimestamp()});
    writes++;
    if (writes>=400) { await batch.commit(); batch=database.batch(); writes=0; }
  }
  if (writes) await batch.commit();
  await barberRef.update({loyaltyPrograms:[program],defaultLoyaltyProgramId:program.id,rewards:program.rewards,updatedAt:admin().firestore.FieldValue.serverTimestamp()});
  return { ...source, loyaltyPrograms:[program],defaultLoyaltyProgramId:program.id,rewards:program.rewards };
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const decoded = await requireUser(req, res);
    if (!decoded) return;
    // Legacy installed clients may still send presence pings. Acknowledge without Firestore reads or writes.
    const legacyPresence = String(req.query && req.query.presence || '');
    if (legacyPresence === '1' || legacyPresence === '0') return send(res, 200, { ok:true, online:false });
    const database = db();
    const profileRef = database.collection('userProfiles').doc(decoded.uid);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) return send(res, 404, { ok: false, error: 'No se encontró el perfil de esta cuenta. Volvé a ingresar.' });
    const profile = profileSnap.data();
    if (profile.role === 'barber') {
      const barberRef = database.collection('barbers').doc(decoded.uid);
      const barberSnap = await barberRef.get();
      if (!barberSnap.exists) return send(res, 404, { ok: false, error: 'Falta configurar el perfil profesional.' });
      const barber = await sanitizeBarberLoyalty(database, barberRef, barberSnap.data());
      if (typeof barber.hasPaidSubscription !== 'boolean') {
        try { const paid = await barberRef.collection('payments').limit(1).get(); barber.hasPaidSubscription = !paid.empty; } catch (_) { barber.hasPaidSubscription = false; }
      }
      return send(res, 200, {
        ok: true, role: 'barber', uid: decoded.uid, barberUid: decoded.uid, subscriptionPrice: getSubscriptionPrice(),
        profile: { ...barber, subscription: subscription(barber), subscriptionExpiresAt: barber.subscriptionExpiresAt && barber.subscriptionExpiresAt.toDate ? barber.subscriptionExpiresAt.toDate().toISOString() : null }
      });
    }

    if (profile.role === 'customer' && profile.barberUid) {
      const barberRef = database.collection('barbers').doc(profile.barberUid);
      const customerRef = barberRef.collection('customers').doc(decoded.uid);
      const customerSnap = await customerRef.get();
      if (!customerSnap.exists || customerSnap.data().active === false) return send(res, 403, { ok: false, error: 'Este cliente fue dado de baja. Consultá con tu profesional.' });
      const customer = customerSnap.data();
      const barberSnap = await barberRef.get();
      if (!barberSnap.exists) return send(res, 404, { ok: false, error: 'No se encontró el espacio profesional asociado.' });
      const barber = await sanitizeBarberLoyalty(database, barberRef, barberSnap.data());
      return send(res, 200, { ok: true, role: 'customer', uid: decoded.uid, barberUid: profile.barberUid, customer, barber: publicBarberProfile(barber) });
    }
    return send(res, 403, { ok: false, error: 'El tipo de cuenta no está configurado correctamente.' });
  } catch (error) {
    console.error('me error', error);
    return send(res, 500, { ok: false, error: 'No se pudo cargar tu cuenta. Probá de nuevo.' });
  }
};
