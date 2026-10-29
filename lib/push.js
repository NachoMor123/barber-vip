'use strict';

const crypto = require('crypto');
const webPush = require('web-push');
const { db } = require('./admin');

const BATCH_SIZE = 400;
const SEND_CONCURRENCY = 25;
const APP_ORIGIN = 'https://barber-vip-three.vercel.app';

function pushConfigured() {
  return Boolean(String(process.env.VAPID_PUBLIC_KEY || '').trim() && String(process.env.VAPID_PRIVATE_KEY || '').trim());
}

function configureWebPush() {
  if (!pushConfigured()) return false;
  webPush.setVapidDetails(
    String(process.env.VAPID_SUBJECT || APP_ORIGIN).trim(),
    String(process.env.VAPID_PUBLIC_KEY).trim(),
    String(process.env.VAPID_PRIVATE_KEY).trim()
  );
  return true;
}

function subscriptionId(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint)).digest('hex');
}

function cleanPayload({ title, body, tag, url = '/' }) {
  const safeUrl = (() => {
    try {
      const candidate = new URL(String(url || '/'), APP_ORIGIN);
      return candidate.origin === APP_ORIGIN ? candidate.pathname + candidate.search + candidate.hash : '/';
    } catch (_) { return '/'; }
  })();
  return {
    title: String(title || 'Barber VIP').slice(0, 90),
    body: String(body || 'Hay una novedad en tu tarjeta VIP.').slice(0, 220),
    tag: String(tag || 'barber-vip-update').replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 120),
    url: safeUrl
  };
}

async function refreshCustomerPushFlagIfEmpty(customerId, barberUid) {
  if (!customerId || !barberUid) return;
  try {
    const remaining = await db().collection('pushSubscriptions')
      .where('customerId', '==', String(customerId))
      .where('barberUid', '==', String(barberUid))
      .where('enabled', '==', true)
      .limit(1)
      .get();
    if (!remaining.empty) return;
    await db().collection('barbers').doc(String(barberUid))
      .collection('customers').doc(String(customerId))
      .update({ pushEnabled: false })
      .catch(() => {});
  } catch (_) {
    // Notification cleanup must never make a visit or promotion fail.
  }
}

async function deliverToDoc(subscriptionDoc, payload) {
  const subscription = subscriptionDoc.data() || {};
  if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) return false;
  try {
    configureWebPush();
    await webPush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(payload),
      { TTL: 3600, urgency: 'normal' }
    );
    return true;
  } catch (error) {
    const status = Number(error && error.statusCode || 0);
    if (status === 404 || status === 410) {
      const expired = subscriptionDoc.data() || {};
      await subscriptionDoc.ref.delete().catch(() => {});
      await refreshCustomerPushFlagIfEmpty(expired.customerId, expired.barberUid);
    } else {
      // Never log endpoints or encryption keys; each endpoint is a private delivery capability.
      console.warn('[Barber VIP push] Delivery failed; status:', status || 'unknown');
    }
    return false;
  }
}

async function deliverDocs(docs, payload) {
  let sent = 0;
  for (let offset = 0; offset < docs.length; offset += SEND_CONCURRENCY) {
    const results = await Promise.all(docs.slice(offset, offset + SEND_CONCURRENCY).map(doc => deliverToDoc(doc, payload)));
    sent += results.filter(Boolean).length;
  }
  return sent;
}

async function sendPushToCustomer({ barberUid, customerId, title, body, tag, url = '/' }) {
  if (!pushConfigured() || !barberUid || !customerId) return 0;
  try {
    const snapshot = await db().collection('pushSubscriptions')
      .where('customerId', '==', String(customerId))
      .where('barberUid', '==', String(barberUid))
      .where('enabled', '==', true)
      .get();
    return await deliverDocs(snapshot.docs, cleanPayload({ title, body, tag, url }));
  } catch (_) {
    console.warn('[Barber VIP push] Customer notification unavailable.');
    return 0;
  }
}

async function sendPushToBarberCustomers({ barberUid, customerIds = null, title, body, tag, url = '/' }) {
  if (!pushConfigured() || !barberUid) return 0;
  const selected = Array.isArray(customerIds)
    ? [...new Set(customerIds.map(id => String(id || '').trim()).filter(Boolean))]
    : null;
  if (selected && selected.length === 0) return 0;
  let lastDoc = null;
  let sent = 0;
  const payload = cleanPayload({ title, body, tag, url });
  try {
    if (selected) {
      // Only read subscriptions belonging to the selected customers, not every customer of the barber.
      // Firestore "in" supports up to 30 values per query; chunk to stay within that limit.
      for (let offset = 0; offset < selected.length; offset += 30) {
        const customerChunk = selected.slice(offset, offset + 30);
        const snapshot = await db().collection('pushSubscriptions')
          .where('customerId', 'in', customerChunk)
          .get();
        const docs = snapshot.docs.filter(doc => {
          const data = doc.data() || {};
          return data.barberUid === String(barberUid)
            && data.enabled === true
            && selected.includes(String(data.customerId || ''));
        });
        sent += await deliverDocs(docs, payload);
      }
      return sent;
    }

    // Broadcasts include only live subscriptions; logged-out or expired endpoints are not read.
    while (true) {
      let query = db().collection('pushSubscriptions')
        .where('barberUid', '==', String(barberUid))
        .where('enabled', '==', true)
        .limit(BATCH_SIZE);
      if (lastDoc) query = query.startAfter(lastDoc);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      const docs = snapshot.docs.filter(doc => {
        const data = doc.data() || {};
        return data.enabled === true && data.customerId;
      });
      sent += await deliverDocs(docs, payload);
      if (snapshot.size < BATCH_SIZE) break;
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }
  } catch (_) {
    console.warn('[Barber VIP push] Promotion notifications partially unavailable.');
  }
  return sent;
}

async function removeCustomerPushSubscriptions(customerId, database = db()) {
  if (!customerId) return 0;
  const snapshot = await database.collection('pushSubscriptions').where('customerId', '==', String(customerId)).get();
  for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
    const batch = database.batch();
    snapshot.docs.slice(offset, offset + 450).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
  return snapshot.size;
}

module.exports = { pushConfigured, subscriptionId, sendPushToCustomer, sendPushToBarberCustomers, removeCustomerPushSubscriptions };
