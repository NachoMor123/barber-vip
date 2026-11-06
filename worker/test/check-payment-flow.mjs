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
assert.ok(html.includes("Mercado Pago recibió tu pago"), "the app must explain webhook confirmation after returning from Checkout");
assert.ok(html.includes("setPersistence(state.auth,browserLocalPersistence)"), "the app must persist the Firebase session across external Checkout navigation");
assert.ok(html.includes("await user.getIdToken(true);\n            me=await api('/api/me');"), "session restoration must refresh the Firebase token and retry /api/me once after a transient return-from-Checkout failure");
assert.ok(html.includes("const payment=new URLSearchParams(location.search).get('payment')"), "the payment result query must be handled after the authenticated context is restored");
assert.ok(!html.includes("el pago se coordina mediante un enlace de Mercado Pago enviado por el equipo"), "the previous manual-only payment message must be removed");
assert.ok(worker.includes('path === "/api/create-preference"'), "the Worker must expose the preference endpoint");
assert.ok(worker.includes('notification_url: workerOrigin + "/api/mercadopago-webhook"'), "each Checkout must notify the Worker webhook");
assert.ok(worker.includes("validMercadoPagoSignature(request, paymentId, env.MP_WEBHOOK_SECRET)"), "webhook signature validation must be active");
assert.ok(worker.includes('payment.status !== "approved"'), "only approved payments may be processed");
assert.ok(worker.includes('Number(payment.transaction_amount) !== amount || payment.currency_id !== "ARS"'), "webhook must enforce the configured ARS price");

console.log("Checkout UI, Worker preference route, webhook signature, and payment validation are connected.");
