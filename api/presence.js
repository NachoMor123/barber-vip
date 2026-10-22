const { send, method } = require('../lib/http');
const { requireBarber } = require('../lib/security');

const PRESENCE_WINDOW_MS = 5 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;

    // Presence refresh must not scan the full customer collection.
    // Only read records with activity inside the online window; old lastSeenAt
    // values are already held by the client list and remain available for display.
    const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS);
    const snap = await ctx.db
      .collection('barbers')
      .doc(ctx.uid)
      .collection('presence')
      .where('lastSeenAt', '>=', cutoff)
      .orderBy('lastSeenAt', 'desc')
      .get();

    const presence = [];
    for (const doc of snap.docs) {
      const customer = doc.data();
      if (customer.active === false) continue;
      const raw = customer.lastSeenAt;
      const seen = raw && typeof raw.toMillis === 'function' ? raw.toMillis() : 0;
      const age = Date.now() - seen;
      if (!seen || age < 0 || age >= PRESENCE_WINDOW_MS) continue;
      presence.push({
        uid: doc.id,
        lastSeenAt: new Date(seen).toISOString(),
        isOnline: customer.isOnline === true
      });
    }

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return send(res, 200, {
      ok: true,
      presence,
      windowSeconds: PRESENCE_WINDOW_MS / 1000,
      scope: 'recent-activity'
    });
  } catch (error) {
    console.error('presence refresh failed', error);
    return send(res, 500, { ok: false, error: 'No se pudo actualizar el estado de conexión. Intentá nuevamente.' });
  }
};
