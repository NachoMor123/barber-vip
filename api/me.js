const { db, admin } = require('../lib/admin');
const { send, method } = require('../lib/http');
const { requireUser, subscription } = require('../lib/security');
function getSubscriptionPrice(){const n=Number.parseInt(process.env.SUBSCRIPTION_PRICE_ARS||'2500',10);return Number.isFinite(n)&&n>0?n:2500;}


async function sanitizeBarberLoyalty(database, barberRef, source) {
  const barber = { ...source };
  const programs = Array.isArray(barber.loyaltyPrograms) ? barber.loyaltyPrograms : [];
  const hasLegacyIds = programs.some(program => Array.isArray(program.customerIds) && program.customerIds.length > 0);
  if (!hasLegacyIds) return barber;

  // Migration for earlier builds that stored customer UID lists inside a publicly readable
  // barber profile. Preserve assignments on private customer docs, then remove the lists.
  const targetByCustomer = new Map();
  for (const program of programs) {
    if (program.audience === 'selected' && Array.isArray(program.customerIds)) {
      for (const customerId of program.customerIds) if (!targetByCustomer.has(customerId)) targetByCustomer.set(customerId, program.id);
    }
  }
  const defaultId = barber.defaultLoyaltyProgramId || programs.find(program => program.audience === 'all')?.id || programs[0]?.id;
  const customersRef = barberRef.collection('customers');
  const affectedDocs = new Map();
  const selectedIds = [...targetByCustomer.keys()];
  for (let i = 0; i < selectedIds.length; i += 100) {
    const docs = await Promise.all(selectedIds.slice(i, i + 100).map(id => customersRef.doc(id).get()));
    for (const doc of docs) if (doc.exists) affectedDocs.set(doc.id, doc);
  }
  // Also pick up customers currently assigned to an old variant but no longer in its saved list.
  for (const program of programs.filter(item => item.audience === 'selected')) {
    const oldSnap = await customersRef.where('loyaltyProgramId', '==', program.id).get();
    for (const doc of oldSnap.docs) affectedDocs.set(doc.id, doc);
  }
  let batch = database.batch();
  let writes = 0;
  for (const customerDoc of affectedDocs.values()) {
    const nextProgramId = targetByCustomer.get(customerDoc.id) || defaultId;
    if (!nextProgramId || customerDoc.data().loyaltyProgramId === nextProgramId) continue;
    batch.update(customerDoc.ref, { loyaltyProgramId: nextProgramId, updatedAt: admin().firestore.FieldValue.serverTimestamp() });
    writes++;
    if (writes >= 400) { await batch.commit(); batch = database.batch(); writes = 0; }
  }
  if (writes) await batch.commit();
  const publicPrograms = programs.map(({ customerIds, ...program }) => ({ ...program, customerIds: [] }));
  await barberRef.update({ loyaltyPrograms: publicPrograms, updatedAt: admin().firestore.FieldValue.serverTimestamp() });
  return { ...barber, loyaltyPrograms: publicPrograms };
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
    await profileRef.update({ lastSeenAt: admin().firestore.FieldValue.serverTimestamp() });

    if (profile.role === 'barber') {
      const barberRef = database.collection('barbers').doc(decoded.uid);
      const barberSnap = await barberRef.get();
      if (!barberSnap.exists) return send(res, 404, { ok: false, error: 'Falta configurar el perfil de la barbería.' });
      const barber = await sanitizeBarberLoyalty(database, barberRef, barberSnap.data());
      return send(res, 200, {
        ok: true, role: 'barber', uid: decoded.uid, barberUid: decoded.uid, subscriptionPrice: getSubscriptionPrice(),
        profile: { ...barber, subscription: subscription(barber), subscriptionExpiresAt: barber.subscriptionExpiresAt && barber.subscriptionExpiresAt.toDate ? barber.subscriptionExpiresAt.toDate().toISOString() : null }
      });
    }

    if (profile.role === 'customer' && profile.barberUid) {
      const customerRef = database.collection('barbers').doc(profile.barberUid).collection('customers').doc(decoded.uid);
      const customerSnap = await customerRef.get();
      if (!customerSnap.exists || customerSnap.data().active === false) return send(res, 403, { ok: false, error: 'Este cliente fue dado de baja. Consultá con tu barbero.' });
      await customerRef.update({ lastSeenAt: admin().firestore.FieldValue.serverTimestamp() });
      const barberRef = database.collection('barbers').doc(profile.barberUid);
      const barberSnap = await barberRef.get();
      if (!barberSnap.exists) return send(res, 404, { ok: false, error: 'No se encontró la barbería asociada.' });
      const barber = await sanitizeBarberLoyalty(database, barberRef, barberSnap.data());
      return send(res, 200, { ok: true, role: 'customer', uid: decoded.uid, barberUid: profile.barberUid, customer: customerSnap.data(), barber, subscriptionPrice: getSubscriptionPrice() });
    }
    return send(res, 403, { ok: false, error: 'El tipo de cuenta no está configurado correctamente.' });
  } catch (error) {
    console.error('me error', error);
    return send(res, 500, { ok: false, error: 'No se pudo cargar tu cuenta. Probá de nuevo.' });
  }
};
