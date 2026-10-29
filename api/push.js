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

function cleanEndpoint(value) {
  const endpoint = String(value || '').slice(0, 2048);
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:' || !ALLOWED_PUSH_HOST(parsed.hostname.toLowerCase())) return '';
    return endpoint;
  } catch (_) {
    return '';
  }
}

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
  return {
    database,
    uid: decoded.uid,
    barberUid,
    customerRef,
    customer: customerSnap.data()
  };
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;
  try {
    const configured = pushConfigured();
    const publicKey = configured ? String(process.env.VAPID_PUBLIC_KEY).trim() : '';

    if (req.method === 'GET') {
      // Fetching the public VAPID key costs no Firestore reads.
      const endpointParam = new URL(req.url || '/', 'https://barber-vip.internal').searchParams.get('endpoint') || '';
      if (!endpointParam || !configured) {
        return send(res, 200, { ok: true, enabled: configured, publicKey, registered: false, active: false });
      }
      const endpoint = cleanEndpoint(endpointParam);
      if (!endpoint) return send(res, 400, { ok: false, error: 'El dispositivo no devolvió un endpoint de notificaciones válido.' });
      const decoded = await requireUser(req, res);
      if (!decoded) return;
      const subscriptionSnap = await db().collection('pushSubscriptions').doc(subscriptionId(endpoint)).get();
      const record = subscriptionSnap.exists ? (subscriptionSnap.data() || {}) : null;
      const owned = Boolean(record && String(record.customerId || '') === String(decoded.uid));
      return send(res, 200, {
        ok: true,
        enabled: configured,
        publicKey,
        registered: owned,
        active: owned && record.enabled === true
      });
    }

    if (req.method === 'POST' && !configured) {
      return send(res, 503, { ok: false, error: 'El servicio de notificaciones todavía no está configurado en el servidor.' });
    }

    const pushRef = db().collection('pushSubscriptions');

    if (req.method === 'POST') {
      const context = await customerContext(req, res);
      if (!context) return;
      const { database, uid, barberUid, customerRef, customer } = context;
      const subscription = body(req).subscription;
      const endpoint = cleanEndpoint(subscription?.endpoint);
      const keys = subscription && subscription.keys;
      if (!endpoint) {
        return send(res, 400, { ok: false, error: 'El navegador no devolvió una suscripción de notificaciones válida.' });
      }
      if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' ||
          keys.p256dh.length > 512 || keys.auth.length > 256) {
        return send(res, 400, { ok: false, error: 'Faltan las claves de la suscripción de notificaciones.' });
      }

      const ref = pushRef.doc(subscriptionId(endpoint));
      const existingSnap = await ref.get();
      const existing = existingSnap.exists ? (existingSnap.data() || {}) : null;
      if (existing && String(existing.customerId || '') !== String(uid)) {
        return send(res, 403, { ok: false, error: 'Este dispositivo ya está vinculado a otra cuenta de cliente.' });
      }

      const alreadyCurrent = Boolean(existing
        && String(existing.barberUid || '') === String(barberUid)
        && existing.enabled === true
        && String(existing.keys?.p256dh || '') === keys.p256dh
        && String(existing.keys?.auth || '') === keys.auth);
      if (!alreadyCurrent) {
        await ref.set({
          endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          barberUid,
          customerId: uid,
          enabled: true,
          updatedAt: admin().firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      // The customer document lets visit registration skip a billed, empty push query
      // for customers who have never enabled notifications or have logged out on all devices.
      if (customer.pushEnabled !== true) {
        await customerRef.update({ pushEnabled: true });
      }
      return send(res, 200, { ok: true, enabled: true, unchanged: alreadyCurrent && customer.pushEnabled === true });
    }

    // Logout removes only this device's endpoint. It does not require reading the user profile
    // or customer document: ownership is checked against the authenticated UID in the endpoint record.
    const decoded = await requireUser(req, res);
    if (!decoded) return;
    const endpoint = cleanEndpoint(body(req).endpoint);
    if (!endpoint) return send(res, 400, { ok: false, error: 'Falta identificar este dispositivo.' });
    const ref = pushRef.doc(subscriptionId(endpoint));
    const snapshot = await ref.get();
    if (!snapshot.exists) return send(res, 200, { ok: true, enabled: false, unchanged: true });
    const current = snapshot.data() || {};
    if (String(current.customerId || '') !== String(decoded.uid)) {
      return send(res, 403, { ok: false, error: 'No podés modificar las notificaciones de otra cuenta.' });
    }
    const barberUid = String(current.barberUid || '');
    await ref.delete();

    if (barberUid) {
      const remaining = await pushRef
        .where('customerId', '==', String(decoded.uid))
        .where('barberUid', '==', barberUid)
        .where('enabled', '==', true)
        .limit(1)
        .get();
      if (remaining.empty) {
        await db().collection('barbers').doc(barberUid).collection('customers').doc(decoded.uid)
          .update({ pushEnabled: false })
          .catch(() => {});
      }
    }
    return send(res, 200, { ok: true, enabled: false });
  } catch (error) {
    console.error('push subscription error', error?.message || error);
    return send(res, 500, { ok: false, error: 'No se pudo guardar la configuración de notificaciones. Probá de nuevo.' });
  }
};
