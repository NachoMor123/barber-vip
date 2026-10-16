const { db, admin } = require('../lib/admin');
const { send, method, body, text, normalizeArgentinaPhone, validArgentinaWhatsapp } = require('../lib/http');
const { requireUser, requireBarber, subscription } = require('../lib/security');
const crypto = require('crypto');

function defaultCode(uid) { return String(uid).replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase(); }
function getSubscriptionPrice(){const n=Number.parseInt(process.env.SUBSCRIPTION_PRICE_ARS||'2500',10);return Number.isFinite(n)&&n>0?n:2500;}
function safeHttpsUrl(value, allowedHosts = []) {
  const raw = text(value, 500);
  if (!raw) return '';
  let u;
  try { u = new URL(raw); } catch (_) { throw new Error('Revisá que los enlaces comiencen con https:// y sean completos.'); }
  if (u.protocol !== 'https:' || !u.hostname || (allowedHosts.length && !allowedHosts.some(host => u.hostname === host || u.hostname.endsWith('.' + host)))) {
    throw new Error('El enlace no pertenece al sitio permitido o no usa HTTPS.');
  }
  return u.toString();
}
function validTime(value) { return !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value)); }
function cleanSchedule(input) {
  // Backward-compatible: old profiles used one mode for the entire week; new profiles save a mode per day.
  const globalMode = input && input.mode === 'double' ? 'double' : 'continuous';
  const allowed = new Set(['mon','tue','wed','thu','fri','sat','sun']);
  const raw = Array.isArray(input && input.days) ? input.days : [];
  const byDay = new Map();
  for (const day of raw) {
    if (!allowed.has(day.day)) continue;
    const mode = day.mode === 'double' ? 'double' : (day.mode === 'continuous' ? 'continuous' : globalMode);
    const row = {
      day: day.day, mode, enabled: Boolean(day.enabled),
      start1: text(day.start1,5), end1: text(day.end1,5),
      start2: text(day.start2,5), end2: text(day.end2,5)
    };
    for (const key of ['start1','end1','start2','end2']) if (!validTime(row[key])) throw new Error('Hay un horario con un formato de hora inválido.');
    if (row.enabled && (!row.start1 || !row.end1 || row.start1 >= row.end1)) throw new Error(`En ${row.day}, el inicio debe ser anterior al cierre.`);
    if (row.enabled && mode === 'double' && (!row.start2 || !row.end2 || row.start2 >= row.end2 || row.start2 < row.end1)) throw new Error(`En ${row.day}, el segundo turno debe comenzar después del primer turno y terminar más tarde.`);
    byDay.set(row.day,row);
  }
  const days = ['mon','tue','wed','thu','fri','sat','sun'].map(day => byDay.get(day) || {day,mode:'continuous',enabled:false,start1:'09:00',end1:'18:00',start2:'16:00',end2:'20:00'});
  return { mode:'mixed', days };
}
function profileView(barber) {
  return {
    ...barber,
    subscription: subscription(barber),
    subscriptionExpiresAt: barber.subscriptionExpiresAt && typeof barber.subscriptionExpiresAt.toDate === 'function'
      ? barber.subscriptionExpiresAt.toDate().toISOString() : (barber.subscriptionExpiresAt || null)
  };
}
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PUT'])) return;
  try {
    if (req.method === 'POST') {
      const decoded = await requireUser(req, res);
      if (!decoded) return;
      const data = body(req);
      const database = db();
      const userRef = database.collection('userProfiles').doc(decoded.uid);
      const userSnap = await userRef.get();
      if (userSnap.exists && userSnap.data().role !== 'barber') return send(res, 403, { ok: false, error: 'Esta cuenta pertenece a un cliente, no a un administrador.' });
      const barberRef = database.collection('barbers').doc(decoded.uid);
      const barberSnap = await barberRef.get();
      const initializingNewAccount = !userSnap.exists && !barberSnap.exists;
      if (initializingNewAccount) {
        if (decoded.email_verified !== true) return send(res, 403, { ok: false, error: 'Verificá tu correo electrónico antes de activar la prueba gratuita.' });
        const normalizedEmail = String(decoded.email || '').trim().toLowerCase();
        if (!normalizedEmail) return send(res, 400, { ok: false, error: 'La cuenta necesita un correo verificado para activar la prueba.' });
        const emailHash = crypto.createHash('sha256').update(normalizedEmail).digest('hex');
        const trialClaimRef = database.collection('trialClaims').doc(emailHash);
        try {
          await database.runTransaction(async transaction => {
            const [freshUserSnap, freshBarberSnap, claimSnap] = await Promise.all([
              transaction.get(userRef), transaction.get(barberRef), transaction.get(trialClaimRef)
            ]);
            if (freshUserSnap.exists && freshUserSnap.data().role !== 'barber') throw new Error('Esta cuenta pertenece a un cliente, no a un administrador.');
            if (freshUserSnap.exists && freshBarberSnap.exists) return; // Idempotent retry after an earlier successful initialization.
            if (claimSnap.exists && claimSnap.data().uid !== decoded.uid) throw new Error('TRIAL_ALREADY_USED');
            const now = admin().firestore.Timestamp.now();
            const trialExpiry = admin().firestore.Timestamp.fromDate(new Date(Date.now() + 15 * 86400000));
            const displayName = text(data.displayName || decoded.name || String(decoded.email || '').split('@')[0] || 'Barbero', 80);
            const code = defaultCode(decoded.uid);
            if (!freshBarberSnap.exists) transaction.set(barberRef, {
              uid: decoded.uid, displayName, barberName: '', whatsapp: '',
              instagramUrl: '', mapsUrl: '', schedule: { mode: 'mixed', days: [] }, barberCode: code,
              theme: { accent: '#c7ff3d', density: 'comfortable' }, loyaltyPrograms: [], rewards: [],
              subscriptionExpiresAt: trialExpiry, reminderThresholdDays: 3, reminderFollowUpDays: 7,
              reminderMaxMessages: 2, trialStartedAt: now, createdAt: now, updatedAt: now
            });
            transaction.set(userRef, {
              uid: decoded.uid, role: 'barber', barberUid: decoded.uid, email: normalizedEmail,
              emailVerified: true, updatedAt: now
            }, { merge: true });
            transaction.set(trialClaimRef, { uid: decoded.uid, emailHash, claimedAt: now });
          });
        } catch (error) {
          if (error.message === 'TRIAL_ALREADY_USED') return send(res, 409, { ok: false, error: 'Ya se utilizó una prueba gratuita con este correo. Iniciá sesión o contactá al equipo si creés que es un error.' });
          throw error;
        }
        const fresh = await barberRef.get();
        return send(res, 200, { ok: true, profile: profileView(fresh.data()), subscriptionPrice: getSubscriptionPrice() });
      }
      if (!barberSnap.exists) {
        const now = admin().firestore.FieldValue.serverTimestamp();
        const trialExpiry = admin().firestore.Timestamp.fromDate(new Date(Date.now() + 15 * 86400000));
        const displayName = text(data.displayName || decoded.name || String(decoded.email || '').split('@')[0] || 'Barbero', 80);
        const code = defaultCode(decoded.uid);
        await barberRef.set({
          uid: decoded.uid, displayName, barberName: '', whatsapp: '',
          instagramUrl:'', mapsUrl:'', schedule:{mode:'mixed',days:[]}, barberCode: code,
          theme: { accent: '#c7ff3d', density: 'comfortable' }, loyaltyPrograms: [], rewards: [], subscriptionExpiresAt: trialExpiry,
          reminderThresholdDays:3, reminderFollowUpDays:7, reminderMaxMessages:2,
          trialStartedAt: now, createdAt: now, updatedAt: now
        });
      } else if (data.displayName && !userSnap.exists) {
        await barberRef.update({ displayName: text(data.displayName,80), updatedAt: admin().firestore.FieldValue.serverTimestamp() });
      }
      await userRef.set({ uid: decoded.uid, role: 'barber', barberUid: decoded.uid, email: decoded.email || '', emailVerified: decoded.email_verified === true, updatedAt: admin().firestore.FieldValue.serverTimestamp() }, { merge: true });
      const fresh = await barberRef.get();
      return send(res, 200, { ok: true, profile: profileView(fresh.data()), subscriptionPrice: getSubscriptionPrice() });
    }
    const context = await requireBarber(req, res);
    if (!context) return;
    const ref = context.db.collection('barbers').doc(context.uid);
    if (req.method === 'GET') {
      const snap = await ref.get();
      if (!snap.exists) return send(res, 404, { ok: false, error: 'No se encontró la configuración del barbero.' });
      return send(res, 200, { ok: true, profile: profileView(snap.data()) });
    }
    const data = body(req);
    const displayName = text(data.displayName, 80);
    const barberName = text(data.barberName, 100);
    const whatsapp = normalizeArgentinaPhone(data.whatsapp);
    const accent = /^#[0-9a-fA-F]{6}$/.test(String(data.theme && data.theme.accent || '')) ? String(data.theme.accent) : '#b69cff';
    const density = data.theme && data.theme.density === 'compact' ? 'compact' : 'comfortable';
    if (!displayName) return send(res, 400, { ok: false, error: 'Escribí tu nombre.' });
    if (!validArgentinaWhatsapp(data.whatsapp)) return send(res, 400, { ok: false, error: 'Ingresá un WhatsApp argentino válido y completo.' });
    let instagramUrl, mapsUrl, schedule;
    try {
      instagramUrl = safeHttpsUrl(data.instagramUrl, ['instagram.com']);
      mapsUrl = safeHttpsUrl(data.mapsUrl, ['google.com','maps.app.goo.gl','goo.gl']);
      schedule = cleanSchedule(data.schedule || {});
    } catch (error) { return send(res, 400, { ok:false, error:error.message }); }
    const existingSnap = await ref.get();
    const existing = existingSnap.exists ? existingSnap.data() : {};
    const reminderThresholdInput = data.reminderThresholdDays === undefined ? existing.reminderThresholdDays : data.reminderThresholdDays;
    const reminderFollowUpInput = data.reminderFollowUpDays === undefined ? existing.reminderFollowUpDays : data.reminderFollowUpDays;
    const reminderMaxInput = data.reminderMaxMessages === undefined ? existing.reminderMaxMessages : data.reminderMaxMessages;
    const thresholdNumber = Number(reminderThresholdInput ?? 3);
    const followUpNumber = Number(reminderFollowUpInput ?? 7);
    const maxMessageNumber = Number(reminderMaxInput ?? 2);
    const reminderThresholdDays = Number.isInteger(thresholdNumber) ? Math.max(0, Math.min(30, thresholdNumber)) : 3;
    const reminderFollowUpDays = Number.isInteger(followUpNumber) ? Math.max(1, Math.min(30, followUpNumber)) : 7;
    const reminderMaxMessages = [1,2,3].includes(maxMessageNumber) ? maxMessageNumber : 2;
    await ref.update({ displayName, barberName, whatsapp, instagramUrl, mapsUrl, schedule, theme: { accent, density }, reminderThresholdDays, reminderFollowUpDays, reminderMaxMessages, updatedAt: admin().firestore.FieldValue.serverTimestamp() });
    const fresh = await ref.get();
    return send(res, 200, { ok: true, profile: profileView(fresh.data()), subscriptionPrice: getSubscriptionPrice() });
  } catch (error) {
    console.error('profile error', error);
    return send(res, 500, { ok: false, error: error.message || 'No se pudo guardar la configuración.' });
  }
};
