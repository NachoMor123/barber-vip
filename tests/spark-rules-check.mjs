import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc,
  writeBatch, serverTimestamp, Timestamp
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-barber-vip',
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8') }
});
const barberUid = 'barber-test-001';
const customerUid = 'customer-test-001';
const expiry = Timestamp.fromMillis(Date.now() + 7 * 86400000);

try {
  const barberDb = env.authenticatedContext(barberUid, { email: 'barber@test.example' }).firestore();

  // A trial, user profile, barber record, public code and public metadata are created atomically.
  const first = writeBatch(barberDb);
  first.set(doc(barberDb, 'trialClaims', 'trial-hash-001'), {
    uid: barberUid, emailHash: 'trial-hash-001', claimedAt: serverTimestamp(),
    trialStartedAt: serverTimestamp(), trialExpiresAt: expiry
  });
  first.set(doc(barberDb, 'userProfiles', barberUid), {
    uid: barberUid, role: 'barber', createdAt: serverTimestamp()
  });
  first.set(doc(barberDb, 'barbers', barberUid), {
    displayName: 'Barbero de prueba', barberCode: 'BARBER01',
    subscriptionExpiresAt: expiry, trialClaimId: 'trial-hash-001',
    trialStartedAt: serverTimestamp(), hasPaidSubscription: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    sparkLoginIndexMigratedAt: serverTimestamp(),
    sparkPublicCodeReadyAt: serverTimestamp(), sparkPublicMetaReadyAt: serverTimestamp(),
    loyaltyPrograms: [{ id: 'program-general', audience: 'all', rewards: [
      { cut: 2, discount: 10 }, { cut: 4, discount: 20 }, { cut: 6, discount: 30 }
    ] }], defaultLoyaltyProgramId: 'program-general'
  });
  first.set(doc(barberDb, 'publicBarberCodes', 'BARBER01'), {
    barberUid, barberCode: 'BARBER01', createdAt: serverTimestamp()
  });
  first.set(doc(barberDb, 'barbers', barberUid, 'publicMeta', 'professional'), {
    displayName: 'Barbero de prueba', barberCode: 'BARBER01', showServices: false
  });
  await assertSucceeds(first.commit());
  console.log('PASS: barber trial bootstrap');

  const customer = {
    uid: customerUid, barberUid, fullName: 'Franco Prueba', usernameNormalized: 'franco prueba',
    loginEmail: 'cliente-customer-test-001@accounts.barbervip.app', whatsapp: '5492615550000',
    totalCuts: 0, actualCutsRegistered: 0, cycleCuts: 0, cycleVersion: 2,
    availableRewards: [], rewardReady: false, active: true,
    loyaltyOverride: { mode: 'standard', rewards: [] },
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastCutAt: null
  };
  const second = writeBatch(barberDb);
  second.set(doc(barberDb, 'barbers', barberUid, 'customers', customerUid), customer);
  second.set(doc(barberDb, 'userProfiles', customerUid), {
    uid: customerUid, role: 'customer', barberUid, createdAt: serverTimestamp()
  });
  second.set(doc(barberDb, 'customerLoginLookup', 'name-hash-001'), {
    uid: customerUid, barberUid, email: customer.loginEmail, active: true, updatedAt: serverTimestamp()
  });
  await assertSucceeds(second.commit());
  console.log('PASS: barber creates customer and name lookup index');

  const customerDb = env.authenticatedContext(customerUid).firestore();
  await assertSucceeds(getDoc(doc(customerDb, 'userProfiles', customerUid)));
  await assertSucceeds(getDoc(doc(customerDb, 'barbers', barberUid, 'customers', customerUid)));
  await assertFails(getDoc(doc(customerDb, 'barbers', barberUid)));
  await assertFails(getDoc(doc(customerDb, 'barbers', barberUid, 'customers', 'other')));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'publicBarberCodes', 'BARBER01')));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'customerLoginLookup', 'name-hash-001')));
  console.log('PASS: customer privacy and exact public lookups');

  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'barbers', barberUid, 'customerRoster', 'state'), {
      version: 1,
      changes: [{
        version: 1, action: 'created', customerId: customerUid,
        customer: { uid: customerUid, barberUid, fullName: 'Franco Prueba', active: true },
        changedAt: serverTimestamp()
      }],
      updatedAt: serverTimestamp()
    });
  });
  await assertSucceeds(getDoc(doc(barberDb, 'barbers', barberUid, 'customerRoster', 'state')));
  await assertFails(getDoc(doc(customerDb, 'barbers', barberUid, 'customerRoster', 'state')));
  await assertFails(setDoc(doc(barberDb, 'barbers', barberUid, 'customerRoster', 'state'), {
    version: 2, changes: [], updatedAt: serverTimestamp()
  }));
  await assertFails(getDocs(collection(barberDb, 'barbers', barberUid, 'customerRoster')));
  console.log('PASS: compact customer roster feed is readable only by the barber and not client-writable');

  const listed = await assertSucceeds(getDocs(collection(barberDb, 'barbers', barberUid, 'customers')));
  if (listed.size !== 1) throw new Error('Expected exactly one customer');
  await assertFails(updateDoc(doc(customerDb, 'barbers', barberUid, 'customers', customerUid), {
    totalCuts: 99, updatedAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(doc(barberDb, 'barbers', barberUid, 'customers', customerUid), {
    totalCuts: 1, actualCutsRegistered: 1, cycleCuts: 1, cycleVersion: 2, updatedAt: serverTimestamp()
  }));
  console.log('PASS: customer cannot forge visits; barber can register visits');

  await assertSucceeds(updateDoc(doc(barberDb, 'barbers', barberUid), {
    displayName: 'Nombre actualizado', updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(barberDb, 'barbers', barberUid), {
    subscriptionExpiresAt: Timestamp.fromMillis(Date.now() + 365 * 86400000),
    updatedAt: serverTimestamp()
  }));
  console.log('PASS: subscription expiry is protected from the barber');

  // A client can self-register with an active barber using only direct Firestore writes.
  const selfUid = 'self-customer-001';
  const selfDb = env.authenticatedContext(selfUid).firestore();
  const selfCustomer = {
    ...customer, uid: selfUid, fullName: 'Sofia Autoregistro',
    usernameNormalized: 'sofia autoregistro', whatsapp: '5492615550001',
    loginEmail: 'cliente-self-customer-001@accounts.barbervip.app'
  };
  const selfBatch = writeBatch(selfDb);
  selfBatch.set(doc(selfDb, 'barbers', barberUid, 'customers', selfUid), selfCustomer);
  selfBatch.set(doc(selfDb, 'userProfiles', selfUid), {
    uid: selfUid, role: 'customer', barberUid, createdAt: serverTimestamp()
  });
  selfBatch.set(doc(selfDb, 'customerLoginLookup', 'name-hash-002'), {
    uid: selfUid, barberUid, email: selfCustomer.loginEmail, active: true, updatedAt: serverTimestamp()
  });
  await assertSucceeds(selfBatch.commit());
  console.log('PASS: public customer self-registration');

  const disable = writeBatch(barberDb);
  disable.update(doc(barberDb, 'barbers', barberUid, 'customers', selfUid), {
    active: false, disabledAt: serverTimestamp(), usernameNormalized: null, whatsapp: '', updatedAt: serverTimestamp()
  });
  disable.set(doc(barberDb, 'userProfiles', selfUid), { disabled: true, updatedAt: serverTimestamp() }, { merge: true });
  disable.set(doc(barberDb, 'customerLoginLookup', 'name-hash-002'), {
    uid: selfUid, barberUid, email: selfCustomer.loginEmail, active: false, updatedAt: serverTimestamp()
  }, { merge: true });
  await assertSucceeds(disable.commit());
  await assertFails(getDoc(doc(selfDb, 'barbers', barberUid, 'customers', selfUid)));
  console.log('PASS: customer deactivation revokes card access');

  // Ordinary barbers may not list all professionals or grant themselves admin status.
  await assertFails(getDocs(collection(barberDb, 'barbers')));
  await assertFails(updateDoc(doc(barberDb, 'userProfiles', barberUid), { platformAdmin: true }));
  console.log('PASS: platform-admin privileges cannot be self-assigned');

  const adminUid = 'platform-admin-001';
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'userProfiles', adminUid), {
      uid: adminUid, role: 'barber', platformAdmin: true, createdAt: serverTimestamp()
    });
  });
  const adminDb = env.authenticatedContext(adminUid).firestore();
  const allBarbers = await assertSucceeds(getDocs(collection(adminDb, 'barbers')));
  if (allBarbers.size !== 1) throw new Error('Platform admin should see all barber accounts');
  const paymentTime = Timestamp.fromMillis(Date.now());
  const paymentExpiry = Timestamp.fromMillis(paymentTime.toMillis() + 30 * 86400000);
  const billingBatch = writeBatch(adminDb);
  billingBatch.update(doc(adminDb, 'barbers', barberUid), {
    hasPaidSubscription: true,
    subscriptionExpiresAt: paymentExpiry,
    lastPaymentAt: paymentTime,
    updatedAt: serverTimestamp()
  });
  billingBatch.set(doc(collection(adminDb, 'barbers', barberUid, 'payments'), 'manual-payment-001'), {
    amount: 8000, currency: 'ARS', status: 'approved', method: 'mercadopago-link-manual',
    receiptReference: 'MP-RECEIPT-001', paidAt: paymentTime, newExpiry: paymentExpiry, createdAt: serverTimestamp()
  });
  await assertSucceeds(billingBatch.commit());
  const payment = await assertSucceeds(getDoc(doc(adminDb, 'barbers', barberUid, 'payments', 'manual-payment-001')));
  if (!payment.exists() || payment.data().amount !== 8000) throw new Error('Manual payment record missing');
  await assertFails(setDoc(doc(adminDb, 'barbers', barberUid, 'payments', 'manual-payment-001'), {
    amount: 8000, currency: 'ARS', status: 'approved', method: 'mercadopago-link-manual',
    receiptReference: 'MP-RECEIPT-001', paidAt: paymentTime, newExpiry: paymentExpiry, createdAt: serverTimestamp()
  }));
  console.log('PASS: platform admin records an ARS 8000 payment atomically; duplicate payment records cannot be overwritten');

  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'barbers', barberUid), {
      subscriptionExpiresAt: Timestamp.fromMillis(Date.now() - 86400000), hasPaidSubscription: false
    });
  });
  await assertFails(updateDoc(doc(barberDb, 'barbers', barberUid, 'customers', customerUid), {
    totalCuts: 2, actualCutsRegistered: 2, cycleCuts: 2, updatedAt: serverTimestamp()
  }));
  console.log('PASS: expired barber cannot mutate customer data');
} finally {
  await env.cleanup();
}
