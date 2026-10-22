const { send, method } = require('../lib/http');
const { requireBarber } = require('../lib/security');

const PRESENCE_WINDOW_MS = 6 * 60 * 1000;
const PRESENCE_QUERY_LIMIT = 1000;

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;

    // This manual refresh reads only profiles with recent activity, never the
    // full customer list. The main customer list is already kept live by Firestore.
    const cutoff = ctx.admin.firestore.Timestamp.fromMillis(Date.now() - PRESENCE_WINDOW_MS);
    const snap = await ctx.db.collection('barbers').doc(ctx.uid).collection('customers')
      .where('lastSeenAt', '>=', cutoff)
      .orderBy('lastSeenAt', 'desc')
      .limit(PRESENCE_QUERY_LIMIT)
      .get();

    const now = Date.now();
    const presence = [];
    for (const doc of snap.docs) {
      const customer = doc.data();
      if (customer.active === false) continue;
      const raw = customer.lastSeenAt;
      const seen = raw && typeof raw.toMillis === 'function' ? raw.toMillis() : 0;
      if (!seen || now - seen < 0 || now - seen >= PRESENCE_WINDOW_MS) continue;
      // Return both fresh online and fresh offline updates so a manual refresh can
      // correct a missed snapshot without scanning the entire customer collection.
      presence.push({ uid: doc.id, lastSeenAt: new Date(seen).toISOString(), isOnline: customer.isOnline === true });
    }
    return send(res, 200, { ok: true, presence, windowSeconds: PRESENCE_WINDOW_MS / 1000, partial: snap.size === PRESENCE_QUERY_LIMIT });
  } catch (error) {
    console.error('presence refresh failed', error);
    return send(res, 500, { ok: false, error: 'No se pudo actualizar el estado de conexión. Intentá nuevamente.' });
  }
};
