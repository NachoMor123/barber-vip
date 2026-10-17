const crypto = require('crypto');
const { admin } = require('./admin');

function newReferralCode() {
  return crypto.randomBytes(18).toString('hex');
}

function isReferralCode(value) {
  return /^[a-f0-9]{36}$/i.test(String(value || ''));
}

function inviteRecord(barberUid, customerId, customerName) {
  return {
    barberUid,
    referrerCustomerId: customerId,
    referrerName: String(customerName || '').slice(0, 100),
    active: true,
    updatedAt: admin().firestore.FieldValue.serverTimestamp()
  };
}

async function ensureCustomerInvite(database, barberUid, customerRef, customerData) {
  const freshSnap = await customerRef.get();
  if (!freshSnap.exists) throw new Error('No se encontró el perfil del cliente para crear su invitación.');
  const fresh = freshSnap.data();
  let code = isReferralCode(fresh.referralCode) ? fresh.referralCode.toLowerCase() : newReferralCode();
  const inviteRef = database.collection('customerInvites').doc(code);
  const record = inviteRecord(barberUid, customerRef.id, fresh.fullName || customerData?.fullName || 'Cliente VIP');
  const batch = database.batch();
  if (fresh.referralCode !== code) batch.update(customerRef, { referralCode: code, updatedAt: admin().firestore.FieldValue.serverTimestamp() });
  batch.set(inviteRef, { ...record, createdAt: fresh.referralCode === code ? (fresh.createdAt || admin().firestore.FieldValue.serverTimestamp()) : admin().firestore.FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  return { ...fresh, referralCode: code };
}

module.exports = { newReferralCode, isReferralCode, inviteRecord, ensureCustomerInvite };
