import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const [html, worker] = await Promise.all([
  readFile(join(root, "index.html"), "utf8"),
  readFile(join(root, "worker", "src", "index.js"), "utf8")
]);

assert.ok(html.includes('data-action="checkout"'), "subscription modal must expose a Checkout action");
assert.ok(html.includes("api('/api/create-preference'"), "the app must request a payment preference from the Worker");
assert.ok(html.includes("window.location.assign(checkoutUrl.href)"), "the app must redirect to the validated Mercado Pago URL");
assert.ok(html.includes("Volviste desde Mercado Pago") && html.includes("no activa los 30 días por sí solo"), "the app must not treat a Checkout redirect as payment approval");
assert.ok(html.includes("Estado sin verificar") && html.includes("No vamos a iniciar un cobro"), "missing subscription dates must not be mislabeled as expired or chargeable");
assert.ok(html.includes("Tu prueba gratuita dura 7 días") && html.includes("no tiene días de gracia"), "trial copy must state its seven-day limit and lack of grace");
assert.ok(html.includes("los 5 días de gracia terminaron"), "expired paid accounts must explain when access pauses");
assert.ok(html.includes("function elapsedDurationText") && html.includes("function remainingDurationText"), "subscription countdowns must use precise minute, hour and day units");
assert.ok(html.includes("function watchSubscriptionAfterPaymentReturn"), "a delayed payment webhook must be able to refresh the barber subscription without reloading customers");
assert.ok(html.includes("setPersistence(state.auth,browserLocalPersistence)"), "the app must persist the Firebase session across external Checkout navigation");
const resumeSessionStart = html.indexOf("async function resumeSession(user)");
const resumeSessionEnd = html.indexOf("async function signOutAndReturn()", resumeSessionStart);
assert.ok(resumeSessionStart >= 0 && resumeSessionEnd > resumeSessionStart, "the authenticated session restoration handler must exist");
const resumeSession = html.slice(resumeSessionStart, resumeSessionEnd);
assert.match(
  resumeSession,
  /else if\s*\(isRetryableError\(error\)\)\s*\{[\s\S]*?await user\.getIdToken\(true\);[\s\S]*?me=await api\('\/api\/me'\);/,
  "session restoration must refresh the Firebase token and retry /api/me once after a transient return-from-Checkout failure"
);
assert.ok(html.includes("const payment=new URLSearchParams(location.search).get('payment')"), "the payment result query must be handled after the authenticated context is restored");
assert.ok(!html.includes("el pago se coordina mediante un enlace de Mercado Pago enviado por el equipo"), "the previous manual-only payment message must be removed");
assert.ok(worker.includes('path === "/api/create-preference"'), "the Worker must expose the preference endpoint");
assert.ok(worker.includes('notification_url: workerOrigin + "/api/mercadopago-webhook"'), "each Checkout must notify the Worker webhook");
assert.ok(worker.includes("validMercadoPagoSignature(request, paymentId, env.MP_WEBHOOK_SECRET)"), "webhook signature validation must be active");
assert.ok(worker.includes('payment.live_mode !== true'), "test payments must never activate production subscriptions");
assert.ok(worker.includes('["refunded", "charged_back"].includes(status)'), "refunds and chargebacks must be processed after approval");
assert.ok(worker.includes('status: partialRefund ? "partially_refunded" : "approved"'), "partial refund state must be persisted without extending the plan twice");
assert.ok(worker.includes('data.id') && worker.includes('validMercadoPagoSignature(request, paymentId, env.MP_WEBHOOK_SECRET)'), "webhook must verify the signed data.id query parameter");
assert.ok(worker.includes('env.MP_ACCESS_TOKEN || !env.MP_WEBHOOK_SECRET'), "Checkout must be disabled if webhook signature verification is not configured");
assert.ok(worker.includes('paymentCheckout/current'), "parallel checkout requests must reuse a single active preference");
assert.ok(worker.includes('expiration_date_from: new Date(now - 60_000).toISOString()') && worker.includes('expiration_date_to: expiresAt.toISOString()'), "Checkout preferences must have an explicit validity window");
assert.ok(worker.includes('AbortSignal.timeout(15_000)'), "Mercado Pago requests must have bounded timeouts");
assert.ok(worker.includes('Number(payment.transaction_amount) !== configuredPrice || payment.currency_id !== "ARS"'), "webhook must validate the price and currency against its stored preference");

console.log("Checkout UI, Worker preference route, webhook signature, and payment validation are connected.");
