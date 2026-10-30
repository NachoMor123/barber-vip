const { db, admin } = require('../lib/admin');
const { send } = require('../lib/http');

const BATCH_SIZE = 400;
const MAX_BATCHES_PER_RUN = 5;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { ok: false, error: 'Método no permitido.' });
  }
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization || '';
  if (!secret || authorization !== `Bearer ${secret}`) {
    return send(res, 401, { ok: false, error: 'No autorizado.' });
  }
  try {
    // Visit records are never expired or deleted. Only temporary hashed-IP
    // signup rate-limit records are cleaned up after their protection window.
    const limitsCutoff = admin().firestore.Timestamp.fromDate(new Date(Date.now() - 2 * 86400000));
    let rateLimitDocsDeleted = 0;
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const staleLimits = await db().collection('customerSignupLimits')
        .where('updatedAt', '<', limitsCutoff)
        .orderBy('updatedAt', 'asc')
        .limit(BATCH_SIZE)
        .get();
      if (staleLimits.empty) break;
      const batch = admin().firestore().batch();
      staleLimits.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      rateLimitDocsDeleted += staleLimits.size;
      if (staleLimits.size < BATCH_SIZE) break;
    }
    return send(res, 200, { ok: true, visitRecordsDeleted: 0, rateLimitDocsDeleted, signupRateLimitRetentionDays: 2 });
  } catch (error) {
    console.error('cleanup operational records error', error);
    return send(res, 500, { ok: false, error: 'No se pudieron limpiar los registros operativos temporales.' });
  }
};
