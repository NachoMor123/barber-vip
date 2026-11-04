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

assert.match(html, /data-action="checkout"/, "subscription modal must expose a Checkout action");
assert.match(html, /api\('\/api\/create-preference'/, "the app must request a payment preference from the Worker");
assert.match(html, /window\.location\.assign\(checkoutUrl\.href\)/, "the app must redirect to the validated Mercado Pago URL");
assert.match(html, /Mercado Pago recibió tu pago/, "the app must explain the webhook confirmation after returning from Checkout");
assert.doesNotMatch(html, /el pago se coordina mediante un enlace de Mercado Pago enviado por el equipo/i, "the previous manual-only payment message must be removed");
assert.match(worker, /path === "\/api\/create-preference"/, "the Worker must expose the preference endpoint");
assert.match(worker, /notification_url: workerOrigin \+ "\/api\/mercadopago-webhook"/, "each Checkout must notify the Worker webhook");
assert.match(worker, /validMercadoPagoSignature\(request, paymentId, env\.MP_WEBHOOK_SECRET\)/, "webhook signature validation must be active");
assert.match(worker, /payment\.status !== "approved"/, "only approved payments may be processed");
assert.match(worker, /Number\(payment\.transaction_amount\) !== amount \|\| payment\.currency_id !== "ARS"/, "webhook must enforce the configured ARS price");
console.log("Checkout UI, Worker preference route, webhook signature, and payment validation are connected.");
