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
    const barberRef = database.collection('barbers').doc(ctx.uid);
    const customers = barberRef.collection('customers');

    if (req.method === 'POST') {
      const fullName = text(data.fullName, 100);
      const usernameNormalized = normalizeName(fullName);
      const password = String(data.password || '');
      const whatsapp = normalizeArgentinaPhone(data.whatsapp);
      const approximateVisitDays = validRequired(data.approximateVisitDays, 15, 365);
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
        approximateVisitDays, cutStyle: text(data.cutStyle, 100), conversationPreference: ['conversar','tranquilo'].includes(data.conversationPreference) ? data.conversationPreference : '',
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

    if (req.method === 'PUT' && data.action === 'reminder-settings') {
      const threshold = Number(data.threshold), maxMessages = Number(data.maxMessages);
      if (!Number.isInteger(threshold) || threshold < 0 || threshold > 30) return send(res, 400, { ok:false, error:'El margen debe estar entre 0 y 30 días.' });
      if (![1,2,3].includes(maxMessages)) return send(res, 400, { ok:false, error:'Elegí un máximo de 1, 2 o 3 recordatorios.' });
      const changes = { reminderThresholdDays:threshold, reminderMaxMessages:maxMessages, updatedAt:admin().firestore.FieldValue.serverTimestamp() };
      if (Object.prototype.hasOwnProperty.call(data, 'messageTemplate')) {
        const messageTemplate = text(data.messageTemplate, 500);
        changes.reminderMessageTemplate = messageTemplate;
      }
      // Follow-up is intentionally persistent: it ends only when a new cut is registered.
      await barberRef.update(changes);
      const saved = await barberRef.get();
      return send(res, 200, {ok:true, settings:{reminderThresholdDays:threshold,reminderMaxMessages:maxMessages,reminderMessageTemplate:saved.data().reminderMessageTemplate||''}});
    }

    const customerId = text(data.customerId, 100);
    if (!customerId) return send(res, 400, { ok: false, error: 'Falta identificar al cliente.' });
    const customerRef = customers.doc(customerId);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) return send(res, 404, { ok: false, error: 'No se encontró ese cliente.' });

    if (req.method === 'PUT' && ['pause-reminders','resume-reminders'].includes(data.action)) {
      const pause = data.action === 'pause-reminders';
      const now = admin().firestore.FieldValue.serverTimestamp();
      const updates = pause
        ? { remindersPaused:true, remindersPausedAt:now, updatedAt:now }
        : { remindersPaused:false, remindersPausedAt:null, reminderCount:0, reminderStatus:null, reminderFollowUpUntil:null, reminderLastContactAt:null, updatedAt:now };
      await customerRef.update(updates);
      const saved = await customerRef.get();
      return send(res, 200, {ok:true, customer:saved.data()});
    }

    if (req.method === 'PUT' && data.action === 'record-reminder') {
      let updatedCustomer = null;
      try {
        await database.runTransaction(async transaction => {
          const [freshCustomerSnap, freshBarberSnap] = await Promise.all([transaction.get(customerRef), transaction.get(barberRef)]);
          if (!freshCustomerSnap.exists || freshCustomerSnap.data().active === false) throw new Error('Este cliente está dado de baja o ya no existe.');
          const current = freshCustomerSnap.data();
          const barber = freshBarberSnap.exists ? freshBarberSnap.data() : {};
          const maxMessages = Math.max(1, Math.min(3, Number(barber.reminderMaxMessages || 2)));
          const oldCount = Math.max(0, Number(current.reminderCount || 0));
          if (oldCount >= maxMessages) throw new Error('Ya se alcanzó el máximo de recordatorios. El contador se reinicia cuando registrás una nueva visita.');
          const count = oldCount + 1;
          const nowDate = new Date();
          const nowTimestamp = admin().firestore.Timestamp.fromDate(nowDate);
          // A confirmation records one manual attempt. WhatsApp itself cannot verify delivery.
          transaction.update(customerRef, {
            reminderCount: count,
            reminderStatus: 'followup',
            reminderFollowUpUntil: null,
            reminderLastContactAt: nowTimestamp,
            updatedAt: admin().firestore.FieldValue.serverTimestamp()
          });
          updatedCustomer = { ...current, reminderCount: count, reminderStatus: 'followup', reminderFollowUpUntil: null, reminderLastContactAt: nowDate.toISOString() };
        });
      } catch (error) {
        const status = /dado de baja|ya no existe/i.test(error.message) ? 403 : 409;
        return send(res, status, { ok: false, error: error.message || 'No se pudo guardar el seguimiento.' });
      }
      return send(res, 200, { ok: true, customer: updatedCustomer });
    }

    if (req.method === 'PUT' && data.action === 'close-reminder') {
      const current = customerSnap.data();
      await customerRef.update({reminderStatus:'closed',reminderFollowUpUntil:null,updatedAt:admin().firestore.FieldValue.serverTimestamp()});
      return send(res,200,{ok:true,customer:{...current,reminderStatus:'closed',reminderFollowUpUntil:null}});
    }

    if (req.method === 'DELETE') {
      await customerRef.update({ active: false, disabledAt: admin().firestore.FieldValue.serverTimestamp(), usernameNormalized: null, whatsapp: '', remindersPaused: true, remindersPausedAt: admin().firestore.FieldValue.serverTimestamp(), updatedAt: admin().firestore.FieldValue.serverTimestamp() });
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
