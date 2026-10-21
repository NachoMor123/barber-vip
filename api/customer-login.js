const crypto = require('crypto');
const { db, auth, admin } = require('../lib/admin');
const { send, method, body, text, normalizeName, normalizeArgentinaPhone, validArgentinaWhatsapp } = require('../lib/http');
const { subscription } = require('../lib/security');


function cleanBarberCode(value) {
  return text(value, 16).toUpperCase().replace(/[^A-Z0-9]/g, '');
}


async function enforceSignupRateLimit(database, req, barberUid) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  const ip = (realIp || forwarded).slice(0, 128);
  // Vercel normally supplies one of these headers. If unavailable, do not block legitimate clients.
  if (!ip) return;
  const key = crypto.createHash('sha256').update(`barber-vip-signup-v1|${barberUid}|${ip}`).digest('hex');
  const ref = database.collection('customerSignupLimits').doc(key);
  const nowMs = Date.now();
  const windowMs = 60 * 60 * 1000;
  await database.runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const current = snap.exists ? snap.data() : {};
    const windowStarted = current.windowStartedAt && typeof current.windowStartedAt.toMillis === 'function'
      ? current.windowStartedAt.toMillis() : 0;
    const stillInWindow = windowStarted > 0 && nowMs - windowStarted < windowMs;
    const count = stillInWindow ? Number(current.count || 0) : 0;
    if (count >= 15) {
      const error = new Error('Se alcanzó el límite temporal de registros desde esta conexión. Esperá una hora o pedile a tu profesional que cree la cuenta.');
      error.code = 'signup-rate-limited';
      throw error;
    }
    transaction.set(ref, {
      barberUid,
      count: count + 1,
      windowStartedAt: admin().firestore.Timestamp.fromMillis(stillInWindow ? windowStarted : nowMs),
      updatedAt: admin().firestore.Timestamp.fromMillis(nowMs)
    }, { merge: true });
  });
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const data = body(req);
    const database = db();
    const action = text(data.action, 30);

    if (action === 'register') {
      const fullName = text(data.fullName, 100);
      const usernameNormalized = normalizeName(fullName);
      const password = String(data.password || '');
      const whatsapp = normalizeArgentinaPhone(data.whatsapp);
      const visitDays = Number(data.approximateVisitDays);
      if (fullName.length < 3 || !usernameNormalized || usernameNormalized.split(' ').filter(Boolean).length < 2) {
        return send(res, 400, { ok: false, error: 'Ingresá tu nombre y apellido.' });
      }
      if (password.length < 6 || password.length > 128) return send(res, 400, { ok: false, error: 'La contraseña debe tener entre 6 y 128 caracteres.' });
      if (!validArgentinaWhatsapp(data.whatsapp)) return send(res, 400, { ok: false, error: 'Ingresá un WhatsApp argentino válido, con característica y número completo.' });
      if (!Number.isInteger(visitDays) || visitDays < 1 || visitDays > 365) return send(res, 400, { ok: false, error: 'Indicá cada cuántos días aproximadamente visitás a tu profesional (1 a 365).'});

      const barberCode = cleanBarberCode(data.barberCode);
      if (!barberCode) return send(res, 400, { ok: false, error: 'Completá el código de tu profesional.' });
      const barberQuery = await database.collection('barbers').where('barberCode', '==', barberCode).limit(1).get();
      if (barberQuery.empty) return send(res, 404, { ok: false, error: 'No encontramos ese código. Revisalo con tu profesional y probá nuevamente.' });
      const barberUid = barberQuery.docs[0].id;
      const barber = barberQuery.docs[0].data();
      if (subscription(barber).status === 'suspended') return send(res, 402, {ok:false,error:'El acceso para nuevas cuentas está pausado porque el plan del profesional está vencido. Consultá con el profesional.'});
      const barberRef = database.collection('barbers').doc(barberUid);
      const customersRef = barberRef.collection('customers');
      const [duplicateNames, duplicatePhones] = await Promise.all([
        customersRef.where('usernameNormalized', '==', usernameNormalized).get(),
        customersRef.where('whatsapp', '==', whatsapp).get()
      ]);
      if (duplicateNames.docs.some(doc => doc.data().active !== false)) return send(res, 409, { ok: false, error: 'Ya existe una cuenta activa con ese nombre en este espacio profesional. Iniciá sesión o consultá con tu profesional.' });
      if (duplicatePhones.docs.some(doc => doc.data().active !== false)) return send(res, 409, { ok: false, error: 'Ya existe una cuenta activa con ese WhatsApp en este espacio profesional. Iniciá sesión o consultá con tu profesional.' });
      try {
        await enforceSignupRateLimit(database, req, barberUid);
      } catch (error) {
        if (error.code === 'signup-rate-limited') return send(res, 429, { ok: false, error: error.message });
        throw error;
      }

      const uid = crypto.randomUUID();
      const loginEmail = `cliente-${uid}@accounts.barbervip.app`;
      try {
        await auth().createUser({ uid, email: loginEmail, password, displayName: fullName, emailVerified: true, disabled: false });
        const now = admin().firestore.FieldValue.serverTimestamp();
        const customer = {
          uid, barberUid, fullName, usernameNormalized, loginEmail, whatsapp, signupSource: 'self',
          approximateVisitDays: visitDays, cutStyle: '', conversationPreference: '',
          totalCuts: 0, actualCutsRegistered: 0, cycleCuts: 0, cycleVersion: 2, cyclePausedAtMax: false, availableRewards: [], rewardReady: false,
          active: true,
          reminderCount: 0, reminderStatus: null, remindersPaused: false,
          createdAt: now, updatedAt: now, lastCutAt: null, lastSeenAt: null
        };
        const batch = database.batch();
        batch.set(customersRef.doc(uid), customer);
        batch.set(database.collection('userProfiles').doc(uid), { uid, role: 'customer', barberUid, createdAt: now });
        await batch.commit();
        return send(res, 201, { ok: true, email: loginEmail, barberCode: String(barber.barberCode || '') });
      } catch (error) {
        await database.collection('barbers').doc(barberUid).collection('customers').doc(uid).delete().catch(() => {});
        await database.collection('userProfiles').doc(uid).delete().catch(() => {});
        await auth().deleteUser(uid).catch(() => {});
        if (error && error.code === 'auth/email-already-exists') return send(res, 409, { ok: false, error: 'No se pudo crear la cuenta en este momento. Probá nuevamente.' });
        throw error;
      }
    }

    // Existing customer sign-in path: names are resolved to the internal Firebase Auth email.
    const barberCode = cleanBarberCode(data.barberCode);
    const usernameNormalized = normalizeName(data.username);
    if (!barberCode || !usernameNormalized) return send(res, 400, { ok: false, error: 'Completá el código de tu profesional y tu nombre.' });
    const barberQuery = await database.collection('barbers').where('barberCode', '==', barberCode).limit(1).get();
    if (barberQuery.empty) return send(res, 401, { ok: false, error: 'No encontramos esa combinación. Revisá el código profesional, el nombre y la contraseña.' });
    const barberDoc = barberQuery.docs[0];
    const query = await barberDoc.ref.collection('customers').where('usernameNormalized', '==', usernameNormalized).get();
    const customerDoc = query.docs.find(doc => doc.data().active !== false);
    if (!customerDoc) return send(res, 401, { ok: false, error: 'No encontramos esa combinación. Revisá el código profesional, el nombre y la contraseña.' });
    return send(res, 200, { ok: true, email: customerDoc.data().loginEmail });
  } catch (error) {
    console.error('customer login/register error', error);
    if (error && error.code === 'signup-rate-limited') return send(res, 429, { ok: false, error: error.message });
    return send(res, 500, { ok: false, error: 'No se pudo completar el acceso. Probá de nuevo.' });
  }
};
