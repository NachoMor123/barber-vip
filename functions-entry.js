'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { send } = require('./lib/http');

// Keep the existing API handlers unchanged. Hosting forwards /api/** here;
// this router selects the original handler without adding Firestore listeners.
const routes = Object.freeze({
  'me': require('./api/me'),
  'customers': require('./api/customers'),
  'customer-login': require('./api/customer-login'),
  'cuts': require('./api/cuts'),
  'loyalty': require('./api/loyalty'),
  'profile': require('./api/profile'),
  'promotions': require('./api/promotions'),
  'push': require('./api/push'),
  'create-preference': require('./api/create-preference'),
  'mercadopago-webhook': require('./api/mercadopago-webhook'),
  'cleanup-cuts': require('./api/cleanup-cuts')
});

const secretNames = [
  'MP_ACCESS_TOKEN',
  'MP_WEBHOOK_SECRET',
  'VAPID_PRIVATE_KEY',
  'CRON_SECRET'
];

exports.api = onRequest({
  region: 'us-central1',
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 5,
  concurrency: 40,
  secrets: secretNames
}, async (req, res) => {
  const requestUrl = req.originalUrl || req.url || '/';
  const pathname = new URL(requestUrl, 'https://barber-vip.internal').pathname;
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length !== 2 || segments[0] !== 'api') {
    return send(res, 404, { ok: false, error: 'Ruta de API no encontrada.' });
  }

  const routeName = segments[1];
  const handler = routes[routeName];
  if (!handler) {
    return send(res, 404, { ok: false, error: 'Ruta de API no encontrada.' });
  }

  try {
    await handler(req, res);
  } catch (error) {
    console.error('Unhandled Barber VIP API error:', routeName, error);
    if (!res.headersSent) {
      return send(res, 500, {
        ok: false,
        error: 'Ocurrió un problema temporal. Intentá nuevamente.'
      });
    }
    return res.end();
  }
});
