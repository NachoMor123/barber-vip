const { admin } = require('../lib/admin');
const { send, method, body, text } = require('../lib/http');
const { requireBarber } = require('../lib/security');

const DEFAULT_PROGRAM = {
  id: 'program-general',
  name: 'Programa de premios',
  audience: 'all',
  customerIds: [],
  rewards: [
    { cut: 2, discount: 10, label: '10% OFF' },
    { cut: 4, discount: 20, label: '20% OFF' },
    { cut: 6, discount: 30, label: '30% OFF' }
  ]
};

function cleanId(value, fallback = 'program-general') {
  const id = text(value, 80).replace(/[^a-zA-Z0-9_-]/g, '');
  return id || fallback;
}
function cleanRewards(input) {
  if (!Array.isArray(input)) return [];
  const rewards = input.map(item => ({ cut: Number(item.cut), discount: Number(item.discount) }))
    .sort((a, b) => a.cut - b.cut);
  if (!rewards.length || rewards.length > 10) return [];
  let previous = 0;
  for (const reward of rewards) {
    if (!Number.isInteger(reward.cut) || reward.cut < 1 || reward.cut > 50 || reward.cut <= previous) return [];
    if (!Number.isInteger(reward.discount) || reward.discount < 1 || reward.discount > 100) return [];
    reward.label = `${reward.discount}% OFF`;
    previous = reward.cut;
  }
  return rewards;
}
function chooseGeneralProgram(barber) {
  const programs = Array.isArray(barber.loyaltyPrograms) ? barber.loyaltyPrograms : [];
  const chosen = programs.find(p => p && p.id === barber.defaultLoyaltyProgramId)
    || programs.find(p => p && p.audience === 'all')
    || programs.find(Boolean)
    || DEFAULT_PROGRAM;
  const rewards = cleanRewards(chosen.rewards);
  return {
    id: cleanId(chosen.id),
    name: text(chosen.name, 60) || 'Programa de premios',
    audience: 'all',
    customerIds: [],
    rewards: (rewards.length ? rewards : DEFAULT_PROGRAM.rewards).map(r => ({
      cut: Number(r.cut),
      discount: Math.min(100, Math.max(1, Number(r.discount))),
      label: `${Math.min(100, Math.max(1, Number(r.discount)))}% OFF`
    }))
  };
}
async function migrateToSingleProgram(database, barberRef, source) {
  const oldPrograms = Array.isArray(source.loyaltyPrograms) ? source.loyaltyPrograms : [];
  const program = chooseGeneralProgram(source);
  const needsMigration = oldPrograms.length !== 1
    || oldPrograms[0]?.id !== program.id
    || oldPrograms[0]?.audience !== 'all'
    || (oldPrograms[0]?.customerIds || []).length > 0
    || source.defaultLoyaltyProgramId !== program.id;
  if (!needsMigration) return { ...source, loyaltyPrograms: [program], defaultLoyaltyProgramId: program.id };

  const customersRef = barberRef.collection('customers');
  const oldProgramIds = [...new Set(oldPrograms.map(p => cleanId(p?.id, '')).filter(Boolean))];
  const explicitCustomerIds = [...new Set(oldPrograms.flatMap(p => Array.isArray(p?.customerIds) ? p.customerIds.map(id => text(id, 100)).filter(Boolean) : []))];
  const affected = new Map();
  for (const oldId of oldProgramIds) {
    if (oldId === program.id) continue;
    const snapshot = await customersRef.where('loyaltyProgramId', '==', oldId).get();
    for (const doc of snapshot.docs) affected.set(doc.id, doc);
  }
  for (let i = 0; i < explicitCustomerIds.length; i += 100) {
    const docs = await Promise.all(explicitCustomerIds.slice(i, i + 100).map(id => customersRef.doc(id).get()));
    for (const doc of docs) if (doc.exists) affected.set(doc.id, doc);
  }
  let batch = database.batch();
  let writes = 0;
  for (const doc of affected.values()) {
    if (doc.data().loyaltyProgramId === program.id) continue;
    batch.update(doc.ref, { loyaltyProgramId: program.id, updatedAt: admin().firestore.FieldValue.serverTimestamp() });
    writes++;
    if (writes >= 400) { await batch.commit(); batch = database.batch(); writes = 0; }
  }
  if (writes) await batch.commit();

  await barberRef.update({
    loyaltyPrograms: [program],
    defaultLoyaltyProgramId: program.id,
    rewards: program.rewards,
    updatedAt: admin().firestore.FieldValue.serverTimestamp()
  });
  return { ...source, loyaltyPrograms: [program], defaultLoyaltyProgramId: program.id, rewards: program.rewards };
}
function normalizeSubmitted(raw) {
  const id = cleanId(raw.id, 'program-general');
  const name = text(raw.name, 60) || 'Programa de premios';
  if (!Array.isArray(raw.rewards) || raw.rewards.length < 1 || raw.rewards.length > 10) {
    throw new Error('Configurá entre 1 y 10 hitos para el ciclo de fidelización.');
  }
  const rewards = cleanRewards(raw.rewards);
  if (!rewards.length || rewards.length !== raw.rewards.length) {
    throw new Error('Revisá los hitos: deben ser únicos, estar entre 1 y 50 visitas y tener descuentos entre 1% y 100%.');
  }
  return { id, name, audience: 'all', customerIds: [], rewards };
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'PUT'])) return;
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;
    const barberRef = ctx.db.collection('barbers').doc(ctx.uid);
    const barberSnap = await barberRef.get();
    if (!barberSnap.exists) return send(res, 404, { ok: false, error: 'No se encontró el perfil del barbero.' });
    const current = await migrateToSingleProgram(ctx.db, barberRef, barberSnap.data());

    if (req.method === 'GET') {
      const program = current.loyaltyPrograms[0] || DEFAULT_PROGRAM;
      return send(res, 200, { ok: true, programs: [program], defaultLoyaltyProgramId: program.id });
    }

    const data = body(req);
    if (!Array.isArray(data.programs) || data.programs.length !== 1) {
      return send(res, 400, { ok: false, error: 'El programa de fidelización es único y se aplica a todos los clientes.' });
    }
    const program = normalizeSubmitted(data.programs[0]);
    const customerRef = barberRef.collection('customers');
    const oldProgramIds = [...new Set((Array.isArray(current.loyaltyPrograms) ? current.loyaltyPrograms : []).map(p => cleanId(p.id, '')).filter(Boolean))];
    const affected = new Map();
    for (const oldId of oldProgramIds) {
      if (oldId === program.id) continue;
      const snapshot = await customerRef.where('loyaltyProgramId', '==', oldId).get();
      for (const doc of snapshot.docs) affected.set(doc.id, doc);
    }
    await barberRef.update({
      loyaltyPrograms: [program],
      defaultLoyaltyProgramId: program.id,
      rewards: program.rewards,
      updatedAt: admin().firestore.FieldValue.serverTimestamp()
    });
    let batch = ctx.db.batch();
    let writes = 0;
    for (const doc of affected.values()) {
      batch.update(doc.ref, { loyaltyProgramId: program.id, updatedAt: admin().firestore.FieldValue.serverTimestamp() });
      writes++;
      if (writes >= 400) { await batch.commit(); batch = ctx.db.batch(); writes = 0; }
    }
    if (writes) await batch.commit();
    return send(res, 200, { ok: true, programs: [program], defaultLoyaltyProgramId: program.id, updatedCustomers: affected.size });
  } catch (error) {
    console.error('loyalty error', error);
    return send(res, 400, { ok: false, error: error.message || 'No se pudo guardar la fidelización. Revisá los números de corte y descuentos.' });
  }
};
