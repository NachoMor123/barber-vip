'use strict';

const express = require('express');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const secrets = {
  APP_URL: defineSecret('APP_URL'),
  SUBSCRIPTION_PRICE_ARS: defineSecret('SUBSCRIPTION_PRICE_ARS'),
  MP_ACCESS_TOKEN: defineSecret('MP_ACCESS_TOKEN'),
  MP_WEBHOOK_SECRET: defineSecret('MP_WEBHOOK_SECRET'),
  CRON_SECRET: defineSecret('CRON_SECRET'),
  VAPID_PUBLIC_KEY: defineSecret('VAPID_PUBLIC_KEY'),
  VAPID_PRIVATE_KEY: defineSecret('VAPID_PRIVATE_KEY'),
  VAPID_SUBJECT: defineSecret('VAPID_SUBJECT')
};

const routes = {
  '/api/me': require('./api/me'),
  '/api/customers': require('./api/customers'),
  '/api/customer-login': require('./api/customer-login'),
  '/api/cuts': require('./api/cuts'),
  '/api/loyalty': require('./api/loyalty'),
  '/api/profile': require('./api/profile'),
  '/api/promotions': require('./api/promotions'),
  '/api/push': require('./api/push'),
  '/api/create-preference': require('./api/create-preference'),
  '/api/mercadopago-webhook': require('./api/mercadopago-webhook'),
  '/api/cleanup-cuts': require('./api/cleanup-cuts')
};

const app = express();
app.disable('x-powered-by');
app.set('query parser', 'simple');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use(async (req, res) => {
  const originalUrl = req.originalUrl || req.url || '/';
  let pathname;
  try {
    pathname = new URL(originalUrl, 'https://barber-vip.internal').pathname;
  } catch (_) {
    pathname = '/';
  }
  pathname = pathname.replace(new RegExp('/+$'), '') || '/';
  const handler = routes[pathname];

  if (!handler) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ ok: false, error: 'Ruta de API no encontrada.' });
  }

  // Keep the original path and query string for handlers that read req.url.
  req.url = originalUrl;

  try {
    await handler(req, res);
  } catch (error) {
    console.error('Barber VIP API unhandled error', pathname, error);
    if (!res.headersSent) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(500).json({ ok: false, error: 'Ocurrió un error inesperado. Probá de nuevo.' });
    }
  }
});

// Zero warm instances reduce idle compute. The cap limits scaling but is not
// a hard billing limit; actual usage still depends on incoming traffic.
exports.api = onRequest({
  region: 'us-central1', // Confirm against the Firestore database location before deployment.
  memory: '256MiB',
  timeoutSeconds: 60,
  maxInstances: 5,
  concurrency: 80,
  invoker: 'public',
  secrets: Object.values(secrets)
}, (req, res) => {
  // Existing endpoint modules keep using process.env; Secret Manager provides the values.
  for (const [name, secret] of Object.entries(secrets)) {
    const value = secret.value();
    if (value) process.env[name] = value;
    else delete process.env[name];
  }
  return app(req, res);
});
