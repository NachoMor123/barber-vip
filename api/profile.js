const { db, admin } = require('../lib/admin');
const { send, method, body, text, normalizeArgentinaPhone, validArgentinaWhatsapp } = require('../lib/http');
const { requireUser, requireBarber, subscription } = require('../lib/security');
const TRIAL_DAYS = 7;
const crypto = require('crypto');

function normalizeEmail(value) {
  const email = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ingresá un correo con formato válido.');
  return email;
}
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function millis(value) { return value && typeof value.toMillis === 'function' ? value.toMillis() : (value ? new Date(value).getTime() : 0); }

function defaultCode(uid) { return String(uid).replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase(); }
function getSubscriptionPrice(){const n=Number.parseInt(process.env.SUBSCRIPTION_PRICE_ARS||'5000',10);return Number.isFinite(n)&&n>0?n:5000;}
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
function cleanServices(input) {
  if (!Array.isArray(input)) return [];
  if (input.length > 20) throw new Error('Podés configurar hasta 20 servicios.');
  const out = [], ids = new Set(), names = new Set();
  for (let index = 0; index < input.length; index++) {
    const item = input[index] && typeof input[index] === 'object' ? input[index] : {};
    const name = text(item.name, 60).trim();
    if (!name) continue;
    if (name.length < 2) throw new Error('Cada servicio necesita un nombre de al menos 2 caracteres.');
    const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (names.has(key)) throw new Error('No repitas el nombre de un servicio.');
    names.add(key);
    let price = null;
    if (item.price !== null && item.price !== undefined && String(item.price).trim() !== '') {
      price = Number(item.price);
      if (!Number.isInteger(price) || price < 0 || price > 10000000) throw new Error('Cada precio debe ser un importe entero entre $0 y $10.000.000, o dejarse vacío para consultar.');
    }
    let id = text(item.id, 80).replace(/[^a-zA-Z0-9_-]/g, '') || 'service-' + (index + 1);
    if (ids.has(id)) id = id + '-' + (index + 1);
    ids.add(id);
    out.push({ id, name, price, active: item.active !== false });
  }
  return out;
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
      if (data.action !== 'ensure') return send(res, 400, { ok:false, error:'Acción no reconocida.' });
      const decoded = await requireUser(req, res);
      if (!decoded) return;
      const database = db();
      const userRef = database.collection('userProfiles').doc(decoded.uid);
      const barberRef = database.collection('barbers').doc(decoded.uid);
      const [userSnap, barberSnap] = await Promise.all([userRef.get(), barberRef.get()]);
      if (userSnap.exists && userSnap.data().role && userSnap.data().role !== 'barber') {
        return send(res, 403, { ok:false, error:'Esta cuenta pertenece a un cliente, no a un administrador.' });
      }
      if (userSnap.exists && barberSnap.exists) {
        return send(res, 200, { ok:true, profile:profileView(barberSnap.data()), subscriptionPrice:getSubscriptionPrice() });
      }

      let normalizedEmail;
      try { normalizedEmail = normalizeEmail(decoded.email || ''); }
      catch (error) { return send(res, 400, { ok:false, error:'La cuenta necesita un correo con formato válido.' }); }
      const emailHash = sha256(normalizedEmail);
      const trialClaimRef = database.collection('trialClaims').doc(emailHash);
      const Timestamp = admin().firestore.Timestamp;
      let createdProfile = null;
      try {
        await database.runTransaction(async transaction => {
          const [freshUserSnap, freshBarberSnap, claimSnap] = await Promise.all([
            transaction.get(userRef), transaction.get(barberRef), transaction.get(trialClaimRef)
          ]);
          if (freshUserSnap.exists && freshUserSnap.data().role && freshUserSnap.data().role !== 'barber') {
            throw new Error('CUSTOMER_ACCOUNT');
          }
          if (freshUserSnap.exists && freshBarberSnap.exists) {
            createdProfile = freshBarberSnap.data();
            return;
          }
          const claim = claimSnap.exists ? claimSnap.data() : null;
          // If this email already claimed a trial on a previous account, reuse its original
          // expiry date below. Never delete the newly created Auth account or grant a fresh trial.
          const now = Timestamp.now();
          const requestedName = text(data.displayName || decoded.name || String(decoded.email || '').split('@')[0] || 'Profesional VIP', 80);
          const displayName = requestedName.length >= 2 ? requestedName : 'Profesional VIP';
          let trialExpiryDate;
          if (freshBarberSnap.exists) {
            const existingExpiry = freshBarberSnap.data().subscriptionExpiresAt;
            trialExpiryDate = existingExpiry && typeof existingExpiry.toDate === 'function' ? existingExpiry.toDate() : (existingExpiry ? new Date(existingExpiry) : null);
          }
          if (!trialExpiryDate && claim) {
            const savedExpiry = claim.trialExpiresAt;
            if (savedExpiry) trialExpiryDate = savedExpiry && typeof savedExpiry.toDate === 'function' ? savedExpiry.toDate() : new Date(savedExpiry);
            else if (claim.claimedAt) trialExpiryDate = new Date(millis(claim.claimedAt) + TRIAL_DAYS * 86400000);
          }
          if (!trialExpiryDate || Number.isNaN(trialExpiryDate.getTime())) trialExpiryDate = new Date(now.toMillis() + TRIAL_DAYS * 86400000);
          const trialExpiry = Timestamp.fromDate(trialExpiryDate);
          const barberCode = freshBarberSnap.exists ? (freshBarberSnap.data().barberCode || defaultCode(decoded.uid)) : defaultCode(decoded.uid);
          const fallbackRewards = [
            {cut:2,discount:10,label:'10% OFF'},
            {cut:4,discount:20,label:'20% OFF'},
            {cut:6,discount:30,label:'30% OFF'}
          ];
          if (!freshBarberSnap.exists) {
            transaction.set(barberRef, {
              uid:decoded.uid, displayName, barberName:'', activityType:'barberia', whatsapp:'', instagramUrl:'', mapsUrl:'',
              schedule:{mode:'mixed',days:[]}, barberCode,
              theme:{accent:'#3478ff',density:'comfortable'},
              loyaltyPrograms:[{id:'program-246',name:'Programa de premios',audience:'all',customerIds:[],rewards:fallbackRewards}],
              defaultLoyaltyProgramId:'program-246', rewards:fallbackRewards,
              subscriptionExpiresAt:trialExpiry, hasPaidSubscription:false,
              trialStartedAt:claim && claim.claimedAt ? claim.claimedAt : now,
              createdAt:now, updatedAt:now
            });
          } else if (data.displayName) {
            transaction.update(barberRef, {displayName, updatedAt:now});
          }
          transaction.set(userRef, {
            uid:decoded.uid, role:'barber', barberUid:decoded.uid, email:normalizedEmail,
            emailVerified:decoded.email_verified === true, updatedAt:now
          }, {merge:true});
          if (!claimSnap.exists) {
            transaction.create(trialClaimRef, {
              uid:decoded.uid, emailHash, claimedAt:now, trialStartedAt:now, trialExpiresAt:trialExpiry
            });
          } else if (claim && !claim.trialExpiresAt) {
            transaction.set(trialClaimRef, {trialExpiresAt:trialExpiry}, {merge:true});
          }
          createdProfile = null;
        });
      } catch (error) {
        if (error.message === 'CUSTOMER_ACCOUNT') return send(res, 403, {ok:false,error:'Esta cuenta pertenece a un cliente, no a un administrador.'});
        throw error;
      }
      const fresh = await barberRef.get();
      if (!fresh.exists) return send(res, 500, {ok:false,error:'No pudimos inicializar el perfil. Cerrá sesión y probá de nuevo.'});
      return send(res, 200, {ok:true, profile:profileView(fresh.data()), subscriptionPrice:getSubscriptionPrice()});
    }

    const context = await requireBarber(req, res);
    if (!context) return;
    const ref = context.db.collection('barbers').doc(context.uid);
    if (req.method === 'GET') {
      const snap = await ref.get();
      if (!snap.exists) return send(res, 404, { ok:false, error:'No se encontró la configuración profesional.' });
      return send(res, 200, { ok:true, profile:profileView(snap.data()) });
    }
    const data = body(req);
    const displayName = text(data.displayName, 80);
    const barberName = text(data.barberName, 100);
    const whatsapp = normalizeArgentinaPhone(data.whatsapp);
    const accent = '#3478ff';
    const density = data.theme && data.theme.density === 'compact' ? 'compact' : 'comfortable';
    if (!displayName) return send(res, 400, { ok:false, error:'Escribí tu nombre.' });
    if (!validArgentinaWhatsapp(data.whatsapp)) return send(res, 400, { ok:false, error:'Ingresá un WhatsApp argentino válido y completo.' });
    let instagramUrl, mapsUrl, schedule;
    try {
      let instagramInput = text(data.instagramUsername ?? data.instagramUrl, 500).trim();
      if (instagramInput) {
        if (/^https?:\/\//i.test(instagramInput)) {
          const parsed = new URL(safeHttpsUrl(instagramInput, ['instagram.com']));
          instagramInput = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
        }
        instagramInput = instagramInput.replace(/^@/, '').trim();
        if (!/^[A-Za-z0-9._]{1,30}$/.test(instagramInput) || instagramInput === '.' || instagramInput === '..') {
          throw new Error('Ingresá solo tu usuario de Instagram (sin @ ni enlace), con hasta 30 letras, números, puntos o guiones bajos.');
        }
        instagramUrl = `https://www.instagram.com/${instagramInput}/`;
      } else instagramUrl = '';
      mapsUrl = safeHttpsUrl(data.mapsUrl, ['google.com','maps.app.goo.gl','goo.gl']);
      schedule = cleanSchedule(data.schedule || {});
    } catch (error) { return send(res, 400, {ok:false,error:error.message}); }
    // The normal settings form always sends services and showServices. Avoid a read
    // on every save; only fetch existing values for partial requests that omit either field.
    let existing = {};
    if (data.services === undefined || data.showServices === undefined) {
      const existingSnap = await ref.get();
      existing = existingSnap.exists ? existingSnap.data() : {};
    }
    const allowedActivityTypes = ['barberia'];
    let activityType = 'barberia';
    if (data.activityType !== undefined) {
      activityType = text(data.activityType, 30);
      if (!allowedActivityTypes.includes(activityType)) return send(res, 400, {ok:false,error:'Elegí un tipo de actividad válido.'});
    }
    let services;
    try { services = cleanServices(data.services === undefined ? existing.services : data.services); }
    catch (error) { return send(res, 400, { ok:false, error:error.message }); }
    const showServices = data.showServices === undefined ? existing.showServices === true : data.showServices === true;
    const updatedAt = admin().firestore.FieldValue.serverTimestamp();
    const publicProfile = {
      displayName, barberName, whatsapp, instagramUrl, mapsUrl, schedule,
      services: showServices ? services.filter(service => service.active !== false).map(({id,name,price,active})=>({id,name,price,active})) : [],
      showServices, updatedAt
    };
    // Commit private settings and public customer-facing data together. The customer listener
    // receives only this small public document; no polling or second read is needed on save.
    const batch = context.db.batch();
    batch.update(ref,{displayName,barberName,activityType,whatsapp,instagramUrl,mapsUrl,schedule,services,showServices,theme:{accent,density},updatedAt});
    batch.set(ref.collection('publicMeta').doc('professional'),publicProfile);
    await batch.commit();
    const savedProfile = profileView({
      ...existing,displayName,barberName,activityType,whatsapp,instagramUrl,mapsUrl,schedule,
      services,showServices,theme:{...(existing.theme||{}),accent,density},
      updatedAt: new Date().toISOString()
    });
    return send(res, 200, {ok:true,profile:savedProfile,subscriptionPrice:getSubscriptionPrice()});
  } catch (error) {
    console.error('profile error', error);
    return send(res, 500, {ok:false,error:'No se pudo guardar la configuración profesional por un problema temporal. Revisá tu conexión e intentá nuevamente.'});
  }
};
