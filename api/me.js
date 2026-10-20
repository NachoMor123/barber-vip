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
async function sanitizeBarberLoyalty(database, barberRef, source) {
  const oldPrograms = Array.isArray(source.loyaltyPrograms) ? source.loyaltyPrograms : [];
  const chosen = oldPrograms.find(p => p && p.id === source.defaultLoyaltyProgramId)
    || oldPrograms.find(p => p && p.audience === 'all') || oldPrograms.find(Boolean) || {};
  const chosenRewards = safeProgramRewards(chosen.rewards);
  const oldDefault = chosenRewards.length===3 && chosenRewards[0]?.cut===2 && chosenRewards[0]?.discount===30 && chosenRewards[1]?.cut===4 && chosenRewards[1]?.discount===50 && chosenRewards[2]?.cut===6 && chosenRewards[2]?.discount===70;
  const fallbackRewards = [{cut:2,discount:10,label:'10% OFF'},{cut:4,discount:20,label:'20% OFF'},{cut:6,discount:30,label:'30% OFF'}];
  const program = {
    id: cleanProgramId(chosen.id),
    name: String(chosen.name || 'Programa de premios').slice(0,60),
    audience: 'all', customerIds: [],
    rewards: chosenRewards.length ? (oldDefault ? fallbackRewards : [2,4,6].map((cut,i)=>{const r=chosenRewards.find(x=>Number(x.cut)===cut)||chosenRewards[i];const discount=Math.max(1,Math.min(50,Number(r?.discount)||fallbackRewards[i].discount));return {cut,discount,label:`${discount}% OFF`};})) : fallbackRewards
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
    const database = db();
    const profileRef = database.collection('userProfiles').doc(decoded.uid);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) return send(res, 404, { ok: false, error: 'No se encontró el perfil de esta cuenta. Volvé a ingresar.' });
    const profile = profileSnap.data();
    const isOnline = String(req.query && req.query.presence || '1') !== '0';
    const presencePatch = { lastSeenAt: admin().firestore.FieldValue.serverTimestamp(), isOnline };
    await profileRef.update(presencePatch);

    if (profile.role === 'barber') {
      const barberRef = database.collection('barbers').doc(decoded.uid);
      const barberSnap = await barberRef.get();
      if (!barberSnap.exists) return send(res, 404, { ok: false, error: 'Falta configurar el perfil de la barbería.' });
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
      if (!customerSnap.exists || customerSnap.data().active === false) return send(res, 403, { ok: false, error: 'Este cliente fue dado de baja. Consultá con tu barbero.' });
      let customer = customerSnap.data();
      await customerRef.update(presencePatch);
      customer = { ...customer, lastSeenAt: new Date().toISOString(), isOnline };
      const barberSnap = await barberRef.get();
      if (!barberSnap.exists) return send(res, 404, { ok: false, error: 'No se encontró la barbería asociada.' });
      const barber = await sanitizeBarberLoyalty(database, barberRef, barberSnap.data());
      return send(res, 200, { ok: true, role: 'customer', uid: decoded.uid, barberUid: profile.barberUid, customer, barber, subscriptionPrice: getSubscriptionPrice() });
    }
    return send(res, 403, { ok: false, error: 'El tipo de cuenta no está configurado correctamente.' });
  } catch (error) {
    console.error('me error', error);
    return send(res, 500, { ok: false, error: 'No se pudo cargar tu cuenta. Probá de nuevo.' });
  }
};
