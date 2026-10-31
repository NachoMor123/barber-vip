'use strict';

const { db, admin } = require('../lib/admin');
const { send, method, body } = require('../lib/http');
const { requireUser } = require('../lib/security');
const { pushConfigured, subscriptionId } = require('../lib/push');

const ALLOWED_PUSH_HOST = host =>
  host === 'fcm.googleapis.com' ||
  host === 'fcmregistrations.googleapis.com' ||
  host.endsWith('.push.services.mozilla.com') ||
  host.endsWith('.push.apple.com') ||
  host === 'notify.windows.com' ||
  host.endsWith('.notify.windows.com');

async function customerContext(req, res) {
  const decoded = await requireUser(req, res);
  if (!decoded) return null;
  const database = db();
  const profileSnap = await database.collection('userProfiles').doc(decoded.uid).get();
  if (!profileSnap.exists || profileSnap.data().role !== 'customer' || !profileSnap.data().barberUid) {
    send(res, 403, { ok: false, error: 'Las notificaciones de tarjeta están disponibles para cuentas de cliente.' });
    return null;
  }
  const barberUid = String(profileSnap.data().barberUid);
  const customerRef = database.collection('barbers').doc(barberUid).collection('customers').doc(decoded.uid);
  const customerSnap = await customerRef.get();
  if (!customerSnap.exists || customerSnap.data().active === false) {
    send(res, 403, { ok: false, error: 'La cuenta de cliente no está activa.' });
    return null;
  }
  return { database, uid: decoded.uid, barberUid };
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;
  try {
    // The public VAPID key is safe to expose. GET does not read Firestore.
    if (req.method === 'GET') {
      const configured = pushConfigured();
      return send(res, 200, { ok: true, enabled: configured, publicKey: configured ? String(process.env.VAPID_PUBLIC_KEY).trim() : '' });
    }
    if (!pushConfigured()) return send(res, 503, { ok: false, error: 'El servicio de notificaciones todavía no está configurado en el servidor.' });

    const context = await customerContext(req, res);
    if (!context) return;
    const { database, uid, barberUid } = context;
    const pushRef = database.collection('pushSubscriptions');

    if (req.method === 'POST') {
      const subscription = body(req).subscription;
      const endpoint = String(subscription?.endpoint || '').slice(0, 2048);
      const keys = subscription && subscription.keys;
      let parsedEndpoint;
      try { parsedEndpoint = new URL(endpoint); } catch (_) {
        return send(res, 400, { ok: false, error: 'El navegador no devolvió una suscripción de notificaciones válida.' });
      }
      if (parsedEndpoint.protocol !== 'https:' || !ALLOWED_PUSH_HOST(parsedEndpoint.hostname.toLowerCase())) {
        return send(res, 400, { ok: false, error: 'El proveedor de notificaciones del navegador no es compatible.' });
      }
      if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' ||
          keys.p256dh.length > 512 || keys.auth.length > 256) {
        return send(res, 400, { ok: false, error: 'Faltan las claves de la suscripción de notificaciones.' });
      }
      const id = subscriptionId(endpoint);
      const now = admin().firestore.FieldValue.serverTimestamp();
      await pushRef.doc(id).set({
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        barberUid,
        customerId: uid,
        enabled: true,
        updatedAt: now
      }, { merge: true });
      return send(res, 200, { ok: true, enabled: true });
    }

    const endpoint = String(body(req).endpoint || '').slice(0, 2048);
    if (!endpoint) return send(res, 400, { ok: false, error: 'Falta identificar este dispositivo.' });
    const id = subscriptionId(endpoint);
    const ref = pushRef.doc(id);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      const current = snapshot.data() || {};
      if (current.customerId !== uid || current.barberUid !== barberUid) {
        return send(res, 403, { ok: false, error: 'No podés modificar las notificaciones de otra cuenta.' });
      }
      await ref.delete();
    }
    return send(res, 200, { ok: true, enabled: false });
  } catch (error) {
    console.error('push subscription error', error?.message || error);
    return send(res, 500, { ok: false, error: 'No se pudo guardar la configuración de notificaciones. Probá de nuevo.' });
  }
};