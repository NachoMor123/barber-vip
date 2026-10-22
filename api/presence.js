const { send, method } = require('../lib/http');
const { requireBarber } = require('../lib/security');

const PRESENCE_WINDOW_MS = 5 * 60 * 1000;
const PRESENCE_QUERY_LIMIT = 1000;

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;

    // Manual refresh returns each active client, not only recent pings. This lets
    // the UI reliably turn stale "online" labels into "last connection" labels.
    const snap = await ctx.db.collection('barbers').doc(ctx.uid).collection('customers')
      .limit(PRESENCE_QUERY_LIMIT)
      .get();

    const now = Date.now();
    const presence = [];
    for (const doc of snap.docs) {
      const customer = doc.data();
      if (customer.active === false) continue;
      const raw = customer.lastSeenAt;
      const seen = raw && typeof raw.toMillis === 'function' ? raw.toMillis() : 0;
      const fresh = seen > 0 && now - seen >= 0 && now - seen < PRESENCE_WINDOW_MS;
      presence.push({
        uid: doc.id,
        lastSeenAt: seen ? new Date(seen).toISOString() : null,
        isOnline: fresh && customer.isOnline === true
      });
    }
    return send(res, 200, {
      ok: true,
      presence,
      windowSeconds: PRESENCE_WINDOW_MS / 1000,
      partial: snap.size === PRESENCE_QUERY_LIMIT
    });
  } catch (error) {
    console.error('presence refresh failed', error);
    return send(res, 500, { ok: false, error: 'No se pudo actualizar el estado de conexión. Intentá nuevamente.' });
  }
};
