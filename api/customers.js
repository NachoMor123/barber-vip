const { db, auth, admin } = require('../lib/admin');
const { send, method, body, text, normalizeName, digits, normalizeArgentinaPhone, validArgentinaWhatsapp } = require('../lib/http');
const { requireBarber, subscription } = require('../lib/security');
const { removeCustomerPushSubscriptions } = require('../lib/push');
const crypto = require('crypto');

const FIXED_MILESTONES = [2, 4, 6];
const DEFAULT_REWARDS = [{cut:2,discount:10},{cut:4,discount:20},{cut:6,discount:30}];
function standardRewards(barber = {}) {
  const programs = Array.isArray(barber.loyaltyPrograms) ? barber.loyaltyPrograms : [];
  const selected = programs.find(p => p.id === barber.defaultLoyaltyProgramId)
    || programs.find(p => p.audience === 'all') || programs[0] || {};
  const raw = (Array.isArray(selected.rewards) ? selected.rewards : DEFAULT_REWARDS)
    .slice().sort((a,b) => Number(a.cut) - Number(b.cut)).slice(0,3);
  return FIXED_MILESTONES.map((cut,index) => ({
    cut,
    discount: Number.isInteger(Number(raw[index]?.discount))
      ? Math.min(100,Math.max(0,Number(raw[index].discount))) : DEFAULT_REWARDS[index].discount
  }));
}
function normalizeLoyaltyOverride(mode, input, barber = {}, current = {}) {
  if (mode !== 'custom') return {mode:'standard',rewards:[]};
  const fallback = standardRewards(barber);
  const source = Array.isArray(input) && input.length
    ? input.map(item => ({cut:Number(item.cut),discount:Number(item.discount)})).sort((a,b) => a.cut-b.cut).slice(0,3)
    : [];
  for (const reward of source) {
    if (!Number.isInteger(reward.discount) || reward.discount < 0 || reward.discount > 100) {
      throw new Error('Configurá los descuentos de los hitos 2, 4 y 6 entre 0% y 100%.');
    }
  }
  return {mode:'custom',rewards:FIXED_MILESTONES.map((cut,index)=>({
    cut,discount:source[index]?.discount ?? fallback[index].discount
  }))};
}

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

      const barberData = barberSnap.data();
      const loyaltyOverride = normalizeLoyaltyOverride(data.loyaltyMode, data.loyaltyRewards, barberData);
      const uid = crypto.randomUUID();
      const loginEmail = `cliente-${uid}@accounts.barbervip.app`;
      await auth().createUser({ uid, email: loginEmail, password, displayName: fullName, emailVerified: true, disabled: false });
      const now = admin().firestore.FieldValue.serverTimestamp();
      const customer = {
        uid, barberUid: ctx.uid, fullName, usernameNormalized, loginEmail, whatsapp, signupSource: 'admin',
        cutStyle: text(data.cutStyle, 100), conversationPreference: ['conversar','tranquilo'].includes(data.conversationPreference) ? data.conversationPreference : '',
        loyaltyOverride,
        totalCuts: 0, actualCutsRegistered: 0, cycleCuts: 0, cycleVersion: 2, cyclePausedAtMax: false, availableRewards: [], rewardReady: false, active: true, pushEnabled: false,
        createdAt: now, updatedAt: now, lastCutAt: null
      };
      try {
        const batch = database.batch();
        batch.set(customers.doc(uid), customer);
        batch.set(database.collection('userProfiles').doc(uid), { uid, role: 'customer', barberUid: ctx.uid, createdAt: now });
        await batch.commit();
      } catch (error) {
        // Firestore batch writes are atomic: a failed commit leaves both documents unwritten.
        // Deleting them here would add two redundant Firestore writes; only roll back Auth.
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
      await customerRef.update({ active: false, pushEnabled: false, disabledAt: admin().firestore.FieldValue.serverTimestamp(), usernameNormalized: null, whatsapp: '', updatedAt: admin().firestore.FieldValue.serverTimestamp() });
      await database.collection('userProfiles').doc(customerId).set({ disabled: true, updatedAt: admin().firestore.FieldValue.serverTimestamp() }, { merge: true });
      await auth().updateUser(customerId, { disabled: true }).catch((error) => {
        if (error.code !== 'auth/user-not-found') throw error;
      });
      await removeCustomerPushSubscriptions(customerId, database).catch(() => {});
      return send(res, 200, { ok: true });
    }

    const current = customerSnap.data();
    const updates = {};
    let fullNameChanged = false;
    let passwordChanged = false;
    let activeChanged = false;

    if (data.fullName !== undefined) {
      const fullName = text(data.fullName, 100);
      const usernameNormalized = normalizeName(fullName);
      if (fullName.length < 3) return send(res, 400, { ok: false, error: 'Ingresá el nombre y apellido del cliente.' });

      // If the normalized name is unchanged, an ordinary edit cannot create a duplicate.
      // Legacy records without the normalized field still take the validation query once.
      const storedNormalizedName = String(current.usernameNormalized || '');
      if (!storedNormalizedName || usernameNormalized !== storedNormalizedName) {
        const duplicate = await customers.where('usernameNormalized', '==', usernameNormalized).get();
        if (duplicate.docs.some(doc => doc.id !== customerId && doc.data().active !== false)) {
          return send(res, 409, { ok: false, error: 'Ya hay otro cliente activo con ese nombre dentro de este espacio profesional.' });
        }
      }
      if (fullName !== String(current.fullName || '')) {
        updates.fullName = fullName;
        fullNameChanged = true;
      }
      if (usernameNormalized !== storedNormalizedName) updates.usernameNormalized = usernameNormalized;
    }

    if (data.whatsapp !== undefined) {
      const whatsapp = normalizeArgentinaPhone(data.whatsapp);
      if (!validArgentinaWhatsapp(data.whatsapp)) {
        return send(res, 400, { ok: false, error: 'Ingresá un WhatsApp argentino válido, con característica y número completo.' });
      }
      const storedWhatsapp = String(current.whatsapp || '');
      const currentWhatsapp = normalizeArgentinaPhone(storedWhatsapp);
      if (whatsapp !== currentWhatsapp) {
        const duplicatePhone = await customers.where('whatsapp', '==', whatsapp).get();
        if (duplicatePhone.docs.some(doc => doc.id !== customerId && doc.data().active !== false)) {
          return send(res, 409, { ok: false, error: 'Ya hay otro cliente activo con ese WhatsApp dentro de este espacio profesional.' });
        }
      }
      if (whatsapp !== storedWhatsapp) updates.whatsapp = whatsapp;
    }

    if (data.cutStyle !== undefined) {
      const cutStyle = text(data.cutStyle, 100);
      if (cutStyle !== String(current.cutStyle || '')) updates.cutStyle = cutStyle;
    }
    if (data.conversationPreference !== undefined) {
      const preference = ['conversar','tranquilo'].includes(data.conversationPreference) ? data.conversationPreference : '';
      if (preference !== String(current.conversationPreference || '')) updates.conversationPreference = preference;
    }

    if (data.loyaltyMode !== undefined || data.loyaltyRewards !== undefined) {
      const mode = data.loyaltyMode !== undefined ? data.loyaltyMode : current.loyaltyOverride?.mode;
      const rewards = data.loyaltyRewards !== undefined ? data.loyaltyRewards : current.loyaltyOverride?.rewards;
      const nextOverride = normalizeLoyaltyOverride(mode, rewards, barberSnap.data(), current.loyaltyOverride || {});
      if (JSON.stringify(current.loyaltyOverride || {mode:'standard',rewards:[]}) !== JSON.stringify(nextOverride)) {
        updates.loyaltyOverride = nextOverride;
      }
    }

    const password = data.password === undefined ? '' : String(data.password);
    if (password.length) {
      if (password.length < 6) return send(res, 400, { ok: false, error: 'La contraseña nueva debe tener al menos 6 caracteres.' });
      await auth().updateUser(customerId, { password });
      passwordChanged = true;
    }

    if (data.active !== undefined) {
      const nextActive = Boolean(data.active);
      const currentActive = current.active !== false;
      if (nextActive !== currentActive) {
        updates.active = nextActive;
        if (!nextActive) updates.pushEnabled = false;
        activeChanged = true;
      }
    }

    if (fullNameChanged) {
      await auth().updateUser(customerId, { displayName: updates.fullName }).catch(() => {});
    }
    if (activeChanged) {
      await auth().updateUser(customerId, { disabled: !updates.active }).catch(() => {});
      await database.collection('userProfiles').doc(customerId).set({ disabled: !updates.active }, { merge: true });
      if (updates.active === false) await removeCustomerPushSubscriptions(customerId, database).catch(() => {});
    }

    const hasDocumentChanges = Object.keys(updates).length > 0;
    if (hasDocumentChanges) {
      updates.updatedAt = admin().firestore.FieldValue.serverTimestamp();
      await customerRef.update(updates);
    }

    // Avoid a no-op Firestore write; it would trigger customer listeners despite unchanged data.
    const customerResponse = hasDocumentChanges
      ? { ...current, ...updates, updatedAt: new Date().toISOString() }
      : current;
    if (!hasDocumentChanges && !passwordChanged) {
      return send(res, 200, { ok: true, customer: customerResponse, unchanged: true });
    }
    return send(res, 200, { ok: true, customer: customerResponse });
  } catch (error) {
    console.error('customers error', error);
    if (/^Configurá los descuentos de los hitos 2, 4 y 6/.test(String(error?.message||''))) return send(res, 400, {ok:false,error:error.message});
    if (error && error.code === 'auth/email-already-exists') return send(res, 409, { ok: false, error: 'No se pudo crear el usuario del cliente; probá otra vez.' });
    if (error && error.code === 'auth/user-not-found') return send(res, 404, { ok: false, error: 'No se encontró la cuenta de acceso de este cliente. Verificá sus datos e intentá nuevamente.' });
    return send(res, 500, { ok: false, error: 'No se pudo guardar el cliente por un problema temporal. Revisá tu conexión e intentá nuevamente.' });
  }
};
