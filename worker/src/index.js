import { buildPushPayload } from "@block65/webcrypto-web-push";


const DAY_MS = 86_400_000;
const PAID_PERIOD_DAYS = 30;
const GRACE_DAYS = 5;
let cachedGoogleToken = "";
let cachedGoogleTokenUntil = 0;
const enc = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
function b64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function pemBytes(pem) {
  const body = String(pem || "").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return fromBase64(body);
}
async function googleAccessToken(env) {
  if (cachedGoogleToken && cachedGoogleTokenUntil > Date.now() + 60_000) return cachedGoogleToken;
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
  if (!account.client_email || !account.private_key || !account.project_id) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON no está configurado correctamente.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(enc.encode(JSON.stringify({
    iss: account.client_email,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit"
  })));
  const unsigned = header + "." + claims;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  const assertion = unsigned + "." + b64url(signature);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error("No se pudo obtener un token seguro de Google para Firebase.");
  cachedGoogleToken = result.access_token;
  cachedGoogleTokenUntil = Date.now() + Number(result.expires_in || 3600) * 1000;
  return cachedGoogleToken;
}
function projectId(env) {
  if (env.FIREBASE_PROJECT_ID) return env.FIREBASE_PROJECT_ID;
  try { return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}").project_id || ""; }
  catch (_) { return ""; }
}
function firestoreBase(env) {
  const id = projectId(env);
  if (!id) throw new Error("FIREBASE_PROJECT_ID no está configurado.");
  return "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(id) + "/databases/(default)/documents";
}
function firestoreResourceName(env, path) {
  return "projects/" + projectId(env) + "/databases/(default)/documents/" + path;
}
function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") {
    const fields = {};
    for (const [key, item] of Object.entries(value)) fields[key] = encodeValue(item);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}
function decodeValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}
function encodeFields(data) {
  const fields = {};
  for (const [key, value] of Object.entries(data || {})) fields[key] = encodeValue(value);
  return fields;
}
function decodeFields(fields = {}) {
  const result = {};
  for (const [key, value] of Object.entries(fields)) result[key] = decodeValue(value);
  return result;
}
function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}
async function fsRequest(env, path, init = {}) {
  const token = await googleAccessToken(env);
  const suffix = path.startsWith(":") ? path : "/" + encodePath(path);
  return fetch(firestoreBase(env) + suffix, {
    ...init,
    headers: { authorization: "Bearer " + token, "content-type": "application/json", ...(init.headers || {}) }
  });
}
async function fsGet(env, path) {
  const response = await fsRequest(env, path);
  if (response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Firestore GET falló (" + response.status + ").");
  return { data: decodeFields(data.fields), updateTime: data.updateTime, name: data.name };
}
async function fsSet(env, path, data) {
  const url = new URL(firestoreBase(env) + "/" + encodePath(path));
  for (const key of Object.keys(data || {})) url.searchParams.append("updateMask.fieldPaths", key);
  const token = await googleAccessToken(env);
  const response = await fetch(url, {
    method: "PATCH",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(data) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Firestore no pudo guardar el documento (" + response.status + ").");
  return result;
}
async function fsDelete(env, path) {
  const response = await fsRequest(env, path, { method: "DELETE" });
  if (response.status === 404) return;
  if (!response.ok) throw new Error("Firestore no pudo eliminar el documento (" + response.status + ").");
}
async function fsQuery(env, collectionId, fieldPath, value, limit = 500) {
  const response = await fsRequest(env, ":runQuery", {
    method: "POST",
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath }, op: "EQUAL", value: encodeValue(value) } },
        limit
      }
    })
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error("Firestore no pudo consultar " + collectionId + " (" + response.status + ").");
  return (Array.isArray(rows) ? rows : []).filter(row => row.document).map(row => ({
    name: row.document.name,
    path: row.document.name.split("/documents/")[1],
    data: decodeFields(row.document.fields || {})
  }));
}
async function fsCommit(env, writes) {
  const response = await fsRequest(env, ":commit", { method: "POST", body: JSON.stringify({ writes }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error("Firestore no pudo confirmar la operación atómica (" + response.status + ")."), { conflict: response.status === 409 || response.status === 400 });
  return result;
}
async function verifyFirebaseToken(env, request) {
  const match = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Iniciá sesión para continuar."), { status: 401 });
  const apiKey = env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw new Error("FIREBASE_WEB_API_KEY no está configurada.");
  const response = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: match[1] })
  });
  const result = await response.json().catch(() => ({}));
  const user = result.users && result.users[0];
  if (!response.ok || !user || user.disabled) throw Object.assign(new Error("La sesión no es válida o venció. Volvé a ingresar."), { status: 401 });
  return { uid: user.localId, email: user.email || "" };
}
async function requireBarber(env, request, checkPlan = true) {
  const user = await verifyFirebaseToken(env, request);
  const profile = await fsGet(env, "userProfiles/" + user.uid);
  if (!profile || profile.data.role !== "barber") throw Object.assign(new Error("Esta operación está disponible solamente para el profesional."), { status: 403 });
  const barber = await fsGet(env, "barbers/" + user.uid);
  if (!barber) throw Object.assign(new Error("No se encontró el perfil profesional."), { status: 404 });
  if (checkPlan && !planCanOperate(barber.data)) throw Object.assign(new Error("Tu plan está vencido. Renovalo para continuar."), { status: 402 });
  return { uid: user.uid, profile: profile.data, barber: barber.data, barberUpdateTime: barber.updateTime };
}
async function requireCustomer(env, request) {
  const user = await verifyFirebaseToken(env, request);
  const profile = await fsGet(env, "userProfiles/" + user.uid);
  if (!profile || profile.data.role !== "customer" || !profile.data.barberUid) throw Object.assign(new Error("Esta operación está disponible solamente para cuentas de cliente."), { status: 403 });
  const barberUid = String(profile.data.barberUid);
  const customer = await fsGet(env, "barbers/" + barberUid + "/customers/" + user.uid);
  if (!customer || customer.data.active === false || customer.data.barberUid !== barberUid) throw Object.assign(new Error("La cuenta de cliente no está activa."), { status: 403 });
  return { uid: user.uid, barberUid, customer: customer.data };
}
function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function planCanOperate(barber, now = Date.now()) {
  const expiry = toDate(barber.subscriptionExpiresAt);
  if (!expiry) return false;
  if (expiry.getTime() > now) return true;
  return barber.hasPaidSubscription === true && expiry.getTime() + GRACE_DAYS * DAY_MS > now;
}
function subscriptionStatus(barber, now = Date.now()) {
  const expiry = toDate(barber.subscriptionExpiresAt);
  const isTrial = Boolean(barber.trialStartedAt) && barber.hasPaidSubscription !== true;
  if (!expiry) return "suspended";
  if (expiry.getTime() > now) return "active";
  if (isTrial) return "suspended";
  if (barber.hasPaidSubscription === true && expiry.getTime() + GRACE_DAYS * DAY_MS > now) return "grace";
  return "suspended";
}
function renewalExpiry(currentExpiry, approvedAt, action = "renew") {
  const approved = toDate(approvedAt);
  if (!approved) throw new Error("La fecha de aprobación del pago no es válida.");
  const current = toDate(currentExpiry);
  const base = action !== "skip-trial" && current && current.getTime() > approved.getTime() ? current : approved;
  return new Date(base.getTime() + PAID_PERIOD_DAYS * DAY_MS);
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function validMercadoPagoSignature(request, paymentId, secret) {
  if (!secret) return false;
  const signature = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const parts = Object.fromEntries(signature.split(",").map(part => {
    const [key, value] = part.trim().split("=");
    return [key, value];
  }));
  if (!parts.ts || !parts.v1 || !requestId || !paymentId) return false;
  const manifest = "id:" + String(paymentId).toLowerCase() + ";request-id:" + requestId + ";ts:" + parts.ts + ";";
  return safeEqual(await hmacHex(secret, manifest), parts.v1.toLowerCase());
}
function appOrigin(env) {
  return String(env.APP_ORIGIN || "https://barbervip-309dc.web.app").replace(/\/+$/, "");
}
function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = [
    appOrigin(env),
    String(env.COMMERCIAL_ORIGIN || "https://barber-vip-comercial-309dc.web.app").replace(/\/+$/, ""),
    "http://localhost:5000", "http://127.0.0.1:5000"
  ];
  return allowed.includes(origin);
}
function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  return {
    "access-control-allow-origin": originAllowed(request, env) ? origin : appOrigin(env),
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}
function responseError(error, request, env) {
  const status = Number(error && error.status) || 500;
  const message = status >= 500 ? "El servidor auxiliar no pudo completar la operación. Probá nuevamente." : error.message;
  return json({ ok: false, error: message }, status, corsHeaders(request, env));
}
async function parseBody(request) {
  try { return await request.json(); }
  catch (_) { throw Object.assign(new Error("El contenido de la solicitud no es válido."), { status: 400 }); }
}

async function createPaymentPreference(request, env) {
  const barber = await requireBarber(env, request, false);
  const data = await parseBody(request);
  const skipTrial = data.action === "skip-trial";
  const paid = barber.barber.hasPaidSubscription === true;
  if (subscriptionStatus(barber.barber) === "active" && (!skipTrial || paid)) {
    throw Object.assign(new Error(paid ? "Tu plan ya está activo. No hace falta pagar otra vez." : "Tu prueba todavía está activa."), { status: 409 });
  }
  if (skipTrial && paid) throw Object.assign(new Error("Tu cuenta ya registra un pago."), { status: 409 });
  const price = Number.parseInt(env.SUBSCRIPTION_PRICE_ARS || "8000", 10);
  if (!Number.isFinite(price) || price < 1 || !env.MP_ACCESS_TOKEN) throw new Error("La configuración de Mercado Pago está incompleta.");
  const origin = appOrigin(env);
  const workerOrigin = new URL(request.url).origin;
  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { authorization: "Bearer " + env.MP_ACCESS_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({
      items: [{
        id: "barber-vip-monthly", title: "Barber VIP — acceso por 30 días",
        description: "Acceso a Barber VIP por 30 días; renovación manual desde la app",
        quantity: 1, currency_id: "ARS", unit_price: price
      }],
      external_reference: barber.uid,
      metadata: { barber_uid: barber.uid, product: "barber-vip-monthly", billing_action: skipTrial ? "skip-trial" : "renew" },
      back_urls: { success: origin + "/?payment=success", failure: origin + "/?payment=failure", pending: origin + "/?payment=pending" },
      auto_return: "approved",
      notification_url: workerOrigin + "/api/mercadopago-webhook"
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.init_point || !result.id) throw Object.assign(new Error("Mercado Pago no pudo crear el enlace de pago."), { status: 502 });
  await fsSet(env, "barbers/" + barber.uid + "/paymentPreferences/" + String(result.id), {
    preferenceId: String(result.id), billingAction: skipTrial ? "skip-trial" : "renew", createdAt: new Date()
  });
  return { ok: true, url: result.init_point, preferenceId: String(result.id) };
}

async function handleMercadoPagoWebhook(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const url = new URL(request.url);
  const paymentId = String(url.searchParams.get("data.id") || url.searchParams.get("id") || body.data?.id || body.id || "");
  const topic = String(url.searchParams.get("type") || url.searchParams.get("topic") || body.type || body.topic || "");
  if (!paymentId || (topic && !["payment", "payments"].includes(topic))) return json({ ok: true, ignored: true });
  if (!await validMercadoPagoSignature(request, paymentId, env.MP_WEBHOOK_SECRET)) return json({ ok: false, error: "Firma de notificación inválida." }, 401);
  if (!env.MP_ACCESS_TOKEN) return json({ ok: false, error: "Falta configurar Mercado Pago." }, 503);
  const response = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(paymentId), {
    headers: { authorization: "Bearer " + env.MP_ACCESS_TOKEN }
  });
  const payment = await response.json().catch(() => ({}));
  if (!response.ok) return json({ ok: false, error: "No se pudo consultar el pago." }, 502);
  if (payment.status !== "approved") return json({ ok: true, ignored: true, status: payment.status || "unknown" });
  const amount = Number.parseInt(env.SUBSCRIPTION_PRICE_ARS || "8000", 10);
  if (Number(payment.transaction_amount) !== amount || payment.currency_id !== "ARS") return json({ ok: false, error: "El importe o la moneda no coinciden." }, 400);
  const barberUid = String(payment.external_reference || payment.metadata?.barber_uid || "");
  if (!barberUid || (payment.metadata?.barber_uid && payment.metadata.barber_uid !== barberUid)) return json({ ok: false, error: "El pago no pertenece a una cuenta de Barber VIP." }, 400);
  const preferenceId = String(payment.preference_id || "");
  if (!preferenceId) return json({ ok: false, error: "El pago no tiene preferencia asociada." }, 400);
  const preferencePath = "barbers/" + barberUid + "/paymentPreferences/" + preferenceId;
  const preference = await fsGet(env, preferencePath);
  if (!preference || !["renew", "skip-trial"].includes(preference.data.billingAction)) {
    return json({ ok: false, error: "No se encontró una preferencia de pago válida." }, 503);
  }
  if (preference.data.processedAt) return json({ ok: true, received: true, duplicate: true });
  const approvedAt = payment.date_approved ? new Date(payment.date_approved) : new Date();
  const barberDoc = await fsGet(env, "barbers/" + barberUid);
  if (!barberDoc) return json({ ok: false, error: "No existe el profesional asociado al pago." }, 404);
  const expiry = renewalExpiry(barberDoc.data.subscriptionExpiresAt, approvedAt, preference.data.billingAction);
  const paymentPath = "barbers/" + barberUid + "/payments/" + String(payment.id);
  const paymentDocName = firestoreResourceName(env, paymentPath);
  try {
    await fsCommit(env, [
      {
        update: {
          name: barberDoc.name,
          fields: encodeFields({
            subscriptionExpiresAt: expiry, hasPaidSubscription: true,
            lastPaymentAt: approvedAt, updatedAt: new Date()
          })
        },
        updateMask: { fieldPaths: ["subscriptionExpiresAt", "hasPaidSubscription", "lastPaymentAt", "updatedAt"] },
        currentDocument: { updateTime: barberDoc.updateTime }
      },
      {
        update: {
          name: paymentDocName,
          fields: encodeFields({
            paymentId: String(payment.id), amount: Number(payment.transaction_amount),
            currency: payment.currency_id, status: "approved",
            billingAction: preference.data.billingAction,
            approvedAt, newExpiry: expiry, createdAt: new Date()
          })
        },
        currentDocument: { exists: false }
      },
      {
        update: {
          name: preference.name,
          fields: encodeFields({ processedAt: new Date(), paymentId: String(payment.id) })
        },
        updateMask: { fieldPaths: ["processedAt", "paymentId"] },
        currentDocument: { updateTime: preference.updateTime }
      }
    ]);
    return json({ ok: true, received: true });
  } catch (error) {
    const prior = await fsGet(env, paymentPath).catch(() => null);
    if (prior) return json({ ok: true, received: true, duplicate: true });
    console.error("Mercado Pago webhook commit failed:", error.message);
    return json({ ok: false, error: "No se pudo aplicar el pago. Mercado Pago puede reintentar la notificación." }, 500);
  }
}

async function subscriptionsForBarber(env, barberUid) {
  return fsQuery(env, "pushSubscriptions", "barberUid", barberUid, 500);
}
async function savePushSubscription(env, context, subscription) {
  const endpoint = String(subscription?.endpoint || "").slice(0, 2048);
  const keys = subscription?.keys;
  let parsed;
  try { parsed = new URL(endpoint); } catch (_) { throw Object.assign(new Error("La suscripción del navegador no es válida."), { status: 400 }); }
  if (parsed.protocol !== "https:" || !keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
    throw Object.assign(new Error("La suscripción del navegador no es válida."), { status: 400 });
  }
  const id = await sha256Hex(endpoint);
  await fsSet(env, "pushSubscriptions/" + id, {
    endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth },
    barberUid: context.barberUid, customerId: context.uid,
    enabled: true, updatedAt: new Date()
  });
  return { ok: true, enabled: true };
}
async function removePushSubscription(env, context, endpoint) {
  const id = await sha256Hex(String(endpoint || ""));
  const path = "pushSubscriptions/" + id;
  const existing = await fsGet(env, path);
  if (existing) {
    if (existing.data.customerId !== context.uid || existing.data.barberUid !== context.barberUid) {
      throw Object.assign(new Error("No podés modificar las notificaciones de otra cuenta."), { status: 403 });
    }
    await fsDelete(env, path);
  }
  return { ok: true, enabled: false };
}
async function removeCustomerPushSubscriptions(request, env) {
  const barber = await requireBarber(env, request, false);
  const data = await parseBody(request);
  const customerId = String(data.customerId || "");
  if (!customerId) throw Object.assign(new Error("Falta identificar al cliente."), { status: 400 });
  const customer = await fsGet(env, "barbers/" + barber.uid + "/customers/" + customerId);
  if (!customer || customer.data.barberUid !== barber.uid) {
    throw Object.assign(new Error("El cliente no pertenece a este profesional."), { status: 403 });
  }
  const subscriptions = await subscriptionsForBarber(env, barber.uid);
  const targets = subscriptions.filter(item => item.data.customerId === customerId);
  for (const item of targets) await fsDelete(env, item.path);
  return { ok: true, removed: targets.length };
}
function cleanPushPayload(data, origin) {
  let url = "/";
  try {
    const candidate = new URL(String(data.url || "/"), origin);
    if (candidate.origin === origin) url = candidate.pathname + candidate.search + candidate.hash;
  } catch (_) {}
  return {
    title: String(data.title || "Barber VIP").slice(0, 90),
    body: String(data.body || "Hay una novedad en tu tarjeta VIP.").slice(0, 220),
    tag: String(data.tag || "barber-vip-update").replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 120),
    url
  };
}
async function deliverPush(env, docs, payload) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw Object.assign(new Error("Las notificaciones no están configuradas."), { status: 503 });
  }

  const vapid = {
    subject: String(env.VAPID_SUBJECT || "https://barbervip-309dc.web.app"),
    publicKey: String(env.VAPID_PUBLIC_KEY),
    privateKey: String(env.VAPID_PRIVATE_KEY)
  };
  let sent = 0;

  // Small batches keep each free-tier Worker invocation within a conservative CPU/subrequest budget.
  const batchSize = 5;
  for (let offset = 0; offset < docs.length; offset += batchSize) {
    const batch = docs.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async doc => {
      try {
        const subscription = {
          endpoint: String(doc.data.endpoint || ""),
          expirationTime: doc.data.expirationTime ?? null,
          keys: doc.data.keys
        };
        const requestInit = await buildPushPayload({
          data: payload,
          options: { ttl: 3600, urgency: "normal" }
        }, subscription, vapid);
        const response = await fetch(subscription.endpoint, requestInit);

        if (response.status === 404 || response.status === 410) {
          await fsDelete(env, doc.path).catch(() => {});
          return false;
        }
        if (!response.ok) {
          console.warn("[Barber VIP push] Delivery failed with status", response.status);
          return false;
        }
        return true;
      } catch (error) {
        console.warn("[Barber VIP push] Delivery failed:", error?.message || "unknown error");
        return false;
      }
    }));
    sent += results.filter(Boolean).length;
  }
  return sent;
}
async function sendVisitPush(request, env) {
  const barber = await requireBarber(env, request);
  const data = await parseBody(request);
  const customerId = String(data.customerId || "");
  if (!customerId) throw Object.assign(new Error("Falta el cliente de la notificación."), { status: 400 });
  const customer = await fsGet(env, "barbers/" + barber.uid + "/customers/" + customerId);
  if (!customer || customer.data.barberUid !== barber.uid || customer.data.active === false) {
    throw Object.assign(new Error("El cliente no pertenece a este profesional."), { status: 403 });
  }
  const all = await subscriptionsForBarber(env, barber.uid);
  const targets = all.filter(item => item.data.customerId === customerId && item.data.enabled !== false);
  const sent = await deliverPush(env, targets, cleanPushPayload(data, appOrigin(env)));
  return { ok: true, sent };
}
async function sendPromotionPush(request, env) {
  const barber = await requireBarber(env, request);
  const data = await parseBody(request);
  const promotion = data.promotion || {};
  if (!promotion.active) return { ok: true, sent: 0, nextOffset: null };
  const startsAt = promotion.startsAt ? new Date(promotion.startsAt).getTime() : 0;
  const endsAt = promotion.endsAt ? new Date(promotion.endsAt).getTime() : Infinity;
  const now = Date.now();
  if ((promotion.startsAt && !Number.isFinite(startsAt)) || (promotion.endsAt && !Number.isFinite(endsAt))) {
    throw Object.assign(new Error("Las fechas de la promoción no son válidas."), { status: 400 });
  }
  if (startsAt > now || endsAt < now) return { ok: true, sent: 0, nextOffset: null };
  const audience = ["all", "selected", "except"].includes(promotion.audience) ? promotion.audience : "all";
  const ids = new Set(Array.isArray(promotion.customerIds) ? promotion.customerIds.map(String) : []);
  const offset = Math.max(0, Number(data.offset) || 0);
  const all = await subscriptionsForBarber(env, barber.uid);
  const matched = all.filter(item => {
    const customerId = String(item.data.customerId || "");
    if (!customerId || item.data.enabled === false || item.data.barberUid !== barber.uid) return false;
    if (audience === "selected") return ids.has(customerId);
    if (audience === "except") return !ids.has(customerId);
    return true;
  });
  const chunk = matched.slice(offset, offset + 15);
  const payload = cleanPushPayload({
    title: promotion.title || "Nueva promoción",
    body: promotion.description || "Tu profesional publicó una promoción en Barber VIP.",
    tag: "promotion-" + String(promotion.id || "update")
  }, appOrigin(env));
  const sent = await deliverPush(env, chunk, payload);
  const nextOffset = offset + chunk.length < matched.length ? offset + chunk.length : null;
  return { ok: true, sent, nextOffset, total: matched.length };
}
async function resetCustomerPassword(request, env) {
  const barber = await requireBarber(env, request);
  const data = await parseBody(request);
  const customerId = String(data.customerId || "");
  const password = String(data.password || "");
  if (!customerId || password.length < 6 || password.length > 128) {
    throw Object.assign(new Error("Ingresá una contraseña de entre 6 y 128 caracteres."), { status: 400 });
  }
  const customer = await fsGet(env, "barbers/" + barber.uid + "/customers/" + customerId);
  if (!customer || customer.data.barberUid !== barber.uid || customer.data.active === false) {
    throw Object.assign(new Error("El cliente no pertenece a este profesional o está inactivo."), { status: 403 });
  }
  const token = await googleAccessToken(env);
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/projects/" + encodeURIComponent(projectId(env)) + "/accounts:update",
    {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ localId: customerId, password })
    }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Firebase Auth admin update failed:", response.status, result.error?.message || "");
    throw Object.assign(new Error("Firebase no pudo actualizar la contraseña del cliente."), { status: 502 });
  }
  return { ok: true };
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/health" && request.method === "GET") {
    return json({
      ok: true, service: "barber-vip-api",
      configured: {
        firebase: Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON && env.FIREBASE_WEB_API_KEY),
        mercadoPago: Boolean(env.MP_ACCESS_TOKEN && env.MP_WEBHOOK_SECRET),
        push: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
      }
    }, 200, corsHeaders(request, env));
  }
  if (path === "/api/mercadopago-webhook" && ["POST", "GET"].includes(request.method)) return handleMercadoPagoWebhook(request, env);
  if (path === "/api/push" && request.method === "GET") {
    return json({ ok: true, enabled: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY), publicKey: env.VAPID_PUBLIC_KEY || "" }, 200, corsHeaders(request, env));
  }
  if (path === "/api/create-preference" && request.method === "POST") {
    return json(await createPaymentPreference(request, env), 200, corsHeaders(request, env));
  }
  if (path === "/api/push" && request.method === "POST") {
    const context = await requireCustomer(env, request);
    const data = await parseBody(request);
    return json(await savePushSubscription(env, context, data.subscription), 200, corsHeaders(request, env));
  }
  if (path === "/api/push" && request.method === "DELETE") {
    const context = await requireCustomer(env, request);
    const data = await parseBody(request);
    return json(await removePushSubscription(env, context, data.endpoint), 200, corsHeaders(request, env));
  }
  if (path === "/api/push/send" && request.method === "POST") return json(await sendVisitPush(request, env), 200, corsHeaders(request, env));
  if (path === "/api/push/promotion" && request.method === "POST") return json(await sendPromotionPush(request, env), 200, corsHeaders(request, env));
  if (path === "/api/push/remove-customer" && request.method === "POST") return json(await removeCustomerPushSubscriptions(request, env), 200, corsHeaders(request, env));
  if (path === "/api/customers/reset-password" && request.method === "POST") return json(await resetCustomerPassword(request, env), 200, corsHeaders(request, env));
  return json({ ok: false, error: "Ruta no encontrada." }, 404, corsHeaders(request, env));
}

export default {
  async fetch(request, env) {
    if (!originAllowed(request, env)) return json({ ok: false, error: "Origen no autorizado." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    try {
      return await route(request, env);
    } catch (error) {
      console.error("[Barber VIP Worker]", error?.message || "Error");
      return responseError(error, request, env);
    }
  }
};

export { renewalExpiry, planCanOperate, subscriptionStatus, safeEqual, validMercadoPagoSignature, encodeValue, decodeValue };
