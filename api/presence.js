const { send, method } = require('../lib/http');
const { requireBarber } = require('../lib/security');

const PRESENCE_WINDOW_MS = 5 * 60 * 1000;
// La vista normal usa onSnapshot. Este endpoint de respaldo solo busca actividad reciente.
const PRESENCE_QUERY_LIMIT = 250;

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;

    // Nunca escanear toda la cartera para un refresco de presencia.
    // Los clientes sin actividad en los últimos 5 minutos no pueden estar en línea.
    const now = Date.now();
    const cutoff = ctx.admin.firestore.Timestamp.fromMillis(now - PRESENCE_WINDOW_MS);
    const snap = await ctx.db.collection('barbers').doc(ctx.uid).collection('customers')
      .where('lastSeenAt', '>=', cutoff)
      .orderBy('lastSeenAt', 'desc')
      .limit(PRESENCE_QUERY_LIMIT)
      .get();

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
