const { db, auth, admin } = require('../lib/admin');
const { send, method, body, text, normalizeName, digits, normalizeArgentinaPhone, validArgentinaWhatsapp } = require('../lib/http');
const { requireBarber } = require('../lib/security');
const crypto = require('crypto');

function validRequired(value, fallback, max = 1000) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST', 'PUT', 'DELETE'])) return;
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;
    const data = body(req);
    const database = ctx.db;
    const customers = database.collection('barbers').doc(ctx.uid).collection('customers');

    if (req.method === 'POST') {
      const fullName = text(data.fullName, 100);
      const usernameNormalized = normalizeName(fullName);
      const password = String(data.password || '');
      const whatsapp = normalizeArgentinaPhone(data.whatsapp);
      const approximateVisitDays = validRequired(data.approximateVisitDays, 15, 365);
      if (fullName.length < 3) return send(res, 400, { ok: false, error: 'Ingresá el nombre y apellido del cliente.' });
      if (password.length < 6) return send(res, 400, { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
      if (!validArgentinaWhatsapp(data.whatsapp)) return send(res, 400, { ok: false, error: 'Ingresá un WhatsApp argentino válido, con característica y número completo.' });
      const duplicate = await customers.where('usernameNormalized', '==', usernameNormalized).limit(1).get();
      if (!duplicate.empty) return send(res, 409, { ok: false, error: 'Ya existe un cliente con ese nombre en esta barbería. Probá agregar una inicial o distinguir el apellido.' });

      const uid = crypto.randomUUID();
      const loginEmail = `cliente-${uid}@accounts.barbervip.app`;
      await auth().createUser({ uid, email: loginEmail, password, displayName: fullName, emailVerified: true, disabled: false });
      const now = admin().firestore.FieldValue.serverTimestamp();
      const customer = {
        uid, barberUid: ctx.uid, fullName, usernameNormalized, loginEmail, whatsapp,
        approximateVisitDays, cutStyle: text(data.cutStyle, 100), conversationPreference: ['conversar','tranquilo'].includes(data.conversationPreference) ? data.conversationPreference : '',
        totalCuts: 0, cycleCuts: 0, availableRewards: [], rewardReady: false, active: true,
        createdAt: now, updatedAt: now, lastCutAt: null, lastSeenAt: null
      };
      try {
        await customers.doc(uid).set(customer);
        await database.collection('userProfiles').doc(uid).set({ uid, role: 'customer', barberUid: ctx.uid, createdAt: now });
      } catch (error) {
        await auth().deleteUser(uid).catch(() => {});
        throw error;
      }
      return send(res, 201, { ok: true, customer: { ...customer, createdAt: new Date().toISOString() } });
    }

    const customerId = text(data.customerId, 100);
    if (!customerId) return send(res, 400, { ok: false, error: 'Falta identificar al cliente.' });
    const customerRef = customers.doc(customerId);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) return send(res, 404, { ok: false, error: 'No se encontró ese cliente.' });

    if (req.method === 'DELETE') {
      await customerRef.update({ active: false, disabledAt: admin().firestore.FieldValue.serverTimestamp(), updatedAt: admin().firestore.FieldValue.serverTimestamp() });
      await database.collection('userProfiles').doc(customerId).set({ disabled: true, updatedAt: admin().firestore.FieldValue.serverTimestamp() }, { merge: true });
      await auth().updateUser(customerId, { disabled: true }).catch((error) => {
        if (error.code !== 'auth/user-not-found') throw error;
      });
      return send(res, 200, { ok: true });
    }

    const current = customerSnap.data();
    const updates = { updatedAt: admin().firestore.FieldValue.serverTimestamp() };
    if (data.fullName !== undefined) {
      const fullName = text(data.fullName, 100);
      const usernameNormalized = normalizeName(fullName);
      if (fullName.length < 3) return send(res, 400, { ok: false, error: 'Ingresá el nombre y apellido del cliente.' });
      const duplicate = await customers.where('usernameNormalized', '==', usernameNormalized).limit(5).get();
      if (duplicate.docs.some(doc => doc.id !== customerId)) return send(res, 409, { ok: false, error: 'Ya hay otro cliente con ese nombre dentro de esta barbería.' });
      updates.fullName = fullName;
      updates.usernameNormalized = usernameNormalized;
      await auth().updateUser(customerId, { displayName: fullName }).catch(() => {});
    }
    if (data.whatsapp !== undefined) {
      const whatsapp = normalizeArgentinaPhone(data.whatsapp);
      if (!validArgentinaWhatsapp(data.whatsapp)) return send(res, 400, { ok: false, error: 'Ingresá un WhatsApp argentino válido, con característica y número completo.' });
      updates.whatsapp = whatsapp;
    }
    if (data.approximateVisitDays !== undefined) updates.approximateVisitDays = validRequired(data.approximateVisitDays, current.approximateVisitDays, 365);
    if (data.cutStyle !== undefined) updates.cutStyle = text(data.cutStyle, 100);
    if (data.conversationPreference !== undefined) updates.conversationPreference = ['conversar','tranquilo'].includes(data.conversationPreference) ? data.conversationPreference : '';
    if (data.password !== undefined && String(data.password).length) {
      if (String(data.password).length < 6) return send(res, 400, { ok: false, error: 'La contraseña nueva debe tener al menos 6 caracteres.' });
      await auth().updateUser(customerId, { password: String(data.password) });
    }
    if (data.active !== undefined) {
      updates.active = Boolean(data.active);
      await auth().updateUser(customerId, { disabled: !updates.active }).catch(() => {});
      await database.collection('userProfiles').doc(customerId).set({ disabled: !updates.active }, { merge: true });
    }
    await customerRef.update(updates);
    const saved = await customerRef.get();
    return send(res, 200, { ok: true, customer: saved.data() });
  } catch (error) {
    console.error('customers error', error);
    if (error && error.code === 'auth/email-already-exists') return send(res, 409, { ok: false, error: 'No se pudo crear el usuario del cliente; probá otra vez.' });
    return send(res, 500, { ok: false, error: error.message || 'No se pudo guardar el cliente.' });
  }
};
