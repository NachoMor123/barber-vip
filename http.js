function send(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}
function method(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    send(res, 405, { ok: false, error: 'Método no permitido.' });
    return false;
  }
  return true;
}
function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}
function text(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}
function normalizeName(value) {
  return text(value, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}
function digits(value) { return String(value || '').replace(/\D/g, '').slice(0, 18); }
function normalizeArgentinaPhone(value) {
  let n = digits(value);
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = n.replace(/^0+/, '');
  if (n.startsWith('549') && n.length === 13) return n;
  if (n.startsWith('54') && n.length === 12) return '549' + n.slice(2);
  if (n.length === 10) return '549' + n;
  return n;
}
function validArgentinaWhatsapp(value) { return /^(549\d{10}|54\d{10})$/.test(normalizeArgentinaPhone(value)); }
module.exports = { send, method, body, text, normalizeName, digits, normalizeArgentinaPhone, validArgentinaWhatsapp };
