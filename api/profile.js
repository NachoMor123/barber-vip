const { db, admin } = require('../lib/admin');
const { send, method, body, text, normalizeArgentinaPhone, validArgentinaWhatsapp } = require('../lib/http');
const { requireUser, requireBarber, subscription } = require('../lib/security');

function defaultCode(uid) { return String(uid).replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase(); }
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
  const mode = input && input.mode === 'double' ? 'double' : 'continuous';
  const allowed = new Set(['mon','tue','wed','thu','fri','sat','sun']);
  const raw = Array.isArray(input && input.days) ? input.days : [];
  const byDay = new Map();
  for (const day of raw) {
    if (!allowed.has(day.day)) continue;
    const row = {
      day: day.day, enabled: Boolean(day.enabled),
      start1: text(day.start1,5), end1: text(day.end1,5),
      start2: text(day.start2,5), end2: text(day.end2,5)
    };
    for (const key of ['start1','end1','start2','end2']) if (!validTime(row[key])) throw new Error('Hay un horario con un formato de hora inválido.');
    if (row.enabled && (!row.start1 || !row.end1 || row.start1 >= row.end1)) throw new Error('En cada día activo, el horario de inicio debe ser anterior al de cierre.');
    if (row.enabled && mode === 'double' && (!row.start2 || !row.end2 || row.start2 >= row.end2 || row.start2 < row.end1)) throw new Error('En el doble turno, el segundo horario debe comenzar después del primero y cerrar más tarde.');
    byDay.set(row.day,row);
  }
  const days = ['mon','tue','wed','thu','fri','sat','sun'].map(day => byDay.get(day) || {day,enabled:false,start1:'09:00',end1:'18:00',start2:'16:00',end2:'20:00'});
  return { mode, days };
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
      const database = db();
      const userRef = database.collection('userProfiles').doc(decoded.uid);
      const userSnap = await userRef.get();
      if (userSnap.exists && userSnap.data().role !== 'barber') return send(res, 403, { ok: false, error: 'Esta cuenta pertenece a un cliente, no a un administrador.' });
      const barberRef = database.collection('barbers').doc(decoded.uid);
      const barberSnap = await barberRef.get();
      if (!barberSnap.exists) {
        const now = admin().firestore.FieldValue.serverTimestamp();
        await barberRef.set({
          uid: decoded.uid, displayName: text(decoded.name || decoded.email || 'Barbero', 80), barberName: '', whatsapp: '',
          instagramUrl:'', mapsUrl:'', schedule:{mode:'continuous',days:[]}, barberCode: defaultCode(decoded.uid),
          theme: { accent: '#b69cff', density: 'comfortable' }, loyaltyPrograms: [], rewards: [], subscriptionExpiresAt: null,
          createdAt: now, updatedAt: now
        });
      }
      await userRef.set({ uid: decoded.uid, role: 'barber', barberUid: decoded.uid, updatedAt: admin().firestore.FieldValue.serverTimestamp() }, { merge: true });
      const fresh = await barberRef.get();
      return send(res, 200, { ok: true, profile: profileView(fresh.data()) });
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
    await ref.update({ displayName, barberName, whatsapp, instagramUrl, mapsUrl, schedule, theme: { accent, density }, updatedAt: admin().firestore.FieldValue.serverTimestamp() });
    const fresh = await ref.get();
    return send(res, 200, { ok: true, profile: profileView(fresh.data()) });
  } catch (error) {
    console.error('profile error', error);
    return send(res, 500, { ok: false, error: error.message || 'No se pudo guardar la configuración.' });
  }
};
