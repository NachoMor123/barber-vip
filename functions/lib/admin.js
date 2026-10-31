const admin = require('firebase-admin');

function getAdmin() {
  if (!admin.apps.length) {
    // Firebase Functions uses its attached Google service identity (ADC).
    // Keep JSON credentials supported for the temporary Vercel rollback path.
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (raw) {
      let serviceAccount;
      try { serviceAccount = JSON.parse(raw); }
      catch (_) { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON no contiene un JSON válido.'); }
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      admin.initializeApp();
    }
  }
  return admin;
}
function db() { return getAdmin().firestore(); }
function auth() { return getAdmin().auth(); }
module.exports = { admin: getAdmin, db, auth };
