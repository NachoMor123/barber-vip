const admin = require('firebase-admin');

function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('Falta configurar FIREBASE_SERVICE_ACCOUNT_JSON en Vercel.');
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch (_) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON no contiene un JSON válido.');
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

function db() { return getAdmin().firestore(); }
function auth() { return getAdmin().auth(); }
module.exports = { admin: getAdmin, db, auth };
