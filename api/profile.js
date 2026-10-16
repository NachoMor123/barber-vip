const { db, admin } = require('../lib/admin');
const { send, method, body, text, normalizeArgentinaPhone, validArgentinaWhatsapp } = require('../lib/http');
const { requireUser, requireBarber, subscription } = require('../lib/security');
const { auth } = require('../lib/admin');
const crypto = require('crypto');


function normalizeEmail(value) {
  const email = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ingresá un correo electrónico válido.');
  return email;
}
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function htmlEscape(value) { return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function millis(value) { return value && typeof value.toMillis === 'function' ? value.toMillis() : (value ? new Date(value).getTime() : 0); }
function isExpired(value) { return !millis(value) || millis(value) <= Date.now(); }
async function sendEmailCode(email, code, displayName) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error('Falta configurar RESEND_API_KEY y EMAIL_FROM en Vercel para enviar códigos de verificación.');
  const name = htmlEscape(displayName || '');
  const html = `<div style="margin:0;background:#071126;padding:32px 12px;font-family:Arial,sans-serif;color:#eff5ff"><div style="max-width:520px;margin:auto;border:1px solid #234a8e;border-radius:20px;background:#0d1932;padding:28px"><p style="font-size:12px;font-weight:bold;letter-spacing:3px;color:#5e9bff">BARBER VIP</p><h1 style="font-size:24px">Tu código de verificación</h1><p>Hola${name ? ` ${name}` : ''}. Usá este código para continuar. No necesitás abrir ningún enlace.</p><div style="font-size:36px;letter-spacing:10px;font-weight:bold;background:#10264c;border:1px solid #2e65b8;padding:20px 12px;text-align:center;border-radius:14px;color:#90bdff">${code}</div><p>El código vence en 10 minutos y se puede usar una sola vez.</p><p style="font-size:12px;color:#93a5c6">Si no solicitaste este código, podés ignorar el correo.</p></div></div>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject: 'Tu código de verificación · Barber VIP', html, text: `Barber VIP\n\nTu código de verificación es: ${code}\n\nVence en 10 minutos. No necesitás abrir ningún enlace.` })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Resend send failed', response.status, payload && payload.message ? payload.message : 'sin detalle');
    throw new Error('No pudimos enviar el correo. Revisá la configuración del servicio de email e intentá nuevamente.');
  }
}
async function requestEmailCode(req, res, data, purpose) {
  let email;
  try { email = normalizeEmail(data.email); }
  catch (error) { return send(res, 400, { ok: false, error: error.message }); }
  const displayName = text(data.displayName, 80);
  if (purpose === 'signup' && displayName.length < 2) return send(res, 400, { ok: false, error: 'Ingresá tu nombre para crear la cuenta.' });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return send(res, 503, { ok: false, error: 'El envío de códigos todavía no está configurado. El administrador debe completar RESEND_API_KEY y EMAIL_FROM en Vercel.' });

  let existingUser = null;
  try { existingUser = await auth().getUserByEmail(email); }
  catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  if (purpose === 'signup' && existingUser) return send(res, 409, { ok: false, error: 'Ya existe una cuenta con ese correo. Iniciá sesión o recuperá tu contraseña.' });
  if (purpose === 'existing' && !existingUser) return send(res, 404, { ok: false, error: 'No encontramos una cuenta con ese correo. Volvé al acceso e intentá iniciar sesión.' });
  if (purpose === 'existing' && existingUser.emailVerified) return send(res, 409, { ok: false, error: 'Este correo ya está verificado. Iniciá sesión con tu contraseña.' });

  const database = db();
  const emailHash = sha256(email);
  const trialClaimRef = database.collection('trialClaims').doc(emailHash);
  if (purpose === 'signup') {
    const claim = await trialClaimRef.get();
    if (claim.exists) return send(res, 409, { ok: false, error: 'Este correo ya utilizó una prueba gratuita. Iniciá sesión con la cuenta existente.' });
  }
  const forwarded = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const ipHash = sha256(forwarded || 'unknown');
  const codeRef = database.collection('signupVerificationCodes').doc(emailHash);
  const ipRef = database.collection('signupCodeRateLimits').doc(ipHash);
  const requestId = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const timestamp = admin().firestore.Timestamp;
  let rateResult = { ok: true };
  await database.runTransaction(async tx => {
    const [codeSnap, ipSnap] = await Promise.all([tx.get(codeRef), tx.get(ipRef)]);
    const oldCode = codeSnap.exists ? codeSnap.data() : {};
    const lastSent = millis(oldCode.lastSentAt);
    if (lastSent && now - lastSent < 60_000) { rateResult = { ok: false, status: 429, error: 'Esperá un minuto antes de pedir otro código.' }; return; }
    const emailWindow = millis(oldCode.hourWindowStartAt);
    const emailCount = emailWindow && now - emailWindow < 3_600_000 ? Number(oldCode.sentCount || 0) + 1 : 1;
    if (emailCount > 4) { rateResult = { ok: false, status: 429, error: 'Ya pediste varios códigos para ese correo. Esperá una hora antes de volver a intentarlo.' }; return; }
    const oldIp = ipSnap.exists ? ipSnap.data() : {};
    const ipWindow = millis(oldIp.hourWindowStartAt);
    const ipCount = ipWindow && now - ipWindow < 3_600_000 ? Number(oldIp.sentCount || 0) + 1 : 1;
    if (ipCount > 15) { rateResult = { ok: false, status: 429, error: 'Se solicitaron demasiados códigos desde esta conexión. Esperá un rato e intentá de nuevo.' }; return; }
    tx.set(codeRef, {
      email, purpose, displayName, salt,
      codeHash: sha256(`${emailHash}:${salt}:${code}`),
      expiresAt: timestamp.fromMillis(now + 10 * 60_000), attempts: 0, consumed: false,
      lastSentAt: timestamp.fromMillis(now), hourWindowStartAt: timestamp.fromMillis(emailWindow && now - emailWindow < 3_600_000 ? emailWindow : now), sentCount: emailCount,
      requestId, createdAt: timestamp.fromMillis(now)
    });
    tx.set(ipRef, {
      hourWindowStartAt: timestamp.fromMillis(ipWindow && now - ipWindow < 3_600_000 ? ipWindow : now),
      sentCount: ipCount, lastSentAt: timestamp.fromMillis(now), updatedAt: timestamp.fromMillis(now)
    });
  });
  if (!rateResult.ok) return send(res, rateResult.status, { ok: false, error: rateResult.error });
  try {
    await sendEmailCode(email, code, displayName);
  } catch (error) {
    const saved = await codeRef.get().catch(() => null);
    if (saved && saved.exists && saved.data().requestId === requestId) await codeRef.delete().catch(() => {});
    return send(res, 502, { ok: false, error: error.message || 'No pudimos enviar el código.' });
  }
  return send(res, 200, { ok: true, message: 'Código enviado. Revisá tu correo y la carpeta Spam.' });
}
async function verifyEmailCode(data, purpose, res) {
  let email;
  try { email = normalizeEmail(data.email); }
  catch (error) { return send(res, 400, { ok: false, error: error.message }); }
  const code = String(data.code || '').trim();
  if (!/^\d{6}$/.test(code)) return send(res, 400, { ok: false, error: 'Ingresá los seis números del código.' });
  let displayName = text(data.displayName, 80);
  const password = String(data.password || '');
  if (purpose === 'signup') {
    if (displayName.length < 2) return send(res, 400, { ok: false, error: 'Ingresá tu nombre.' });
    if (password.length < 8) return send(res, 400, { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' });
    try { await auth().getUserByEmail(email); return send(res, 409, { ok: false, error: 'Ya existe una cuenta con ese correo. Iniciá sesión o recuperá tu contraseña.' }); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  }
  let existingUser = null;
  if (purpose === 'existing') {
    try { existingUser = await auth().getUserByEmail(email); }
    catch (error) { if (error.code === 'auth/user-not-found') return send(res, 404, { ok: false, error: 'No encontramos una cuenta con ese correo.' }); throw error; }
    if (existingUser.emailVerified) return send(res, 409, { ok: false, error: 'Este correo ya está verificado. Iniciá sesión normalmente.' });
    displayName = displayName || existingUser.displayName || email.split('@')[0];
  }

  const database = db(); const emailHash = sha256(email);
  const codeRef = database.collection('signupVerificationCodes').doc(emailHash);
  const trialClaimRef = database.collection('trialClaims').doc(emailHash);
  let result = { ok: false, error: 'CODE_INVALID' };
  await database.runTransaction(async tx => {
    const [codeSnap, claimSnap] = await Promise.all([tx.get(codeRef), tx.get(trialClaimRef)]);
    if (!codeSnap.exists) { result = { ok: false, error: 'CODE_INVALID' }; return; }
    const stored = codeSnap.data();
    if (stored.purpose !== purpose || stored.consumed || isExpired(stored.expiresAt)) { result = { ok: false, error: 'CODE_INVALID' }; return; }
    if (purpose === 'signup' && claimSnap.exists) { result = { ok: false, error: 'TRIAL_ALREADY_USED' }; return; }
    if (purpose === 'existing' && claimSnap.exists && claimSnap.data().uid !== existingUser.uid) { result = { ok: false, error: 'TRIAL_ALREADY_USED' }; return; }
    if (Number(stored.attempts || 0) >= 5) { result = { ok: false, error: 'CODE_INVALID' }; return; }
    const candidate = sha256(`${emailHash}:${stored.salt}:${code}`);
    if (candidate !== stored.codeHash) {
      tx.update(codeRef, { attempts: Number(stored.attempts || 0) + 1 });
      result = { ok: false, error: 'CODE_INVALID' };
      return;
    }
    tx.update(codeRef, { consumed: true, consumedAt: admin().firestore.FieldValue.serverTimestamp() });
    result = { ok: true, requestId: stored.requestId };
  });
  if (!result.ok) {
    const trialUsed = result.error === 'TRIAL_ALREADY_USED';
    return send(res, trialUsed ? 409 : 400, { ok: false, error: trialUsed ? 'TRIAL_ALREADY_USED' : 'CODE_INVALID' });
  }

  try {
    let user;
    if (purpose === 'signup') user = await auth().createUser({ email, password, displayName, emailVerified: true, disabled: false });
    else user = await auth().updateUser(existingUser.uid, { emailVerified: true, displayName });
    const customToken = await auth().createCustomToken(user.uid);
    await codeRef.delete().catch(() => {});
    return send(res, 200, { ok: true, customToken, message: purpose === 'signup' ? 'Correo verificado. Tu cuenta está lista.' : 'Correo verificado. Ya podés ingresar.' });
  } catch (error) {
    console.error('auth code verification finalization failed', error);
    if (error.code === 'auth/email-already-exists') return send(res, 409, { ok: false, error: 'Ya existe una cuenta con ese correo. Iniciá sesión.' });
    return send(res, 500, { ok: false, error: 'El código fue validado, pero no pudimos terminar de activar la cuenta. Solicitá un nuevo código o iniciá sesión.' });
  }
}

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
      const data = body(req);
      // Public email-code actions run before requireUser so new accounts can be verified safely.
      if (data.action === 'request-signup-code') return await requestEmailCode(req, res, data, 'signup');
      if (data.action === 'request-existing-code') return await requestEmailCode(req, res, data, 'existing');
      if (data.action === 'verify-signup-code') return await verifyEmailCode(data, 'signup', res);
      if (data.action === 'verify-existing-code') return await verifyEmailCode(data, 'existing', res);
      const decoded = await requireUser(req, res);
      if (!decoded) return;
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
              theme: { accent: '#3478ff', density: 'comfortable' }, loyaltyPrograms: [], rewards: [],
              subscriptionExpiresAt: trialExpiry, reminderThresholdDays: 3, reminderFollowUpDays: 7,
              reminderMaxMessages: 2, reminderMessageTemplate: '', trialStartedAt: now, createdAt: now, updatedAt: now
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
          theme: { accent: '#3478ff', density: 'comfortable' }, loyaltyPrograms: [], rewards: [], subscriptionExpiresAt: trialExpiry,
          reminderThresholdDays:3, reminderFollowUpDays:7, reminderMaxMessages:2, reminderMessageTemplate:'',
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
    const accent = '#3478ff'; // Barber VIP keeps one fixed blue theme.
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
    const reminderFollowUpInput = existing.reminderFollowUpDays;
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
