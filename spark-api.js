import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { WORKER_API_BASE } from './worker-config.js';
import { normalizeInstagramProfileUrl } from './profile-utils.js';
import { appendCustomerRosterChange } from './customer-roster.js';
import {
  getAuth, createUserWithEmailAndPassword, updateProfile as updateAuthProfile,
  deleteUser, signOut, setPersistence, inMemoryPersistence
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, getCountFromServer, query, where, orderBy, documentId, startAfter, limit, setDoc, updateDoc,
  deleteDoc, writeBatch, runTransaction, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const DAY_MS = 86400000;
const TRIAL_DAYS = 7;
const GRACE_DAYS = 5;
const SUBSCRIPTION_PRICE_ARS = 8000;
const DEFAULT_REWARDS = [
  { cut: 2, discount: 10, label: '10% OFF' },
  { cut: 4, discount: 20, label: '20% OFF' },
  { cut: 6, discount: 30, label: '30% OFF' }
];

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.retryable = status >= 500 || status === 429;
  return error;
}
function bodyOf(options) {
  if (!options?.body) return {};
  if (typeof options.body === 'object') return options.body;
  try { return JSON.parse(options.body); } catch (_) { return {}; }
}
function cleanText(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}
function normalizeName(value) {
  return cleanText(value, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}
function normalizePhone(value) {
  let n = String(value || '').replace(/\D/g, '').slice(0, 18);
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('549') && n.length === 13) return n;
  if (n.startsWith('54') && n.length === 12) return '549' + n.slice(2);
  if (n.startsWith('0')) n = n.replace(/^0+/, '');
  if (n.length === 12) {
    const match = n.match(/^(\d{2,4})15(\d{6,8})$/);
    if (match) n = match[1] + match[2];
  }
  return n.length === 10 ? '549' + n : n;
}
function validPhone(value) {
  return /^(549\d{10}|54\d{10})$/.test(normalizePhone(value));
}
function cleanCode(value) {
  return cleanText(value, 16).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function dateOf(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function subscription(barber, now = Date.now()) {
  const expiry = dateOf(barber?.subscriptionExpiresAt);
  const isTrial = !!barber?.trialStartedAt && barber?.hasPaidSubscription !== true;
  if (!expiry) return { status: 'suspended', label: 'Fecha de vencimiento sin configurar', daysRemaining: null, expiresAt: null, isTrial: false };
  const ms = expiry.getTime() - now;
  const days = Math.ceil(ms / DAY_MS);
  if (ms >= 0) return { status: 'active', label: isTrial ? 'Prueba gratuita' : 'Cuenta activa', daysRemaining: days, expiresAt: expiry.toISOString(), isTrial };
  if (isTrial) return { status: 'suspended', label: 'Prueba finalizada', daysRemaining: days, expiresAt: expiry.toISOString(), isTrial: false, trialEnded: true };
  const grace = expiry.getTime() + GRACE_DAYS * DAY_MS - now;
  if (barber?.hasPaidSubscription === true && grace > 0) return { status: 'grace', label: 'Período de gracia', daysRemaining: Math.ceil(grace / DAY_MS), expiresAt: expiry.toISOString(), isTrial: false };
  return { status: 'suspended', label: 'Cuenta vencida', daysRemaining: days, expiresAt: expiry.toISOString(), isTrial: false, trialEnded: false };
}
function labelReward(discount) {
  const n = Math.max(0, Math.min(100, Number(discount) || 0));
  return n === 100 ? 'Servicio gratis' : n + '% OFF';
}
function safeRewards(input) {
  const source = Array.isArray(input) ? input.slice().sort((a, b) => Number(a.cut) - Number(b.cut)) : [];
  return [2, 4, 6].map((cut, i) => {
    const d = Number(source[i]?.discount);
    const discount = Number.isInteger(d) && d >= 0 && d <= 100 ? d : DEFAULT_REWARDS[i].discount;
    return { cut, discount, label: labelReward(discount) };
  });
}
function cleanProfileForCustomer(source = {}) {
  const programs = (Array.isArray(source.loyaltyPrograms) ? source.loyaltyPrograms : [])
    .filter(p => p && p.audience === 'all').slice(0, 1).map(p => ({
      id: cleanText(p.id || 'program-general', 80),
      name: cleanText(p.name || 'Programa de premios', 60),
      audience: 'all',
      customerIds: [],
      rewards: safeRewards(p.rewards)
    }));
  const services = source.showServices === true && Array.isArray(source.services)
    ? source.services.slice(0, 20).map(s => ({
        id: cleanText(s?.id, 80),
        name: cleanText(s?.name, 80),
        description: cleanText(s?.description, 180),
        price: s?.price === null || s?.price === undefined || s?.price === '' ? null : Math.max(0, Math.min(10000000, Number(s.price) || 0)),
        active: s?.active !== false
      })).filter(s => s.name)
    : [];
  return {
    displayName: cleanText(source.displayName || 'Tu profesional', 80),
    barberName: cleanText(source.barberName, 100),
    activityType: 'barberia',
    barberCode: cleanCode(source.barberCode),
    whatsapp: cleanText(source.whatsapp, 40),
    instagramUrl: cleanText(source.instagramUrl, 500),
    mapsUrl: cleanText(source.mapsUrl, 1000),
    schedule: source.schedule && typeof source.schedule === 'object' ? source.schedule : {},
    services,
    showServices: source.showServices === true,
    theme: { accent: '#3478ff', density: source.theme?.density === 'compact' ? 'compact' : 'comfortable' },
    loyaltyPrograms: programs,
    defaultLoyaltyProgramId: cleanText(source.defaultLoyaltyProgramId || programs[0]?.id || 'program-general', 80),
  };
}
async function hashHex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function loginLookupId(barberUid, normalizedName) {
  return String(barberUid) + '_' + await hashHex(normalizedName);
}
function customerDefaults({ uid, barberUid, fullName, usernameNormalized, loginEmail, whatsapp, signupSource, cutStyle = '', conversationPreference = '', loyaltyOverride = { mode: 'standard', rewards: [] } }) {
  return {
    uid, barberUid, fullName, usernameNormalized, loginEmail, whatsapp, signupSource,
    cutStyle: cleanText(cutStyle, 100),
    conversationPreference: ['conversar', 'tranquilo'].includes(conversationPreference) ? conversationPreference : '',
    loyaltyOverride,
    totalCuts: 0, actualCutsRegistered: 0, cycleCuts: 0, cycleVersion: 2,
    cyclePausedAtMax: false, availableRewards: [], rewardReady: false, active: true,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastCutAt: null
  };
}
function standardProgram(barber = {}) {
  const programs = Array.isArray(barber.loyaltyPrograms) ? barber.loyaltyPrograms : [];
  return programs.find(p => p?.id === barber.defaultLoyaltyProgramId) || programs.find(p => p?.audience === 'all') || programs[0] || {
    id: 'program-general', name: 'Programa de premios', rewards: DEFAULT_REWARDS
  };
}
function normalizeOverride(mode, input, barber = {}) {
  if (mode !== 'custom') return { mode: 'standard', rewards: [] };
  if (!Array.isArray(input) || input.length > 3) throw fail('Configurá los descuentos de los hitos 2, 4 y 6.');
  const fallback = safeRewards(standardProgram(barber).rewards);
  const values = [2, 4, 6].map((cut, i) => {
    const n = Number(input[i]?.discount ?? fallback[i].discount);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw fail('Configurá los descuentos de los hitos 2, 4 y 6 entre 0% y 100%.');
    return { cut, discount: n };
  });
  return { mode: 'custom', rewards: values };
}

export function createSparkApi({ firebaseConfig, state }) {
  let cachedMe = null;
  let cachedUid = '';
  let publicBarberCode = '';
  const customerSearchCache = new Map();
  const clearCustomerSearchCache = () => customerSearchCache.clear();

  const db = () => {
    if (!state.db) throw fail('No se pudo conectar con el servicio. Recargá Barber VIP e intentá nuevamente.', 503);
    return state.db;
  };
  const auth = () => {
    if (!state.auth?.currentUser) throw fail('Tu sesión venció. Volvé a ingresar.', 401);
    return state.auth;
  };
  const currentUid = () => auth().currentUser.uid;
  const invalidate = () => { cachedMe = null; cachedUid = ''; };

  async function workerRequest(path, options = {}) {
    const base = String(WORKER_API_BASE || '').trim().replace(/\/+$/, '');
    if (!base || base.includes('<COMPLETAR')) {
      throw fail('El servicio no está disponible en este momento. Intentá nuevamente más tarde.', 503);
    }
    const current = state.auth?.currentUser;
    const requiresAuth = options.auth !== false;
    if (requiresAuth && !current) throw fail('Tu sesión venció. Volvé a ingresar.', 401);
    const token = requiresAuth ? await current.getIdToken() : '';
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(options.headers || {}) };
    let body = options.body;
    if (body !== undefined && body !== null && typeof body !== 'string') {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(base + path, { method, headers, body, cache: 'no-store', credentials: 'omit' });
    } catch (error) {
      throw Object.assign(fail('No se pudo conectar con el servidor seguro de Barber VIP. Revisá tu conexión e intentá nuevamente.', 503), { retryable: true, cause: error });
    }
    const result = await response.json().catch(() => null);
    if (!result || !response.ok || result.ok === false) {
      const message = result?.error || 'El servidor seguro no pudo completar la operación.';
      throw fail(message, response.status || 502);
    }
    return result;
  }

  async function writePublicBarberCode(barber) {
    const code = cleanCode(barber.barberCode);
    if (!code) return;
    const ref = doc(db(), 'publicBarberCodes', code);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { barberUid: barber.uid || currentUid(), barberCode: code, createdAt: serverTimestamp() });
    }
  }

  async function ensureLoginIndex(barberUid, customers) {
    const barberRef = doc(db(), 'barbers', barberUid);
    const barberSnap = await getDoc(barberRef);
    if (!barberSnap.exists() || barberSnap.data().sparkLoginIndexMigratedAt) return;
    const active = (Array.isArray(customers) ? customers : []).filter(c => c && c.active !== false && c.loginEmail && c.fullName);
    for (let offset = 0; offset < active.length; offset += 350) {
      const batch = writeBatch(db());
      const group = active.slice(offset, offset + 350);
      for (const c of group) {
        const normalized = cleanText(c.usernameNormalized || normalizeName(c.fullName), 100);
        if (!normalized) continue;
        const id = await loginLookupId(barberUid, normalized);
        batch.set(doc(db(), 'customerLoginLookup', id), {
          uid: c.uid, barberUid, email: c.loginEmail, active: true, updatedAt: serverTimestamp()
        }, { merge: true });
      }
      if (group.length) await batch.commit();
    }
    await updateDoc(barberRef, { sparkLoginIndexMigratedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }

  async function publicMetaForBarber(barberUid, source, allowCreate = true) {
    const ref = doc(db(), 'barbers', barberUid, 'publicMeta', 'professional');
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    const profile = cleanProfileForCustomer(source);
    if (allowCreate) await setDoc(ref, profile);
    return profile;
  }

  async function getMe() {
    const uid = currentUid();
    if (cachedMe && cachedUid === uid) return cachedMe;
    const profileSnap = await getDoc(doc(db(), 'userProfiles', uid));
    if (!profileSnap.exists()) throw fail('No se encontró el perfil de esta cuenta. Volvé a ingresar.', 404);
    const profile = profileSnap.data();

    if (profile.role === 'barber') {
      const barberRef = doc(db(), 'barbers', uid);
      const barberSnap = await getDoc(barberRef);
      if (!barberSnap.exists()) throw fail('Falta configurar el perfil profesional.', 404);
      const barber = { ...barberSnap.data(), uid };
      if (!barber.sparkLoginIndexMigratedAt) {
        try {
          const migration = await migrateCustomerLoginIndexForBarber(barber);
          if (migration.migrated) barber.sparkLoginIndexMigratedAt = true;
          if (migration.cursorId) barber.sparkLoginIndexMigrationCursor = migration.cursorId;
        } catch (error) {
          console.warn('[Barber VIP] La preparación de accesos continuará desde el último bloque guardado.', error?.message || error);
        }
      }
      if (!barber.sparkPublicCodeReadyAt || !barber.sparkPublicMetaReadyAt) {
        if (!barber.sparkPublicCodeReadyAt) await writePublicBarberCode(barber);
        if (!barber.sparkPublicMetaReadyAt) await publicMetaForBarber(uid, barber);
        await updateDoc(barberRef, {
          sparkPublicCodeReadyAt: barber.sparkPublicCodeReadyAt || serverTimestamp(),
          sparkPublicMetaReadyAt: barber.sparkPublicMetaReadyAt || serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        barber.sparkPublicCodeReadyAt = true;
        barber.sparkPublicMetaReadyAt = true;
      }
      const result = {
        ok: true, role: 'barber', uid, barberUid: uid, subscriptionPrice: SUBSCRIPTION_PRICE_ARS,
        profile: { ...barber, subscription: subscription(barber) }
      };
      cachedMe = result; cachedUid = uid;
      return result;
    }

    if (profile.role === 'customer' && profile.barberUid) {
      const barberUid = String(profile.barberUid);
      const customerSnap = await getDoc(doc(db(), 'barbers', barberUid, 'customers', uid));
      if (!customerSnap.exists() || customerSnap.data().active === false || profile.disabled === true) {
        throw fail('Este cliente fue dado de baja. Consultá con tu profesional.', 403);
      }
      const professional = await publicMetaForBarber(barberUid, {}, false);
      const result = {
        ok: true, role: 'customer', uid, barberUid,
        customer: { ...customerSnap.data(), uid },
        barber: cleanProfileForCustomer(professional)
      };
      cachedMe = result; cachedUid = uid;
      return result;
    }
    throw fail('El tipo de cuenta no está configurado correctamente.', 403);
  }

  async function ensureBarberProfile(data) {
    const uid = currentUid();
    const dbRef = db();
    const userRef = doc(dbRef, 'userProfiles', uid);
    const barberRef = doc(dbRef, 'barbers', uid);
    const [userSnap, barberSnap] = await Promise.all([getDoc(userRef), getDoc(barberRef)]);
    if (userSnap.exists() && userSnap.data().role && userSnap.data().role !== 'barber') throw fail('Esta cuenta pertenece a un cliente, no a un administrador.', 403);
    if (userSnap.exists() && barberSnap.exists()) return { ok: true, profile: { ...barberSnap.data(), uid, subscription: subscription(barberSnap.data()) }, subscriptionPrice: SUBSCRIPTION_PRICE_ARS };

    const displayName = cleanText(data.displayName || auth().currentUser.displayName || auth().currentUser.email?.split('@')[0] || 'Profesional', 80);
    const email = cleanText(auth().currentUser.email, 254).toLowerCase();
    if (!email) throw fail('La cuenta necesita un correo electrónico válido para iniciar la prueba.', 400);
    const trialClaimId = await hashHex(email);
    const barberCode = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const now = Date.now();
    const trialExpiry = Timestamp.fromDate(new Date(now + TRIAL_DAYS * DAY_MS));
    const program = { id: 'program-general', name: 'Programa de premios', audience: 'all', customerIds: [], rewards: DEFAULT_REWARDS };
    const barber = {
      displayName, barberName: '', activityType: 'barberia', barberCode,
      whatsapp: '', instagramUrl: '', mapsUrl: '', schedule: { mode: 'continuous', days: [] },
      services: [], showServices: false, theme: { accent: '#3478ff', density: 'comfortable' },
      loyaltyPrograms: [program], defaultLoyaltyProgramId: program.id, rewards: DEFAULT_REWARDS,
      subscriptionExpiresAt: trialExpiry, hasPaidSubscription: false,
      trialClaimId, trialStartedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      sparkLoginIndexMigratedAt: serverTimestamp(), sparkPublicCodeReadyAt: serverTimestamp(), sparkPublicMetaReadyAt: serverTimestamp()
    };
    const batch = writeBatch(dbRef);
    batch.set(barberRef, barber);
    batch.set(doc(dbRef, 'trialClaims', trialClaimId), { uid, emailHash: trialClaimId, claimedAt: serverTimestamp(), trialStartedAt: serverTimestamp(), trialExpiresAt: trialExpiry });
    batch.set(userRef, { uid, role: 'barber', createdAt: serverTimestamp() });
    batch.set(doc(dbRef, 'publicBarberCodes', barberCode), { barberUid: uid, barberCode, createdAt: serverTimestamp() });
    batch.set(doc(dbRef, 'barbers', uid, 'publicMeta', 'professional'), cleanProfileForCustomer(barber));
    await batch.commit();
    invalidate();
    return { ok: true, profile: { ...barber, uid, subscription: subscription(barber) }, subscriptionPrice: SUBSCRIPTION_PRICE_ARS };
  }

  async function registerCustomer(data) {
    const barberCode = cleanCode(data.barberCode);
    const fullName = cleanText(data.fullName, 100);
    const normalized = normalizeName(fullName);
    const password = String(data.password || '');
    const whatsapp = normalizePhone(data.whatsapp);
    if (fullName.length < 3 || normalized.split(' ').filter(Boolean).length < 2) throw fail('Ingresá tu nombre y apellido.');
    if (password.length < 6 || password.length > 128) throw fail('La contraseña debe tener entre 6 y 128 caracteres.');
    if (!validPhone(data.whatsapp)) throw fail('Ingresá un WhatsApp argentino válido, con característica y número completo.');
    if (!barberCode) throw fail('Completá el código de tu profesional.');

    // Public registration is created by the Worker with server credentials.
    // The client must not read the private barber document or write into another
    // barber's customer collection, which Firestore rules correctly prohibit.
    return await workerRequest('/api/customer-register', {
      method: 'POST',
      auth: false,
      body: { barberCode, fullName, password, whatsapp }
    });
  }

  async function signInCustomerLookup(data) {
    const barberCode = cleanCode(data.barberCode);
    const normalized = normalizeName(data.username);
    if (!barberCode || !normalized) throw fail('Completá el código de tu profesional y tu nombre.');
    return await workerRequest('/api/customer-login', {
      method: 'POST',
      auth: false,
      body: { barberCode, username: normalized }
    });
  }

  async function migrateCustomerLoginIndexForBarber(barberData = state.barber || {}) {
    const uid = currentUid();
    const barberRef = doc(db(), 'barbers', uid);
    if (barberData?.sparkLoginIndexMigratedAt) return { ok: true, migrated: false, cursorId: '' };

    const customersRef = collection(db(), 'barbers', uid, 'customers');
    const pageSize = 250;
    const cursorId = String(barberData?.sparkLoginIndexMigrationCursor || '');
    const pageQuery = cursorId
      ? query(customersRef, orderBy(documentId()), startAfter(cursorId), limit(pageSize))
      : query(customersRef, orderBy(documentId()), limit(pageSize));

    // Exactly one bounded page per barber sign-in. Never walk the whole roster
    // in one session; legacy customer access remains available through the Worker fallback.
    const snapshot = await getDocs(pageQuery);
    if (snapshot.empty) {
      await updateDoc(barberRef, {
        sparkLoginIndexMigratedAt: serverTimestamp(),
        sparkLoginIndexMigrationCursor: null,
        updatedAt: serverTimestamp()
      });
      if (cachedMe?.profile) cachedMe = {
        ...cachedMe,
        profile: { ...cachedMe.profile, sparkLoginIndexMigratedAt: true, sparkLoginIndexMigrationCursor: null }
      };
      return { ok: true, migrated: true, indexed: 0, processed: 0, cursorId: '' };
    }

    const batch = writeBatch(db());
    let indexed = 0;
    for (const customerDoc of snapshot.docs) {
      const customer = customerDoc.data() || {};
      if (customer.active === false || !customer.loginEmail || !customer.fullName) continue;
      const normalized = cleanText(customer.usernameNormalized || normalizeName(customer.fullName), 100);
      if (!normalized) continue;
      const lookupId = await loginLookupId(uid, normalized);
      batch.set(doc(db(), 'customerLoginLookup', lookupId), {
        uid: customerDoc.id, barberUid: uid, email: customer.loginEmail,
        active: true, updatedAt: serverTimestamp()
      }, { merge: true });
      indexed++;
    }

    const nextCursorId = snapshot.docs[snapshot.docs.length - 1].id;
    const completed = snapshot.size < pageSize;
    batch.update(barberRef, {
      sparkLoginIndexMigrationCursor: completed ? null : nextCursorId,
      ...(completed ? { sparkLoginIndexMigratedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp()
    });
    await batch.commit();

    if (completed && cachedMe?.profile) cachedMe = {
      ...cachedMe,
      profile: { ...cachedMe.profile, sparkLoginIndexMigratedAt: true, sparkLoginIndexMigrationCursor: null }
    };
    return {
      ok: true, migrated: completed, indexed, processed: snapshot.size,
      cursorId: completed ? '' : nextCursorId
    };
  }

  async function migrateCustomerLoginIndex(customers, barberData = state.barber || {}) {
    // Backwards-compatible API route: use the resumable server-side pagination
    // rather than trusting a caller-supplied in-memory copy of the full roster.
    return await migrateCustomerLoginIndexForBarber(barberData);
  }

  async function createCustomerForBarber(data) {
    const uid = currentUid();
    const barber = state.barber || (await getMe()).profile;
    if (subscription(barber).status === 'suspended') throw fail('Tu plan está vencido. Renovalo para modificar clientes.');
    const fullName = cleanText(data.fullName, 100);
    const normalized = normalizeName(fullName);
    const password = String(data.password || '');
    const whatsapp = normalizePhone(data.whatsapp);
    if (fullName.length < 3) throw fail('Ingresá el nombre y apellido del cliente.');
    if (password.length < 6) throw fail('La contraseña debe tener al menos 6 caracteres.');
    if (!validPhone(data.whatsapp)) throw fail('Ingresá un WhatsApp argentino válido, con característica y número completo.');
    const lookupId = await loginLookupId(uid, normalized);
    const lookupRef = doc(db(), 'customerLoginLookup', lookupId);
    const nameIndex = await getDoc(lookupRef);
    const duplicateName = state.customers?.some(c => c.active !== false && c.usernameNormalized === normalized);
    const phoneMatches = await searchCustomers({ search: whatsapp, source: 'all' });
    const duplicatePhone = (phoneMatches.customers || []).some(c => c.active !== false && normalizePhone(c.whatsapp) === whatsapp);
    if (duplicateName || duplicatePhone || (nameIndex.exists() && nameIndex.data().active !== false)) {
      throw fail('Ya existe un cliente activo con ese nombre o WhatsApp en este espacio profesional.');
    }
    const override = normalizeOverride(data.loyaltyMode, data.loyaltyRewards, barber);
    const loginEmail = 'cliente-' + crypto.randomUUID() + '@accounts.barbervip.app';
    const secondaryApp = initializeApp(firebaseConfig, 'BarberVIP-Customer-' + crypto.randomUUID());
    const secondaryAuth = getAuth(secondaryApp);
    let credential = null;
    try {
      await setPersistence(secondaryAuth, inMemoryPersistence);
      credential = await createUserWithEmailAndPassword(secondaryAuth, loginEmail, password);
      await updateAuthProfile(credential.user, { displayName: fullName });
      const customer = customerDefaults({
        uid: credential.user.uid, barberUid: uid, fullName, usernameNormalized: normalized,
        loginEmail, whatsapp, signupSource: 'admin',
        cutStyle: data.cutStyle, conversationPreference: data.conversationPreference, loyaltyOverride: override
      });
      const customerRef = doc(db(), 'barbers', uid, 'customers', credential.user.uid);
      const profileRef = doc(db(), 'userProfiles', credential.user.uid);
      const rosterRef = doc(db(), 'barbers', uid, 'customerRoster', 'state');
      const rosterCustomer = { ...customer, createdAt: new Date(), updatedAt: new Date() };
      await runTransaction(db(), async transaction => {
        const rosterSnap = await transaction.get(rosterRef);
        const nextRoster = appendCustomerRosterChange(
          rosterSnap.exists() ? rosterSnap.data() : null,
          'created', rosterCustomer, new Date()
        );
        transaction.set(customerRef, customer);
        transaction.set(profileRef, { uid: credential.user.uid, role: 'customer', barberUid: uid, createdAt: serverTimestamp() });
        transaction.set(lookupRef, { uid: credential.user.uid, barberUid: uid, email: loginEmail, active: true, updatedAt: serverTimestamp() });
        transaction.set(rosterRef, nextRoster);
      });
      clearCustomerSearchCache();
      return { ok: true, customer: { ...customer, createdAt: new Date().toISOString() } };
    } catch (error) {
      if (credential?.user) await deleteUser(credential.user).catch(() => {});
      throw error;
    } finally {
      await signOut(secondaryAuth).catch(() => {});
      await deleteApp(secondaryApp).catch(() => {});
    }
  }

  async function updateCustomer(data) {
    const uid = currentUid();
    const id = cleanText(data.customerId, 100);
    if (!id) throw fail('Falta identificar al cliente.');
    const customerRef = doc(db(), 'barbers', uid, 'customers', id);
    const existing = state.customers?.find(c => c.uid === id) || (await getDoc(customerRef)).data();
    if (!existing) throw fail('No se encontró ese cliente.', 404);
    if (data.password) {
      await workerRequest('/api/customers/reset-password', { method: 'POST', body: { customerId: id, password: String(data.password) } });
    }
    const updates = { updatedAt: serverTimestamp() };
    let newNormalized = existing.usernameNormalized || normalizeName(existing.fullName);
    if (data.fullName !== undefined) {
      const fullName = cleanText(data.fullName, 100);
      if (fullName.length < 3) throw fail('Ingresá el nombre y apellido del cliente.');
      newNormalized = normalizeName(fullName);
      updates.fullName = fullName;
      updates.usernameNormalized = newNormalized;
    }
    if (data.whatsapp !== undefined) {
      if (!validPhone(data.whatsapp)) throw fail('Ingresá un WhatsApp argentino válido, con característica y número completo.');
      const nextWhatsapp = normalizePhone(data.whatsapp);
      if (nextWhatsapp !== normalizePhone(existing.whatsapp)) {
        const matches = await searchCustomers({ search: nextWhatsapp, source: 'all' });
        if ((matches.customers || []).some(c => c.uid !== id && c.active !== false && normalizePhone(c.whatsapp) === nextWhatsapp)) {
          throw fail('Ya existe otro cliente activo con ese WhatsApp en este espacio profesional.');
        }
      }
      updates.whatsapp = nextWhatsapp;
    }
    if (data.cutStyle !== undefined) updates.cutStyle = cleanText(data.cutStyle, 100);
    if (data.conversationPreference !== undefined) updates.conversationPreference = ['conversar', 'tranquilo'].includes(data.conversationPreference) ? data.conversationPreference : '';
    if (data.loyaltyMode !== undefined) {
      updates.loyaltyOverride = normalizeOverride(data.loyaltyMode, data.loyaltyRewards, state.barber || {});
    }
    const rosterRef = doc(db(), 'barbers', uid, 'customerRoster', 'state');
    let savedCustomer = null;
    await runTransaction(db(), async transaction => {
      const [customerSnap, rosterSnap] = await Promise.all([
        transaction.get(customerRef), transaction.get(rosterRef)
      ]);
      if (!customerSnap.exists() || customerSnap.data().active === false) {
        throw fail('El cliente ya no está activo. Actualizá la lista y volvé a intentarlo.', 404);
      }
      const fresh = { uid: id, ...customerSnap.data() };
      const oldNormalized = fresh.usernameNormalized || normalizeName(fresh.fullName);
      const nextNormalized = updates.usernameNormalized ?? oldNormalized;
      let oldLookupRef = null, newLookupRef = null;
      if (nextNormalized !== oldNormalized) {
        const oldId = await loginLookupId(uid, oldNormalized);
        const newId = await loginLookupId(uid, nextNormalized);
        oldLookupRef = doc(db(), 'customerLoginLookup', oldId);
        newLookupRef = doc(db(), 'customerLoginLookup', newId);
        const newNameIndex = await transaction.get(newLookupRef);
        if (newNameIndex.exists() && newNameIndex.data().active !== false && newNameIndex.data().uid !== id) {
          throw fail('Ya existe un cliente activo con ese nombre en este espacio profesional.');
        }
      }
      const changedAt = new Date();
      const rosterCustomer = { ...fresh, ...updates, uid: id, updatedAt: changedAt };
      const nextRoster = appendCustomerRosterChange(
        rosterSnap.exists() ? rosterSnap.data() : null,
        'updated', rosterCustomer, changedAt
      );
      transaction.update(customerRef, updates);
      if (oldLookupRef && newLookupRef) {
        transaction.delete(oldLookupRef);
        transaction.set(newLookupRef, {
          uid: id, barberUid: uid, email: fresh.loginEmail,
          active: fresh.active !== false, updatedAt: serverTimestamp()
        });
      }
      transaction.set(rosterRef, nextRoster);
      savedCustomer = rosterCustomer;
    });
    clearCustomerSearchCache();
    return { ok: true, customer: { ...savedCustomer, updatedAt: new Date().toISOString() } };
  }

  async function disableCustomer(data) {
    const uid = currentUid();
    const id = cleanText(data.customerId, 100);
    if (!id) throw fail('Falta identificar al cliente.');
    const customerRef = doc(db(), 'barbers', uid, 'customers', id);
    const existing = state.customers?.find(c => c.uid === id) || (await getDoc(customerRef)).data();
    if (!existing) throw fail('No se encontró ese cliente.', 404);
    const normalized = existing.usernameNormalized || normalizeName(existing.fullName);
    const profileRef = doc(db(), 'userProfiles', id);
    const rosterRef = doc(db(), 'barbers', uid, 'customerRoster', 'state');
    const loginRef = normalized ? doc(db(), 'customerLoginLookup', await loginLookupId(uid, normalized)) : null;
    const disabledAt = new Date();
    const disabledCustomer = {
      ...existing, uid: id, active: false, disabledAt,
      usernameNormalized: null, whatsapp: '', updatedAt: disabledAt
    };
    await runTransaction(db(), async transaction => {
      const rosterSnap = await transaction.get(rosterRef);
      const nextRoster = appendCustomerRosterChange(
        rosterSnap.exists() ? rosterSnap.data() : null,
        'disabled', disabledCustomer, disabledAt
      );
      transaction.update(customerRef, {
        active: false, disabledAt: serverTimestamp(), usernameNormalized: null, whatsapp: '', updatedAt: serverTimestamp()
      });
      transaction.set(profileRef, { disabled: true, updatedAt: serverTimestamp() }, { merge: true });
      if (loginRef) transaction.set(loginRef, {
        uid: id, barberUid: uid, email: existing.loginEmail || '', active: false, updatedAt: serverTimestamp()
      }, { merge: true });
      transaction.set(rosterRef, nextRoster);
    });
    clearCustomerSearchCache();
    return { ok: true };
  }

  async function addCut(data) {
    const uid = currentUid();
    const id = cleanText(data.customerId, 100);
    if (!id) throw fail('Elegí un cliente.');
    const barberRef = doc(db(), 'barbers', uid);
    const customerRef = doc(db(), 'barbers', uid, 'customers', id);
    let resultCustomer = null;
    let outcome = { appliedReward: null, cycleReset: false };
    await runTransaction(db(), async transaction => {
      const [customerSnap, barberSnap] = await Promise.all([transaction.get(customerRef), transaction.get(barberRef)]);
      if (!customerSnap.exists() || customerSnap.data().active === false) throw fail('El cliente no existe o fue dado de baja.');
      if (!barberSnap.exists()) throw fail('No se encontró el perfil profesional.');
      const customer = customerSnap.data();
      const freshBarber = barberSnap.data();
      if (subscription(freshBarber).status === 'suspended') throw fail('La cuenta está vencida. Para registrar nuevas visitas, primero renová tu plan desde Configuración.', 402);
      const programs = Array.isArray(freshBarber.loyaltyPrograms) ? freshBarber.loyaltyPrograms : [];
      const program = customer.loyaltyOverride?.mode === 'custom'
        ? { id: 'customer-override', rewards: customer.loyaltyOverride.rewards }
        : programs.find(p => p.id === freshBarber.defaultLoyaltyProgramId) || programs.find(p => p.audience === 'all') || { rewards: DEFAULT_REWARDS };
      const rewards = safeRewards(program.rewards);
      const cycleMax = Math.max(1, ...rewards.map(r => Number(r.cut) || 1));
      const legacyNonVisitCredits = Math.max(0, Number(customer.referralCreditsReceived || 0));
      const ownCutsBefore = Number.isFinite(Number(customer.actualCutsRegistered))
        ? Math.max(0, Number(customer.actualCutsRegistered))
        : Math.max(0, Number(customer.totalCuts || 0) - legacyNonVisitCredits);
      const totalCuts = ownCutsBefore + 1;
      const actualCutsRegistered = ownCutsBefore + 1;
      const pendingRewards = Array.isArray(customer.availableRewards) ? customer.availableRewards : [];
      let pendingReward = null;
      if (pendingRewards.length) {
        const saved = pendingRewards.slice().sort((a, b) => Number(b.cut || 0) - Number(a.cut || 0))[0];
        const discount = Math.min(100, Math.max(0, Number(saved.discount) || 0));
        const cut = Number(saved.cut) <= 2 ? 2 : Number(saved.cut) <= 4 ? 4 : 6;
        pendingReward = { cut, discount, label: discount === 100 ? 'Servicio gratis' : (discount + '% OFF') };
      } else if (customer.rewardReady) {
        const n = Number(customer.cycleCuts || 0);
        pendingReward = [...rewards].filter(r => Number(r.cut) <= n).pop() || rewards[0];
      }
      let cycleBefore = customer.cycleVersion === 2
        ? Math.max(0, Math.min(cycleMax, Number(customer.cycleCuts || 0)))
        : (ownCutsBefore % cycleMax);
      if (legacyNonVisitCredits > 0 && !pendingReward) cycleBefore = ownCutsBefore % cycleMax;
      const shouldRestart = Boolean(customer.cyclePausedAtMax) || cycleBefore >= cycleMax || Boolean(pendingReward && Number(pendingReward.cut) >= cycleMax);
      const cycleForVisit = shouldRestart ? 1 : Math.min(cycleMax, cycleBefore + 1);
      const milestoneReward = rewards.find(r => Number(r.cut) === cycleForVisit) || null;
      const appliedReward = pendingReward || milestoneReward || null;
      const appliedOnFinalMilestone = Boolean(!pendingReward && milestoneReward && Number(milestoneReward.cut) >= cycleMax && appliedReward === milestoneReward);
      const cycleNext = appliedOnFinalMilestone ? 0 : cycleForVisit;
      const now = serverTimestamp();
      const updates = {
        totalCuts, actualCutsRegistered, cycleCuts: cycleNext, cycleVersion: 2,
        cyclePausedAtMax: false, availableRewards: [], rewardReady: false,
        lastCutAt: now,
        lastRewardAppliedLabel: appliedReward ? cleanText(appliedReward.label || labelReward(appliedReward.discount), 50) : null,
        lastRewardAppliedAt: appliedReward ? now : null,
        lastRewardAppliedCut: appliedReward ? Number(appliedReward.cut || 0) : null,
        lastRewardAppliedOnFinalMilestone: appliedReward ? appliedOnFinalMilestone : null,
        updatedAt: now
      };
      transaction.update(customerRef, updates);
      resultCustomer = {
        ...customer, ...updates, totalCuts, actualCutsRegistered, cycleCuts: cycleNext, cycleVersion: 2,
        loyaltyProgramId: customer.loyaltyProgramId || program.id,
        lastCutAt: new Date().toISOString(),
        lastRewardAppliedAt: appliedReward ? new Date().toISOString() : null
      };
      outcome = { appliedReward, cycleReset: appliedOnFinalMilestone };
    });
    let message = 'Visita registrada correctamente.';
    if (outcome.appliedReward) message = 'Visita registrada. ' + (outcome.appliedReward.label || labelReward(outcome.appliedReward.discount)) + ' se aplicó en esta visita.';
    if (outcome.cycleReset) message += ' El siguiente ciclo comenzó.';
    invalidate();
    clearCustomerSearchCache();
    return { ok: true, customer: resultCustomer, message };
  }

  function customerListSort(value) {
    switch (value) {
      case 'cuts-asc': return { field: 'totalCuts', direction: 'asc' };
      case 'visit-order-desc': case 'last-cut-desc': return { field: 'lastCutAt', direction: 'desc' };
      case 'last-cut-asc': return { field: 'lastCutAt', direction: 'asc' };
      case 'name-asc': return { field: 'fullName', direction: 'asc' };
      default: return { field: 'totalCuts', direction: 'desc' };
    }
  }

  function customerDirectoryFilters(ref, source) {
    const filters = [where('active', '==', true)];
    if (source === 'admin' || source === 'self') filters.push(where('signupSource', '==', source));
    return filters;
  }

  async function listCustomers(data = {}) {
    const uid = currentUid();
    const ref = collection(db(), 'barbers', uid, 'customers');
    const source = data.source === 'admin' || data.source === 'self' ? data.source : 'all';
    const sort = customerListSort(data.sort);
    const pageSize = Math.max(20, Math.min(100, Number(data.pageSize) || 50));
    const filters = customerDirectoryFilters(ref, source);
    const constraints = [...filters, orderBy(sort.field, sort.direction), orderBy(documentId(), sort.direction)];

    if (data.cursorId) {
      let cursorValue = data.cursorValue;
      if (sort.field === 'lastCutAt' && cursorValue) {
        const parsed = dateOf(cursorValue);
        cursorValue = parsed ? Timestamp.fromDate(parsed) : null;
      }
      if (cursorValue === undefined) throw fail('No se pudo continuar la lista. Actualizala para seguir.', 400);
      constraints.push(startAfter(cursorValue, String(data.cursorId)));
    }
    constraints.push(limit(pageSize));
    const snap = await getDocs(query(ref, ...constraints));
    const customers = snap.docs.map(item => {
      const customer = { uid: item.id, ...item.data() };
      delete customer.isOnline; delete customer.lastSeenAt; delete customer.lastConnectedAt;
      return customer;
    });

    let totalCount = null;
    if (data.includeCount !== false) {
      try {
        const count = await getCountFromServer(query(ref, ...filters));
        totalCount = Number(count.data().count) || 0;
      } catch (error) {
        console.warn('[Barber VIP] No se pudo calcular el total de clientes.', error?.message || error);
      }
    }
    const last = snap.docs.at(-1);
    const lastData = last?.data() || {};
    const cursorValue = last
      ? (sort.field === 'lastCutAt' ? (dateOf(lastData[sort.field])?.toISOString() || null) : lastData[sort.field])
      : (data.cursorValue ?? null);
    return {
      ok: true, customers, totalCount,
      hasMore: snap.docs.length === pageSize,
      cursorId: last?.id || String(data.cursorId || ''),
      cursorValue,
      sort: data.sort || 'cuts-desc',
      source
    };
  }

  async function searchCustomers(data = {}) {
    const uid = currentUid();
    const term = cleanText(data.search, 100);
    if (term.length < 2) return { ok: true, customers: [] };
    const ref = collection(db(), 'barbers', uid, 'customers');
    const source = data.source === 'admin' || data.source === 'self' ? data.source : 'all';
    const filters = customerDirectoryFilters(ref, source);
    const rawDigits = term.replace(/\D/g, '');
    const phoneSearch = rawDigits.length >= 3 && /^[+\d\s().-]+$/.test(term);
    const field = phoneSearch ? 'whatsapp' : 'usernameNormalized';
    const prefix = phoneSearch
      ? (rawDigits.startsWith('549') || rawDigits.startsWith('54') ? rawDigits : '549' + rawDigits)
      : normalizeName(term);
    if (!prefix) return { ok: true, customers: [] };

    const cacheKey = [uid, source, field, prefix].join('|');
    const cached = customerSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ok: true, customers: cached.customers.map(customer => ({ ...customer })) };
    }
    if (cached) customerSearchCache.delete(cacheKey);

    const q = query(
      ref,
      ...filters,
      where(field, '>=', prefix),
      where(field, '<=', prefix + '\uf8ff'),
      orderBy(field, 'asc'),
      orderBy(documentId(), 'asc'),
      limit(25)
    );
    const snap = await getDocs(q);
    const customers = snap.docs.map(item => {
      const customer = { uid: item.id, ...item.data() };
      delete customer.isOnline; delete customer.lastSeenAt; delete customer.lastConnectedAt;
      return customer;
    });
    // Brief, account-scoped memory cache smooths repeated searches without persisting
    // private search results to localStorage or treating a partial directory page as complete.
    if (customerSearchCache.size > 100) {
      for (const [key, value] of customerSearchCache) if (value.expiresAt <= Date.now()) customerSearchCache.delete(key);
      while (customerSearchCache.size >= 100) customerSearchCache.delete(customerSearchCache.keys().next().value);
    }
    customerSearchCache.set(cacheKey, { expiresAt: Date.now() + 30000, customers });
    return { ok: true, customers: customers.map(customer => ({ ...customer })) };
  }


  const apiRequest = async function api(url, options = {}) {
    if (navigator.onLine === false) throw Object.assign(fail('Parece que no hay conexión a internet. Revisá la conexión y volvé a intentar.'), { retryable: true });
    const parsed = new URL(url, window.location.origin);
    const path = parsed.pathname;
    const method = String(options.method || 'GET').toUpperCase();
    const data = bodyOf(options);
    try {
      if (path === '/api/me' && method === 'GET') return await getMe();
      if (path === '/api/profile' && method === 'POST') return await ensureBarberProfile(data);
      if (path === '/api/profile' && method === 'PUT') return await saveProfile(data);
      if (path === '/api/loyalty' && method === 'PUT') return await saveLoyalty(data);
      if (path === '/api/customer-login' && method === 'POST') return data.action === 'register' ? await registerCustomer(data) : await signInCustomerLookup(data);
      if (path === '/api/customer-login-index' && method === 'POST') return await migrateCustomerLoginIndex(data.customers);
      if (path === '/api/customers' && method === 'POST') return await createCustomerForBarber(data);
      if (path === '/api/customers' && method === 'PUT') return await updateCustomer(data);
      if (path === '/api/customers' && method === 'DELETE') return await disableCustomer(data);
      if (path === '/api/customers/list' && method === 'POST') return await listCustomers(data);
      if (path === '/api/customers/search' && method === 'POST') return await searchCustomers(data);
      if (path === '/api/cuts' && method === 'POST') return await addCut(data);
      if (path === '/api/create-preference' && method === 'POST') return await workerRequest('/api/create-preference', { method: 'POST', body: data });
      throw fail('La operación solicitada no está disponible en el plan gratuito.', 404);
    } catch (error) {
      if (error?.code === 'permission-denied') {
        throw fail('No se pudo completar la acción. Cerrá sesión y volvé a ingresar; si continúa, contactá al soporte.', 403);
      }
      if (error?.code === 'unavailable' || error?.code === 'deadline-exceeded' || error?.code === 'auth/network-request-failed') {
        throw Object.assign(fail('No se pudo conectar con el servicio. Revisá tu conexión y volvé a intentar.', 503), { retryable: true });
      }
      throw error;
    }
  };

  async function saveProfile(data) {
    const uid = currentUid();
    const ref = doc(db(), 'barbers', uid);
    const schedule = data.schedule && typeof data.schedule === 'object' ? data.schedule : { mode: 'continuous', days: [] };
    const services = Array.isArray(data.services) ? data.services.slice(0, 20).map((s,i) => ({
      id: cleanText(s.id || 'service-' + (i + 1), 80).replace(/[^a-zA-Z0-9_-]/g, ''),
      name: cleanText(s.name, 80),
      description: cleanText(s.description, 180),
      price: s.price === null || s.price === undefined || s.price === '' ? null : Math.max(0, Math.min(10000000, Number(s.price) || 0)),
      active: s.active !== false
    })).filter(s => s.name) : [];
    const rawInstagram = cleanText(data.instagramUrl ?? data.instagramUsername, 500);
    const instagram = normalizeInstagramProfileUrl(rawInstagram);
    if (rawInstagram && !instagram) throw fail('Pegá un usuario o enlace de perfil válido de Instagram.');
    const maps = cleanText(data.mapsUrl, 1000);
    const profile = {
      displayName: cleanText(data.displayName, 80),
      barberName: cleanText(data.barberName, 100),
      activityType: 'barberia',
      whatsapp: normalizePhone(data.whatsapp),
      instagramUrl: instagram,
      mapsUrl: maps,
      schedule, services, showServices: data.showServices === true,
      theme: { accent: '#3478ff', density: data.theme?.density === 'compact' ? 'compact' : 'comfortable' },
      updatedAt: serverTimestamp()
    };
    const publicProfile = cleanProfileForCustomer({ ...(state.barber || {}), ...profile });
    const batch = writeBatch(db());
    batch.update(ref, profile);
    batch.set(doc(db(), 'barbers', uid, 'publicMeta', 'professional'), publicProfile, { merge: true });
    // Barber settings and the public card projection become visible atomically.
    await batch.commit();
    invalidate();
    const resultProfile = { ...(state.barber || {}), ...profile, whatsapp: profile.whatsapp };
    return { ok: true, profile: resultProfile };
  }

  async function saveLoyalty(data) {
    const uid = currentUid();
    const input = Array.isArray(data.programs) ? data.programs : [];
    const selected = input.find(p => p && p.id) || standardProgram(state.barber || {});
    const id = cleanText(selected.id || 'program-general', 80).replace(/[^a-zA-Z0-9_-]/g, '') || 'program-general';
    const program = {
      id, name: cleanText(selected.name || 'Programa de premios', 60),
      audience: 'all', customerIds: [], rewards: safeRewards(selected.rewards)
    };
    const batch = writeBatch(db());
    batch.update(doc(db(), 'barbers', uid), {
      loyaltyPrograms: [program], defaultLoyaltyProgramId: id, rewards: program.rewards, updatedAt: serverTimestamp()
    });
    batch.set(doc(db(), 'barbers', uid, 'publicMeta', 'professional'), {
      loyaltyPrograms: [program], defaultLoyaltyProgramId: id
    }, { merge: true });
    // The barber program and the data consumed by customer cards cannot diverge on a partial write.
    await batch.commit();
    invalidate();
    return { ok: true, programs: [program], defaultLoyaltyProgramId: id };
  }

  apiRequest.resetSessionCache = invalidate;
  apiRequest.clearCustomerSearchCache = clearCustomerSearchCache;
  return apiRequest;
}
