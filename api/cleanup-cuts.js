const { db, admin } = require('../lib/admin');
const { send } = require('../lib/http');

const RETENTION_DAYS = 60;
const MAX_BATCHES_PER_RUN = 40;
const BATCH_SIZE = 400;

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
    const cutoff = admin().firestore.Timestamp.fromDate(new Date(Date.now() - RETENTION_DAYS * 86400000));
    let deleted = 0;
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const snap = await db().collectionGroup('cuts').where('createdAt', '<', cutoff).orderBy('createdAt', 'asc').limit(BATCH_SIZE).get();
      if (snap.empty) break;
      const batch = admin().firestore().batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      deleted += snap.size;
      if (snap.size < BATCH_SIZE) break;
    }
    // Signup rate-limit records store only a hashed IP key. They are operational data and expire quickly.
    const limitsCutoff = admin().firestore.Timestamp.fromDate(new Date(Date.now() - 2 * 86400000));
    let rateLimitDocsDeleted = 0;
    for (let i = 0; i < 5; i++) {
      const staleLimits = await db().collection('customerSignupLimits').where('updatedAt', '<', limitsCutoff).orderBy('updatedAt', 'asc').limit(BATCH_SIZE).get();
      if (staleLimits.empty) break;
      const batch = admin().firestore().batch();
      staleLimits.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      rateLimitDocsDeleted += staleLimits.size;
      if (staleLimits.size < BATCH_SIZE) break;
    }
    return send(res, 200, { ok: true, deleted, rateLimitDocsDeleted, retentionDays: RETENTION_DAYS, signupRateLimitRetentionDays: 2 });
  } catch (error) {
    console.error('cleanup cuts error', error);
    return send(res, 500, { ok: false, error: 'No se pudo limpiar el historial antiguo.' });
  }
};
