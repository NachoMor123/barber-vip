import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  renewalExpiry,
  planCanOperate,
  subscriptionStatus,
  validMercadoPagoSignature
} from "../src/index.js";

const DAY = 86_400_000;
const base = new Date("2026-11-11T12:00:00.000Z");
const trialExpiry = new Date(base.getTime() + 7 * DAY);
const paidExpiry = new Date(base.getTime() + 30 * DAY);

function trialProfile(expiry = trialExpiry) {
  return {
    trialStartedAt: base,
    subscriptionExpiresAt: expiry,
    hasPaidSubscription: false
  };
}

function paidProfile(expiry = paidExpiry) {
  return {
    subscriptionExpiresAt: expiry,
    hasPaidSubscription: true,
    lastPaymentAt: base
  };
}

test("a free trial is active only before its exact expiry and never gets grace", () => {
  const trial = trialProfile();
  assert.equal(subscriptionStatus(trial, trialExpiry.getTime() - 1), "active");
  assert.equal(planCanOperate(trial, trialExpiry.getTime() - 1), true);
  assert.equal(subscriptionStatus(trial, trialExpiry.getTime()), "suspended");
  assert.equal(planCanOperate(trial, trialExpiry.getTime()), false);
  assert.equal(subscriptionStatus(trial, trialExpiry.getTime() + 4 * DAY), "suspended");
  assert.equal(planCanOperate(trial, trialExpiry.getTime() + 4 * DAY), false);
});

test("a paid plan enters exactly five days of grace at expiry", () => {
  const paid = paidProfile();
  const graceEnd = paidExpiry.getTime() + 5 * DAY;
  assert.equal(subscriptionStatus(paid, paidExpiry.getTime() - 1), "active");
  assert.equal(planCanOperate(paid, paidExpiry.getTime() - 1), true);
  assert.equal(subscriptionStatus(paid, paidExpiry.getTime()), "grace");
  assert.equal(planCanOperate(paid, paidExpiry.getTime()), true);
  assert.equal(subscriptionStatus(paid, graceEnd - 1), "grace");
  assert.equal(planCanOperate(paid, graceEnd - 1), true);
  assert.equal(subscriptionStatus(paid, graceEnd), "suspended");
  assert.equal(planCanOperate(paid, graceEnd), false);
});

test("missing or invalid subscription dates fail closed", () => {
  assert.equal(subscriptionStatus({}, base.getTime()), "suspended");
  assert.equal(planCanOperate({}, base.getTime()), false);
  assert.equal(subscriptionStatus({ subscriptionExpiresAt: "not-a-date", hasPaidSubscription: true }, base.getTime()), "suspended");
  assert.equal(planCanOperate({ subscriptionExpiresAt: "not-a-date", hasPaidSubscription: true }, base.getTime()), false);
});

test("early paid renewal extends the current term without losing remaining days", () => {
  const approval = base;
  const current = new Date(base.getTime() + 10 * DAY);
  assert.equal(renewalExpiry(current, approval, "renew").getTime(), current.getTime() + 30 * DAY);
});

test("renewal after expiry starts at approval and a trial activation starts at approval", () => {
  const approval = base;
  const expired = new Date(base.getTime() - DAY);
  assert.equal(renewalExpiry(expired, approval, "renew").getTime(), approval.getTime() + 30 * DAY);
  const futureTrialExpiry = new Date(base.getTime() + 2 * DAY);
  assert.equal(renewalExpiry(futureTrialExpiry, approval, "skip-trial").getTime(), approval.getTime() + 30 * DAY);
});

test("Mercado Pago signature uses data.id, x-request-id and the signed manifest", async () => {
  const secret = "local-test-webhook-secret";
  const paymentId = "987654321";
  const requestId = "bv-test-request-001";
  const ts = "1794400000000";
  const manifest = "id:" + paymentId + ";request-id:" + requestId + ";ts:" + ts + ";";
  const signature = createHmac("sha256", secret).update(manifest).digest("hex");
  const request = new Request("https://worker.example/api/mercadopago-webhook?data.id=" + paymentId + "&type=payment", {
    headers: { "x-signature": "ts=" + ts + ",v1=" + signature, "x-request-id": requestId }
  });
  assert.equal(await validMercadoPagoSignature(request, paymentId, secret), true);
  assert.equal(await validMercadoPagoSignature(request, "987654322", secret), false);
  assert.equal(await validMercadoPagoSignature(request, paymentId, "wrong-secret"), false);
  assert.equal(await validMercadoPagoSignature(new Request("https://worker.example/"), paymentId, secret), false);
});

console.log("Subscription boundaries, renewals, and Mercado Pago webhook signatures validated.");
