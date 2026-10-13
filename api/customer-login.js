const { db } = require('../lib/admin');
const { send, method, body, text, normalizeName } = require('../lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const data = body(req);
    const barberCode = text(data.barberCode, 16).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const usernameNormalized = normalizeName(data.username);
    if (!barberCode || !usernameNormalized) return send(res, 400, { ok: false, error: 'Completá el código de barbería y tu nombre.' });
    const barberQuery = await db().collection('barbers').where('barberCode', '==', barberCode).limit(1).get();
    if (barberQuery.empty) return send(res, 401, { ok: false, error: 'No encontramos esa combinación. Revisá el código de barbería, el nombre y la contraseña.' });
    const barberDoc = barberQuery.docs[0];
    const query = await barberDoc.ref.collection('customers').where('usernameNormalized', '==', usernameNormalized).limit(2).get();
    const customerDoc = query.docs.find(doc => doc.data().active !== false);
    if (!customerDoc) return send(res, 401, { ok: false, error: 'No encontramos esa combinación. Revisá el código de barbería, el nombre y la contraseña.' });
    return send(res, 200, { ok: true, email: customerDoc.data().loginEmail });
  } catch (error) {
    console.error('customer login error', error);
    return send(res, 500, { ok: false, error: 'No se pudo iniciar sesión. Probá de nuevo.' });
  }
};
