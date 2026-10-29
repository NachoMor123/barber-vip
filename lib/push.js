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
      await subscriptionDoc.ref.delete().catch(() => {});
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

async function sendPushToCustomer({ barberUid, customerId, title, body, tag, url = '/', pushNotificationsEnabled }) {
  if (!pushConfigured() || !barberUid || !customerId || pushNotificationsEnabled === false) return 0;
  try {
    const snapshot = await db().collection('pushSubscriptions').where('customerId', '==', String(customerId)).get();
    const docs = snapshot.docs.filter(doc => {
      const data = doc.data() || {};
      return data.barberUid === String(barberUid) && data.enabled !== false;
    });

    // One-time backfill for accounts created before push opt-in was tracked on the customer document.
    if (pushNotificationsEnabled === undefined || (pushNotificationsEnabled === true && docs.length === 0)) {
      await db().collection('barbers').doc(String(barberUid)).collection('customers').doc(String(customerId))
        .update({ pushNotificationsEnabled: docs.length > 0 }).catch(() => {});
    }
    if (!docs.length) return 0;
    return await deliverDocs(docs, cleanPayload({ title, body, tag, url }));
  } catch (_) {
    console.warn('[Barber VIP push] Customer notification unavailable.');
    return 0;
  }
}

async function sendPushToBarberCustomersasync function sendPushToBarberCustomers({ barberUid, customerIds = null, title, body, tag, url = '/' }) {
  if (!pushConfigured() || !barberUid) return 0;
  const selected = Array.isArray(customerIds) ? new Set(customerIds.map(id => String(id))) : null;
  let lastDoc = null;
  let sent = 0;
  const payload = cleanPayload({ title, body, tag, url });
  try {
    while (true) {
      let query = db().collection('pushSubscriptions').where('barberUid', '==', String(barberUid)).limit(BATCH_SIZE);
      if (lastDoc) query = query.startAfter(lastDoc);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      const docs = snapshot.docs.filter(doc => {
        const data = doc.data() || {};
        return data.enabled !== false && data.customerId && (!selected || selected.has(String(data.customerId)));
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
