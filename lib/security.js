const { auth, db, admin } = require('./admin');
const { send } = require('./http');

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
    send(res, 403, { ok: false, error: 'Esta acción es exclusiva del administrador de la barbería.' });
    return null;
  }
  return { decoded, profile: snap.data(), uid: decoded.uid, db: db(), admin: admin() };
}

function subscription(barber) {
  const now = Date.now();
  const raw = barber && barber.subscriptionExpiresAt;
  const expiry = raw && typeof raw.toDate === 'function' ? raw.toDate() : (raw ? new Date(raw) : null);
  if (!expiry || Number.isNaN(expiry.getTime())) {
    return { status: 'suspended', label: 'Fecha de vencimiento sin configurar', daysRemaining: null, expiresAt: null };
  }
  const ms = expiry.getTime() - now;
  const days = Math.ceil(ms / 86400000);
  if (ms < 0) return { status: 'suspended', label: 'Cuenta vencida', daysRemaining: days, expiresAt: expiry.toISOString() };
  if (days <= 5) return { status: 'grace', label: 'Período de gracia', daysRemaining: days, expiresAt: expiry.toISOString() };
  return { status: 'active', label: 'Cuenta activa', daysRemaining: days, expiresAt: expiry.toISOString() };
}

module.exports = { requireUser, requireBarber, subscription };
