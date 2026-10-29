const { auth, db, admin } = require('./admin');
const { send } = require('./http');
const { subscription } = require('./subscription');

async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) { send(res, 401, { ok: false, error: 'Tu sesión venció. Volvé a ingresar.' }); return null; }
  try { return await auth().verifyIdToken(token); }
  catch (_) { send(res, 401, { ok: false, error: 'La sesión no es válida. Volvé a ingresar.' }); return null; }
}

async function requireBarber(req, res) {
  const decoded = await requireUser(req, res);
  if (!decoded) return null;
  const snap = await db().collection('userProfiles').doc(decoded.uid).get();
  if (!snap.exists || snap.data().role !== 'barber') {
    send(res, 403, { ok: false, error: 'Esta acción requiere acceso de administración a la barbería.' });
    return null;
  }
  return { decoded, profile: snap.data(), uid: decoded.uid, db: db(), admin: admin() };
}


module.exports = { requireUser, requireBarber, subscription };
