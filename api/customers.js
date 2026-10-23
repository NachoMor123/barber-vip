const { db, auth, admin } = require('../lib/admin');
const { send, method, body, text, normalizeName, digits, normalizeArgentinaPhone, validArgentinaWhatsapp } = require('../lib/http');
const { requireBarber, subscription } = require('../lib/security');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST', 'PUT', 'DELETE'])) return;
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;
    const database = ctx.db;
    const barberRef = database.collection('barbers').doc(ctx.uid);
    const barberSnap = await barberRef.get();
    if (!barberSnap.exists) return send(res, 404, {ok:false,error:'No se encontró el perfil profesional.'});
    if (subscription(barberSnap.data()).status === 'suspended') {
      return send(res, 402, {ok:false,error:'Tu plan está vencido. Renovalo para modificar clientes y recordatorios.'});
    }
    const data = body(req);
    const customers = barberRef.collection('customers');

    if (req.method === 'POST') {
      const fullName = text(data.fullName, 100);
      const usernameNormalized = normalizeName(fullName);
      const password = String(data.password || '');
      const whatsapp = normalizeArgentinaPhone(data.whatsapp);
      if (fullName.length < 3) return send(res, 400, { ok: false, error: 'Ingresá el nombre y apellido del cliente.' });
      if (password.length < 6) return send(res, 400, { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
      if (!validArgentinaWhatsapp(data.whatsapp)) return send(res, 400, { ok: false, error: 'Ingresá un WhatsApp argentino válido, con característica y número completo.' });
      const [duplicateNames, duplicatePhones] = await Promise.all([
        customers.where('usernameNormalized', '==', usernameNormalized).get(),
        customers.where('whatsapp', '==', whatsapp).get()
      ]);
      if (duplicateNames.docs.some(doc => doc.data().active !== false)) return send(res, 409, { ok: false, error: 'Ya existe un cliente activo con ese nombre en este espacio profesional. Agregá una inicial para distinguirlo.' });
      if (duplicatePhones.docs.some(doc => doc.data().active !== false)) return send(res, 409, { ok: false, error: 'Ya existe un cliente activo con ese WhatsApp en este espacio profesional.' });

      const uid = crypto.randomUUID();
      const loginEmail = `cliente-${uid}@accounts.barbervip.app`;
      await auth().createUser({ uid, email: loginEmail, password, displayName: fullName, emailVerified: true, disabled: false });
      const now = admin().firestore.FieldValue.serverTimestamp();
      const customer = {
        uid, barberUid: ctx.uid, fullName, usernameNormalized, loginEmail, whatsapp, signupSource: 'admin',
        cutStyle: text(data.cutStyle, 100), conversationPreference: ['conversar','tranquilo'].includes(data.conversationPreference) ? data.conversationPreference : '',
        totalCuts: 0, actualCutsRegistered: 0, cycleCuts: 0, cycleVersion: 2, cyclePausedAtMax: false, availableRewards: [], rewardReady: false, active: true,
        createdAt: now, updatedAt: now, lastCutAt: null, lastSeenAt: null
      };
      try {
        const batch = database.batch();
        batch.set(customers.doc(uid), customer);
        batch.set(database.collection('userProfiles').doc(uid), { uid, role: 'customer', barberUid: ctx.uid, createdAt: now });
        await batch.commit();
      } catch (error) {
        await database.collection('barbers').doc(ctx.uid).collection('customers').doc(uid).delete().catch(() => {});
        await database.collection('userProfiles').doc(uid).delete().catch(() => {});
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
      await customerRef.update({ active: false, disabledAt: admin().firestore.FieldValue.serverTimestamp(), usernameNormalized: null, whatsapp: '', updatedAt: admin().firestore.FieldValue.serverTimestamp() });
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
      const duplicate = await customers.where('usernameNormalized', '==', usernameNormalized).get();
      if (duplicate.docs.some(doc => doc.id !== customerId && doc.data().active !== false)) return send(res, 409, { ok: false, error: 'Ya hay otro cliente activo con ese nombre dentro de este espacio profesional.' });
      updates.fullName = fullName;
      updates.usernameNormalized = usernameNormalized;
      await auth().updateUser(customerId, { displayName: fullName }).catch(() => {});
    }
    if (data.whatsapp !== undefined) {
      const whatsapp = normalizeArgentinaPhone(data.whatsapp);
      if (!validArgentinaWhatsapp(data.whatsapp)) return send(res, 400, { ok: false, error: 'Ingresá un WhatsApp argentino válido, con característica y número completo.' });
      const duplicatePhone = await customers.where('whatsapp', '==', whatsapp).get();
      if (duplicatePhone.docs.some(doc => doc.id !== customerId && doc.data().active !== false)) return send(res, 409, { ok: false, error: 'Ya hay otro cliente activo con ese WhatsApp dentro de este espacio profesional.' });
      updates.whatsapp = whatsapp;
    }
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
    // customerSnap was already read above; echo the updated fields instead of reading again.
    return send(res, 200, { ok: true, customer: { ...current, ...updates, updatedAt: new Date().toISOString() } });
  } catch (error) {
    console.error('customers error', error);
    if (error && error.code === 'auth/email-already-exists') return send(res, 409, { ok: false, error: 'No se pudo crear el usuario del cliente; probá otra vez.' });
    return send(res, 500, { ok: false, error: error.message || 'No se pudo guardar el cliente.' });
  }
};
